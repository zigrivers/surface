import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createFileStateStore } from "../state-store.js";
import type { QaRun } from "./schemas.js";
import { createFileQaRunStore } from "./state-store.js";

describe("QaRunStore", () => {
  it("commits run manifests under .surface/qa without embedding QA arrays in state.json", async () => {
    const projectRoot = await makeTempRoot();
    const stateStore = createFileStateStore({ projectRoot });
    const qaStore = createFileQaRunStore({ projectRoot, stateStore });

    await expect(qaStore.writeRun(makeQaRun({ id: "qa_state" }))).resolves.toMatchObject({
      ok: true,
    });

    const manifest = JSON.parse(
      await readFile(
        path.join(projectRoot, ".surface", "qa", "runs", "qa_state", "manifest.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(manifest.id).toBe("qa_state");

    const state = await stateStore.readState();
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value).not.toHaveProperty("qaRuns");
      expect(state.value).not.toHaveProperty("browserQa");
    }
  });

  it("reads an exact run manifest when shared indexes are absent", async () => {
    const projectRoot = await makeTempRoot();
    const qaStore = createFileQaRunStore({
      projectRoot,
      stateStore: createFileStateStore({ projectRoot }),
    });

    await qaStore.writeRun(makeQaRun({ id: "qa_exact" }));
    await rm(path.join(projectRoot, ".surface", "qa", "refs"), {
      force: true,
      recursive: true,
    });
    await rm(path.join(projectRoot, ".surface", "qa", "index"), {
      force: true,
      recursive: true,
    });

    const result = await qaStore.readRun("qa_exact");

    expect(result).toMatchObject({ ok: true, value: { id: "qa_exact" } });
  });

  it("rejects path-like run ids before resolving fallback manifests", async () => {
    const projectRoot = await makeTempRoot();
    const qaStore = createFileQaRunStore({
      projectRoot,
      stateStore: createFileStateStore({ projectRoot }),
    });

    const result = await qaStore.readRun("qa_../secret");

    expect(result).toMatchObject({ ok: false, error: { code: "state_read_failed" } });
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-qa-state-"));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  return root;
}

function makeQaRun(overrides: Partial<QaRun> = {}): QaRun {
  return {
    candidateFindings: ["qfc_state"],
    candidateFlows: ["qflow_state"],
    completedAt: "2026-06-08T11:00:01.000Z",
    degradation: [],
    evidenceBundles: ["ev_state"],
    findings: [],
    flowRuns: [
      {
        flowId: "checkout",
        id: "flowrun_state",
        status: "failed",
      },
    ],
    id: "qa_state",
    manifestPath: ".surface/qa/runs/qa_state/manifest.json",
    mode: "hybrid",
    startedAt: "2026-06-08T11:00:00.000Z",
    status: "degraded",
    target: { kind: "url", ref: "http://localhost:3000" },
    ...overrides,
  };
}
