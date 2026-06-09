import { z } from "zod";

import { FindingsPolicySchema } from "./findings-policy.js";
import { SeverityBandSchema } from "./findings.js";
import { NormalizedScoreSchema } from "./scores.js";
export {
  ConfidenceCutoffsSchema,
  DEFAULT_FINDINGS_POLICY,
  FindingsPolicySchema,
  SeverityCutoffsSchema,
  type ConfidenceCutoffs,
  type FindingsPolicy,
  type SeverityCutoffs,
} from "./findings-policy.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const DepthSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Depth = z.infer<typeof DepthSchema>;

export const PresetSchema = z.enum([
  "quick",
  "mvp",
  "standard",
  "deep",
  "accessibility-first",
  "agent-ready",
  "conversion-focused",
  "design-system-focused",
  "custom",
]);
export type Preset = z.infer<typeof PresetSchema>;

export const AppTypeSchema = z.enum([
  "generic",
  "saas-dashboard",
  "e-commerce",
  "marketing",
  "admin",
  "content-media",
]);
export type AppType = z.infer<typeof AppTypeSchema>;

export const StackSchema = z.enum(["react", "next", "vue", "svelte", "agnostic"]);
export type Stack = z.infer<typeof StackSchema>;

export const RedactionRuleSchema = z
  .object({
    pattern: nonEmptyStringSchema,
    appliesTo: z.array(z.enum(["dom", "screenshot", "export"])).min(1),
  })
  .strict();
export type RedactionRule = z.infer<typeof RedactionRuleSchema>;

export const ViewportSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    label: z.enum(["mobile", "tablet", "desktop"]),
  })
  .strict();
export type Viewport = z.infer<typeof ViewportSchema>;

export const CaptureConfigSchema = z
  .object({
    redactionRules: z.array(RedactionRuleSchema),
    viewports: z.array(ViewportSchema).min(1),
    allowlist: z.array(nonEmptyStringSchema),
    captureRetention: z.enum(["ephemeral", "retain"]),
    networkInterception: z.boolean(),
  })
  .strict();
export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;

export const EvaluationConfigSchema = z
  .object({
    preset: PresetSchema,
    depth: DepthSchema,
    stack: z.array(StackSchema).min(1),
    appType: AppTypeSchema.optional(),
  })
  .strict();
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;

export const ConfidenceCutoffsLayerSchema = z
  .object({
    assert: NormalizedScoreSchema.optional(),
    question: NormalizedScoreSchema.optional(),
  })
  .strict();

export const SeverityCutoffsLayerSchema = z
  .object({
    P0: NormalizedScoreSchema.optional(),
    P1: NormalizedScoreSchema.optional(),
    P2: NormalizedScoreSchema.optional(),
    P3: NormalizedScoreSchema.optional(),
  })
  .strict();

export const ExportTargetSchema = z.enum(["github", "linear", "jira"]);
export type ExportTarget = z.infer<typeof ExportTargetSchema>;

export const GatePolicySchema = z
  .object({
    failOnNewMeasuredAtOrAbove: SeverityBandSchema,
    thresholds: z.record(nonEmptyStringSchema, NormalizedScoreSchema),
    neverFailOn: z.array(z.enum(["judged", "gatedForHuman"])).min(2),
  })
  .strict()
  .superRefine((policy, context) => {
    const neverFailOn = new Set(policy.neverFailOn);

    if (neverFailOn.size !== policy.neverFailOn.length) {
      context.addIssue({
        code: "custom",
        message: "neverFailOn cannot contain duplicate values",
        path: ["neverFailOn"],
      });
    }

    if (!neverFailOn.has("judged") || !neverFailOn.has("gatedForHuman")) {
      context.addIssue({
        code: "custom",
        message: 'neverFailOn must include "judged" and "gatedForHuman"',
        path: ["neverFailOn"],
      });
    }
  });
