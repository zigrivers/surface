import { z } from "zod";

import {
  getAppTypeOverlay,
  hasRegisteredAppTypeOverlay,
  listAppTypeOverlays,
} from "./app-type-overlays.js";
import { AppTypeSchema, SurfaceConfigSchema, type AppType, type SurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import type { ProjectStateSnapshot, StateStore, Target, TargetKind } from "./interfaces.js";
import { nonEmptyTrimmedStringSchema } from "./schemas.js";

const TargetKindSchema = z.enum(["url", "localhost", "route", "screenshot", "component", "dom"]);
const ViewportSchema = z
  .object({
    height: z.number().int().positive(),
    label: z.enum(["mobile", "tablet", "desktop"]),
    width: z.number().int().positive(),
  })
  .strict();

const DiscoveryTargetSchema = z
  .object({
    kind: TargetKindSchema,
    ref: nonEmptyTrimmedStringSchema,
    theme: z.enum(["light", "dark"]).optional(),
    viewport: ViewportSchema.optional(),
  })
  .strict();

const DiscoveryRunInputSchema = z
  .object({
    appTypeOverride: AppTypeSchema.optional(),
    config: SurfaceConfigSchema.optional(),
    personaHint: z.string().optional(),
    routeCandidates: z.array(z.string()).optional(),
    routeCap: z.number().int().positive().optional(),
    runId: nonEmptyTrimmedStringSchema,
    target: DiscoveryTargetSchema,
    taskHint: z.string().optional(),
  })
  .passthrough();

export type DiscoveryRunInput = {
  readonly appTypeOverride?: AppType;
  readonly config?: SurfaceConfig;
  readonly personaHint?: string;
  readonly routeCandidates?: readonly string[];
  readonly routeCap?: number;
  readonly runId: string;
  readonly target: Target;
  readonly taskHint?: string;
};

export const RouteInventoryEntrySchema = z
  .object({
    path: nonEmptyTrimmedStringSchema,
    source: z.enum(["target", "candidate"]),
  })
  .strict();
export type RouteInventoryEntry = z.infer<typeof RouteInventoryEntrySchema>;

export const RouteSkippedSchema = z
  .object({
    path: nonEmptyTrimmedStringSchema,
    reason: z.literal("route_cap_exceeded"),
    source: z.enum(["target", "candidate"]),
  })
  .strict();
export type RouteSkipped = z.infer<typeof RouteSkippedSchema>;

export const RouteInventorySchema = z
  .object({
    cap: z.number().int().positive(),
    routes: z.array(RouteInventoryEntrySchema),
    skipped: z.array(RouteSkippedSchema),
  })
  .strict();
export type RouteInventory = z.infer<typeof RouteInventorySchema>;

export const PersonaTaskSchema = z
  .object({
    persona: nonEmptyTrimmedStringSchema,
    task: nonEmptyTrimmedStringSchema,
  })
  .strict();
export type PersonaTask = z.infer<typeof PersonaTaskSchema>;

export const AppTypeClassificationSchema = z
  .object({
    appType: AppTypeSchema,
    matchedSignals: z.array(nonEmptyTrimmedStringSchema),
    source: z.enum(["config", "route-inventory", "target-ref", "generic-fallback"]),
  })
  .strict();
export type AppTypeClassification = z.infer<typeof AppTypeClassificationSchema>;

export const DiscoveryEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("AppTypeClassified"),
      appType: AppTypeSchema,
      overlayId: AppTypeSchema,
      runId: nonEmptyTrimmedStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("RoutesSkipped"),
      cap: z.number().int().positive(),
      runId: nonEmptyTrimmedStringSchema,
      skipped: z.array(RouteSkippedSchema).min(1),
    })
    .strict(),
]);
export type DiscoveryEvent = z.infer<typeof DiscoveryEventSchema>;

export const DiscoveryResultSchema = z
  .object({
    appType: AppTypeSchema,
    classification: AppTypeClassificationSchema,
    events: z.array(DiscoveryEventSchema),
    overlayId: AppTypeSchema,
    personaTask: PersonaTaskSchema,
    routeInventory: RouteInventorySchema,
    runId: nonEmptyTrimmedStringSchema,
  })
  .passthrough();
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

