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
    tool: z.enum(["axe", "lighthouse", "eslint-jsx-a11y", "backend", "context-ingestor"]),
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

export const ContrastHexSuggestedPatchSchema = z
  .object({
    kind: z.literal("contrast-hex"),
    change: nonEmptyStringSchema,
  })
  .strict();

export const AriaAttributeSuggestedPatchSchema = z
  .object({
    kind: z.literal("aria-attribute"),
    change: nonEmptyStringSchema,
  })
  .strict();

export const TargetSizeSuggestedPatchSchema = z
  .object({
    kind: z.literal("target-size"),
    change: nonEmptyStringSchema,
  })
  .strict();

export const SuggestedPatchSchema = z.discriminatedUnion("kind", [
  ContrastHexSuggestedPatchSchema,
  AriaAttributeSuggestedPatchSchema,
  TargetSizeSuggestedPatchSchema,
]);
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
    tags: z.array(nonEmptyStringSchema).optional(),
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
    tags: z.array(nonEmptyStringSchema).optional(),
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
    title: nonEmptyStringSchema.optional(),
    rationale: nonEmptyStringSchema.optional(),
    severityBand: SeverityBandSchema.optional(),
    location: LocationSchema.optional(),
    suggestedPatch: SuggestedPatchSchema.optional(),
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
const HEX_COLOR_PATTERN = /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/giu;
const CONTRAST_RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*:1/u;
const CONTRAST_EXPECTED_RATIO_PATTERN =
  /(?:expected|threshold|at\s+least)[^0-9]*(\d+(?:\.\d+)?)\s*:1/iu;
const DEFAULT_CONTRAST_THRESHOLD = 4.5;
const MIN_TARGET_SIZE_PX = 44;
const ACCESSIBLE_NAME_RULES = new Set([
  "aria-command-name",
  "aria-input-field-name",
  "aria-meter-name",
  "aria-progressbar-name",
  "aria-toggle-field-name",
  "aria-tooltip-name",
  "aria-treeitem-name",
  "button-name",
  "control-has-associated-label",
  "custom-controls-labels",
  "input-button-name",
  "label",
  "link-name",
  "select-name",
]);

type RgbColor = {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
};

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

function toolResultEvidenceFor(draft: FindingDraft): ToolResultEvidence[] {
  return draft.evidence.filter(
    (entry): entry is ToolResultEvidence => entry.kind === "tool-result",
  );
}

function generatedSuggestedPatchFor(draft: FindingDraft): SuggestedPatch | undefined {
  if (draft.method !== "measured") {
    return undefined;
  }

  return (
    contrastHexSuggestedPatchFor(draft) ??
    ariaAttributeSuggestedPatchFor(draft) ??
    targetSizeSuggestedPatchFor(draft)
  );
}

function suggestedPatchFor(draft: FindingDraft): SuggestedPatch | undefined {
  return draft.suggestedPatch ?? generatedSuggestedPatchFor(draft);
}

function contrastHexSuggestedPatchFor(draft: FindingDraft): SuggestedPatch | undefined {
  const evidence = toolResultEvidenceFor(draft).find(
    (entry) => entry.rule === "color-contrast" || draft.issueType === "contrast-insufficient",
  );

  if (evidence === undefined) {
    return undefined;
  }

  const contrastInputs = contrastInputsFor(evidence);

  if (contrastInputs === undefined) {
    return undefined;
  }

  const { foreground, background, threshold } = contrastInputs;
  const currentRatio = contrastRatio(foreground.rgb, background.rgb);

  if (currentRatio >= threshold) {
    return undefined;
  }

  const replacement = foregroundReplacementFor(foreground.rgb, background.rgb, threshold);

  return {
    kind: "contrast-hex",
    change: `Set foreground color from ${foreground.hex} to ${replacement} against ${background.hex} to meet ${formatRatio(threshold)}:1.`,
  };
}

function contrastInputsFor(evidence: ToolResultEvidence):
  | {
      readonly foreground: { readonly hex: string; readonly rgb: RgbColor };
      readonly background: { readonly hex: string; readonly rgb: RgbColor };
      readonly threshold: number;
    }
  | undefined {
  const text = [evidence.measuredValue, evidence.threshold].filter(Boolean).join(" ");
  const colors = [...text.matchAll(HEX_COLOR_PATTERN)].map((match) => normalizeHexColor(match[0]));

  if (colors.length < 2) {
    return undefined;
  }

  const firstColor = colors[0];
  const secondColor = colors[1];

  if (firstColor === undefined || secondColor === undefined) {
    return undefined;
  }

  const foregroundHex =
    colorAfterLabel(text, /(?:foreground|fg|text(?:\s+color)?|color)/iu) ?? firstColor;
  const backgroundHex = colorAfterLabel(text, /(?:background|bg)(?:\s+color)?/iu) ?? secondColor;
  const foreground = rgbForHex(foregroundHex);
  const background = rgbForHex(backgroundHex);

  if (foreground === undefined || background === undefined) {
    return undefined;
  }

  return {
    foreground: { hex: foregroundHex, rgb: foreground },
    background: { hex: backgroundHex, rgb: background },
    threshold: thresholdFor(evidence) ?? DEFAULT_CONTRAST_THRESHOLD,
  };
}

