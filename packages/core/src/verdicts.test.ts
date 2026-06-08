import { describe, expect, it } from "vitest";

import { isOk } from "./errors.js";
import { type Backlog, type Finding } from "./findings.js";
import type { CandidateFinding } from "./browser-qa/schemas.js";
import {
  applyVerdictsToBacklog,
  createCandidateVerdictPromotion,
  createSelfGroundingReport,
  createVerdict,
  VerdictSchema,
} from "./verdicts.js";

const judgedFinding = {
  id: "f_judged_empty_state",
  lens: "heuristics",
  issueType: "empty-state-recovery-missing",
  method: "judged",
  title: "Empty state lacks a recovery action",
  rationale: "The empty state explains the problem but does not offer a next step.",
  citedHeuristics: ["kb_empty_state"],
  evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
  dimensions: {
    severity: 0.66,
    confidence: 0.86,
    effort: 0.35,
    userImpact: 0.7,
    businessImpact: 0.6,
    a11yLegalRisk: 0.1,
    evidenceQuality: 0.76,
    agentImplementability: 0.82,
  },
  severityBand: "P2",
  location: { component: "EmptyState", selector: ".empty-state" },
  confidenceBand: "assert",
  gatedForHuman: true,
} satisfies Finding;

const measuredFinding = {
  id: "f_measured_contrast",
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
    severity: 0.82,
    confidence: 1,
    effort: 0.2,
    userImpact: 0.78,
    businessImpact: 0.72,
    a11yLegalRisk: 0.9,
    evidenceQuality: 1,
    agentImplementability: 0.9,
  },
  severityBand: "P1",
  location: { selector: ".checkout-button" },
  confidenceBand: "assert",
  gatedForHuman: false,
} satisfies Finding;

const backlog = {
  id: "backlog_run_verdicts",
  runId: "run_verdicts",
  entries: [
    {
      findingId: "f_judged_empty_state",
      title: "Empty state lacks a recovery action",
      priority: 0.9,
      rank: 1,
    },
    {
      findingId: "f_measured_contrast",
      title: "Button contrast is below AA",
      priority: 0.7,
      rank: 2,
    },
  ],
} satisfies Backlog;

describe("Verdict adjudication", () => {
  it("creates a verdict keyed by finding identity with a reusable policy", () => {
    const result = createVerdict({
      finding: judgedFinding,
      decision: "reject",
      rationale: "Human review confirmed the empty state already has recovery copy.",
      recordedAt: "2026-06-02T00:00:00.000Z",
      reusePolicy: "this-identity-always",
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(VerdictSchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({
      findingId: "f_judged_empty_state",
      decision: "reject",
      rationale: "Human review confirmed the empty state already has recovery copy.",
      reusePolicy: "this-identity-always",
    });
    expect(result.value.findingIdentityKey).toMatch(/^ik_/);
  });

  it("reports judged false-positive rate from human verdicts and measured ground truth", () => {
    const rejectedJudged = createVerdict({
      finding: judgedFinding,
      decision: "reject",
      rationale: "False positive.",
      recordedAt: "2026-06-02T00:00:00.000Z",
    });
    const acceptedJudged = createVerdict({
      finding: { ...judgedFinding, id: "f_judged_checkout_copy" },
      decision: "accept",
      rationale: "Valid finding.",
      recordedAt: "2026-06-02T00:01:00.000Z",
    });
    const acceptedMeasured = createVerdict({
      finding: measuredFinding,
      decision: "accept",
      rationale: "Measured issue confirmed.",
      recordedAt: "2026-06-02T00:02:00.000Z",
    });

    expect(isOk(rejectedJudged)).toBe(true);
    expect(isOk(acceptedJudged)).toBe(true);
    expect(isOk(acceptedMeasured)).toBe(true);

    if (!isOk(rejectedJudged) || !isOk(acceptedJudged) || !isOk(acceptedMeasured)) {
      return;
    }

    const report = createSelfGroundingReport({
      findings: [
        judgedFinding,
        { ...judgedFinding, id: "f_judged_checkout_copy" },
        measuredFinding,
      ],
      verdicts: [rejectedJudged.value, acceptedJudged.value, acceptedMeasured.value],
    });

    expect(isOk(report)).toBe(true);

    if (!isOk(report)) {
      return;
    }

    expect(report.value).toEqual({
      sampleSize: 2,
      measuredGroundTruthCount: 1,
      judgedFalsePositiveCount: 1,
      judgedFalsePositiveRate: 0.5,
    });
  });

  it("feeds rejected verdicts into future backlog prioritization", () => {
    const rejectedJudged = createVerdict({
      finding: judgedFinding,
      decision: "reject",
      rationale: "False positive.",
      recordedAt: "2026-06-02T00:00:00.000Z",
    });

    expect(isOk(rejectedJudged)).toBe(true);

    if (!isOk(rejectedJudged)) {
      return;
    }

    const reprioritized = applyVerdictsToBacklog({
      backlog,
      verdicts: [rejectedJudged.value],
    });

    expect(isOk(reprioritized)).toBe(true);

    if (!isOk(reprioritized)) {
      return;
    }

    expect(reprioritized.value.entries.map((entry) => entry.findingId)).toEqual([
      "f_measured_contrast",
      "f_judged_empty_state",
    ]);
    expect(reprioritized.value.entries[1]).toMatchObject({
      findingId: "f_judged_empty_state",
      priority: 0,
      rank: 2,
    });
  });

  it("creates candidate promotion verdict metadata without changing normal verdict behavior", () => {
    const result = createCandidateVerdictPromotion({
      candidate: candidateFinding,
      reason: "Confirmed during manual QA",
      recordedAt: "2026-06-08T12:00:00.000Z",
      verdictId: "verdict_manual",
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) {
      return;
    }

    expect(result.value).toEqual({
      candidateFindingId: "qfc_checkout",
      gateEligible: true,
      promotionSource: "human-verdict",
      reason: "Confirmed during manual QA",
      recordedAt: "2026-06-08T12:00:00.000Z",
      replayEligible: false,
      verdictId: "verdict_manual",
    });
  });
});

const candidateFinding = {
  actionPath: [
    {
      action: "click",
      locator: { name: "Pay now", refHint: "@e12", role: "button" },
    },
  ],
  category: "functional",
  confidence: "candidate",
  evidenceBundleId: "ev_checkout",
  gateEligible: false,
  id: "qfc_checkout",
  identityConfidence: "medium",
  qaRunId: "qa_seed",
  replayStatus: "not-run",
  replayable: true,
  severity: "high",
  sourceRunManifestDigest: "sha256:abc123",
  title: "Checkout submit lacks payment validation feedback",
} satisfies CandidateFinding;
