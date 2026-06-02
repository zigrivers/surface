import { z } from "zod";

import { createSurfaceError, err, ok, type Result } from "./errors.js";
import { BacklogSchema, FindingSchema, type Backlog, type Finding } from "./findings.js";
import { deriveFindingIdentity } from "./identity.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

const timestampSchema = z.string().datetime();

export const VerdictDecisionSchema = z.enum(["accept", "reject", "correct", "defer"]);
export type VerdictDecision = z.infer<typeof VerdictDecisionSchema>;

export const VerdictReusePolicySchema = z.enum(["this-run", "this-identity-always"]);
export type VerdictReusePolicy = z.infer<typeof VerdictReusePolicySchema>;

export const VerdictSchema = z
  .object({
    findingIdentityKey: nonEmptyStringSchema,
    findingId: nonEmptyStringSchema,
    decision: VerdictDecisionSchema,
    rationale: nonEmptyStringSchema,
    recordedAt: timestampSchema,
    reusePolicy: VerdictReusePolicySchema,
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

export const SelfGroundingReportSchema = z
  .object({
    sampleSize: z.number().int().nonnegative(),
    measuredGroundTruthCount: z.number().int().nonnegative(),
    judgedFalsePositiveCount: z.number().int().nonnegative(),
    judgedFalsePositiveRate: z.number().min(0).max(1),
  })
  .strict();
export type SelfGroundingReport = z.infer<typeof SelfGroundingReportSchema>;

const CreateVerdictInputSchema = z
  .object({
    finding: FindingSchema,
    decision: VerdictDecisionSchema,
    rationale: nonEmptyStringSchema,
    recordedAt: z.union([timestampSchema, z.date()]).optional(),
    reusePolicy: VerdictReusePolicySchema.optional(),
  })
  .strict();

export type CreateVerdictInput = {
  readonly finding: Finding;
  readonly decision: VerdictDecision;
  readonly rationale: string;
  readonly recordedAt?: string | Date;
  readonly reusePolicy?: VerdictReusePolicy;
};

export type CreateSelfGroundingReportInput = {
  readonly findings: readonly Finding[];
  readonly verdicts: readonly Verdict[];
};

export type ApplyVerdictsToBacklogInput = {
  readonly backlog: Backlog;
  readonly verdicts: readonly Verdict[];
};

export function createVerdict(input: CreateVerdictInput): Result<Verdict> {
  const parsedInput = CreateVerdictInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Verdict input is invalid.", {
        cause: parsedInput.error,
      }),
    );
  }

  const finding = parsedInput.data.finding;
  const identity = deriveFindingIdentity(finding);
  const recordedAt =
    parsedInput.data.recordedAt instanceof Date
      ? parsedInput.data.recordedAt.toISOString()
      : (parsedInput.data.recordedAt ?? new Date().toISOString());
  const verdict = VerdictSchema.safeParse({
    findingIdentityKey: identity.identityKey,
    findingId: finding.id,
    decision: parsedInput.data.decision,
    rationale: parsedInput.data.rationale,
    recordedAt,
    reusePolicy: parsedInput.data.reusePolicy ?? "this-run",
  });

  if (!verdict.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Verdict output is invalid.", {
        cause: verdict.error,
      }),
    );
  }

  return ok(verdict.data);
}

export function createSelfGroundingReport(
  input: CreateSelfGroundingReportInput,
): Result<SelfGroundingReport> {
  const parsedFindings = z.array(FindingSchema).safeParse(input.findings);
  const parsedVerdicts = z.array(VerdictSchema).safeParse(input.verdicts);

  if (!parsedFindings.success || !parsedVerdicts.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Self-grounding input is invalid.", {
        cause: parsedFindings.success ? parsedVerdicts.error : parsedFindings.error,
      }),
    );
  }

  const findingsById = new Map(parsedFindings.data.map((finding) => [finding.id, finding]));
  const adjudicatedJudgedVerdicts = parsedVerdicts.data.filter((verdict) => {
    const finding = findingsById.get(verdict.findingId);
    return finding?.method === "judged";
  });
  const measuredGroundTruthCount = parsedVerdicts.data.filter((verdict) => {
    const finding = findingsById.get(verdict.findingId);
    return finding?.method === "measured";
  }).length;
  const judgedFalsePositiveCount = adjudicatedJudgedVerdicts.filter(
    (verdict) => verdict.decision === "reject",
  ).length;
  const sampleSize = adjudicatedJudgedVerdicts.length;
  const judgedFalsePositiveRate =
    sampleSize === 0 ? 0 : roundRate(judgedFalsePositiveCount / sampleSize);
  const report = SelfGroundingReportSchema.safeParse({
    sampleSize,
    measuredGroundTruthCount,
    judgedFalsePositiveCount,
    judgedFalsePositiveRate,
  });

  if (!report.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Self-grounding report is invalid.", {
        cause: report.error,
      }),
    );
  }

  return ok(report.data);
}

export function applyVerdictsToBacklog(input: ApplyVerdictsToBacklogInput): Result<Backlog> {
  const parsedBacklog = BacklogSchema.safeParse(input.backlog);
  const parsedVerdicts = z.array(VerdictSchema).safeParse(input.verdicts);

  if (!parsedBacklog.success || !parsedVerdicts.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Verdict backlog input is invalid.", {
        cause: parsedBacklog.success ? parsedVerdicts.error : parsedBacklog.error,
      }),
    );
  }

  const rejectedFindingIds = new Set(
    parsedVerdicts.data
      .filter((verdict) => verdict.decision === "reject")
      .map((verdict) => verdict.findingId),
  );
  const entriesWithOriginalIndex = parsedBacklog.data.entries.map((entry, index) => ({
    entry: {
      ...entry,
      priority: rejectedFindingIds.has(entry.findingId) ? 0 : entry.priority,
    },
    originalIndex: index,
  }));
  const entries = entriesWithOriginalIndex
    .sort((left, right) => {
      if (left.entry.priority !== right.entry.priority) {
        return right.entry.priority - left.entry.priority;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ entry }, index) => ({
      ...entry,
      rank: index + 1,
    }));
  const backlog = BacklogSchema.safeParse({
    ...parsedBacklog.data,
    entries,
  });

  if (!backlog.success) {
    return err(
      createSurfaceError("invalid_verdict_transition", "Verdict backlog output is invalid.", {
        cause: backlog.error,
      }),
    );
  }

  return ok(backlog.data);
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}
