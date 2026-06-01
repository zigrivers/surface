import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import type {
  BuiltInCaptureBackendId,
  Capture,
  CaptureArtifact,
  CaptureBackend,
  CaptureNetworkPolicy,
  CaptureOptions,
  Target,
} from "./interfaces.js";

const BROWSER_BACKEND_PRIORITY = {
  "agent-browser": 2,
  playwright: 1,
} as const satisfies Record<Exclude<BuiltInCaptureBackendId, "static">, number>;

const CAPTURE_ARTIFACT_TYPES = new Set<string>([
  "screenshot",
  "dom-snapshot",
  "accessibility-tree",
  "computed-styles",
]);
const CAPTURE_STATUSES = new Set<string>([
  "requested",
  "completed",
  "degraded",
  "auth-failed",
  "unreachable",
]);
const TARGET_KINDS = new Set<string>([
  "url",
  "localhost",
  "route",
  "screenshot",
  "component",
  "dom",
]);

// Custom injected backends are treated as explicit user wiring and win over built-ins.
const CUSTOM_BACKEND_PRIORITY = 3;

export type CaptureIdFactory = (target: Target) => string;
export type CaptureClock = () => string;
export type CaptureRandomHex = () => string;

export interface CaptureService {
  capture(target: Target, options: CaptureOptions): Promise<Result<Capture, SurfaceError>>;
}

export interface CaptureServiceOptions {
  readonly backends: readonly CaptureBackend[];
  readonly staticFallback: CaptureBackend;
}

export function createCaptureService(options: CaptureServiceOptions): CaptureService {
  return {
    async capture(target, captureOptions) {
      const authorization = await authorizeCaptureTarget(target, captureOptions?.config);

      if (!authorization.ok) {
        return err(authorization.error);
      }

      const authorizedOptions = withCaptureNetworkPolicy(captureOptions, authorization.value);
      const detectedBackend = selectCaptureBackend(options.backends);
      const backend = detectedBackend ?? options.staticFallback;
      const result = await observeBackend(
        backend,
        target,
        authorizedOptions,
        detectedBackend === undefined ? "fallback" : "selected",
      );

      if (detectedBackend !== undefined && shouldUseStaticFallback(result)) {
        const fallbackResult = await observeBackend(
          options.staticFallback,
          target,
          authorizedOptions,
          "fallback",
        );

        if (fallbackResult.ok) {
          return ok(annotateFallbackCapture(fallbackResult.value, backend.id, result.error));
        }

        return result;
      }

      return result;
    },
  };
}

export function selectCaptureBackend(
  backends: readonly CaptureBackend[],
): CaptureBackend | undefined {
  return backends
    .map((backend, index) => ({ backend, index }))
    .filter(({ backend }) => backend.id !== "static" && detectBackend(backend))
    .sort((left, right) => compareBackendSelection(left, right))[0]?.backend;
}

function compareBackendSelection(
  left: { readonly backend: CaptureBackend; readonly index: number },
  right: { readonly backend: CaptureBackend; readonly index: number },
): number {
  const leftPriority = backendSelectionPriority(left.backend.id);
  const rightPriority = backendSelectionPriority(right.backend.id);

  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  return left.index - right.index;
}

function backendSelectionPriority(id: string): number {
  // Built-in backend IDs are reserved; custom backends should use project/plugin IDs.
  return Object.prototype.hasOwnProperty.call(BROWSER_BACKEND_PRIORITY, id)
    ? BROWSER_BACKEND_PRIORITY[id as keyof typeof BROWSER_BACKEND_PRIORITY]
    : CUSTOM_BACKEND_PRIORITY;
}

function detectBackend(backend: CaptureBackend): boolean {
  try {
    return backend.detect();
  } catch {
    return false;
  }
}