export type GatePolicy = z.infer<typeof GatePolicySchema>;

export const ReportingConfigSchema = z
  .object({
    integrations: z.array(ExportTargetSchema),
    gatePolicy: GatePolicySchema,
  })
  .strict();
export type ReportingConfig = z.infer<typeof ReportingConfigSchema>;

const DIRECT_SUBSCRIPTION_CHANNEL_IDS = ["claude", "codex", "gemini"] as const;

const MODEL_CHANNEL_IDS = [
  "anthropic",
  "openai",
  "local",
  ...DIRECT_SUBSCRIPTION_CHANNEL_IDS,
  "grok",
  "antigravity",
  "mmr",
] as const;

export const DirectSubscriptionChannelIdSchema = z.enum(DIRECT_SUBSCRIPTION_CHANNEL_IDS);
export type DirectSubscriptionChannelId = z.infer<typeof DirectSubscriptionChannelIdSchema>;

export const ModelChannelIdSchema = z.enum(MODEL_CHANNEL_IDS);
export type ModelChannelId = z.infer<typeof ModelChannelIdSchema>;

export const ModelFallbackModeSchema = z.enum(["off", "direct", "mmr", "auto"]);
export type ModelFallbackMode = z.infer<typeof ModelFallbackModeSchema>;

export const ModelEgressModeSchema = z.enum(["off", "text", "text-and-screenshots"]);
export type ModelEgressMode = z.infer<typeof ModelEgressModeSchema>;

export const ScreenshotEgressPolicySchema = z.enum(["blocked", "redacted-only"]);
export type ScreenshotEgressPolicy = z.infer<typeof ScreenshotEgressPolicySchema>;

export const ModelEgressPolicySchema = z
  .object({
    mode: ModelEgressModeSchema,
    screenshots: ScreenshotEgressPolicySchema,
    allowedChannels: z.array(ModelChannelIdSchema).optional(),
    deniedChannels: z.array(ModelChannelIdSchema).optional(),
  })
  .strict();
export type ModelEgressPolicy = z.infer<typeof ModelEgressPolicySchema>;

export const DirectSubscriptionChannelPolicyBlockSchema = z
  .object({
    channelId: DirectSubscriptionChannelIdSchema,
    reason: z.enum(["channel_denied_by_policy", "channel_not_allowed_by_policy"]),
  })
  .strict();
export type DirectSubscriptionChannelPolicyBlock = z.infer<
  typeof DirectSubscriptionChannelPolicyBlockSchema
>;

export const ModelFallbackConfigSchema = z
  .object({
    mode: ModelFallbackModeSchema,
    providerOrder: z.array(DirectSubscriptionChannelIdSchema).min(1),
    allowedChannels: z.array(DirectSubscriptionChannelIdSchema).optional(),
    fallbackToMmr: z.boolean(),
    timeoutMs: z.number().int().positive(),
    depth: DepthSchema,
    effectiveChannels: z.array(DirectSubscriptionChannelIdSchema),
    policyBlockedChannels: z.array(DirectSubscriptionChannelPolicyBlockSchema),
  })
  .strict();
export type ModelFallbackConfig = z.infer<typeof ModelFallbackConfigSchema>;

export const ModelConfigSchema = z
  .object({
    fallback: ModelFallbackConfigSchema,
    egressPolicy: ModelEgressPolicySchema,
    effectiveEgressPolicy: ModelEgressPolicySchema,
  })
  .strict();
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const SurfaceConfigSchema = z
  .object({
    capture: CaptureConfigSchema,
    evaluation: EvaluationConfigSchema,
    findings: FindingsPolicySchema,
    model: ModelConfigSchema,
    reporting: ReportingConfigSchema,
  })
  .strict();
export type SurfaceConfig = z.infer<typeof SurfaceConfigSchema>;

