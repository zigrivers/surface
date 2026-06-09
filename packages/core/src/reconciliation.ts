import { z } from "zod";

import { createSurfaceError, err, ok, type Result } from "./errors.js";
import { FindingSchema, type Finding } from "./findings.js";
import { NormalizedScoreSchema } from "./scores.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const ReconciliationUnavailableReasonSchema = z.enum([
  "model_unavailable",
  "channel_unavailable",
]);
export type ReconciliationUnavailableReason = z.infer<typeof ReconciliationUnavailableReasonSchema>;

export const ReconciliationChannelSchema = z.discriminatedUnion("status", [
  z
    .object({
      id: nonEmptyStringSchema,
      status: z.literal("available"),
      findings: z.array(FindingSchema),
    })
    .strict(),
  z
    .object({
      id: nonEmptyStringSchema,
      status: z.literal("unavailable"),
      reason: ReconciliationUnavailableReasonSchema,
      message: nonEmptyStringSchema,
    })
    .strict(),
]);
export type ReconciliationChannel = z.infer<typeof ReconciliationChannelSchema>;

export const ReconciliationInputSchema = z
  .object({
    channels: z.array(ReconciliationChannelSchema).min(1),
  })
  .strict();
export type ReconciliationInput = z.infer<typeof ReconciliationInputSchema>;