const DEFAULT_ROUTE_CAP = 25;
const MAX_SIGNAL_TEXT_LENGTH = 2_048;
const MAX_HOST_SEGMENT_LENGTH = 253;

const AUTO_CLASSIFICATION_PRIORITY = ["e-commerce", "saas-dashboard", "marketing"] as const;

type TokenizedPath = {
  readonly path: string;
  readonly tokens: readonly string[];
};

export async function runDiscovery(
  input: DiscoveryRunInput,
  options: { readonly stateStore?: StateStore } = {},
): Promise<Result<DiscoveryResult, SurfaceError>> {
  const parsedInput = DiscoveryRunInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return err(
      createSurfaceError("config_invalid", "Discovery input is invalid.", {
        cause: parsedInput.error,
      }),
    );
  }

  const routeInventory = createRouteInventory({
    cap: parsedInput.data.routeCap ?? DEFAULT_ROUTE_CAP,
    candidates: parsedInput.data.routeCandidates ?? [],
    target: parsedInput.data.target,
  });
  const classification = classifyAppType({
    configOverride: explicitAppTypeOverride(
      parsedInput.data.appTypeOverride,
      parsedInput.data.config?.evaluation?.appType,
    ),
    routeInventory,
    target: parsedInput.data.target,
  });
  const overlay = getAppTypeOverlay(classification.appType);
  const personaTask = PersonaTaskSchema.parse({
    persona: trimmedHintOrUndefined(parsedInput.data.personaHint) ?? overlay.defaultPersona,
    task: trimmedHintOrUndefined(parsedInput.data.taskHint) ?? overlay.defaultTask,
  });
  const events = [
    DiscoveryEventSchema.parse({
      type: "AppTypeClassified",
      appType: classification.appType,
      overlayId: overlay.appType,
      runId: parsedInput.data.runId,
    }),
    ...(routeInventory.skipped.length > 0
      ? [
          DiscoveryEventSchema.parse({
            type: "RoutesSkipped",
            cap: routeInventory.cap,
            runId: parsedInput.data.runId,
            skipped: routeInventory.skipped,
          }),
        ]
      : []),
  ];
  const result = DiscoveryResultSchema.parse({
    ...discoveryInputMetadata(parsedInput.data),
    appType: classification.appType,
    classification,
    events,
    overlayId: overlay.appType,
    personaTask,
    routeInventory,
    runId: parsedInput.data.runId,
  });

  if (options.stateStore === undefined) {
    return ok(result);
  }

  const written =
    options.stateStore.updateState === undefined
      ? await updateDiscoveryStateFallback(options.stateStore, result)
      : await options.stateStore.updateState((state) => ({
          ...state,
          discovery: result,
        }));

  if (!isOk(written)) {
    return err(written.error);
  }

  return ok(result);
}

function discoveryInputMetadata(
  input: z.infer<typeof DiscoveryRunInputSchema>,
): Record<string, unknown> {
  const knownInputKeys = new Set(Object.keys(DiscoveryRunInputSchema.shape));

  return Object.fromEntries(Object.entries(input).filter(([key]) => !knownInputKeys.has(key)));
}

function classifyAppType(input: {
  readonly configOverride: AppType | undefined;
  readonly routeInventory: RouteInventory;
  readonly target: Pick<Target, "kind" | "ref">;
}): AppTypeClassification {
  if (input.configOverride !== undefined) {
    const appType = hasRegisteredAppTypeOverlay(input.configOverride)
      ? input.configOverride
      : "generic";

    return AppTypeClassificationSchema.parse({
      appType,
      matchedSignals: [`config:${input.configOverride}`],
      source: "config",
    });
  }

  const candidatePaths = [
    ...input.routeInventory.routes
      .filter((route) => route.source === "candidate")
      .map((route) => route.path),
    ...input.routeInventory.skipped
      .filter((route) => route.source === "candidate")
      .map((route) => route.path),
  ];
  const targetPaths = input.routeInventory.routes
    .filter((route) => route.source === "target")
    .map((route) => route.path);
  const targetSignalPaths = isRouteLikeTargetKind(input.target.kind)
    ? [input.target.ref, ...targetPaths]
    : targetPaths;
  const candidateTokenizedPaths = tokenizedPaths(candidatePaths);
  const targetTokenizedPaths = tokenizedPaths(targetSignalPaths);

  for (const { overlay, signalMatches } of createAutoClassificationOverlays()) {
    const candidateSignals = matchingSignals(signalMatches, candidateTokenizedPaths);
    const targetSignals = matchingSignals(signalMatches, targetTokenizedPaths);
    const matchedSignals = mergeSignals(candidateSignals, targetSignals);

    if (matchedSignals.length > 0) {
      return AppTypeClassificationSchema.parse({
        appType: overlay.appType,
        matchedSignals,
        source: candidateSignals.length > 0 ? "route-inventory" : "target-ref",
      });
    }
  }

  return AppTypeClassificationSchema.parse({
    appType: "generic",
    matchedSignals: [],
    source: "generic-fallback",
  });
}