export const CaptureConfigLayerSchema = z
  .object({
    redactionRules: z.array(RedactionRuleSchema).optional(),
    viewports: z.array(ViewportSchema).min(1).optional(),
    allowlist: z.array(nonEmptyStringSchema).optional(),
    captureRetention: z.enum(["ephemeral", "retain"]).optional(),
    networkInterception: z.boolean().optional(),
  })
  .strict();

export const EvaluationConfigLayerSchema = z
  .object({
    preset: PresetSchema.optional(),
    depth: DepthSchema.optional(),
    stack: z.array(StackSchema).min(1).optional(),
    appType: AppTypeSchema.optional(),
  })
  .strict();

export const FindingsPolicyLayerSchema = z
  .object({
    confidenceCutoffs: ConfidenceCutoffsLayerSchema.optional(),
    severityCutoffs: SeverityCutoffsLayerSchema.optional(),
  })
  .strict();

export const GatePolicyLayerSchema = z
  .object({
    failOnNewMeasuredAtOrAbove: SeverityBandSchema.optional(),
    thresholds: z.record(nonEmptyStringSchema, NormalizedScoreSchema).optional(),
  })
  .strict();

export const ReportingConfigLayerSchema = z
  .object({
    integrations: z.array(ExportTargetSchema).optional(),
    // neverFailOn is a fixed safety invariant on the final GatePolicy, not a config-layer knob.
    gatePolicy: GatePolicyLayerSchema.optional(),
  })
  .strict();

export const ModelFallbackConfigLayerSchema = z
  .object({
    mode: ModelFallbackModeSchema.optional(),
    providerOrder: z.array(DirectSubscriptionChannelIdSchema).min(1).optional(),
    allowedChannels: z.array(DirectSubscriptionChannelIdSchema).optional(),
    fallbackToMmr: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    depth: DepthSchema.optional(),
  })
  .strict();

export const ModelEgressPolicyLayerSchema = z
  .object({
    mode: ModelEgressModeSchema.optional(),
    screenshots: ScreenshotEgressPolicySchema.optional(),
    allowedChannels: z.array(ModelChannelIdSchema).optional(),
    deniedChannels: z.array(ModelChannelIdSchema).optional(),
  })
  .strict();

export const ModelConfigLayerSchema = z
  .object({
    fallback: ModelFallbackConfigLayerSchema.optional(),
    egressPolicy: ModelEgressPolicyLayerSchema.optional(),
  })
  .strict();

export const SurfaceConfigLayerSchema = z
  .object({
    capture: CaptureConfigLayerSchema.optional(),
    evaluation: EvaluationConfigLayerSchema.optional(),
    findings: FindingsPolicyLayerSchema.optional(),
    model: ModelConfigLayerSchema.optional(),
    reporting: ReportingConfigLayerSchema.optional(),
  })
  .strict();
export type SurfaceConfigLayer = z.infer<typeof SurfaceConfigLayerSchema>;

export const SurfaceConfigLayersSchema = z
  .object({
    // The defaults layer customizes the internal DEFAULT_SURFACE_CONFIG at the lowest precedence.
    defaults: SurfaceConfigLayerSchema.optional(),
    user: SurfaceConfigLayerSchema.optional(),
    project: SurfaceConfigLayerSchema.optional(),
    env: SurfaceConfigLayerSchema.optional(),
    cli: SurfaceConfigLayerSchema.optional(),
  })
  .strict();

/**
 * Ordered partial config layers. Resolution precedence is:
 * DEFAULT_SURFACE_CONFIG < defaults < user < project < env < cli.
 */
export type SurfaceConfigLayers = z.input<typeof SurfaceConfigLayersSchema>;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function deepFreeze<T extends object>(value: T): T {
  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    if (isObject(nestedValue) && !Object.isFrozen(nestedValue)) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}

