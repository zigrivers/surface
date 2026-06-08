import { GatePolicySchema } from "./config.js";
import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import type { QaSeverity } from "./browser-qa/schemas.js";
import type { Finding, SeverityBand } from "./findings.js";
import { deriveFindingIdentity } from "./identity.js";
import type { GateEvaluationContext, GateEvaluator, GatePolicy, GateResult } from "./interfaces.js";
import {
  applyWaiversToTrackedFindings,
  type Baseline,
  type TrackedFinding,
} from "./tracked-findings.js";

const SEVERITY_RANK: Record<SeverityBand, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};
const QA_SEVERITY_RANK: Record<QaSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type QaGateFlowRun = {
  readonly flowId?: string;
  readonly gateEligible?: boolean;
  readonly highestFailedSeverity?: QaSeverity;
  readonly id: string;
  readonly status: "passed" | "failed" | "degraded";
};

export type QaGateCandidateFinding = {
  readonly gateEligible: boolean;
  readonly id: string;
  readonly severity: QaSeverity;
};

export type FlowAwareGatePolicy = GatePolicy & {
  readonly failOnFlowSeverityAtOrAbove?: QaSeverity;
};

export type FlowAwareGateInput = {
  readonly candidateFindings?: readonly QaGateCandidateFinding[];
  readonly context?: GateEvaluationContext;
  readonly findings: readonly Finding[];
  readonly policy: FlowAwareGatePolicy;
  readonly qaFlowRuns?: readonly QaGateFlowRun[];
};

export type FlowAwareGateResult = GateResult & {
  readonly failingCandidateIds: readonly string[];
  readonly failingFlowRunIds: readonly string[];
};

/** Create the default release gate evaluator for measured findings. */
export function createGateEvaluator(): GateEvaluator {
  return {
    evaluate: (findings, policy, context) =>
      Promise.resolve(evaluateGate(findings, policy, context)),
  };
}

export function evaluateGateWithQaFlows(
  input: FlowAwareGateInput,
): Result<FlowAwareGateResult, SurfaceError> {
  const measuredResult = evaluateGate(
    input.findings,
    measuredGatePolicyFor(input.policy),
    input.context,
  );

  if (!measuredResult.ok) {
    return measuredResult;
  }

  const threshold = QA_SEVERITY_RANK[input.policy.failOnFlowSeverityAtOrAbove ?? "high"];
  const failingFlowRunIds = (input.qaFlowRuns ?? [])
    .filter((flowRun) => shouldFailForQaFlow(flowRun, threshold))
    .map((flowRun) => flowRun.id);
  const failingCandidateIds = (input.candidateFindings ?? [])
    .filter((candidate) => shouldFailForQaCandidate(candidate, threshold))
    .map((candidate) => candidate.id);
  const passed =
    measuredResult.value.passed &&
    failingFlowRunIds.length === 0 &&
    failingCandidateIds.length === 0;

  return ok({
    ...measuredResult.value,
    exitCode: passed ? 0 : 1,
    failingCandidateIds,
    failingFlowRunIds,
    passed,
  });
}

function evaluateGate(
  findings: readonly Finding[],
  policy: GatePolicy,
  context: GateEvaluationContext = {},
): Result<GateResult, SurfaceError> {
  const parsedPolicy = GatePolicySchema.safeParse(policy);

  if (!parsedPolicy.success) {
    return err(
      createSurfaceError("policy_invalid", "Gate policy is invalid.", {
        cause: parsedPolicy.error,
      }),
    );
  }

  const policyData = parsedPolicy.data;
  const threshold = SEVERITY_RANK[policyData.failOnNewMeasuredAtOrAbove];
  const baselineContext = buildBaselineContext(context);
  const failingFindingIds = findings
    .filter((finding) => shouldFailGate(finding, policyData.neverFailOn, threshold))
    .filter((finding) => shouldEvaluateAgainstBaseline(finding, baselineContext))
    .map((finding) => finding.id);
  const passed = failingFindingIds.length === 0;

  return ok({
    passed,
    failingFindingIds,
    exitCode: passed ? 0 : 1,
    ...(baselineContext.baseline === undefined
      ? {}
      : { baselineId: baselineContext.baseline.baselineId }),
  });
}

type BaselineContext = {
  readonly baseline?: Baseline;
  readonly trackedByFindingId: ReadonlyMap<string, TrackedFinding>;
};

function buildBaselineContext(context: GateEvaluationContext): BaselineContext {
  const baseline = context.baseline;
  const trackedFindings =
    baseline === undefined
      ? (context.trackedFindings ?? [])
      : applyWaiversToTrackedFindings({
          trackedFindings: context.trackedFindings ?? [],
          waivers: baseline.waivers,
          now: context.now ?? new Date(),
        });
  const trackedByFindingId = new Map<string, TrackedFinding>();

  for (const trackedFinding of trackedFindings) {
    if (trackedFinding.currentFindingId !== undefined) {
      trackedByFindingId.set(trackedFinding.currentFindingId, trackedFinding);
    }
  }

  return {
    ...(baseline === undefined ? {} : { baseline }),
    trackedByFindingId,
  };
}

function shouldEvaluateAgainstBaseline(finding: Finding, context: BaselineContext): boolean {
  const trackedFinding = context.trackedByFindingId.get(finding.id);

  if (trackedFinding?.gateDisposition === "ignored-by-waiver") {
    return false;
  }

  if (context.baseline === undefined) {
    return true;
  }

  const identityKey = trackedFinding?.identityKey ?? deriveFindingIdentity(finding).identityKey;
  const hasWaiverRecord = context.baseline.waivers.some(
    (waiver) => waiver.findingIdentityKey === identityKey,
  );

  return !context.baseline.identityKeys.includes(identityKey) || hasWaiverRecord;
}

function shouldFailGate(
  finding: Finding,
  neverFailOn: GatePolicy["neverFailOn"],
  threshold: number,
): boolean {
  if (neverFailOn.includes("gatedForHuman") && finding.gatedForHuman) {
    return false;
  }

  if (finding.method !== "measured") {
    return false;
  }

  return SEVERITY_RANK[finding.severityBand] <= threshold;
}

function measuredGatePolicyFor(policy: FlowAwareGatePolicy): GatePolicy {
  return {
    failOnNewMeasuredAtOrAbove: policy.failOnNewMeasuredAtOrAbove,
    neverFailOn: [...policy.neverFailOn],
    thresholds: { ...policy.thresholds },
  };
}

function shouldFailForQaFlow(flowRun: QaGateFlowRun, threshold: number): boolean {
  if (flowRun.gateEligible !== true || flowRun.status !== "failed") {
    return false;
  }

  return (
    flowRun.highestFailedSeverity !== undefined &&
    QA_SEVERITY_RANK[flowRun.highestFailedSeverity] <= threshold
  );
}

function shouldFailForQaCandidate(candidate: QaGateCandidateFinding, threshold: number): boolean {
  return candidate.gateEligible && QA_SEVERITY_RANK[candidate.severity] <= threshold;
}
