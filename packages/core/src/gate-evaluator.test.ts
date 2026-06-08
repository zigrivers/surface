import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { isErr, isOk } from "./errors.js";
import type { Finding } from "./findings.js";
import { createGateEvaluator, evaluateGateWithQaFlows } from "./gate-evaluator.js";
import type { GatePolicy } from "./interfaces.js";
import { createBaseline, createTrackedFinding } from "./tracked-findings.js";

const baseFinding = {
  id: "f_p1_measured",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Button contrast is below AA",
  rationale: "Primary button contrast is insufficient against its background.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [
    {
      kind: "tool-result",
      tool: "axe",
      rule: "color-contrast",
      measuredValue: "3.1:1",
      threshold: "4.5:1",
    },
  ],
  dimensions: {
    severity: 0.8,
    confidence: 1,
    effort: 0.2,
    userImpact: 0.7,
    businessImpact: 0.5,
    a11yLegalRisk: 0.9,
    evidenceQuality: 1,
    agentImplementability: 0.9,
  },
  severityBand: "P1",
  location: {
    file: "src/Button.tsx",
    component: "Button",
    selector: ".btn-primary",
    elementRef: "@e12",
  },
  confidenceBand: "assert",
  gatedForHuman: false,
} satisfies Finding;

function findingWith(overrides: Partial<Finding>): Finding {
  return {
    ...baseFinding,
    ...overrides,
    dimensions: {
      ...baseFinding.dimensions,
      ...overrides.dimensions,
    },
    location: {
      ...baseFinding.location,
      ...overrides.location,
    },
  };
}

describe("GateEvaluator", () => {
  it("fails measured findings at or above the default P1 threshold", async () => {
    const evaluator = createGateEvaluator();
    const result = await evaluator.evaluate(
      [
        findingWith({ id: "f_p0", severityBand: "P0" }),
        findingWith({ id: "f_p1", severityBand: "P1" }),
        findingWith({ id: "f_p2", severityBand: "P2" }),
      ],
      DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        exitCode: 1,
        failingFindingIds: ["f_p0", "f_p1"],
        passed: false,
      },
    });
  });

  it("never fails judged or human-gated findings", async () => {
    const evaluator = createGateEvaluator();
    const result = await evaluator.evaluate(
      [
        findingWith({
          id: "f_judged_p0",
          method: "judged",
          severityBand: "P0",
          evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_nielsen_visibility" }],
        }),
        findingWith({ id: "f_gated_p0", gatedForHuman: true, severityBand: "P0" }),
      ],
      DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        exitCode: 0,
        failingFindingIds: [],
        passed: true,
      },
    });
  });

  it("does not fail findings already accepted by the active baseline", async () => {
    const evaluator = createGateEvaluator();
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation: { expectation: "axe color-contrast passes", kind: "measured-rule" },
    });
    const result = await evaluator.evaluate(
      [baseFinding],
      DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
      {
        baseline: createBaseline({
          baselineId: "baseline_001",
          identityKeys: [tracked.identityKey],
        }),
        trackedFindings: [tracked],
      },
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        baselineId: "baseline_001",
        exitCode: 0,
        failingFindingIds: [],
        passed: true,
      },
    });
  });

  it("does not fail findings with active waivers", async () => {
    const evaluator = createGateEvaluator();
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation: { expectation: "axe color-contrast passes", kind: "measured-rule" },
    });
    const result = await evaluator.evaluate(
      [baseFinding],
      DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
      {
        baseline: createBaseline({
          baselineId: "baseline_001",
          identityKeys: [tracked.identityKey],
          waivers: [
            {
              expiry: "2026-06-03T00:00:00.000Z",
              findingIdentityKey: tracked.identityKey,
              owner: "design-system",
              reason: "temporary acceptance",
            },
          ],
        }),
        now: "2026-06-02T00:00:00.000Z",
        trackedFindings: [tracked],
      },
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        exitCode: 0,
        failingFindingIds: [],
        passed: true,
      },
    });
  });

  it("fails baseline findings whose waiver has expired", async () => {
    const evaluator = createGateEvaluator();
    const tracked = createTrackedFinding({
      finding: baseFinding,
      gateDisposition: "ignored-by-waiver",
      runId: "run_001",
      validation: { expectation: "axe color-contrast passes", kind: "measured-rule" },
    });
    const result = await evaluator.evaluate(
      [baseFinding],
      DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
      {
        baseline: createBaseline({
          baselineId: "baseline_001",
          identityKeys: [tracked.identityKey],
          waivers: [
            {
              expiry: "2026-06-01T00:00:00.000Z",
              findingIdentityKey: tracked.identityKey,
              owner: "design-system",
              reason: "temporary acceptance",
            },
          ],
        }),
        now: "2026-06-02T00:00:00.000Z",
        trackedFindings: [tracked],
      },
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        baselineId: "baseline_001",
        exitCode: 1,
        failingFindingIds: [baseFinding.id],
        passed: false,
      },
    });
  });

  it("returns a policy_invalid error for malformed gate policies", async () => {
    const evaluator = createGateEvaluator();
    const malformedPolicy = {
      ...DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
      neverFailOn: ["judged"],
    } as unknown as GatePolicy;
    const result = await evaluator.evaluate([baseFinding], malformedPolicy);

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "policy_invalid",
        kind: "ConfigError",
      },
    });
  });

  it("fails with flows when reviewed high-severity flow failures exist", () => {
    const result = evaluateGateWithQaFlows({
      findings: [],
      policy: makeGatePolicy({ failOnFlowSeverityAtOrAbove: "high" }),
      qaFlowRuns: [
        {
          flowId: "checkout",
          gateEligible: true,
          highestFailedSeverity: "high",
          id: "flowrun_checkout",
          status: "failed",
        },
      ],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      return;
    }

    expect(result.value.passed).toBe(false);
    expect(result.value.failingFlowRunIds).toEqual(["flowrun_checkout"]);
  });

  it("does not fail gates on unverified exploratory candidates", () => {
    const result = evaluateGateWithQaFlows({
      candidateFindings: [{ gateEligible: false, id: "qfc_candidate", severity: "critical" }],
      findings: [],
      policy: makeGatePolicy({ failOnFlowSeverityAtOrAbove: "high" }),
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      return;
    }

    expect(result.value.passed).toBe(true);
    expect(result.value.failingFlowRunIds).toEqual([]);
  });

  it("requires explicit QA flow gate eligibility", () => {
    const result = evaluateGateWithQaFlows({
      findings: [],
      policy: makeGatePolicy({ failOnFlowSeverityAtOrAbove: "high" }),
      qaFlowRuns: [
        {
          flowId: "checkout",
          highestFailedSeverity: "critical",
          id: "flowrun_unreviewed",
          status: "failed",
        },
      ],
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      return;
    }

    expect(result.value.passed).toBe(true);
    expect(result.value.failingFlowRunIds).toEqual([]);
  });
});

function makeGatePolicy(options: { readonly failOnFlowSeverityAtOrAbove: "high" }): GatePolicy & {
  readonly failOnFlowSeverityAtOrAbove: "high";
} {
  return {
    ...DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
    failOnFlowSeverityAtOrAbove: options.failOnFlowSeverityAtOrAbove,
  };
}