export const DEFAULT_SURFACE_CONFIG = deepFreeze(
  SurfaceConfigSchema.parse({
    capture: {
      redactionRules: [],
      viewports: [
        { width: 390, height: 844, label: "mobile" },
        { width: 768, height: 1024, label: "tablet" },
        { width: 1440, height: 900, label: "desktop" },
      ],
      allowlist: [],
      captureRetention: "ephemeral",
      networkInterception: false,
    },
    evaluation: {
      preset: "standard",
      depth: 3,
      stack: ["agnostic"],
      appType: "generic",
    },
    findings: {
      confidenceCutoffs: {
        assert: 0.8,
        question: 0.5,
      },
      severityCutoffs: {
        P0: 0.95,
        P1: 0.75,
        P2: 0.45,
        P3: 0,
      },
    },
    model: {
      fallback: {
        mode: "off",
        providerOrder: [...DIRECT_SUBSCRIPTION_CHANNEL_IDS],
        fallbackToMmr: true,
        timeoutMs: 420_000,
        depth: 3,
        effectiveChannels: [],
        policyBlockedChannels: [],
      },
      egressPolicy: {
        mode: "off",
        screenshots: "blocked",
      },
      effectiveEgressPolicy: {
        mode: "off",
        screenshots: "blocked",
      },
    },
    reporting: {
      integrations: [],
      gatePolicy: {
        failOnNewMeasuredAtOrAbove: "P1",
        thresholds: {},
        neverFailOn: ["judged", "gatedForHuman"],
      },
    },
  }),
);

const CONFIG_LAYER_ORDER = ["defaults", "user", "project", "env", "cli"] as const;
type ConfigLayerName = (typeof CONFIG_LAYER_ORDER)[number];

const CONSENT_LAYER_ORDER = ["user", "env", "cli"] as const satisfies readonly ConfigLayerName[];
const CONSENT_LAYER_ORDER_HIGH_TO_LOW = [
  "cli",
  "env",
  "user",
] as const satisfies readonly ConfigLayerName[];
const RUNTIME_LAYER_ORDER_HIGH_TO_LOW = [
  "cli",
  "env",
] as const satisfies readonly ConfigLayerName[];
const HARD_POLICY_LAYER_ORDER = ["user", "project"] as const satisfies readonly ConfigLayerName[];

const egressModeRank = { off: 0, text: 1, "text-and-screenshots": 2 } as const satisfies Record<
  ModelEgressMode,
  number
>;

const screenshotRank = { blocked: 0, "redacted-only": 1 } as const satisfies Record<
  ScreenshotEgressPolicy,
  number
>;

type ParsedSurfaceConfigLayers = z.infer<typeof SurfaceConfigLayersSchema>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  const prototype: unknown = isObject(value) ? Object.getPrototypeOf(value) : undefined;

  return (
    isObject(value) &&
    !Array.isArray(value) &&
    (prototype === Object.prototype || prototype === null)
  );
}

function deepClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry));
  }

  if (isPlainRecord(value)) {
    const cloned: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = deepClone(nestedValue);
    }

    return cloned;
  }

  return value;
}

function mergeRecords(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = merged[key];

    merged[key] =
      isPlainRecord(baseValue) && isPlainRecord(overrideValue)
        ? mergeRecords(baseValue, overrideValue)
        : deepClone(overrideValue);
  }

  return merged;
}

function objectToRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function modelLayer(layers: ParsedSurfaceConfigLayers, layerName: ConfigLayerName) {
  return layers[layerName]?.model;
}

function explicitEgressMode(
  layers: ParsedSurfaceConfigLayers,
  layerNames: readonly ConfigLayerName[],
): ModelEgressMode | undefined {
  for (const layerName of layerNames) {
    const mode = modelLayer(layers, layerName)?.egressPolicy?.mode;

    if (mode !== undefined) {
      return mode;
    }
  }

  return undefined;
}

