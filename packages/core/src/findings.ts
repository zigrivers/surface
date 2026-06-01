import { z } from "zod";

import { createSurfaceError, err, ok, type Result } from "./errors.js";
import {
  DEFAULT_FINDINGS_POLICY,
  FindingsPolicySchema,
  type FindingsPolicy,
} from "./findings-policy.js";
import { NormalizedScoreSchema } from "./scores.js";

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
    severity: NormalizedScoreSchema,
    confidence: NormalizedScoreSchema,
    effort: NormalizedScoreSchema,
    userImpact: NormalizedScoreSchema,
    businessImpact: NormalizedScoreSchema,
    a11yLegalRisk: NormalizedScoreSchema,
    evidenceQuality: NormalizedScoreSchema,
    agentImplementability: NormalizedScoreSchema,
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

const DEFAULT_DIMENSIONS = {
  severity: 0.5,
  confidence: 0.5,
  effort: 0.5,
  userImpact: 0.5,
  businessImpact: 0.5,
  a11yLegalRisk: 0,
  evidenceQuality: 0.5,
  agentImplementability: 0.5,
} satisfies Dimensions;

const HUMAN_GATE_TEXT_PATTERN =
  /\b(meaning|brand|wording|button\s+(copy|text|label)|copy\s+(text|label|wording|change)|label\s+(copy|text|wording)|visible\s+text\s+(copy|change|wording)|critical[-\s]?flow|conversion|conversion[-\s]?flow|checkout|payment|purchase|sign[-\s]?up)\b/i;

function definedDimensionOverrides(
  rawDimensions: FindingDraft["rawDimensions"] | undefined,
): Partial<Dimensions> {
  if (rawDimensions === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawDimensions).filter(([, value]) => value !== undefined),
  );
}

function dimensionsForDraft(draft: FindingDraft): Dimensions {
  const methodDefaults =
    draft.method === "measured" ? { confidence: 1, evidenceQuality: 1 } : { confidence: 0.5 };

  return {
    ...DEFAULT_DIMENSIONS,
    ...methodDefaults,
    ...definedDimensionOverrides(draft.rawDimensions),
  };
}

function severityBandFor(severity: number, policy: FindingsPolicy): SeverityBand {
  if (severity >= policy.severityCutoffs.P0) {
    return "P0";
  }

  if (severity >= policy.severityCutoffs.P1) {
    return "P1";
  }

  if (severity >= policy.severityCutoffs.P2) {
    return "P2";
  }

  return "P3";
}

function confidenceBandFor(confidence: number, policy: FindingsPolicy): ConfidenceBand {
  if (confidence >= policy.confidenceCutoffs.assert) {
    return "assert";
  }

  if (confidence >= policy.confidenceCutoffs.question) {
    return "surface-as-question";
  }

  return "suppress-unless-deep";
}

function draftMatchesHumanGateCategory(draft: FindingDraft): boolean {
  return HUMAN_GATE_TEXT_PATTERN.test(
    [draft.lens, draft.issueType, draft.title, draft.rationale, ...(draft.citedHeuristics ?? [])]
      .filter(Boolean)
      .join(" "),
  );
}

function isJudgedFindingAboveHumanGateThreshold(
  method: EvaluationMethod,
  severityBand: SeverityBand,
): boolean {
  return method === "judged" && (severityBand === "P0" || severityBand === "P1");
}

function shouldGateForHuman(draft: FindingDraft, severityBand: SeverityBand): boolean {
  return (
    draftMatchesHumanGateCategory(draft) ||
    isJudgedFindingAboveHumanGateThreshold(draft.method, severityBand)
  );
}

/**
 * Converts a validated draft occurrence into the immutable Finding shape used by reports/backlogs.
 */
export function scoreFinding(
  draft: FindingDraft,
  policy: FindingsPolicy = DEFAULT_FINDINGS_POLICY,
): Result<Finding> {
  const parsedPolicy = FindingsPolicySchema.safeParse(policy);

  if (!parsedPolicy.success) {
    return err(
      createSurfaceError("finding_score_failed", "Findings scoring policy is invalid.", {
        cause: parsedPolicy.error,
      }),
    );
  }

  const parsedDraft = FindingDraftSchema.safeParse(draft);

  if (!parsedDraft.success) {
    return err(
      createSurfaceError("finding_draft_invalid", "Finding draft cannot be scored.", {
        cause: parsedDraft.error,
      }),
    );
  }

  const validDraft = parsedDraft.data;
  const dimensions = dimensionsForDraft(validDraft);
  const severityBand = severityBandFor(dimensions.severity, parsedPolicy.data);
  const confidenceBand = confidenceBandFor(dimensions.confidence, parsedPolicy.data);
  const gatedForHuman = shouldGateForHuman(validDraft, severityBand);
  const finding = FindingSchema.safeParse({
    id: validDraft.draftId,
    lens: validDraft.lens,
    issueType: validDraft.issueType,
    method: validDraft.method,
    title: validDraft.title,
    rationale: validDraft.rationale,
    citedHeuristics: validDraft.citedHeuristics,
    evidence: validDraft.evidence,
    dimensions,
    severityBand,
    location: validDraft.location,
    confidenceBand,
    gatedForHuman,
    ...(validDraft.method === "measured" && validDraft.suggestedPatch !== undefined
      ? { suggestedPatch: validDraft.suggestedPatch }
      : {}),
  });

  if (!finding.success) {
    return err(
      createSurfaceError("finding_score_failed", "Scoring produced an invalid finding.", {
        cause: finding.error,
      }),
    );
  }

  return ok(finding.data);
}

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
