import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../packages/cli/dist/index.js", import.meta.url));
const fixturePath = fileURLToPath(
  new URL("../../fixtures/seeded-defects/plain-html/index.html", import.meta.url),
);
const tempRoots: string[] = [];

type CliProcessResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

describe("surface CLI e2e smoke", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("`--version` exits 0 and prints a semver", async () => {
    const result = await runSurface(["--version"], await tempProjectRoot());

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it("unknown subcommand exits 2 with a usage error envelope", async () => {
    const result = await runSurface(["--json", "bogus"], await tempProjectRoot());

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "unknown_step", exitCode: 2, kind: "UsageError" },
      ok: false,
    });
  });

  it("audits the seeded fixture and persists a measured finding", async () => {
    const cwd = await tempProjectRoot();
    const html = await readFile(fixturePath, "utf8");
    const result = await runSurface(["--json", "audit", "--dom", html], cwd);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "audit",
      data: {
        findingCount: 1,
        topFinding: {
          id: "seeded_low_contrast",
          method: "measured",
          severityBand: "P1",
        },
      },
      ok: true,
    });

    const state = JSON.parse(await readFile(path.join(cwd, ".surface", "state.json"), "utf8"));

    expect(state).toMatchObject({
      findings: [{ id: "seeded_low_contrast" }],
      trackedFindings: [{ identityKey: "seeded_low_contrast_identity", status: "new" }],
    });
  });

  it("closed loop: fix and re-audit resolves the seeded finding", async () => {
    const cwd = await tempProjectRoot();
    const html = await readFile(fixturePath, "utf8");
    const firstAudit = await runSurface(["--json", "audit", "--dom", html], cwd);

    expect(firstAudit.exitCode).toBe(0);

    const failingGate = await runSurface(["--json", "gate", "--ci"], cwd);

    expect(failingGate.exitCode).toBe(1);
    expect(JSON.parse(failingGate.stdout)).toMatchObject({
      data: { gateResult: { failingFindingIds: ["seeded_low_contrast"], passed: false } },
      ok: true,
    });

    const fixedAudit = await runSurface(["--json", "audit", "--dom", fixedFixtureHtml(html)], cwd);

    expect(fixedAudit.exitCode).toBe(0);
    expect(JSON.parse(fixedAudit.stdout)).toMatchObject({
      data: { findingCount: 0 },
      ok: true,
    });

    const trace = await runSurface(["--json", "trace", "seeded_low_contrast_identity"], cwd);

    expect(trace.exitCode).toBe(0);
    expect(JSON.parse(trace.stdout)).toMatchObject({
      data: {
        trackedFinding: {
          identityKey: "seeded_low_contrast_identity",
          status: "resolved",
        },
      },
      ok: true,
    });

    const cleanGate = await runSurface(["--json", "gate", "--ci"], cwd);

    expect(cleanGate.exitCode).toBe(0);
    expect(JSON.parse(cleanGate.stdout)).toMatchObject({
      data: { gateResult: { failingFindingIds: [], passed: true } },
      ok: true,
    });
  });
});

async function tempProjectRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "surface-cli-smoke-"));
  tempRoots.push(root);

  return root;
}

async function runSurface(args: readonly string[], cwd: string): Promise<CliProcessResult> {
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
      resolve({ exitCode, stderr, stdout });
    });
  });
}

function fixedFixtureHtml(html: string): string {
  return html
    .replaceAll("low-contrast", "fixed-contrast")
    .replaceAll("#b7bdd1", "#334155")
    .replaceAll("intentionally fails contrast", "passes contrast");
}