export function createDefaultCaptureIdFactory(
  options: {
    readonly clock?: CaptureClock;
    readonly randomHex?: CaptureRandomHex;
  } = {},
): CaptureIdFactory {
  let sequence = 0;
  const clock = options.clock ?? (() => new Date().toISOString());
  const randomHex = options.randomHex ?? defaultRandomHex;

  return (target) => {
    sequence += 1;

    const normalized = slugSourceForTarget(target)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const trimmed = normalized.slice(0, 48).replace(/^-+|-+$/g, "");
    const slug = trimmed.length === 0 ? "capture" : trimmed;
    const parsedTimestamp = Date.parse(clock());
    const timestamp = Number.isNaN(parsedTimestamp) ? "unknown" : parsedTimestamp.toString(36);

    return `cap-${slug}-${timestamp}-${sequence.toString(36)}-${randomHex()}`;
  };
}

function defaultRandomHex(): string {
  return randomBytes(8).toString("hex");
}

function slugSourceForTarget(target: Target): string {
  if (target.kind === "url" || target.kind === "localhost") {
    const url = parseTargetUrl(target.ref, target.kind);

    if (url === undefined) {
      return target.kind;
    }

    const port = url.port.length > 0 ? `:${url.port}` : "";

    return `${target.kind}:${url.hostname}${port}`;
  }

  if (target.kind === "route") {
    return `${target.kind}:${target.ref.split(/[?#]/, 1)[0]}`;
  }

  if (target.kind === "screenshot") {
    return `${target.kind}:${basenameLike(target.ref)}`;
  }

  return `${target.kind}:${target.ref.split(/[?#]/, 1)[0]}`;
}

async function authorizeCaptureTarget(
  target: Target,
  config: CaptureOptions["config"] | undefined,
): Promise<Result<CaptureNetworkPolicy | undefined, SurfaceError>> {
  if (target.kind === "route" && !isSafeRouteRef(target.ref)) {
    return err(
      createSurfaceError("capture_failed", "Route capture target must be a path-only route.", {
        details: { targetKind: target.kind },
      }),
    );
  }

  if (target.kind !== "url" && target.kind !== "localhost") {
    return ok(undefined);
  }

  const url = parseTargetUrl(target.ref, target.kind);

  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return err(
      createSurfaceError("capture_failed", "Capture target URL is not an allowed HTTP(S) URL.", {
        details: { targetKind: target.kind },
      }),
    );
  }

  const resolvedAddresses = await resolveHostAddresses(url.hostname);

  if (
    resolvedAddresses === undefined ||
    isUnsafeHost(url.hostname, target.kind) ||
    resolvedAddresses.some((address) => isUnsafeHost(address, target.kind))
  ) {
    return err(
      createSurfaceError("capture_failed", "Capture target host is not allowed.", {
        details: { host: url.hostname, targetKind: target.kind },
      }),
    );
  }

  const allowlist = config?.allowlist ?? [];

  if (!isAllowlisted(url, target, allowlist)) {
    return err(
      createSurfaceError("capture_failed", "Capture target is outside the configured allowlist.", {
        details: {
          allowlist,
          targetKind: target.kind,
          targetOrigin: url.origin,
        },
      }),
    );
  }

  return ok({
    allowlist,
    blockPrivateNetwork: true,
    enforceOnNavigation: true,
    enforceOnRedirects: true,
    enforceOnSubresources: true,
    resolvedAddresses,
    targetHost: url.hostname,
    targetOrigin: url.origin,
  });
}

function withCaptureNetworkPolicy(
  options: CaptureOptions,
  networkPolicy: CaptureNetworkPolicy | undefined,
): CaptureOptions {
  if (networkPolicy === undefined) {
    return options;
  }

  return { ...options, networkPolicy };
}

function isSafeRouteRef(ref: string): boolean {
  if (ref.trim().length === 0 || ref !== ref.trim() || ref.includes("\\") || hasControl(ref)) {
    return false;
  }

  if (ref.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(ref)) {
    return false;
  }

  return !routePathSegments(ref).includes("..");
}

