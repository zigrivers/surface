import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";

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
const cjsRequire = createRequire(import.meta.url);

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

export interface PlaywrightCaptureBackendOptions {
  readonly available?: boolean;
  readonly clock?: CaptureClock;
  readonly idFactory?: CaptureIdFactory;
  readonly loadPlaywright?: () => Promise<unknown>;
}

type HostAddressCache = Map<string, Promise<readonly string[] | undefined>>;

interface PlaywrightModule {
  readonly chromium: {
    launch(options: { readonly headless: true }): Promise<PlaywrightBrowser>;
  };
}

interface PlaywrightBrowser {
  close(): Promise<void>;
  newContext(options: PlaywrightContextOptions): Promise<PlaywrightBrowserContext>;
}

interface PlaywrightContextOptions {
  colorScheme?: ThemeLike;
  serviceWorkers?: "block";
  storageState?: string;
  viewport?: { readonly height: number; readonly width: number };
}

interface PlaywrightBrowserContext {
  close(): Promise<void>;
  newCDPSession(page: PlaywrightPage): Promise<PlaywrightCDPSession>;
  newPage(): Promise<PlaywrightPage>;
  route(pattern: string, handler: (route: PlaywrightRoute) => Promise<void>): Promise<void>;
  routeWebSocket?(
    pattern: string,
    handler: (route: PlaywrightWebSocketRoute) => Promise<void>,
  ): Promise<void>;
}

interface PlaywrightPage {
  close(): Promise<void>;
  content(): Promise<string>;
  evaluate<T, Arg>(pageFunction: string | ((arg: Arg) => T), arg: Arg): Promise<T>;
  goto(
    url: string,
    options: { readonly timeout: number; readonly waitUntil: "domcontentloaded" | "load" },
  ): Promise<unknown>;
  screenshot(options: { readonly fullPage: true; readonly path: string }): Promise<unknown>;
}

interface PlaywrightCDPSession {
  detach?(): Promise<void>;
  send(method: "Accessibility.getFullAXTree"): Promise<unknown>;
}

interface PlaywrightRoute {
  abort(errorCode: "blockedbyclient"): Promise<void>;
  continue(): Promise<void>;
  request(): {
    url(): string;
  };
}

interface PlaywrightWebSocketRoute {
  close(): Promise<void> | void;
  connectToServer(): Promise<void> | void;
  url(): string;
}

type ThemeLike = "dark" | "light";

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