function explicitScreenshotPolicy(
  layers: ParsedSurfaceConfigLayers,
  layerNames: readonly ConfigLayerName[],
): ScreenshotEgressPolicy | undefined {
  for (const layerName of layerNames) {
    const screenshots = modelLayer(layers, layerName)?.egressPolicy?.screenshots;

    if (screenshots !== undefined) {
      return screenshots;
    }
  }

  return undefined;
}

function lowerEgressMode(left: ModelEgressMode, right: ModelEgressMode): ModelEgressMode {
  return egressModeRank[left] <= egressModeRank[right] ? left : right;
}

function higherEgressMode(left: ModelEgressMode, right: ModelEgressMode): ModelEgressMode {
  return egressModeRank[left] >= egressModeRank[right] ? left : right;
}

function lowerScreenshotPolicy(
  left: ScreenshotEgressPolicy,
  right: ScreenshotEgressPolicy,
): ScreenshotEgressPolicy {
  return screenshotRank[left] <= screenshotRank[right] ? left : right;
}

function hardEgressCeiling(layers: ParsedSurfaceConfigLayers): ModelEgressMode {
  let ceiling: ModelEgressMode = "text-and-screenshots";

  for (const layerName of HARD_POLICY_LAYER_ORDER) {
    const mode = modelLayer(layers, layerName)?.egressPolicy?.mode;

    if (mode !== undefined) {
      ceiling = lowerEgressMode(ceiling, mode);
    }
  }

  return ceiling;
}

function hardScreenshotCeiling(layers: ParsedSurfaceConfigLayers): ScreenshotEgressPolicy {
  let ceiling: ScreenshotEgressPolicy = "redacted-only";

  for (const layerName of HARD_POLICY_LAYER_ORDER) {
    const screenshots = modelLayer(layers, layerName)?.egressPolicy?.screenshots;

    if (screenshots !== undefined) {
      ceiling = lowerScreenshotPolicy(ceiling, screenshots);
    }
  }

  return ceiling;
}

function configuredFallbackMode(layers: ParsedSurfaceConfigLayers): ModelFallbackMode {
  let mode = DEFAULT_SURFACE_CONFIG.model.fallback.mode;

  for (const layerName of CONFIG_LAYER_ORDER) {
    const fallbackMode = modelLayer(layers, layerName)?.fallback?.mode;

    if (fallbackMode !== undefined) {
      mode = fallbackMode;
    }
  }

  return mode;
}

function hasFallbackChannelConsent(layers: ParsedSurfaceConfigLayers): boolean {
  return CONSENT_LAYER_ORDER.some((layerName) => {
    const fallback = modelLayer(layers, layerName)?.fallback;

    return (
      (fallback?.providerOrder !== undefined && fallback.providerOrder.length > 0) ||
      (fallback?.allowedChannels !== undefined && fallback.allowedChannels.length > 0)
    );
  });
}

function hasFallbackConsent(layers: ParsedSurfaceConfigLayers): boolean {
  const explicitMode = explicitFallbackMode(layers, CONSENT_LAYER_ORDER_HIGH_TO_LOW);

  if (explicitMode !== undefined) {
    return explicitMode !== "off";
  }

  const mode = configuredFallbackMode(layers);

  return mode !== "off" && hasFallbackChannelConsent(layers);
}

function explicitFallbackMode(
  layers: ParsedSurfaceConfigLayers,
  layerOrder: readonly ConfigLayerName[],
): ModelFallbackMode | undefined {
  for (const layerName of layerOrder) {
    const fallbackMode = modelLayer(layers, layerName)?.fallback?.mode;

    if (fallbackMode !== undefined) {
      return fallbackMode;
    }
  }

  return undefined;
}

