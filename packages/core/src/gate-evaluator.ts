import { GatePolicySchema } from "./config.js";
import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import type { Finding, SeverityBand } from "./findings.js";
import type { GateEvaluator, GatePolicy, GateResult } from "./interfaces.js";

const SEVERITY_RANK: Record<SeverityBand, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/** Create the default release gate evaluator for measured findings. */
export function createGateEvaluator(): GateEvaluator {
  return {
    evaluate: (findings, policy) => Promise.resolve(evaluateGate(findings, policy)),
  };
}

function evaluateGate(
  findings: readonly Finding[],
  policy: GatePolicy,
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
  const failingFindingIds = findings
    .filter((finding) => shouldFailGate(finding, policyData.neverFailOn, threshold))
    .map((finding) => finding.id);
  const passed = failingFindingIds.length === 0;

  return ok({
    passed,
    failingFindingIds,
    exitCode: passed ? 0 : 1,
  });
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