export function createPlaywrightCaptureBackend(
  options: PlaywrightCaptureBackendOptions = {},
): CaptureBackend {
  const idFactory = options.idFactory ?? createDefaultCaptureIdFactory();
  const clock = options.clock ?? (() => new Date().toISOString());
  const loadPlaywright = options.loadPlaywright ?? defaultLoadPlaywright;

  return {
    id: "playwright",
    detect: () =>
      options.available ?? (canResolveModule("playwright") || canResolveModule("playwright-core")),
    observe: async (target, captureOptions) => {
      const targetUrl = targetUrlForPlaywright(target);

      if (targetUrl === undefined) {
        return err(
          createSurfaceError(
            "capture_failed",
            `Playwright backend does not support ${target.kind} targets.`,
            {
              details: { backendId: "playwright", targetKind: target.kind },
            },
          ),
        );
      }

      const captureId = idFactory(target);
      const artifactRoot = captureOptions.artifactRoot ?? ".surface/captures";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      const domPath = join(captureRoot, "dom.html");
      const accessibilityPath = join(captureRoot, "accessibility-tree.json");
      const computedStylesPath = join(captureRoot, "computed-styles.json");
      // Browser evidence is raw; redaction remains a downstream reporting concern.
      const artifactRedacted = false;
      const hostAddressCache: HostAddressCache = new Map();
      let browser: PlaywrightBrowser | undefined;
      let context: PlaywrightBrowserContext | undefined;
      let page: PlaywrightPage | undefined;

      try {
        const playwright = (await loadPlaywright()) as PlaywrightModule;
        browser = await playwright.chromium.launch({ headless: true });
        context = await browser.newContext(playwrightContextOptions(target, captureOptions));
        await context.route("**/*", (route) =>
          handlePlaywrightRoute(route, target, captureOptions, hostAddressCache),
        );
        await context.routeWebSocket?.("**/*", (webSocketRoute) =>
          handlePlaywrightWebSocketRoute(webSocketRoute, target, captureOptions, hostAddressCache),
        );
        page = await context.newPage();

        await mkdir(captureRoot, { recursive: true });
        await page.goto(targetUrl, {
          timeout: captureOptions.navigationTimeoutMs ?? 15_000,
          waitUntil: captureOptions.navigationWaitUntil ?? "load",
        });
        await page.screenshot({ fullPage: true, path: screenshotPath });
        await writeFile(domPath, await page.content());
        await writeFile(
          accessibilityPath,
          JSON.stringify(await playwrightAccessibilitySnapshot(page, context), null, 2),
        );
        await writeFile(
          computedStylesPath,
          JSON.stringify(
            await computedStyleSnapshot(page, captureOptions.computedStyleLimit ?? 2_000),
            null,
            2,
          ),
        );

        return ok({
          artifacts: [
            {
              id: "screenshot",
              path: screenshotPath,
              redacted: artifactRedacted,
              type: "screenshot",
            },
            {
              id: "dom",
              path: domPath,
              redacted: artifactRedacted,
              type: "dom-snapshot",
            },
            {
              id: "accessibility-tree",
              path: accessibilityPath,
              redacted: artifactRedacted,
              type: "accessibility-tree",
            },
            {
              id: "computed-styles",
              path: computedStylesPath,
              redacted: artifactRedacted,
              type: "computed-styles",
            },
          ],
          backend: "playwright",
          capturedAt: clock(),
          id: captureId,
          status: "completed",
          target,
        });
      } catch (cause) {
        await rm(captureRoot, { force: true, recursive: true }).catch(() => {});

        return err(playwrightCaptureError(cause, target));
      } finally {
        await closePlaywrightResources(page, context, browser);
      }
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

async function defaultLoadPlaywright(): Promise<unknown> {
  try {
    return await import("playwright");
  } catch {
    if (canResolveModule("playwright-core")) {
      return importOptionalModule("playwright-core");
    }

    throw new Error("playwright is not installed");
  }
}

async function importOptionalModule(id: string): Promise<unknown> {
  return import(id);
}

function canResolveModule(id: string): boolean {
  try {
    cjsRequire.resolve(id);

    return true;
  } catch {
    return false;
  }
}

function targetUrlForPlaywright(target: Target): string | undefined {
  if (target.kind === "url") {
    return target.ref;
  }

  if (target.kind === "localhost") {
    return parseTargetUrl(target.ref, target.kind)?.toString();
  }

  return undefined;
}

async function playwrightRequestAllowed(
  requestUrl: string,
  target: Target,
  options: CaptureOptions,
  hostAddressCache: HostAddressCache,
): Promise<boolean> {
  const policy = options.networkPolicy;

  if (policy === undefined) {
    return true;
  }

  const url = policyUrlForRequest(requestUrl);

  if (url === undefined) {
    return false;
  }

  const resolvedAddresses = await resolveHostAddressesForPolicy(url.hostname, hostAddressCache);
  const safetyKind = requestSafetyKind(url, target, policy);

  if (
    resolvedAddresses === undefined ||
    isUnsafeHost(url.hostname, safetyKind) ||
    resolvedAddresses.some((address) => isUnsafeHost(address, safetyKind))
  ) {
    return false;
  }

  if (policy.allowlist.length === 0) {
    return url.origin === policy.targetOrigin;
  }

  if (url.origin === policy.targetOrigin) {
    return true;
  }

  return isAllowlisted(url, { kind: safetyKind, ref: requestUrl }, policy.allowlist);
}

async function handlePlaywrightRoute(
  route: PlaywrightRoute,
  target: Target,
  options: CaptureOptions,
  hostAddressCache: HostAddressCache,
): Promise<void> {
  try {
    if (await playwrightRequestAllowed(route.request().url(), target, options, hostAddressCache)) {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  } catch {
    await route.abort("blockedbyclient").catch(() => {});
  }
}

async function handlePlaywrightWebSocketRoute(
  route: PlaywrightWebSocketRoute,
  target: Target,
  options: CaptureOptions,
  hostAddressCache: HostAddressCache,
): Promise<void> {
  try {
    if (await playwrightRequestAllowed(route.url(), target, options, hostAddressCache)) {
      await connectWebSocketRoute(route);
    } else {
      await route.close();
    }
  } catch {
    try {
      await route.close();
    } catch {
      // The policy already failed closed; suppress cleanup errors from the websocket route.
    }
  }
}

function policyUrlForRequest(requestUrl: string): URL | undefined {
  try {
    const url = new URL(requestUrl);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url;
    }

    if (url.protocol === "ws:" || url.protocol === "wss:") {
      url.protocol = url.protocol === "ws:" ? "http:" : "https:";

      return url;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function requestSafetyKind(url: URL, target: Target, policy: CaptureNetworkPolicy): Target["kind"] {
  return target.kind === "localhost" &&
    (url.origin === policy.targetOrigin || isLoopbackHost(url.hostname))
    ? "localhost"
    : "url";
}

async function playwrightAccessibilitySnapshot(
  page: PlaywrightPage,
  context: PlaywrightBrowserContext,
): Promise<unknown> {
  const session = await context.newCDPSession(page);

  try {
    return await session.send("Accessibility.getFullAXTree");
  } finally {
    await session.detach?.();
  }
}

interface BrowserEvaluateGlobal {
  readonly document: {
    querySelectorAll(selector: string): ArrayLike<BrowserElement>;
  };
  getComputedStyle(element: BrowserElement): BrowserStyle;
}

interface BrowserElement {
  readonly children?: ArrayLike<BrowserElement>;
  readonly id: string;
  readonly nodeType: number;
  readonly offsetHeight: number;
  readonly offsetWidth: number;
  readonly parentElement: BrowserElement | null;
  readonly parentNode?: BrowserQueryableRoot | null;
  readonly previousElementSibling: BrowserElement | null;
  readonly shadowRoot?: BrowserQueryableRoot | null;
  readonly tagName: string;
  checkVisibility?(options: {
    readonly checkOpacity: false;
    readonly checkVisibilityCSS: true;
  }): boolean;
  getClientRects(): { readonly length: number };
  getRootNode?(): BrowserQueryableRoot;
}

interface BrowserStyle {
  readonly backgroundColor: string;
  readonly color: string;
  readonly display: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly visibility: string;
}

interface BrowserQueryableRoot {
  readonly children?: ArrayLike<BrowserElement>;
  readonly host?: BrowserElement;
  querySelectorAll(selector: string): ArrayLike<BrowserElement>;
}

async function computedStyleSnapshot(page: PlaywrightPage, limit: number): Promise<unknown> {
  return page.evaluate((snapshotLimit) => {
    const browser = globalThis as unknown as BrowserEvaluateGlobal;
    const siblingIndexCache = new WeakMap<object, Map<BrowserElement, number>>();
    const parentFor = (element: BrowserElement): BrowserElement | BrowserQueryableRoot | null => {
      if (element.parentElement !== null) {
        return element.parentElement;
      }

      const parentNode = element.parentNode;

      if (parentNode?.host !== undefined) {
        return parentNode;
      }

      const root = element.getRootNode?.();

      return root?.host !== undefined ? root : null;
    };
    const nthOfType = (element: BrowserElement): number => {
      const parent = parentFor(element);

      if (parent === null) {
        return 1;
      }

      const cached = siblingIndexCache.get(parent)?.get(element);

      if (cached !== undefined) {
        return cached;
      }

      const indices = new Map<BrowserElement, number>();
      const counts = new Map<string, number>();

      for (const sibling of Array.from(parent.children ?? [])) {
        const tagName = sibling.tagName;
        const next = (counts.get(tagName) ?? 0) + 1;

        counts.set(tagName, next);
        indices.set(sibling, next);
      }

      siblingIndexCache.set(parent, indices);

      return indices.get(element) ?? 1;
    };
    const shadowHostFor = (element: BrowserElement): BrowserElement | undefined => {
      if (element.parentElement !== null) {
        return undefined;
      }

      const root = element.getRootNode?.();

      return root?.host;
    };
    const segmentFor = (element: BrowserElement): string => {
      const tagName = element.tagName.toLowerCase();
      if (element.parentElement === null && shadowHostFor(element) === undefined) {
        return tagName;
      }
      return tagName + ":nth-of-type(" + nthOfType(element) + ")";
    };
    const selectorCache = new WeakMap<BrowserElement, string>();
    const selectorFor = (element: BrowserElement): string => {
      const cached = selectorCache.get(element);

      if (cached !== undefined) {
        return cached;
      }

      const segment = segmentFor(element);
      const parent = element.parentElement;
      const shadowHost = shadowHostFor(element);
      const selector =
        parent !== null
          ? `${selectorFor(parent)} > ${segment}`
          : shadowHost !== undefined
            ? `${selectorFor(shadowHost)} >>> ${segment}`
            : segment;

      selectorCache.set(element, selector);

      return selector;
    };
    const checkElementVisibility = (element: BrowserElement): boolean | undefined => {
      if (typeof element.checkVisibility !== "function") {
        return undefined;
      }

      return element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    };
    const isVisible = (
      element: BrowserElement,
      styles: BrowserStyle,
      precomputedVisibility: boolean | undefined,
    ): boolean => {
      if (precomputedVisibility === false) {
        return false;
      }
      if (
        styles.display === "none" ||
        styles.visibility === "hidden" ||
        styles.visibility === "collapse"
      ) {
        return false;
      }
      if (precomputedVisibility !== undefined) {
        return precomputedVisibility;
      }
      return Boolean(
        element.offsetWidth || element.offsetHeight || element.getClientRects().length,
      );
    };
    function* walkElements(root: BrowserQueryableRoot): Generator<BrowserElement> {
      for (const element of Array.from(root.querySelectorAll("*"))) {
        yield element;

        if (element.shadowRoot !== undefined && element.shadowRoot !== null) {
          yield* walkElements(element.shadowRoot);
        }
      }
    }
    const visible: { readonly element: BrowserElement; readonly styles: BrowserStyle }[] = [];
    for (const element of walkElements(browser.document)) {
      const precomputedVisibility = checkElementVisibility(element);
      if (precomputedVisibility === false) {
        continue;
      }

      const styles = browser.getComputedStyle(element);
      if (!isVisible(element, styles, precomputedVisibility)) {
        continue;
      }
      visible.push({ element, styles });
      if (visible.length >= snapshotLimit) {
        break;
      }
    }
    return visible.map(({ element, styles }, index) => {
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
        display: styles.display,
        fontFamily: styles.fontFamily,
        fontSize: styles.fontSize,
        id: element.id,
        index,
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase(),
        visibility: styles.visibility,
      };
    });
  }, limit);
}

async function connectWebSocketRoute(route: PlaywrightWebSocketRoute): Promise<void> {
  await route.connectToServer();
}

async function closePlaywrightResources(
  page: PlaywrightPage | undefined,
  context: PlaywrightBrowserContext | undefined,
  browser: PlaywrightBrowser | undefined,
): Promise<void> {
  await safelyClosePlaywrightResource(() => page?.close());
  await safelyClosePlaywrightResource(() => context?.close());
  await safelyClosePlaywrightResource(() => browser?.close());
}

async function safelyClosePlaywrightResource(
  close: () => Promise<void> | undefined,
): Promise<void> {
  try {
    await close();
  } catch {
    // Cleanup errors must not replace the capture Result.
  }
}

function playwrightCaptureError(cause: unknown, target: Target): SurfaceError {
  const classification = classifyPlaywrightCaptureError(cause);

  return createSurfaceError(classification.code, classification.message, {
    cause,
    details: {
      backendId: "playwright",
      reason: classification.reason,
      targetKind: target.kind,
    },
  });
}

function classifyPlaywrightCaptureError(cause: unknown): {
  readonly code: "capture_failed" | "capture_unreachable";
  readonly message: string;
  readonly reason: string;
} {
  const message = errorMessage(cause).toLowerCase();
  const code = errorCode(cause);

  if (
    code === "EACCES" ||
    code === "ENOENT" ||
    code === "ENOSPC" ||
    code === "EROFS" ||
    code === "EISDIR"
  ) {
    return {
      code: "capture_failed",
      message: "Playwright could not write capture artifacts.",
      reason: "artifact-write-failed",
    };
  }

  if (
    message.includes("executable doesn't exist") ||
    message.includes("browser executable") ||
    message.includes("failed to launch")
  ) {
    return {
      code: "capture_failed",
      message: "Playwright browser could not launch.",
      reason: "browser-launch-failed",
    };
  }

  if (message.includes("timeout")) {
    return {
      code: "capture_unreachable",
      message: "Playwright timed out while capturing the target.",
      reason: "navigation-timeout",
    };
  }

  if (message.includes("accessibility.getfullaxtree")) {
    return {
      code: "capture_failed",
      message: "Playwright could not collect accessibility evidence.",
      reason: "accessibility-capture-failed",
    };
  }

  if (message.includes("evaluate")) {
    return {
      code: "capture_failed",
      message: "Playwright could not collect computed style evidence.",
      reason: "computed-style-capture-failed",
    };
  }

  return {
    code: "capture_unreachable",
    message: "Playwright could not capture the target.",
    reason: "capture-failed",
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function errorCode(cause: unknown): string | undefined {
  return cause !== null && typeof cause === "object" && "code" in cause
    ? String((cause as { readonly code?: unknown }).code)
    : undefined;
}

function playwrightContextOptions(
  target: Target,
  captureOptions: CaptureOptions,
): PlaywrightContextOptions {
  const options: PlaywrightContextOptions = {};

  if (target.theme !== undefined) {
    options.colorScheme = target.theme;
  }

  if (captureOptions.authStateRef !== undefined) {
    options.storageState = captureOptions.authStateRef;
  }

  if (captureOptions.networkPolicy?.enforceOnSubresources === true) {
    options.serviceWorkers = "block";
  }

  if (target.viewport !== undefined) {
    options.viewport = target.viewport;
  }

  return options;
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

function resolveHostAddressesForPolicy(
  hostname: string,
  cache: HostAddressCache,
): Promise<readonly string[] | undefined> {
  const host = normalizeHostname(hostname);
  const cached = cache.get(host);

  if (cached !== undefined) {
    return cached;
  }

  const resolved = withTimeout(resolveHostAddresses(host), 1_500);
  cache.set(host, resolved);

  return resolved;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(undefined);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        resolve(undefined);
      },
    );
  });
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
