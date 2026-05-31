import { z } from "zod";

import { SeverityBandSchema } from "./findings.js";

const normalizedScoreSchema = z.number().min(0).max(1);
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

export const ConfidenceCutoffsSchema = z
  .object({
    assert: normalizedScoreSchema,
    question: normalizedScoreSchema,
  })
  .strict()
  .refine((cutoffs) => cutoffs.assert >= cutoffs.question, {
    message: "assert cutoff must be greater than or equal to question cutoff",
  });

export const SeverityCutoffsSchema = z
  .object({
    P0: normalizedScoreSchema,
    P1: normalizedScoreSchema,
    P2: normalizedScoreSchema,
    P3: normalizedScoreSchema,
  })
  .strict()
  .refine(
    (cutoffs) => cutoffs.P0 >= cutoffs.P1 && cutoffs.P1 >= cutoffs.P2 && cutoffs.P2 >= cutoffs.P3,
    {
      message: "severity cutoffs must descend from P0 through P3",
    },
  );

export const FindingsPolicySchema = z
  .object({
    confidenceCutoffs: ConfidenceCutoffsSchema,
    severityCutoffs: SeverityCutoffsSchema,
  })
  .strict();
export type FindingsPolicy = z.infer<typeof FindingsPolicySchema>;

export const ConfidenceCutoffsLayerSchema = z
  .object({
    assert: normalizedScoreSchema.optional(),
    question: normalizedScoreSchema.optional(),
  })
  .strict();

export const SeverityCutoffsLayerSchema = z
  .object({
    P0: normalizedScoreSchema.optional(),
    P1: normalizedScoreSchema.optional(),
    P2: normalizedScoreSchema.optional(),
    P3: normalizedScoreSchema.optional(),
  })
  .strict();

export const ExportTargetSchema = z.enum(["github", "linear", "jira"]);
export type ExportTarget = z.infer<typeof ExportTargetSchema>;

export const GatePolicySchema = z
  .object({
    failOnNewMeasuredAtOrAbove: SeverityBandSchema,
    thresholds: z.record(nonEmptyStringSchema, normalizedScoreSchema),
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

export const SurfaceConfigSchema = z
  .object({
    capture: CaptureConfigSchema,
    evaluation: EvaluationConfigSchema,
    findings: FindingsPolicySchema,
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
    thresholds: z.record(nonEmptyStringSchema, normalizedScoreSchema).optional(),
  })
  .strict();

export const ReportingConfigLayerSchema = z
  .object({
    integrations: z.array(ExportTargetSchema).optional(),
    // neverFailOn is a fixed safety invariant on the final GatePolicy, not a config-layer knob.
    gatePolicy: GatePolicyLayerSchema.optional(),
  })
  .strict();

export const SurfaceConfigLayerSchema = z
  .object({
    capture: CaptureConfigLayerSchema.optional(),
    evaluation: EvaluationConfigLayerSchema.optional(),
    findings: FindingsPolicyLayerSchema.optional(),
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

  return SurfaceConfigSchema.parse(merged);
}