function routePathSegments(ref: string): readonly string[] {
  const path = ref.split(/[?#]/, 1)[0] ?? "";

  try {
    return decodeURIComponent(path).split("/");
  } catch {
    return [".."];
  }
}

function isAllowlisted(url: URL, target: Target, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }

  return allowlist.some((entry) => {
    if (entry === "*") {
      return true;
    }

    const normalizedEntry = entry.trim().toLowerCase();
    const allowlistUrl = parseTargetUrl(entry, target.kind);

    if (allowlistUrl !== undefined) {
      return urlMatchesAllowlistUrl(url, allowlistUrl);
    }

    if (
      normalizedEntry === target.ref.toLowerCase() ||
      normalizedEntry === url.origin.toLowerCase() ||
      normalizedEntry === url.host.toLowerCase() ||
      normalizedEntry === url.hostname.toLowerCase()
    ) {
      return true;
    }

    return false;
  });
}

function urlMatchesAllowlistUrl(url: URL, allowlistUrl: URL): boolean {
  if (allowlistUrl.origin !== url.origin) {
    return false;
  }

  if (allowlistUrl.pathname === "/" || allowlistUrl.pathname.length === 0) {
    return true;
  }

  const allowPath = allowlistUrl.pathname.endsWith("/")
    ? allowlistUrl.pathname
    : `${allowlistUrl.pathname}/`;

  return url.pathname === allowlistUrl.pathname || url.pathname.startsWith(allowPath);
}

async function resolveHostAddresses(hostname: string): Promise<readonly string[] | undefined> {
  const host = normalizeHostname(hostname);

  if (isIpLiteral(host) || host === "localhost") {
    return [host];
  }

  try {
    const records = await lookup(host, { all: true, verbatim: true });

    return records.map((record) => record.address);
  } catch {
    return undefined;
  }
}

function isUnsafeHost(hostname: string, kind: Target["kind"]): boolean {
  const host = normalizeHostname(hostname);

  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    return true;
  }

  if (kind === "localhost") {
    return !isLoopbackHost(host);
  }

  return isLoopbackHost(host) || isPrivateHost(host);
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase().replace(/\.$/, "");
  const unbracketed = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  const mappedPrefix = "::ffff:";

  if (!unbracketed.startsWith(mappedPrefix)) {
    return unbracketed;
  }

  const mapped = unbracketed.slice(mappedPrefix.length);
  const mappedIpv4 = ipv4FromMappedIpv6(mapped);

  return mappedIpv4 ?? mapped;
}

function isLoopbackHost(host: string): boolean {
  const compatibleIpv4 = ipv4CompatibleFromIpv6(host);

  return (
    host === "localhost" ||
    host.startsWith("127.") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.startsWith("::ffff:127.") ||
    (compatibleIpv4 !== undefined && isLoopbackHost(compatibleIpv4))
  );
}