function createAutoClassificationOverlays(): readonly {
  readonly overlay: NonNullable<ReturnType<typeof listAppTypeOverlays>[number]>;
  readonly signalMatches: readonly {
    readonly signal: string;
    readonly tokens: readonly string[];
  }[];
}[] {
  return AUTO_CLASSIFICATION_PRIORITY.map((appType) =>
    listAppTypeOverlays().find((overlay) => overlay.appType === appType),
  )
    .filter((overlay): overlay is NonNullable<typeof overlay> => overlay !== undefined)
    .map((overlay) => ({
      overlay,
      signalMatches: overlay.discoverySignals
        .map((signal) => ({ signal, tokens: textSegments(signal) }))
        .filter((signalMatch) => signalMatch.tokens.length > 0),
    }));
}

function createRouteInventory(input: {
  readonly cap: number;
  readonly candidates: readonly string[];
  readonly target: { readonly kind: TargetKind; readonly ref: string };
}): RouteInventory {
  const entries: RouteInventoryEntry[] = [];
  const seen = new Set<string>();

  function addRoute(rawPath: string, source: RouteInventoryEntry["source"]): void {
    const path = normalizeRoutePath(rawPath);

    if (path === undefined || seen.has(path)) {
      return;
    }

    seen.add(path);
    entries.push(RouteInventoryEntrySchema.parse({ path, source }));
  }

  if (isRouteLikeTargetKind(input.target.kind)) {
    addRoute(input.target.ref, "target");
  }

  for (const candidate of input.candidates) {
    addRoute(candidate, "candidate");
  }

  return RouteInventorySchema.parse({
    cap: input.cap,
    routes: entries.slice(0, input.cap),
    skipped: entries.slice(input.cap).map((entry) =>
      RouteSkippedSchema.parse({
        path: entry.path,
        reason: "route_cap_exceeded",
        source: entry.source,
      }),
    ),
  });
}