function resolveEffectiveEgressPolicy(
  configuredPolicy: ModelEgressPolicy,
  layers: ParsedSurfaceConfigLayers,
): ModelEgressPolicy {
  const runtimeMode = explicitEgressMode(layers, RUNTIME_LAYER_ORDER_HIGH_TO_LOW);
  const consentMode = explicitEgressMode(layers, CONSENT_LAYER_ORDER_HIGH_TO_LOW);
  const screenshotPolicy = explicitScreenshotPolicy(layers, CONSENT_LAYER_ORDER_HIGH_TO_LOW);
  const screenshotConsent = screenshotPolicy === "redacted-only";
  let mode: ModelEgressMode = consentMode ?? "off";

  if (runtimeMode !== "off") {
    if (hasFallbackConsent(layers)) {
      mode = higherEgressMode(mode, "text");
    }

    if (screenshotConsent) {
      mode = higherEgressMode(mode, "text-and-screenshots");
    }
  }

  if (runtimeMode === "off") {
    mode = "off";
  }

  mode = lowerEgressMode(mode, hardEgressCeiling(layers));

  let screenshots: ScreenshotEgressPolicy = screenshotPolicy ?? "blocked";
  screenshots = lowerScreenshotPolicy(screenshots, hardScreenshotCeiling(layers));

  if (mode !== "text-and-screenshots") {
    screenshots = "blocked";
  }

  const allowedChannels = collectAllowedModelChannels(layers);
  const deniedChannels = collectDeniedModelChannels(layers);

  return {
    ...configuredPolicy,
    mode,
    screenshots,
    ...(allowedChannels === undefined ? {} : { allowedChannels: [...allowedChannels] }),
    ...(deniedChannels.size === 0 ? {} : { deniedChannels: [...deniedChannels] }),
  };
}

function isDirectSubscriptionChannel(
  channelId: ModelChannelId,
): channelId is DirectSubscriptionChannelId {
  return DIRECT_SUBSCRIPTION_CHANNEL_IDS.includes(channelId as DirectSubscriptionChannelId);
}

function collectAllowedModelChannels(
  layers: ParsedSurfaceConfigLayers,
): Set<ModelChannelId> | undefined {
  let allowed: Set<ModelChannelId> | undefined;

  for (const layerName of CONFIG_LAYER_ORDER) {
    const allowedChannels = modelLayer(layers, layerName)?.egressPolicy?.allowedChannels;

    if (allowedChannels === undefined) {
      continue;
    }

    const channelSet = new Set(allowedChannels);
    allowed =
      allowed === undefined
        ? channelSet
        : new Set([...allowed].filter((channelId) => channelSet.has(channelId)));
  }

  return allowed;
}

function collectDeniedModelChannels(layers: ParsedSurfaceConfigLayers): Set<ModelChannelId> {
  const denied = new Set<ModelChannelId>();

  for (const layerName of CONFIG_LAYER_ORDER) {
    const deniedChannels = modelLayer(layers, layerName)?.egressPolicy?.deniedChannels;

    if (deniedChannels === undefined) {
      continue;
    }

    for (const channelId of deniedChannels) {
      denied.add(channelId);
    }
  }

  return denied;
}

function collectAllowedDirectChannels(
  layers: ParsedSurfaceConfigLayers,
): Set<DirectSubscriptionChannelId> | undefined {
  let allowed: Set<DirectSubscriptionChannelId> | undefined;

  for (const layerName of CONFIG_LAYER_ORDER) {
    const model = modelLayer(layers, layerName);
    const fallbackAllowedChannels = model?.fallback?.allowedChannels;
    const egressAllowedChannels = model?.egressPolicy?.allowedChannels?.filter(
      isDirectSubscriptionChannel,
    );

    for (const channelList of [fallbackAllowedChannels, egressAllowedChannels]) {
      if (channelList === undefined) {
        continue;
      }

      const channelSet = new Set(channelList);

      allowed =
        allowed === undefined
          ? channelSet
          : new Set([...allowed].filter((channelId) => channelSet.has(channelId)));
    }
  }

  return allowed;
}