function isPrivateHost(host: string): boolean {
  const octets = parseIpv4Octets(host);

  if (octets !== undefined) {
    const [first, second, third] = octets;

    return (
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0 && (third === 0 || third === 2)) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  const compatibleIpv4 = ipv4CompatibleFromIpv6(host);

  if (compatibleIpv4 !== undefined) {
    return isLoopbackHost(compatibleIpv4) || isPrivateHost(compatibleIpv4);
  }

  const firstHextet = parseFirstIpv6Hextet(host);

  if (firstHextet !== undefined) {
    return (
      host.startsWith("64:ff9b:") ||
      host === "64:ff9b::" ||
      (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
      (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
      firstHextet >= 0xff00
    );
  }

  return host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd");
}

function parseIpv4Octets(host: string): readonly [number, number, number, number] | undefined {
  const parts = host.split(".");

  if (parts.length !== 4) {
    return undefined;
  }

  if (parts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }

  const octets = parts.map((part) => Number(part));

  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }

  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

function ipv4FromMappedIpv6(mapped: string): string | undefined {
  const dotted = parseIpv4Octets(mapped);

  if (dotted !== undefined) {
    return mapped;
  }

  const parts = mapped.split(":");

  if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) {
    return undefined;
  }

  const high = Number.parseInt(parts[0]!, 16);
  const low = Number.parseInt(parts[1]!, 16);
  const value = high * 0x10000 + low;

  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    ".",
  );
}

function ipv4CompatibleFromIpv6(host: string): string | undefined {
  if (!host.startsWith("::") || host === "::" || host === "::1") {
    return undefined;
  }

  const parts = host.split(":").filter((part) => part.length > 0);
  const dottedTail = parts.at(-1);

  if (dottedTail !== undefined && parseIpv4Octets(dottedTail) !== undefined) {
    return dottedTail;
  }

  const low = parts.at(-1);
  const high = parts.at(-2);

  if (high === undefined || low === undefined) {
    return undefined;
  }

  return ipv4FromMappedIpv6(`${high}:${low}`);
}

function parseFirstIpv6Hextet(host: string): number | undefined {
  if (!host.includes(":")) {
    return undefined;
  }

  const first = host.split(":", 1)[0];

  if (first === undefined || !/^[0-9a-f]{1,4}$/i.test(first)) {
    return undefined;
  }

  return Number.parseInt(first, 16);
}

function isIpLiteral(host: string): boolean {
  return parseIpv4Octets(host) !== undefined || host.includes(":");
}

function parseTargetUrl(ref: string, kind: Target["kind"]): URL | undefined {
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(ref);
  const parseRef = kind === "localhost" && !hasScheme ? `http://${ref}` : ref;

  try {
    return new URL(parseRef);
  } catch {
    return undefined;
  }
}

function basenameLike(ref: string): string {
  const withoutQuery = ref.split(/[?#]/, 1)[0] ?? "";
  const segments = withoutQuery.split(/[\\/]/).filter((segment) => segment.length > 0);

  return segments.at(-1) ?? "";
}

async function observeBackend(
  backend: CaptureBackend,
  target: Target,
  options: CaptureOptions,
  role: "fallback" | "selected",
): Promise<Result<Capture, SurfaceError>> {
  try {
    const result = await backend.observe(target, options);

    if (!result.ok) {
      return result;
    }

    const invariantError = await validateCapture(result.value, target, backend.id, role, options);

    if (invariantError !== undefined) {
      return err(invariantError);
    }

    return result;
  } catch (cause) {
    return err(
      createSurfaceError(
        "capture_failed",
        `Capture backend ${backend.id} threw during observe().`,
        {
          cause,
          details: { backendId: backend.id },
        },
      ),
    );
  }
}

async function validateCapture(
  capture: Capture,
  requestedTarget: Target,
  backendId: string,
  role: "fallback" | "selected",
  options: CaptureOptions,
): Promise<SurfaceError | undefined> {
  const candidate = capture as Partial<Capture> | null;

  if (candidate === null || typeof candidate !== "object") {
    return invalidCapture(undefined, backendId, "backend result did not include capture metadata");
  }

  if (!isSafeCaptureId(candidate.id)) {
    return invalidCapture(candidate, backendId, "capture id must be a path-safe non-empty string");
  }

  if (!isNonEmptyString(candidate.backend)) {
    return invalidCapture(candidate, backendId, "capture backend is required");
  }

  if (candidate.backend !== backendId) {
    return invalidCapture(candidate, backendId, "capture backend must match producing backend");
  }

  if (!isIsoTimestamp(candidate.capturedAt)) {
    return invalidCapture(candidate, backendId, "capturedAt must be a valid ISO timestamp");
  }

  if (!isKnownStatus(candidate.status)) {
    return invalidCapture(candidate, backendId, "capture status is invalid");
  }

  if (!isValidTarget(candidate.target)) {
    return invalidCapture(candidate, backendId, "capture target is invalid");
  }

  if (!targetMatchesRequested(candidate.target, requestedTarget)) {
    return invalidCapture(candidate, backendId, "capture target must match requested target");
  }

  const artifacts = Array.isArray(candidate.artifacts) ? candidate.artifacts : undefined;

  if (artifacts === undefined) {
    return invalidCapture(candidate, backendId, "capture artifacts array is required");
  }

  if (!artifacts.every(isValidArtifact)) {
    return invalidCapture(candidate, backendId, "capture artifact metadata is invalid");
  }

  if (
    (candidate.status === "completed" || candidate.status === "degraded") &&
    artifacts.length === 0
  ) {
    return invalidCapture(candidate, backendId, "completed and degraded captures need artifacts");
  }

  if (!(await artifactsUnderCaptureRoot(candidate, artifacts, options))) {
    return invalidCapture(candidate, backendId, "capture artifacts must exist under capture root");
  }

  if (candidate.status === "degraded") {
    const skippedArtifacts = candidate.degradation?.skippedArtifacts;
    const skippedReason = candidate.degradation?.skippedReason;

    if (
      !Array.isArray(skippedArtifacts) ||
      skippedArtifacts.length === 0 ||
      !skippedArtifacts.every(
        (artifact) => typeof artifact === "string" && CAPTURE_ARTIFACT_TYPES.has(artifact),
      ) ||
      typeof skippedReason !== "string" ||
      skippedReason.trim().length === 0
    ) {
      return invalidCapture(candidate, backendId, "degraded captures need degradation metadata");
    }
  } else if (candidate.degradation !== undefined) {
    return invalidCapture(
      candidate,
      backendId,
      "degradation metadata is only valid for degraded captures",
    );
  }

  if (backendId === "static" && role === "fallback" && candidate.status === "completed") {
    return invalidCapture(candidate, backendId, "static fallback captures must be degraded");
  }

  if (
    backendId === "static" &&
    role === "fallback" &&
    artifacts.some((artifact) => artifact.type !== "screenshot")
  ) {
    return invalidCapture(
      candidate,
      backendId,
      "static fallback captures may only emit screenshots",
    );
  }

  return undefined;
}

function invalidCapture(
  capture: Partial<Capture> | undefined,
  backendId: string,
  reason: string,
): SurfaceError {
  return createSurfaceError(
    "capture_failed",
    `Capture backend ${backendId} returned invalid capture metadata.`,
    {
      details: {
        backendId,
        captureBackend: capture?.backend,
        captureId: capture?.id,
        reason,
        status: capture?.status,
        validation: true,
      },
    },
  );
}

function isValidArtifact(artifact: unknown): boolean {
  if (artifact === null || typeof artifact !== "object") {
    return false;
  }

  const candidate = artifact as {
    readonly id?: unknown;
    readonly path?: unknown;
    readonly redacted?: unknown;
    readonly type?: unknown;
  };

  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.path) &&
    typeof candidate.redacted === "boolean" &&
    typeof candidate.type === "string" &&
    CAPTURE_ARTIFACT_TYPES.has(candidate.type)
  );
}

async function artifactsUnderCaptureRoot(
  capture: Partial<Capture>,
  artifacts: readonly CaptureArtifact[],
  options: CaptureOptions,
): Promise<boolean> {
  if (artifacts.length === 0) {
    return true;
  }

  if (!isSafeCaptureId(capture.id)) {
    return false;
  }

  const captureRoot = resolve(options.artifactRoot ?? ".surface/captures", capture.id);

  try {
    const realArtifactRoot = await realpath(options.artifactRoot ?? ".surface/captures");
    const realCaptureRoot = await realpath(captureRoot);
    const captureRelativePath = relative(realArtifactRoot, realCaptureRoot);

    if (
      captureRelativePath.length === 0 ||
      captureRelativePath.startsWith("..") ||
      isAbsolute(captureRelativePath)
    ) {
      return false;
    }

    for (const artifact of artifacts) {
      const realArtifactPath = await realpathFirst(
        artifactPathCandidates(
          artifact.path,
          captureRoot,
          options.artifactRoot ?? ".surface/captures",
        ),
      );

      if (realArtifactPath === undefined) {
        return false;
      }

      const artifactRelativePath = relative(realCaptureRoot, realArtifactPath);

      if (
        artifactRelativePath.length === 0 ||
        artifactRelativePath.startsWith("..") ||
        isAbsolute(artifactRelativePath)
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function artifactPathCandidates(
  artifactPath: string,
  captureRoot: string,
  artifactRoot: string,
): readonly string[] {
  if (isAbsolute(artifactPath)) {
    return [resolve(artifactPath)];
  }

  return [resolve(captureRoot, artifactPath), resolve(artifactRoot, artifactPath)];
}

async function realpathFirst(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      return await realpath(path);
    } catch {
      // Try the next supported relative-path base.
    }
  }

  return undefined;
}

function isValidTarget(target: unknown): target is Target {
  if (target === null || typeof target !== "object") {
    return false;
  }

  const candidate = target as {
    readonly kind?: unknown;
    readonly ref?: unknown;
  };

  return (
    typeof candidate.kind === "string" &&
    TARGET_KINDS.has(candidate.kind) &&
    isNonEmptyString(candidate.ref)
  );
}

function targetMatchesRequested(candidate: Target, requested: Target): boolean {
  return candidate.kind === requested.kind && candidate.ref === requested.ref;
}

function isKnownStatus(status: unknown): status is Capture["status"] {
  return typeof status === "string" && CAPTURE_STATUSES.has(status);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSafeCaptureId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== ".."
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );

  if (match === null) {
    return false;
  }

  const [, year, month, day, hour, minute, second, fractional = "0"] = match;
  const yearValue = Number(year);
  const monthValue = Number(month);
  const dayValue = Number(day);
  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  const secondValue = Number(second);
  const millisecondValue = Number(fractional.slice(0, 3).padEnd(3, "0"));
  const localDate = new Date(
    Date.UTC(
      yearValue,
      monthValue - 1,
      dayValue,
      hourValue,
      minuteValue,
      secondValue,
      millisecondValue,
    ),
  );

  if (
    localDate.getUTCFullYear() !== yearValue ||
    localDate.getUTCMonth() !== monthValue - 1 ||
    localDate.getUTCDate() !== dayValue ||
    localDate.getUTCHours() !== hourValue ||
    localDate.getUTCMinutes() !== minuteValue ||
    localDate.getUTCSeconds() !== secondValue
  ) {
    return false;
  }

  const parsed = Date.parse(value);

  return !Number.isNaN(parsed);
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }

  return false;
}

function shouldUseStaticFallback(result: Result<Capture, SurfaceError>): result is {
  readonly ok: false;
  readonly error: SurfaceError;
} {
  if (result.ok) {
    return false;
  }

  const error = result.error;

  if (isValidationError(error)) {
    return false;
  }

  return error?.code === "capture_failed" || error?.code === "capture_unreachable";
}

function isValidationError(error: SurfaceError | null | undefined): boolean {
  return error?.details?.["validation"] === true;
}

function annotateFallbackCapture(
  capture: Capture,
  failedBackendId: string,
  failure: SurfaceError,
): Capture {
  const fallbackReason = capture.degradation?.skippedReason;
  const failureReason = `browser backend ${failedBackendId} failed with ${failure.code}`;

  return {
    ...capture,
    degradation: {
      skippedArtifacts: capture.degradation?.skippedArtifacts ?? [],
      skippedReason:
        fallbackReason === undefined ? failureReason : `${fallbackReason}. ${failureReason}`,
    },
  };
}
