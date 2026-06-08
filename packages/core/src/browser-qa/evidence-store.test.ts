import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createFileStateStore } from "../state-store.js";
import { createFileQaEvidenceStore } from "./evidence-store.js";
import type { BrowserAction, EvidenceBundle, QaRun } from "./schemas.js";
import { createFileQaRunStore } from "./state-store.js";

describe("QaEvidenceStore", () => {
  it("writes sanitized bytes to content-addressed storage and verifies digest on read", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    const committed = await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from("Authorization: Bearer secret-token\nGET /checkout"),
          id: "art_network",
          mcpReadable: true,
          mediaType: "text/plain",
          qaKind: "network-summary",
        },
      ],
      bundle: makeEvidence({ id: "ev_digest", qaRunId: "qa_digest" }),
    });

    expect(committed.ok).toBe(true);
    if (!committed.ok) {
      throw new Error(committed.error.message);
    }

    const artifact = committed.value.artifacts[0];
    expect(artifact).toBeDefined();
    if (artifact === undefined) {
      throw new Error("expected evidence artifact");
    }

    expect(artifact.id).toBe("art_network");
    expect(artifact.kind).toBe("network-summary");
    expect(artifact.path).toContain(".surface/qa/artifacts/sha256/");
    expect(artifact.sha256).toMatch(/^sha256:/);
    expect(committed.value.checksums.art_network).toMatch(/^sha256:/);

    await rm(path.join(projectRoot, ".surface", "qa", "refs"), {
      force: true,
      recursive: true,
    });
    await rm(path.join(projectRoot, ".surface", "qa", "index"), {
      force: true,
      recursive: true,
    });
    await qaStore.writeRun(makeQaRun({ evidenceBundles: ["ev_digest"], id: "qa_digest" }));

    const read = await store.readArtifactByRegisteredRef({
      artifactId: "art_network",
      maxBytes: 1024,
      refId: "ev_digest",
    });

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.text).toContain("/checkout");
      expect(read.value.text).not.toContain("secret-token");
      expect(read.value.text).toContain("Authorization: [REDACTED]");
    }

    const refreshedBundle = await qaStore.readEvidenceBundle("ev_digest");
    expect(refreshedBundle.ok).toBe(true);
    if (!refreshedBundle.ok) {
      throw new Error(refreshedBundle.error.message);
    }
    expect(refreshedBundle.value.sourceRunManifestDigest).toBe("sha256:abc");

    await writeFile(
      path.join(projectRoot, refreshedBundle.value.manifestPath),
      `${JSON.stringify(
        {
          ...refreshedBundle.value,
          qaRunId: "qa_bad",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_network",
        maxBytes: 1024,
        refId: "ev_digest",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_network",
        maxBytes: 1024,
        refId: "qa_digest",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
  });

  it("rejects raw refs, sensitive raw artifacts, and unregistered artifact ids", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from('{"log":"Cookie: session=secret"}'),
          id: "art_har",
          mcpReadable: true,
          mediaType: "application/json",
          qaKind: "har",
          sensitiveRaw: true,
        },
      ],
      bundle: makeEvidence({ id: "ev_sensitive", qaRunId: "qa_sensitive" }),
    });
    await qaStore.writeRun(makeQaRun({ evidenceBundles: ["ev_sensitive"], id: "qa_sensitive" }));

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_har",
        maxBytes: 1024,
        refId: "../ev_sensitive",
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_har",
        maxBytes: 1024,
        refId: "ev_sensitive",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_missing",
        maxBytes: 1024,
        refId: "ev_sensitive",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
  });

  it("never exposes raw HAR artifacts through MCP reads", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from('{"log":{"entries":[]}}'),
          id: "art_har_raw",
          mcpReadable: true,
          mediaType: "application/json",
          qaKind: "har",
        },
      ],
      bundle: makeEvidence({ id: "ev_har", qaRunId: "qa_har" }),
    });
    await qaStore.writeRun(makeQaRun({ evidenceBundles: ["ev_har"], id: "qa_har" }));

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_har_raw",
        maxBytes: 1024,
        refId: "ev_har",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
  });

  it("requires candidate evidence refs to match the owning run manifest", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from("candidate summary"),
          id: "art_candidate",
          mcpReadable: true,
          mediaType: "text/plain",
          qaKind: "browser-snapshot",
        },
      ],
      bundle: makeEvidence({ id: "ev_candidate", qaRunId: "qa_candidate" }),
    });
    await qaStore.writeCandidate({
      actionPath: [makeAction()],
      category: "functional",
      confidence: "candidate",
      evidenceBundleId: "ev_candidate",
      gateEligible: false,
      id: "qfc_candidate",
      identityConfidence: "medium",
      qaRunId: "qa_candidate",
      replayStatus: "not-run",
      replayable: true,
      severity: "medium",
      sourceRunManifestDigest: "sha256:abc",
      title: "Candidate",
    });
    await qaStore.writeRun(
      makeQaRun({
        candidateFindings: ["qfc_candidate"],
        evidenceBundles: ["ev_candidate"],
        id: "qa_candidate",
      }),
    );

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_candidate",
        maxBytes: 1024,
        refId: "qfc_candidate",
      }),
    ).resolves.toMatchObject({ ok: true });

    const candidate = await qaStore.readCandidate("qfc_candidate");
    const bundle = await qaStore.readEvidenceBundle("ev_candidate");
    if (!candidate.ok || !bundle.ok) {
      throw new Error("expected committed candidate evidence");
    }

    await qaStore.writeCandidate({
      ...candidate.value,
      sourceRunManifestDigest: "sha256:bad",
    });

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_candidate",
        maxBytes: 1024,
        refId: "qfc_candidate",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
  });

  it("allows promoted finding refs registered through their source candidate", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from("promoted summary"),
          id: "art_promoted",
          mcpReadable: true,
          mediaType: "text/plain",
          qaKind: "browser-snapshot",
        },
      ],
      bundle: makeEvidence({ id: "ev_promoted", qaRunId: "qa_promoted" }),
    });
    await qaStore.writeCandidate({
      actionPath: [makeAction()],
      category: "functional",
      confidence: "candidate",
      evidenceBundleId: "ev_promoted",
      gateEligible: false,
      id: "qfc_promoted",
      identityConfidence: "medium",
      qaRunId: "qa_promoted",
      replayStatus: "not-run",
      replayable: true,
      severity: "medium",
      sourceRunManifestDigest: "sha256:abc",
      title: "Candidate",
    });
    await qaStore.writeRun(
      makeQaRun({
        candidateFindings: ["qfc_promoted"],
        evidenceBundles: ["ev_promoted"],
        id: "qa_promoted",
      }),
    );

    const candidate = await qaStore.readCandidate("qfc_promoted");
    if (!candidate.ok) {
      throw new Error(candidate.error.message);
    }

    await qaStore.writePromotedFinding({
      artifactChecksums: {},
      candidateFindingId: "qfc_promoted",
      evidenceBundleId: "ev_promoted",
      findingId: "f_promoted",
      promotedAt: "2026-06-08T12:00:00.000Z",
      promotionSource: "replay",
      qaRunId: "qa_promoted",
      reason: "verified",
      sourceRunManifestDigest: candidate.value.sourceRunManifestDigest,
    });

    await expect(
      store.readArtifactByRegisteredRef({
        artifactId: "art_promoted",
        maxBytes: 1024,
        refId: "f_promoted",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects public overwrites of committed evidence sidecars", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });
    const bundle = makeEvidence({ id: "ev_immutable" });

    await expect(qaStore.writeEvidenceBundle(bundle)).resolves.toMatchObject({ ok: true });
    await expect(qaStore.writeEvidenceBundle(bundle)).resolves.toMatchObject({ ok: true });
    await expect(
      qaStore.writeEvidenceBundle({
        ...bundle,
        sourceRunManifestDigest: "sha256:bad",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "state_write_failed" } });
  });

  it("rejects concurrent conflicting evidence sidecar creates", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });
    const first = makeEvidence({ id: "ev_concurrent", sourceRunManifestDigest: "sha256:111" });
    const second = makeEvidence({ id: "ev_concurrent", sourceRunManifestDigest: "sha256:222" });

    const results = await Promise.all([
      qaStore.writeEvidenceBundle(first),
      qaStore.writeEvidenceBundle(second),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);

    const stored = await qaStore.readEvidenceBundle("ev_concurrent");
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(["sha256:111", "sha256:222"]).toContain(stored.value.sourceRunManifestDigest);
    }
  });

  it("does not expose raw JSON request bodies through MCP reads", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const store = createFileQaEvidenceStore({
      projectRoot,
      stateStore,
    });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await store.writeBundle({
      artifacts: [
        {
          bytes: Buffer.from(
            JSON.stringify({
              requestBody: {
                callbackUrl: "https://app.example.test/callback?token=query-secret&ok=1",
                cardLast4: "4242",
                notes: "session=inline-secret",
                password: "secret",
                token: "abc123",
              },
            }),
          ),
          id: "art_body",
          mcpReadable: true,
          mediaType: "application/json",
          qaKind: "network-summary",
        },
      ],
      bundle: makeEvidence({ id: "ev_body", qaRunId: "qa_body" }),
    });
    await qaStore.writeRun(makeQaRun({ evidenceBundles: ["ev_body"], id: "qa_body" }));

    const read = await store.readArtifactByRegisteredRef({
      artifactId: "art_body",
      maxBytes: 1024,
      refId: "ev_body",
    });

    expect(read).toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-qa-evidence-"));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  return root;
}

function makeEvidence(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    artifacts: [],
    checksums: {},
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

function makeQaRun(overrides: Partial<QaRun> = {}): QaRun {
  return {
    candidateFindings: [],
    candidateFlows: [],
    completedAt: "2026-06-08T12:00:00.000Z",
    degradation: [],
    evidenceBundles: [],
    findings: [],
    flowRuns: [],
    id: "qa_seed",
    manifestPath: ".surface/qa/runs/qa_seed/manifest.json",
    mode: "flow",
    startedAt: "2026-06-08T12:00:00.000Z",
    status: "completed",
    target: { kind: "url", ref: "http://localhost:3000" },
    ...overrides,
  };
}

function makeAction(): BrowserAction {
  return {
    action: "click",
    locator: { role: "button", name: "Pay now", refHint: "@e12" },
  };
}
