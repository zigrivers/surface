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
    name: "plain-html",
    path: fileURLToPath(
      new URL("../../fixtures/seeded-defects/plain-html/index.html", import.meta.url),
    ),
  },
  {
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

  it("drives seeded measured findings to zero and stays inside quick p95 budget", async () => {
    const auditDurations: number[] = [];

    for (const fixture of fixtureCases) {
      const cwd = await tempProjectRoot(fixture.name);
      const source = await readFile(fixture.path, "utf8");
      const before = await runSurface(["--json", "audit", "--dom", source], cwd);

      auditDurations.push(before.durationMs);
      expect(before.exitCode).toBe(0);
      expect(JSON.parse(before.stdout)).toMatchObject({
        data: {
          findingCount: 1,
          topFinding: { method: "measured", severityBand: "P1" },
        },
        ok: true,
      });

      const failingGate = await runSurface(["--json", "gate", "--ci"], cwd);

      expect(failingGate.exitCode).toBe(1);
      expect(JSON.parse(failingGate.stdout)).toMatchObject({
        data: { gateResult: { passed: false } },
        ok: true,
      });

      const after = await runSurface(["--json", "audit", "--dom", fixedFixtureSource(source)], cwd);

      auditDurations.push(after.durationMs);
      expect(after.exitCode).toBe(0);
      expect(JSON.parse(after.stdout)).toMatchObject({
        data: { findingCount: 0 },
        ok: true,
      });

      const passingGate = await runSurface(["--json", "gate", "--ci"], cwd);

      expect(passingGate.exitCode).toBe(0);
      expect(JSON.parse(passingGate.stdout)).toMatchObject({
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

function fixedFixtureSource(source: string): string {
  return source
    .replaceAll("low-contrast", "fixed-contrast")
    .replaceAll("#b7bdd1", "#334155")
    .replaceAll("intentionally fails contrast", "passes contrast");
}

function percentile(values: readonly number[], percentileRank: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * percentileRank) - 1;

  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}
