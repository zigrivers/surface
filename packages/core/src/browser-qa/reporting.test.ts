import { describe, expect, it } from "vitest";

import { createQaMarkdownReport, createQaReportManifest } from "./reporting.js";
import type { EvidenceBundle, QaRun } from "./schemas.js";

describe("browser QA reporting", () => {
  it("renders redacted QA markdown with artifact refs only", () => {
    const markdown = createQaMarkdownReport(makeQaReportInputWithSensitiveArtifacts());

    expect(markdown).toContain("qa_report");
    expect(markdown).toContain("ev_checkout");
    expect(markdown).not.toContain("Set-Cookie");
    expect(markdown).not.toContain("Authorization");
    expect(markdown).not.toContain("data:video");
  });

  it("renders manifest output with checksums and media types", () => {
    const manifest = createQaReportManifest(makeQaReportInput());
    const [bundle] = manifest.evidenceBundles;
    const [artifact] = bundle?.artifacts ?? [];

    expect(bundle?.id).toBe("ev_checkout");
    expect(artifact?.checksum).toMatch(/^sha256:/);
    expect(artifact?.mediaType).toBe("image/png");
  });
});

function makeQaReportInput() {
  return {
    evidenceBundles: [makeEvidenceBundle()],
    qaRun: makeQaRun(),
    reportId: "qa_report",
  };
}

function makeQaReportInputWithSensitiveArtifacts() {
  return {
    ...makeQaReportInput(),
    artifactSummaries: [
      "Authorization: Bearer secret-token",
      "Set-Cookie: sid=secret",
      "data:video/webm;base64,AAAA",
    ],
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
    flowRuns: [{ flowId: "checkout", id: "flowrun_checkout", status: "failed" }],
    id: "qa_report",
    manifestPath: ".surface/qa/runs/qa_report/manifest.json",
    mode: "flow",
    startedAt: "2026-06-08T12:00:00.000Z",
    status: "failed",
    target: { kind: "url", ref: "http://localhost:3000/checkout" },
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