function normalizeRoutePath(rawPath: string): string | undefined {
  const trimmed = rawPath.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  let pathname = hashRoutePathFromRef(trimmed) ?? trimmed;

  if (pathname === trimmed && isBareHostPath(trimmed)) {
    pathname = pathnameFromUrlishRef(`http://${trimmed}`) ?? trimmed;
  } else if (pathname === trimmed && isAbsoluteUrlRef(trimmed)) {
    pathname = pathnameFromUrlishRef(trimmed) ?? trimmed;
  }

  const withoutQuery = safeDecodeURIComponent(pathname.split(/[?#]/, 1)[0] ?? "");
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;

  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : "/";
}

function textContainsTokenSignal(
  textTokens: readonly string[],
  signalTokens: readonly string[],
): boolean {
  return textTokens.some((_, index) =>
    signalTokens.every((signalToken, offset) => textTokens[index + offset] === signalToken),
  );
}

function matchingSignals(
  signals: readonly { readonly signal: string; readonly tokens: readonly string[] }[],
  paths: readonly TokenizedPath[],
): readonly string[] {
  return signals
    .filter((signalMatch) =>
      paths.some((path) => textContainsTokenSignal(path.tokens, signalMatch.tokens)),
    )
    .map((signalMatch) => signalMatch.signal);
}

function tokenizedPaths(paths: readonly string[]): readonly TokenizedPath[] {
  return paths.map((path) => ({ path, tokens: textSegments(path) }));
}

function textSegments(text: string): readonly string[] {
  const trimmed = text.trim().toLowerCase().slice(0, MAX_SIGNAL_TEXT_LENGTH);
  const parts: string[] = [];

  if (trimmed.length === 0) {
    return parts;
  }

  if (isBareHostPath(trimmed)) {
    const parsed = parseUrlishRef(`http://${trimmed}`);
    parts.push(...urlSignalParts(parsed, trimmed));
  } else if (isAbsoluteUrlRef(trimmed)) {
    const parsed = parseUrlishRef(trimmed);
    parts.push(...urlSignalParts(parsed, trimmed));
  } else {
    parts.push(trimmed);
  }

  return parts.flatMap((part) => signalTokens(safeDecodeURIComponent(part)));
}

function isRouteLikeTargetKind(kind: TargetKind): boolean {
  return kind === "url" || kind === "localhost" || kind === "route";
}

function isBareHostPath(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#") || value.startsWith("?")) {
    return false;
  }

  const firstSegment = value.split(/[/?#]/, 1)[0]?.toLowerCase() ?? "";

  if (firstSegment.length > MAX_HOST_SEGMENT_LENGTH) {
    return false;
  }

  return (
    firstSegment === "localhost" ||
    /^localhost:\d+$/.test(firstSegment) ||
    /^\[[0-9a-f:]+\](?::\d+)?$/i.test(firstSegment) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(firstSegment) ||
    isDomainLikeHostSegment(firstSegment) ||
    /^[a-z0-9.-]+:\d+$/.test(firstSegment)
  );
}

function isDomainLikeHostSegment(value: string): boolean {
  const hostname = value.replace(/:\d+$/, "");
  const labels = hostname.split(".");
  const tld = labels.at(-1) ?? "";
  const commonRelativeExtensions = new Set([
    "css",
    "cjs",
    "cts",
    "gif",
    "htm",
    "html",
    "jpeg",
    "jpg",
    "js",
    "json",
    "jsx",
    "md",
    "mjs",
    "mts",
    "pdf",
    "php",
    "png",
    "svg",
    "ts",
    "tsx",
    "webp",
    "yaml",
    "yml",
  ]);

  return (
    hostname.length <= MAX_HOST_SEGMENT_LENGTH &&
    labels.length >= 2 &&
    /^[a-z][a-z0-9-]{1,}$/.test(tld) &&
    !commonRelativeExtensions.has(tld) &&
    labels.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  );
}

function isAbsoluteUrlRef(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function mergeSignals(
  candidateSignals: readonly string[],
  targetSignals: readonly string[],
): readonly string[] {
  return [
    ...candidateSignals,
    ...targetSignals.filter((signal) => !candidateSignals.includes(signal)),
  ];
}

function signalTokens(value: string): readonly string[] {
  return value.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}

function trimmedHintOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function explicitAppTypeOverride(
  appTypeOverride: AppType | undefined,
  configAppType: AppType | undefined,
): AppType | undefined {
  if (appTypeOverride !== undefined) {
    return appTypeOverride;
  }

  return configAppType === undefined || configAppType === "generic" ? undefined : configAppType;
}

function pathnameFromUrlishRef(value: string): string | undefined {
  const parsed = parseUrlishRef(value);

  return parsed === undefined ? undefined : (hashRoutePath(parsed) ?? parsed.pathname);
}

function parseUrlishRef(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function urlSignalParts(parsed: URL | undefined, fallback: string): readonly string[] {
  if (parsed === undefined) {
    return [fallback];
  }

  return [parsed.hostname, hashRoutePath(parsed) ?? parsed.pathname, parsed.search];
}

function hashRoutePath(parsed: URL): string | undefined {
  return parsed.hash.startsWith("#/") ? parsed.hash.slice(1) : undefined;
}

function hashRoutePathFromRef(value: string): string | undefined {
  const hashRouteStart = value.indexOf("#/");

  return hashRouteStart === -1 ? undefined : value.slice(hashRouteStart + 1);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function updateDiscoveryStateFallback(
  stateStore: StateStore,
  result: DiscoveryResult,
): Promise<Result<ProjectStateSnapshot, SurfaceError>> {
  const state = await stateStore.readState();

  if (!isOk(state)) {
    return err(state.error);
  }

  return stateStore.writeState({
    ...state.value,
    discovery: result,
  });
}
