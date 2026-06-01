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

/**
 * A single backlog row produced from a scored finding.
 *
 * Priority is an internal ordering value, not a headline product score. Duplicate
 * findings remain visible, but rows that match a prior finding by issue type and
 * precise anchor, or by issue type plus high title-token similarity on precise
 * anchors, are demoted and point at the highest-priority canonical finding.
 */
export const BacklogEntrySchema = z
  .object({
    findingId: nonEmptyStringSchema,
    priority: z.number().nonnegative(),
    rank: z.number().int().positive(),
    demotedAsDuplicateOf: nonEmptyStringSchema.optional(),
  })
  .strict();
export type BacklogEntry = z.infer<typeof BacklogEntrySchema>;

/**
 * Ordered implementation backlog for a run.
 *
 * Entries are ranked in list order by descending priority. The schema rejects
 * duplicate finding IDs and any extra scalar summary fields such as
 * `score`/`overallScore`.
 */
export const BacklogSchema = z
  .object({
    id: nonEmptyStringSchema,
    runId: nonEmptyStringSchema,
    entries: z.array(BacklogEntrySchema),
  })
  .strict()
  .superRefine((backlog, context) => {
    const findingIds = new Set<string>();

    for (let index = 0; index < backlog.entries.length; index += 1) {
      const entry = backlog.entries[index];
      const nextEntry = backlog.entries[index + 1];

      if (entry !== undefined && entry.rank !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "backlog entries must be ranked in list order",
          path: ["entries", index, "rank"],
        });
      }

      if (entry !== undefined && findingIds.has(entry.findingId)) {
        context.addIssue({
          code: "custom",
          message: "backlog entries must reference unique findings",
          path: ["entries", index, "findingId"],
        });
      }

      if (entry !== undefined) {
        findingIds.add(entry.findingId);
      }

      if (entry !== undefined && nextEntry !== undefined && entry.priority < nextEntry.priority) {
        context.addIssue({
          code: "custom",
          message: "backlog entries must be ordered by descending priority",
          path: ["entries", index + 1, "priority"],
        });
      }
    }
  });
export type Backlog = z.infer<typeof BacklogSchema>;

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

type RankedFinding = {
  readonly finding: Finding;
  readonly basePriority: number;
  readonly titleTokens: ReadonlySet<string>;
};

type DemotedFinding = RankedFinding & {
  readonly priority: number;
  readonly demotedAsDuplicateOf?: string;
};

const DUPLICATE_PRIORITY_PENALTY = 0.4;
const TOKEN_SIMILARITY_DUPLICATE_CUTOFF = 0.7;
const A11Y_LEGAL_RISK_BOOST = 0.25;

// US-021 keeps duplicates visible for trust, but makes diverse fixes win the next-action slot.
// These fixed weights are deterministic placeholders until scoring policy becomes configurable.

function effortWeight(effort: number): number {
  return 0.25 + effort * 0.75;
}

function priorityForFinding(finding: Finding): number {
  const dimensions = finding.dimensions;
  const basePriority =
    (dimensions.severity *
      dimensions.userImpact *
      dimensions.businessImpact *
      dimensions.confidence) /
    effortWeight(dimensions.effort);
  const a11yBoost = 1 + (dimensions.a11yLegalRisk ?? 0) * A11Y_LEGAL_RISK_BOOST;

  return basePriority * a11yBoost;
}

/**
 * Precise duplicate anchors, in precedence order.
 *
 * File-only locations are intentionally ignored because a file can contain many
 * unrelated issues. Element refs/selectors/components are stable enough to
 * support duplicate demotion.
 */
function locationAnchorKey(finding: Finding): string {
  const location = finding.location;

  if (location === undefined) {
    return "";
  }

  if (location.elementRef !== undefined) {
    return `el:${location.elementRef}`;
  }

  if (location.selector !== undefined) {
    return `sel:${location.selector}`;
  }

  if (location.component !== undefined) {
    return `comp:${location.component}|file:${location.file ?? ""}`;
  }

  return "";
}

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/gu)
      .filter((token) => token.length > 2),
  );
}

function tokenSimilarity(
  leftTokens: ReadonlySet<string>,
  rightTokens: ReadonlySet<string>,
): number {
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const smallerSet = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const largerSet = smallerSet === leftTokens ? rightTokens : leftTokens;
  let intersectionSize = 0;

  for (const token of smallerSet) {
    if (largerSet.has(token)) {
      intersectionSize += 1;
    }
  }

  const unionSize = leftTokens.size + rightTokens.size - intersectionSize;

  return intersectionSize / unionSize;
}