function collectDeniedDirectChannels(
  layers: ParsedSurfaceConfigLayers,
): Set<DirectSubscriptionChannelId> {
  const denied = new Set<DirectSubscriptionChannelId>();

  for (const layerName of CONFIG_LAYER_ORDER) {
    const deniedChannels = modelLayer(layers, layerName)?.egressPolicy?.deniedChannels;

    if (deniedChannels === undefined) {
      continue;
    }

    for (const channelId of deniedChannels) {
      if (isDirectSubscriptionChannel(channelId)) {
        denied.add(channelId);
      }
    }
  }

  return denied;
}

type DirectChannelResolution = {
  readonly effectiveChannels: readonly DirectSubscriptionChannelId[];
  readonly policyBlockedChannels: readonly DirectSubscriptionChannelPolicyBlock[];
};

function resolveEffectiveDirectChannels(
  fallback: ModelFallbackConfig,
  effectivePolicy: ModelEgressPolicy,
  layers: ParsedSurfaceConfigLayers,
): DirectChannelResolution {
  if (
    effectivePolicy.mode === "off" ||
    !hasFallbackConsent(layers) ||
    (fallback.mode !== "direct" && fallback.mode !== "auto")
  ) {
    return { effectiveChannels: [], policyBlockedChannels: [] };
  }

  const allowed = collectAllowedDirectChannels(layers);
  const denied = collectDeniedDirectChannels(layers);
  const effectiveChannels: DirectSubscriptionChannelId[] = [];
  const policyBlockedChannels: DirectSubscriptionChannelPolicyBlock[] = [];
  const seenBlockedChannels = new Set<DirectSubscriptionChannelId>();

  for (const channelId of fallback.providerOrder) {
    if (!DirectSubscriptionChannelIdSchema.safeParse(channelId).success) {
      continue;
    }

    const reason = denied.has(channelId)
      ? "channel_denied_by_policy"
      : allowed !== undefined && !allowed.has(channelId)
        ? "channel_not_allowed_by_policy"
        : undefined;

    if (reason === undefined) {
      effectiveChannels.push(channelId);
    } else if (!seenBlockedChannels.has(channelId)) {
      policyBlockedChannels.push({ channelId, reason });
      seenBlockedChannels.add(channelId);
    }
  }

  return { effectiveChannels, policyBlockedChannels };
}

function applyModelEffectivePolicy(
  merged: Record<string, unknown>,
  layers: ParsedSurfaceConfigLayers,
): Record<string, unknown> {
  const parsedConfig = SurfaceConfigSchema.parse(merged);
  const effectiveEgressPolicy = resolveEffectiveEgressPolicy(
    parsedConfig.model.egressPolicy,
    layers,
  );
  const directChannelResolution = resolveEffectiveDirectChannels(
    parsedConfig.model.fallback,
    effectiveEgressPolicy,
    layers,
  );

  return mergeRecords(merged, {
    model: {
      effectiveEgressPolicy,
      fallback: {
        effectiveChannels: directChannelResolution.effectiveChannels,
        policyBlockedChannels: directChannelResolution.policyBlockedChannels,
      },
    },
  });
}

/**
 * Resolve SurfaceConfig layers with documented precedence. Higher layers replace arrays and
 * scalars, merge nested objects, and ignore explicit undefined values from optional adapters.
 * Returned configs are owned mutable data; DEFAULT_SURFACE_CONFIG remains deeply frozen.
 */
export function resolveSurfaceConfig(layers: SurfaceConfigLayers = {}): SurfaceConfig {
  const parsedLayers = SurfaceConfigLayersSchema.parse(layers);
  let merged = objectToRecord(deepClone(DEFAULT_SURFACE_CONFIG) as object);

  for (const layerName of CONFIG_LAYER_ORDER) {
    const layer = parsedLayers[layerName];

    if (layer !== undefined) {
      merged = mergeRecords(merged, objectToRecord(layer));
    }
  }

  merged = applyModelEffectivePolicy(merged, parsedLayers);

  return SurfaceConfigSchema.parse(merged);
}
