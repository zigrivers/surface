import { describe, expect, it } from "vitest";

import {
  BrowserLocatorSchema,
  CandidateFindingSchema,
  EvidenceBundleSchema,
  FlowRunSchema,
  QaRunSchema,
  type BrowserAction,
  type CandidateFinding,
  type EvidenceBundle,
  type FlowRun,
  type QaRun,
} from "./schemas.js";

describe("browser QA schemas", () => {
  it("accepts valid QA ids and rejects wrong prefixes", () => {
    expect(QaRunSchema.safeParse(makeQaRun({ id: "qa_seed" })).success).toBe(true);
    expect(QaRunSchema.safeParse(makeQaRun({ id: "run_seed" })).success).toBe(false);
    expect(FlowRunSchema.safeParse(makeFlowRun({ id: "flowrun_seed" })).success).toBe(true);
    expect(CandidateFindingSchema.safeParse(makeCandidate({ id: "qfc_seed" })).success).toBe(true);
    expect(EvidenceBundleSchema.safeParse(makeEvidence({ id: "ev_seed" })).success).toBe(true);
  });

  it("requires fallback verification refs on candidate sidecars", () => {
    const valid = CandidateFindingSchema.safeParse(
      makeCandidate({
        evidenceBundleId: "ev_seed",
        id: "qfc_seed",
        qaRunId: "qa_seed",
        sourceRunManifestDigest: "sha256:abc",
      }),
    );
    const missingDigest = CandidateFindingSchema.safeParse({
      ...makeCandidate({ id: "qfc_seed" }),
      sourceRunManifestDigest: undefined,
    });

    expect(valid.success).toBe(true);
    expect(missingDigest.success).toBe(false);
  });

  it("accepts only canonical agent-browser ref hints", () => {
    expect(BrowserLocatorSchema.safeParse({ refHint: "@e12" }).success).toBe(true);
    expect(BrowserLocatorSchema.safeParse({ refHint: "@12" }).success).toBe(false);
  });
});

function makeQaRun(overrides: Partial<QaRun> = {}): QaRun {
  return {
    candidateFindings: ["qfc_seed"],
    candidateFlows: ["qflow_seed"],
    completedAt: "2026-06-08T11:00:01.000Z",
    degradation: [],
    evidenceBundles: ["ev_seed"],
    findings: [],
    flowRuns: [
      {
        flowId: "checkout",
        id: "flowrun_seed",
        status: "failed",
      },
    ],
    id: "qa_seed",
    manifestPath: ".surface/qa/runs/qa_seed/manifest.json",
    mode: "hybrid",
    startedAt: "2026-06-08T11:00:00.000Z",
    status: "degraded",
    target: { kind: "url", ref: "http://localhost:3000" },
    ...overrides,
  };
}

function makeFlowRun(overrides: Partial<FlowRun> = {}): FlowRun {
  return {
    actionPolicyRef: ".surface/qa/action-policy.json",
    evidenceBundles: ["ev_seed"],
    findingIds: [],
    flowId: "checkout",
    gateEligible: true,
    highestFailedSeverity: "high",
    id: "flowrun_seed",
    isolation: {
      mode: "isolated",
      mutatesState: true,
      resetSatisfied: true,
    },
    severity: "high",
    source: { kind: "file", ref: "surface-flows/checkout.yml" },
    status: "failed",
    steps: [
      {
        action: makeAction(),
        evidenceBundleIds: ["ev_seed"],
        id: "submit-empty-payment",
        severity: "high",
        status: "failed",
      },
    ],
    target: { kind: "url", ref: "http://localhost:3000" },
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    actionPath: [makeAction()],
    category: "functional",
    confidence: "candidate",
    evidenceBundleId: "ev_seed",
    gateEligible: false,
    id: "qfc_seed",
    identityConfidence: "medium",
    qaRunId: "qa_seed",
    replayStatus: "not-run",
    replayable: true,
    severity: "high",
    sourceRunManifestDigest: "sha256:abc",
    title: "Checkout submit lacks payment validation feedback",
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    artifacts: [
      {
        id: "art_screenshot",
        kind: "annotated-screenshot",
        mcpReadable: false,
        mediaType: "image/png",
        path: ".surface/qa/artifacts/sha256/abc",
        redacted: true,
        sensitiveRaw: false,
        sha256: "sha256:abc",
        sizeBytes: 12,
      },
    ],
    checksums: { art_screenshot: "sha256:abc" },
    containsSensitiveRaw: false,
    id: "ev_seed",
    manifestPath: ".surface/qa/evidence/ev_seed.json",
    qaRunId: "qa_seed",
    redacted: true,
    reproSteps: [
      {
        action: makeAction(),
        index: 1,
        label: "Submit empty payment",
      },
    ],
    sanitizedAtCapture: true,
    sourceCaptureArtifactIds: [],
    sourceRunManifestDigest: "sha256:abc",
    ...overrides,
  };
}

function makeAction(): BrowserAction {
  return {
    action: "click",
    locator: { role: "button", name: "Pay now", refHint: "@e12" },
  };
}