function areNearDuplicateFindings(left: RankedFinding, right: RankedFinding): boolean {
  if (left.finding.issueType !== right.finding.issueType) {
    return false;
  }

  const leftAnchor = locationAnchorKey(left.finding);
  const rightAnchor = locationAnchorKey(right.finding);

  if (leftAnchor.length > 0 && leftAnchor === rightAnchor) {
    return true;
  }

  if (leftAnchor.length === 0 || rightAnchor.length === 0) {
    return false;
  }

  return tokenSimilarity(left.titleTokens, right.titleTokens) >= TOKEN_SIMILARITY_DUPLICATE_CUTOFF;
}

function comparePriorityThenId(left: DemotedFinding, right: DemotedFinding): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return left.finding.id.localeCompare(right.finding.id);
}

function demoteNearDuplicates(rankings: readonly RankedFinding[]): DemotedFinding[] {
  const seenFindingsByIssueType = new Map<string, RankedFinding[]>();
  const canonicalByFindingId = new Map<string, string>();

  return rankings.map((ranking) => {
    const seenFindings = seenFindingsByIssueType.get(ranking.finding.issueType) ?? [];
    const duplicateOf = seenFindings.find((candidate) =>
      areNearDuplicateFindings(ranking, candidate),
    );

    seenFindings.push(ranking);
    seenFindingsByIssueType.set(ranking.finding.issueType, seenFindings);

    if (duplicateOf !== undefined) {
      const canonicalId = canonicalByFindingId.get(duplicateOf.finding.id)!;
      canonicalByFindingId.set(ranking.finding.id, canonicalId);

      return {
        ...ranking,
        priority: ranking.basePriority * DUPLICATE_PRIORITY_PENALTY,
        demotedAsDuplicateOf: canonicalId,
      };
    }

    canonicalByFindingId.set(ranking.finding.id, ranking.finding.id);

    return {
      ...ranking,
      priority: ranking.basePriority,
    };
  });
}

function roundPriority(priority: number): number {
  return Number(priority.toFixed(6));
}

function duplicateFindingIds(findings: readonly Finding[]): string[] {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const finding of findings) {
    if (seenIds.has(finding.id)) {
      duplicateIds.add(finding.id);
    }

    seenIds.add(finding.id);
  }

  return [...duplicateIds].sort();
}

/**
 * Builds the implementation backlog for a run.
 *
 * Findings are ranked by severity, user impact, business impact, confidence,
 * effort, and accessibility/legal risk. Near duplicates are detected within the
 * same issue type by matching precise anchors or, when both findings have
 * precise anchors, title-token similarity of at least 0.7. Duplicate chains point
 * to the highest-priority canonical finding. The returned backlog intentionally
 * has no scalar `score` or `overallScore` field.
 */
export function synthesizeBacklog(runId: string, findings: readonly Finding[]): Result<Backlog> {
  const parsedRunId = nonEmptyStringSchema.safeParse(runId);

  if (!parsedRunId.success) {
    return err(
      createSurfaceError("backlog_synthesis_failed", "Backlog run id is invalid.", {
        cause: parsedRunId.error,
      }),
    );
  }

  const parsedFindings = z.array(FindingSchema).safeParse(findings);

  if (!parsedFindings.success) {
    return err(
      createSurfaceError("backlog_synthesis_failed", "Backlog findings are invalid.", {
        cause: parsedFindings.error,
      }),
    );
  }

  const duplicatedIds = duplicateFindingIds(parsedFindings.data);

  if (duplicatedIds.length > 0) {
    return err(
      createSurfaceError("backlog_synthesis_failed", "Backlog findings contain duplicate IDs.", {
        details: {
          duplicateIds: duplicatedIds,
        },
      }),
    );
  }

  const rankedFindings = parsedFindings.data
    .map((finding) => ({
      finding,
      basePriority: priorityForFinding(finding),
      titleTokens: tokenSet(finding.title),
    }))
    .sort((left, right) => {
      if (left.basePriority !== right.basePriority) {
        return right.basePriority - left.basePriority;
      }

      return left.finding.id.localeCompare(right.finding.id);
    });
  const entries = demoteNearDuplicates(rankedFindings)
    .map((ranking) => ({
      ...ranking,
      priority: roundPriority(ranking.priority),
    }))
    .sort(comparePriorityThenId)
    .map((ranking, index) => ({
      findingId: ranking.finding.id,
      priority: ranking.priority,
      rank: index + 1,
      ...(ranking.demotedAsDuplicateOf !== undefined
        ? { demotedAsDuplicateOf: ranking.demotedAsDuplicateOf }
        : {}),
    }));
  const backlog = BacklogSchema.safeParse({
    id: `backlog_${parsedRunId.data}`,
    runId: parsedRunId.data,
    entries,
  });

  if (!backlog.success) {
    return err(
      createSurfaceError("backlog_synthesis_failed", "Backlog synthesis produced invalid output.", {
        cause: backlog.error,
      }),
    );
  }

  return ok(backlog.data);
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
