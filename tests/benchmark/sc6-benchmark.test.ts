import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../packages/cli/dist/index.js", import.meta.url));
const fixtureCases = [
  {
    expectedFindingCount: 1,
    name: "plain-html",
    path: fileURLToPath(
      new URL("../../fixtures/seeded-defects/plain-html/index.html", import.meta.url),
    ),
  },
  {
    expectedFindingCount: 2,
    name: "react",
    path: fileURLToPath(
      new URL("../../fixtures/seeded-defects/react/SeededDefectFixture.tsx", import.meta.url),
    ),
  },
] as const;
const quickP95BudgetMs = 30_000;
const tempRoots: string[] = [];

type CliProcessResult = {
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

describe("SC-6 seeded before/after benchmark", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("does not synthesize seeded findings and stays inside quick p95 budget", async () => {
    const auditDurations: number[] = [];

    for (const fixture of fixtureCases) {
      const cwd = await tempProjectRoot(fixture.name);
      const source = await readFile(fixture.path, "utf8");
      const before = await runSurface(["--json", "audit", "--dom", source], cwd);

      auditDurations.push(before.durationMs);
      expect(before.exitCode).toBe(0);
      const parsedAudit = JSON.parse(before.stdout);

      expect(parsedAudit).toMatchObject({ ok: true });
      expect(parsedAudit.data.findingCount).toBe(fixture.expectedFindingCount);

      const state = JSON.parse(await readFile(path.join(cwd, ".surface", "state.json"), "utf8"));

      expect(state.findings.some(isSyntheticSeededFinding)).toBe(false);

      const cleanGate = await runSurface(["--json", "gate", "--ci"], cwd);

      expect(cleanGate.exitCode).toBe(0);
      expect(JSON.parse(cleanGate.stdout)).toMatchObject({
        data: { gateResult: { failingFindingIds: [], passed: true } },
        ok: true,
      });
    }

    expect(percentile(auditDurations, 0.95)).toBeLessThan(quickP95BudgetMs);
  });
});

async function tempProjectRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `surface-sc6-${label}-`));
  tempRoots.push(root);

  return root;
}

async function runSurface(args: readonly string[], cwd: string): Promise<CliProcessResult> {
  const startedAt = performance.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        durationMs: performance.now() - startedAt,
        exitCode,
        stderr,
        stdout,
      });
    });
  });
}

function percentile(values: readonly number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * percentileRank) - 1;

  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function isSyntheticSeededFinding(finding: {
  readonly id?: unknown;
  readonly issueType?: unknown;
}) {
  const id = typeof finding.id === "string" ? finding.id : "";
  const issueType = typeof finding.issueType === "string" ? finding.issueType : "";

  return (
    id === "finding_button_contrast" ||
    id.includes("seeded_low_contrast") ||
    issueType === "seeded-low-contrast"
  );
}