export const ReconciledFindingSchema = z
  .object({
    canonicalFindingId: nonEmptyStringSchema,
    finding: FindingSchema,
    confidence: NormalizedScoreSchema,
    severityBand: FindingSchema.shape.severityBand,
    sourceFindingIds: z.array(nonEmptyStringSchema).min(1),
    supportingChannels: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();
export type ReconciledFinding = z.infer<typeof ReconciledFindingSchema>;

export const ReconciliationQuestionSchema = z
  .object({
    kind: z.literal("severity-divergence"),
    groupKey: nonEmptyStringSchema,
    prompt: nonEmptyStringSchema,
    findingIds: z.array(nonEmptyStringSchema).min(2),
    channelIds: z.array(nonEmptyStringSchema).min(2),
    severityBands: z.array(FindingSchema.shape.severityBand).min(2),
  })
  .strict();
export type ReconciliationQuestion = z.infer<typeof ReconciliationQuestionSchema>;

export const ReconciliationUnavailableChannelSchema = z
  .object({
    id: nonEmptyStringSchema,
    reason: ReconciliationUnavailableReasonSchema,
    message: nonEmptyStringSchema,
  })
  .strict();
export type ReconciliationUnavailableChannel = z.infer<
  typeof ReconciliationUnavailableChannelSchema
>;

export const ReconciliationResultSchema = z
  .object({
    participatedChannels: z.array(nonEmptyStringSchema),
    unavailableChannels: z.array(ReconciliationUnavailableChannelSchema),
    findings: z.array(ReconciledFindingSchema),
    questions: z.array(ReconciliationQuestionSchema),
  })
  .strict();
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

export interface ReconciliationService {
  reconcile(input: ReconciliationInput): Result<ReconciliationResult>;
}

type FindingCandidate = {
  readonly channelId: string;
  readonly finding: Finding;
};

export function createReconciliationService(): ReconciliationService {
  return {
    reconcile: (input) => reconcileFindings(input),
  };
}

export function reconcileFindings(input: ReconciliationInput): Result<ReconciliationResult> {
  const parsedInput = ReconciliationInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return err(
      createSurfaceError("reconciliation_failed", "Reconciliation input is invalid.", {
        cause: parsedInput.error,
      }),
    );
  }

  const candidatesByGroup = new Map<string, FindingCandidate[]>();
  const participatedChannels: string[] = [];
  const unavailableChannels: ReconciliationUnavailableChannel[] = [];

  for (const channel of parsedInput.data.channels) {
    if (channel.status === "unavailable") {
      unavailableChannels.push({
        id: channel.id,
        reason: channel.reason,
        message: channel.message,
      });
      continue;
    }

    participatedChannels.push(channel.id);

    for (const finding of channel.findings) {
      const groupKey = groupKeyForFinding(finding);
      const candidates = candidatesByGroup.get(groupKey) ?? [];
      candidates.push({ channelId: channel.id, finding });
      candidatesByGroup.set(groupKey, candidates);
    }
  }

  const findings: ReconciledFinding[] = [];
  const questions: ReconciliationQuestion[] = [];

  for (const [groupKey, candidates] of candidatesByGroup) {
    if (hasSeverityDivergence(candidates)) {
      questions.push(questionForDivergence(groupKey, candidates));
      continue;
    }

    findings.push(reconciledFindingFor(candidates));
  }

  const parsedResult = ReconciliationResultSchema.safeParse({
    participatedChannels,
    unavailableChannels,
    findings: findings.sort(compareReconciledFindings),
    questions: questions.sort((left, right) => left.groupKey.localeCompare(right.groupKey)),
  });

  if (!parsedResult.success) {
    return err(
      createSurfaceError("reconciliation_failed", "Reconciliation produced invalid output.", {
        cause: parsedResult.error,
      }),
    );
  }

  return ok(parsedResult.data);
}

function groupKeyForFinding(finding: Finding): string {
  const location = finding.location;
  const anchor =
    location.elementRef ??
    location.selector ??
    location.component ??
    location.file ??
    "unknown-location";
  return [finding.lens, finding.issueType, anchor].join("::");
}

function hasSeverityDivergence(candidates: readonly FindingCandidate[]): boolean {
  return new Set(candidates.map((candidate) => candidate.finding.severityBand)).size > 1;
}

function questionForDivergence(
  groupKey: string,
  candidates: readonly FindingCandidate[],
): ReconciliationQuestion {
  const sortedCandidates = [...candidates].sort(compareCandidatesByFindingId);
  const [first] = sortedCandidates;
  const anchor = first === undefined ? groupKey : anchorSummaryFor(first.finding);

  return {
    kind: "severity-divergence",
    groupKey,
    prompt: `Model channels disagree on severity for ${anchor}; review before treating it as a mandate.`,
    findingIds: sortedCandidates.map((candidate) => candidate.finding.id),
    channelIds: sortedCandidates.map((candidate) => candidate.channelId),
    severityBands: [
      ...new Set(sortedCandidates.map((candidate) => candidate.finding.severityBand)),
    ],
  };
}

function reconciledFindingFor(candidates: readonly FindingCandidate[]): ReconciledFinding {
  const sortedCandidates = [...candidates].sort(compareCandidatesByConfidence);
  const [canonical] = sortedCandidates;

  if (canonical === undefined) {
    throw new Error("reconciledFindingFor requires at least one candidate");
  }

  const supportingCandidates = [...candidates].sort(compareCandidatesByFindingId);

  return {
    canonicalFindingId: canonical.finding.id,
    finding: canonical.finding,
    confidence: canonical.finding.dimensions.confidence,
    severityBand: canonical.finding.severityBand,
    sourceFindingIds: supportingCandidates.map((candidate) => candidate.finding.id),
    supportingChannels: supportingCandidates.map((candidate) => candidate.channelId),
  };
}

function anchorSummaryFor(finding: Finding): string {
  return (
    finding.location.component ??
    finding.location.selector ??
    finding.location.elementRef ??
    finding.location.file ??
    finding.title
  );
}

function compareCandidatesByFindingId(left: FindingCandidate, right: FindingCandidate): number {
  return left.finding.id.localeCompare(right.finding.id);
}

function compareCandidatesByConfidence(left: FindingCandidate, right: FindingCandidate): number {
  const confidence = right.finding.dimensions.confidence - left.finding.dimensions.confidence;

  if (confidence !== 0) {
    return confidence;
  }

  const evidenceQuality =
    right.finding.dimensions.evidenceQuality - left.finding.dimensions.evidenceQuality;

  if (evidenceQuality !== 0) {
    return evidenceQuality;
  }

  return left.finding.id.localeCompare(right.finding.id);
}

function compareReconciledFindings(left: ReconciledFinding, right: ReconciledFinding): number {
  const confidence = right.confidence - left.confidence;

  if (confidence !== 0) {
    return confidence;
  }

  return left.canonicalFindingId.localeCompare(right.canonicalFindingId);
}

export type { Finding };
