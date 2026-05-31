import { z } from "zod";

const normalizedScoreSchema = z.number().min(0).max(1);
const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const EvaluationMethodSchema = z.enum(["measured", "judged"]);
export type EvaluationMethod = z.infer<typeof EvaluationMethodSchema>;

export const SeverityBandSchema = z.enum(["P0", "P1", "P2", "P3"]);
export type SeverityBand = z.infer<typeof SeverityBandSchema>;

export const ConfidenceBandSchema = z.enum([
  "assert",
  "surface-as-question",
  "suppress-unless-deep",
]);
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;

export const RectSchema = z
  .object({
    x: z.number().min(0),
    y: z.number().min(0),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type Rect = z.infer<typeof RectSchema>;

export const ToolResultEvidenceSchema = z
  .object({
    kind: z.literal("tool-result"),
    tool: z.enum(["axe", "lighthouse", "eslint-jsx-a11y", "backend"]),
    rule: nonEmptyStringSchema,
    measuredValue: nonEmptyStringSchema,
    threshold: nonEmptyStringSchema.optional(),
  })
  .strict();
export type ToolResultEvidence = z.infer<typeof ToolResultEvidenceSchema>;

export const DomEvidenceSchema = z
  .object({
    kind: z.literal("dom"),
    selector: nonEmptyStringSchema,
    elementRef: nonEmptyStringSchema.optional(),
  })
  .strict();
export type DomEvidence = z.infer<typeof DomEvidenceSchema>;

export const ScreenshotRegionEvidenceSchema = z
  .object({
    kind: z.literal("screenshot-region"),
    artifactId: nonEmptyStringSchema,
    rect: RectSchema,
  })
  .strict();
export type ScreenshotRegionEvidence = z.infer<typeof ScreenshotRegionEvidenceSchema>;

export const CitedHeuristicEvidenceSchema = z
  .object({
    kind: z.literal("cited-heuristic"),
    knowledgeEntryId: nonEmptyStringSchema,
  })
  .strict();
export type CitedHeuristicEvidence = z.infer<typeof CitedHeuristicEvidenceSchema>;

export const EvidenceSchema = z.discriminatedUnion("kind", [
  ToolResultEvidenceSchema,
  DomEvidenceSchema,
  ScreenshotRegionEvidenceSchema,
  CitedHeuristicEvidenceSchema,
]);
export type Evidence = z.infer<typeof EvidenceSchema>;

export const DimensionsSchema = z
  .object({
    severity: normalizedScoreSchema,
    confidence: normalizedScoreSchema,
    effort: normalizedScoreSchema,
    userImpact: normalizedScoreSchema,
    businessImpact: normalizedScoreSchema,
    a11yLegalRisk: normalizedScoreSchema,
    evidenceQuality: normalizedScoreSchema,
    agentImplementability: normalizedScoreSchema,
  })
  .strict();
export type Dimensions = z.infer<typeof DimensionsSchema>;

export const LocationSchema = z
  .object({
    file: nonEmptyStringSchema.optional(),
    component: nonEmptyStringSchema.optional(),
    selector: nonEmptyStringSchema.optional(),
    elementRef: nonEmptyStringSchema.optional(),
  })
  .strict()
  .refine(
    (location) =>
      location.file !== undefined ||
      location.component !== undefined ||
      location.selector !== undefined ||
      location.elementRef !== undefined,
    { message: "location must include at least one anchor" },
  );
export type Location = z.infer<typeof LocationSchema>;

export const SuggestedPatchSchema = z
  .object({
    kind: z.enum(["contrast-hex", "aria-attribute", "target-size"]),
    change: nonEmptyStringSchema,
  })
  .strict();
export type SuggestedPatch = z.infer<typeof SuggestedPatchSchema>;

const evidenceListSchema = z.array(EvidenceSchema).min(1);
const citedHeuristicsSchema = z.array(nonEmptyStringSchema);

function hasToolResultEvidence(evidence: Evidence[] | undefined): boolean {
  return Array.isArray(evidence) && evidence.some((entry) => entry.kind === "tool-result");
}

function enforceMeasuredEvidence(
  method: EvaluationMethod,
  evidence: Evidence[] | undefined,
  context: z.RefinementCtx,
): void {
  if (method === "measured" && !hasToolResultEvidence(evidence)) {
    context.addIssue({
      code: "custom",
      message: 'measured findings require at least one "tool-result" evidence item',
      path: ["evidence"],
    });
  }
}

function enforceJudgedHeuristicCitation(
  method: EvaluationMethod,
  citedHeuristics: string[] | undefined,
  context: z.RefinementCtx,
): void {
  if (method === "judged" && (!Array.isArray(citedHeuristics) || citedHeuristics.length === 0)) {
    context.addIssue({
      code: "custom",
      message: "judged findings require at least one cited heuristic",
      path: ["citedHeuristics"],
    });
  }
}

function enforceJudgedNoToolResultEvidence(
  method: EvaluationMethod,
  evidence: Evidence[] | undefined,
  context: z.RefinementCtx,
): void {
  if (method === "judged" && hasToolResultEvidence(evidence)) {
    context.addIssue({
      code: "custom",
      message: 'judged findings cannot include "tool-result" evidence',
      path: ["evidence"],
    });
  }
}

export const FindingDraftSchema = z
  .object({
    draftId: nonEmptyStringSchema,
    lens: nonEmptyStringSchema,
    issueType: nonEmptyStringSchema,
    method: EvaluationMethodSchema,
    title: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
    citedHeuristics: citedHeuristicsSchema,
    evidence: evidenceListSchema,
    rawDimensions: DimensionsSchema.partial().strict(),
    location: LocationSchema,
    suggestedPatch: SuggestedPatchSchema.optional(),
  })
  .strict()
  .superRefine((draft, context) => {
    enforceMeasuredEvidence(draft.method, draft.evidence, context);
    enforceJudgedHeuristicCitation(draft.method, draft.citedHeuristics, context);
    enforceJudgedNoToolResultEvidence(draft.method, draft.evidence, context);

    if (draft.method === "judged" && draft.suggestedPatch !== undefined) {
      context.addIssue({
        code: "custom",
        message: "suggestedPatch is only allowed for measured findings",
        path: ["suggestedPatch"],
      });
    }
  });
export type FindingDraft = z.infer<typeof FindingDraftSchema>;

export const FindingSchema = z
  .object({
    id: nonEmptyStringSchema,
    lens: nonEmptyStringSchema,
    issueType: nonEmptyStringSchema,
    method: EvaluationMethodSchema,
    title: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
    citedHeuristics: citedHeuristicsSchema,
    evidence: evidenceListSchema,
    dimensions: DimensionsSchema,
    severityBand: SeverityBandSchema,
    location: LocationSchema,
    confidenceBand: ConfidenceBandSchema,
    gatedForHuman: z.boolean(),
    suggestedPatch: SuggestedPatchSchema.optional(),
  })
  .strict()
  .superRefine((finding, context) => {
    enforceMeasuredEvidence(finding.method, finding.evidence, context);
    enforceJudgedHeuristicCitation(finding.method, finding.citedHeuristics, context);
    enforceJudgedNoToolResultEvidence(finding.method, finding.evidence, context);

    if (finding.method === "judged" && finding.suggestedPatch !== undefined) {
      context.addIssue({
        code: "custom",
        message: "suggestedPatch is only allowed for measured findings",
        path: ["suggestedPatch"],
      });
    }
  });
export type Finding = z.infer<typeof FindingSchema>;

export const FindingsEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    runId: nonEmptyStringSchema,
    generatedAt: z.string().datetime(),
    findings: z.array(FindingSchema),
    degradation: z
      .object({
        skippedLenses: z.array(nonEmptyStringSchema),
        reason: nonEmptyStringSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type FindingsEnvelope = z.infer<typeof FindingsEnvelopeSchema>;