function colorAfterLabel(text: string, labelPattern: RegExp): string | undefined {
  const labelMatch = labelPattern.exec(text);

  if (labelMatch === null) {
    return undefined;
  }

  HEX_COLOR_PATTERN.lastIndex = labelMatch.index + labelMatch[0].length;
  const colorMatch = HEX_COLOR_PATTERN.exec(text);
  HEX_COLOR_PATTERN.lastIndex = 0;

  return colorMatch === null ? undefined : normalizeHexColor(colorMatch[0]);
}

function normalizeHexColor(hex: string): string {
  const value = hex.toLowerCase();

  if (value.length === 4) {
    const red = value.charAt(1);
    const green = value.charAt(2);
    const blue = value.charAt(3);

    return `#${red}${red}${green}${green}${blue}${blue}`;
  }

  return value;
}

function rgbForHex(hex: string): RgbColor | undefined {
  const normalized = normalizeHexColor(hex);
  const match = /^#([0-9a-f]{6})$/u.exec(normalized);

  if (match === null) {
    return undefined;
  }

  const value = match[1];

  if (value === undefined) {
    return undefined;
  }

  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

function thresholdFor(evidence: ToolResultEvidence): number | undefined {
  const match =
    evidence.threshold === undefined
      ? CONTRAST_EXPECTED_RATIO_PATTERN.exec(evidence.measuredValue)
      : CONTRAST_RATIO_PATTERN.exec(evidence.threshold);

  if (match === null) {
    return undefined;
  }

  const matchedRatio = match[1];

  if (matchedRatio === undefined) {
    return undefined;
  }

  const value = Number(matchedRatio);

  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function foregroundReplacementFor(
  foreground: RgbColor,
  background: RgbColor,
  threshold: number,
): string {
  const target =
    relativeLuminance(background) >= relativeLuminance(foreground)
      ? { red: 0, green: 0, blue: 0 }
      : { red: 255, green: 255, blue: 255 };
  let low = 0;
  let high = 1;
  let best = target;

  for (let index = 0; index < 24; index += 1) {
    const midpoint = (low + high) / 2;
    const candidate = mixColor(foreground, target, midpoint);

    if (contrastRatio(candidate, background) >= threshold) {
      best = candidate;
      high = midpoint;
    } else {
      low = midpoint;
    }
  }

  return hexForRgb(best);
}

function mixColor(from: RgbColor, to: RgbColor, amount: number): RgbColor {
  return {
    red: Math.round(from.red + (to.red - from.red) * amount),
    green: Math.round(from.green + (to.green - from.green) * amount),
    blue: Math.round(from.blue + (to.blue - from.blue) * amount),
  };
}

function hexForRgb(color: RgbColor): string {
  return `#${hexByte(color.red)}${hexByte(color.green)}${hexByte(color.blue)}`;
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function contrastRatio(left: RgbColor, right: RgbColor): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: RgbColor): number {
  const [red, green, blue] = [color.red, color.green, color.blue].map((component) => {
    const normalized = component / 255;

    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function formatRatio(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function ariaAttributeSuggestedPatchFor(draft: FindingDraft): SuggestedPatch | undefined {
  const hasAccessibleNameRule = toolResultEvidenceFor(draft).some((entry) =>
    ACCESSIBLE_NAME_RULES.has(entry.rule),
  );

  if (draft.issueType !== "accessible-name-missing" && !hasAccessibleNameRule) {
    return undefined;
  }

  return {
    kind: "aria-attribute",
    change: `Add aria-label="<accessible name>" to ${targetForPatch(draft)}.`,
  };
}

function targetSizeSuggestedPatchFor(draft: FindingDraft): SuggestedPatch | undefined {
  const hasTargetSizeRule = toolResultEvidenceFor(draft).some(
    (entry) => entry.rule === "target-size",
  );

  if (draft.issueType !== "target-size" && !hasTargetSizeRule) {
    return undefined;
  }

  return {
    kind: "target-size",
    change: `Set min-width and min-height to at least ${MIN_TARGET_SIZE_PX}px for ${targetForPatch(draft)}; preserve spacing between adjacent targets.`,
  };
}

function targetForPatch(draft: FindingDraft): string {
  return (
    draft.location.selector ??
    draft.location.elementRef ??
    draft.location.component ??
    draft.location.file ??
    "the affected element"
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
      title: ranking.finding.title,
      rationale: ranking.finding.rationale,
      severityBand: ranking.finding.severityBand,
      location: ranking.finding.location,
      ...(ranking.finding.suggestedPatch !== undefined
        ? { suggestedPatch: ranking.finding.suggestedPatch }
        : {}),
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
  const suggestedPatch = suggestedPatchFor(validDraft);
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
    ...(suggestedPatch !== undefined ? { suggestedPatch } : {}),
    ...(validDraft.tags === undefined ? {} : { tags: validDraft.tags }),
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
