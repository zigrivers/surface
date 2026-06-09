import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("audits the seeded fixture without synthesizing findings", async () => {
    const cwd = await tempProjectRoot();
    const html = await readFile(fixturePath, "utf8");
    const result = await runSurface(["--json", "audit", "--dom", html], cwd);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);

    expect(parsed).toMatchObject({
      command: "audit",
      data: {
        model: {
          attemptedChannels: [],
          blockedReasons: ["model_egress_blocked_by_policy"],
          completedChannels: [],
        },
      },
      ok: true,
    });
    expect(parsed.data.findingCount).toBe(1);
    expect(parsed.data.topFinding).toMatchObject({
      issueType: "readability",
      lens: "content",
      method: "judged",
    });

    const state = JSON.parse(await readFile(path.join(cwd, ".surface", "state.json"), "utf8"));

    expect(state.modelEgress).toMatchObject([
      {
        artifactClassesSent: [],
        attemptedChannels: [],
        blockedReasons: ["model_egress_blocked_by_policy"],
        completedChannels: [],
        redactionStatus: "none",
        unavailableChannels: [],
      },
    ]);
    expect(state.findings.some(isSyntheticSeededFinding)).toBe(false);
    expect(state.runRecords.at(-1)).toMatchObject({
      capture: {
        artifacts: expect.arrayContaining([expect.objectContaining({ type: "dom-snapshot" })]),
        target: { kind: "dom", ref: "[redacted-inline-dom]" },
      },
      skippedLenses: expect.arrayContaining([
        expect.objectContaining({
          lensId: "usability",
          reason: "model_unavailable",
        }),
      ]),
    });
    expect(JSON.stringify(state)).not.toContain("seeded_low_contrast");
    expect(JSON.stringify(state)).not.toContain(html);
  });

  it("closed loop: measured findings fail the gate and a fixed re-audit resolves them", async () => {
    const cwd = await tempProjectRoot();
    const html = await readFile(fixturePath, "utf8");
    const evidencePath = await writeStaticEvidence(cwd, [contrastEvidence()]);
    const gatePolicyPath = await writeGatePolicy(cwd);
    const firstAudit = await runSurface(
      ["--json", "audit", "--dom", html, "--evidence", evidencePath],
      cwd,
    );

    expect(firstAudit.exitCode).toBe(0);
    expect(JSON.parse(firstAudit.stdout)).toMatchObject({
      data: {
        findingCount: 2,
        topFinding: { issueType: "contrast-insufficient", method: "measured" },
      },
      ok: true,
    });

    const failingGate = await runSurface(
      ["--json", "gate", "--ci", "--policy", gatePolicyPath],
      cwd,
    );
    const parsedFailingGate = JSON.parse(failingGate.stdout);

    expect(failingGate.exitCode).toBe(1);
    expect(parsedFailingGate).toMatchObject({
      data: { gateResult: { passed: false } },
      ok: true,
    });
    expect(parsedFailingGate.data.gateResult.failingFindingIds).toHaveLength(1);

    const fixedAudit = await runSurface(["--json", "audit", "--dom", html], cwd);

    expect(fixedAudit.exitCode).toBe(0);
    expect(JSON.parse(fixedAudit.stdout)).toMatchObject({
      data: {
        findingCount: 1,
        topFinding: { issueType: "readability", lens: "content", method: "judged" },
      },
      ok: true,
    });

    const cleanGate = await runSurface(["--json", "gate", "--ci", "--policy", gatePolicyPath], cwd);

    expect(cleanGate.exitCode).toBe(0);
    expect(JSON.parse(cleanGate.stdout)).toMatchObject({
      data: { gateResult: { failingFindingIds: [], passed: true } },
      ok: true,
    });
  });

  it("keeps core command envelopes compatible after browser QA additions", async () => {
    const cwd = await tempProjectRoot();
    const html = await readFile(fixturePath, "utf8");

    const status = await runSurface(["--json", "status"], cwd);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      command: "status",
      data: { currentStage: "new" },
      ok: true,
    });

    const capture = await runSurface(["--json", "capture", "--dom", html], cwd);
    expect(capture.exitCode).toBe(0);
    expect(JSON.parse(capture.stdout)).toMatchObject({
      command: "capture",
      data: { captureId: expect.stringMatching(/^(cap|capture)_/u) },
      ok: true,
    });

    const audit = await runSurface(["--json", "audit", "--dom", html], cwd);
    expect(audit.exitCode).toBe(0);
    const auditEnvelope = JSON.parse(audit.stdout) as { readonly data: { readonly runId: string } };

    const validate = await runSurface(
      ["--json", "validate", "--run", auditEnvelope.data.runId],
      cwd,
    );
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(validate.stdout)).toMatchObject({
      command: "validate",
      data: { checks: [{ findingId: "seeded_low_contrast", passed: true }] },
      ok: true,
    });

    const run = await runSurface(["--json", "run", "all"], cwd);
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      command: "run",
      data: { stage: "all", status: "completed" },
      ok: true,
    });
  });
});

function contrastEvidence() {
  return {
    kind: "tool-result",
    measuredValue: ".low-contrast: 3.1:1",
    rule: "color-contrast",
    threshold: "4.5:1",
    tool: "axe",
  };
}

async function writeStaticEvidence(root: string, evidence: readonly unknown[]): Promise<string> {
  const evidencePath = path.join(root, "evidence.json");
  await writeFile(evidencePath, JSON.stringify(evidence));

  return evidencePath;
}

async function writeGatePolicy(root: string): Promise<string> {
  const policyPath = path.join(root, "gate-policy.json");
  await writeFile(
    policyPath,
    JSON.stringify({
      failOnNewMeasuredAtOrAbove: "P2",
      neverFailOn: ["judged", "gatedForHuman"],
      thresholds: {},
    }),
  );

  return policyPath;
}

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
