import { describe, expect, it, vi } from "vitest";

import { ok } from "../errors.js";
import { createBrowserQaOrchestrator, type BrowserQaOrchestratorHarness } from "./orchestrator.js";
import type { BrowserQaExploreResult } from "./explorer.js";
import type { EvidenceBundle, FlowRun, QaRun } from "./schemas.js";

describe("BrowserQaOrchestrator", () => {
  it("runs provided flows before exploration in hybrid mode", async () => {
    const harness = makeOrchestratorHarness();
    const orchestrator = createBrowserQaOrchestrator(harness);

    const result = await orchestrator.runQa({
      explore: true,
      flows: ["surface-flows/checkout.yml"],
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(harness.calls).toEqual(["flow:checkout", "explore"]);
    expect(result.value.mode).toBe("hybrid");
    expect(result.value.flowRuns[0]).toMatchObject({ flowId: "checkout" });
    expect(result.value.exploration?.visitedStates).toBe(2);
  });

  it("degrades unmatched flow globs when exploration is enabled", async () => {
    const result = await createBrowserQaOrchestrator(makeOrchestratorHarness()).runQa({
      explore: true,
      flows: ["surface-flows/missing-*.yml"],
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.degradation).toEqual([
      expect.objectContaining({ code: "flow_glob_unmatched" }),
    ]);
  });

  it("renders report manifests from stored QA runs and evidence bundles", async () => {
    const orchestrator = createBrowserQaOrchestrator(makeOrchestratorHarness());
    const result = await orchestrator.reportQa({ format: "manifest", runId: "qa_report" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toMatchObject({
      format: "manifest",
      report: {
        evidenceBundles: [
          {
            artifacts: [
              {
                checksum: "sha256:abc123",
                mediaType: "image/png",
              },
            ],
            id: "ev_checkout",
          },
        ],
        qaRunId: "qa_report",
      },
    });
  });

  it("renders JSON reports as serialized report text", async () => {
    const orchestrator = createBrowserQaOrchestrator(makeOrchestratorHarness());
    const result = await orchestrator.reportQa({ format: "json", runId: "qa_report" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.format).toBe("json");
    expect(typeof result.value.report).toBe("string");
    expect(JSON.parse(result.value.report as string)).toMatchObject({ qaRunId: "qa_report" });
  });
});

function makeOrchestratorHarness(): BrowserQaOrchestratorHarness & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  const resolveFlows: NonNullable<BrowserQaOrchestratorHarness["resolveFlows"]> = (patterns) =>
    Promise.resolve(
      ok({
        matched: patterns.some((pattern) => pattern.includes("missing")) ? [] : patterns,
        unmatched: patterns.filter((pattern) => pattern.includes("missing")),
      }),
    );
  const runFlow: BrowserQaOrchestratorHarness["runFlow"] = (flowRef) => {
    calls.push("flow:checkout");
    return Promise.resolve(ok(makeFlowRun(flowRef)));
  };

  return {
    calls,
    cleanupStaleSessions: vi.fn(() => Promise.resolve(ok({ cleaned: [], skipped: [] }))),
    now: () => "2026-06-08T12:00:00.000Z",
    readEvidence: vi.fn(() => Promise.resolve(ok({ refId: "ev_checkout", summaries: [] }))),
    readEvidenceBundle: vi.fn(() => Promise.resolve(ok(makeEvidenceBundle()))),
    readRun: vi.fn(() => Promise.resolve(ok(makeQaRun()))),
    replay: vi.fn(() => Promise.resolve(ok({ replayStatus: "not-reproduced" }))),
    resolveFlows: vi.fn(resolveFlows),
    runExplore: vi.fn(() => {
      calls.push("explore");
      return Promise.resolve(ok(makeExploreResult()));
    }),
    runFlow: vi.fn(runFlow),
    writeRun: vi.fn((run) => Promise.resolve(ok(run))),
  };
}

function makeQaRun(): QaRun {
  return {
    candidateFindings: [],
    candidateFlows: [],
    completedAt: "2026-06-08T12:00:00.000Z",
    degradation: [],
    evidenceBundles: ["ev_checkout"],
    findings: [],
    flowRuns: [{ flowId: "checkout", id: "flowrun_checkout", status: "passed" }],
    id: "qa_report",
    manifestPath: ".surface/qa/runs/qa_report/manifest.json",
    mode: "flow",
    startedAt: "2026-06-08T12:00:00.000Z",
    status: "completed",
    target: { kind: "url", ref: "http://localhost:3000" },
  };
}

function makeEvidenceBundle(): EvidenceBundle {
  return {
    artifacts: [
      {
        id: "art_screenshot",
        kind: "step-screenshot",
        mcpReadable: false,
        mediaType: "image/png",
        path: ".surface/qa/artifacts/sha256/abc",
        redacted: true,
        sensitiveRaw: false,
        sha256: "sha256:abc123",
        sizeBytes: 1234,
      },
    ],
    checksums: { art_screenshot: "sha256:abc123" },
    containsSensitiveRaw: false,
    id: "ev_checkout",
    manifestPath: ".surface/qa/evidence/ev_checkout.json",
    qaRunId: "qa_report",
    redacted: true,
    reproSteps: [],
    sanitizedAtCapture: true,
    sourceCaptureArtifactIds: ["art_screenshot"],
    sourceRunManifestDigest: "sha256:def456",
  };
}

function makeFlowRun(flowRef: string): FlowRun {
  return {
    evidenceBundles: ["ev_checkout"],
    findingIds: [],
    flowId: flowRef.includes("checkout") ? "checkout" : flowRef,
    gateEligible: true,
    id: "flowrun_checkout",
    isolation: { mode: "isolated", mutatesState: false, resetSatisfied: false },
    severity: "high",
    source: { kind: "file", ref: flowRef },
    status: "passed",
    steps: [],
    target: { kind: "url", ref: "http://localhost:3000" },
  };
}

function makeExploreResult(): BrowserQaExploreResult {
  return {
    attemptedActions: 2,
    candidateFindings: [],
    candidateFlows: [],
    degradation: [],
    deniedActions: 0,
    visitedStates: 2,
  };
}
