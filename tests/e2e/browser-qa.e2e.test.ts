import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createSurfaceMcpServer } from "../../packages/mcp/src/index.js";
import { startBrowserQaSeededApp } from "../../fixtures/browser-qa/seeded-app/src/server.js";

const cliPath = fileURLToPath(new URL("../../packages/cli/dist/index.js", import.meta.url));
const checkoutFlowPath = fileURLToPath(
  new URL("../../fixtures/browser-qa/flows/checkout.yml", import.meta.url),
);
const actionPolicyPath = fileURLToPath(
  new URL("../../fixtures/browser-qa/action-policy.json", import.meta.url),
);
const tempRoots: string[] = [];

type CliProcessResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

type SeededServer = Awaited<ReturnType<typeof startBrowserQaSeededApp>>;

describe("browser QA CLI e2e", () => {
  let seededApp: SeededServer;

  beforeAll(async () => {
    seededApp = await startBrowserQaSeededApp();
  });

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  afterAll(async () => {
    await seededApp.close();
  });

  it("runs flow, qa, evidence, replay, report, gate, and MCP artifact read", async () => {
    const project = await tempProjectRootWithFakeAgentBrowser();
    const flow = await runSurface(
      ["--json", "flow", "run", checkoutFlowPath, "--url", seededApp.url],
      project.cwd,
      project.env,
    );

    expect(flow.exitCode, flow.stderr).toBe(0);
    const flowEnvelope = JSON.parse(flow.stdout) as {
      readonly data: {
        readonly evidenceBundles: readonly string[];
        readonly flowRunId: string;
        readonly status: string;
      };
    };

    expect(flowEnvelope).toMatchObject({
      command: "flow run",
      data: {
        flowRunId: expect.stringMatching(/^flowrun_checkout_/),
        status: "failed",
      },
      ok: true,
    });
    expect(flowEnvelope.data.evidenceBundles.length).toBeGreaterThan(0);

    const evidenceRef = flowEnvelope.data.evidenceBundles.find((ref) =>
      ref.includes("submit-empty-payment"),
    );
    if (evidenceRef === undefined) {
      throw new Error("Expected failed checkout flow to write evidence.");
    }

    const evidence = await runSurface(
      ["--json", "evidence", evidenceRef],
      project.cwd,
      project.env,
    );

    expect(evidence.exitCode).toBe(0);
    expect(JSON.parse(evidence.stdout)).toMatchObject({
      command: "evidence",
      data: { refId: evidenceRef },
      ok: true,
    });

    const qa = await runSurface(
      [
        "--json",
        "qa",
        "--url",
        seededApp.url,
        "--flows",
        checkoutFlowPath,
        "--explore",
        "--task",
        "complete checkout",
      ],
      project.cwd,
      project.env,
    );

    expect(qa.exitCode).toBe(0);
    const qaEnvelope = JSON.parse(qa.stdout) as {
      readonly data: { readonly candidateFindings: readonly unknown[]; readonly qaRunId: string };
    };

    expect(qaEnvelope).toMatchObject({
      command: "qa",
      data: { candidateFindings: [] },
      ok: true,
    });

    const replay = await runSurface(
      ["--json", "replay", "finding_seeded_checkout"],
      project.cwd,
      project.env,
    );

    expect(replay.exitCode).toBe(1);
    expect(replay.stderr).toBe("");
    expect(JSON.parse(replay.stdout)).toMatchObject({
      command: "replay",
      error: { code: "replay_failed" },
      ok: false,
    });

    const report = await runSurface(
      ["--json", "report", "qa", "--run", qaEnvelope.data.qaRunId, "--format", "manifest"],
      project.cwd,
      project.env,
    );

    expect(report.exitCode).toBe(0);
    expect(JSON.parse(report.stdout)).toMatchObject({
      command: "report qa",
      data: {
        format: "manifest",
        report: { qaRunId: qaEnvelope.data.qaRunId },
      },
      ok: true,
    });

    const gate = await runSurface(
      ["--json", "gate", "--with-flows", "--ci", "--url", seededApp.url],
      project.cwd,
      project.env,
    );

    expect(gate.exitCode).toBe(1);
    const gateEnvelope = JSON.parse(gate.stdout) as {
      readonly data: {
        readonly gateResult: {
          readonly failingFlowRunIds: readonly string[];
          readonly passed: boolean;
        };
      };
    };

    expect(gateEnvelope).toMatchObject({
      command: "gate",
      data: {
        gateResult: {
          failingFlowRunIds: [expect.stringMatching(/^flowrun_checkout_/)],
          passed: false,
        },
      },
      ok: true,
    });

    const mcpServer = createSurfaceMcpServer({ projectRoot: project.cwd });
    await expect(
      mcpServer.callTool("surface_artifact_read", {
        artifactId: "submit-empty-payment_state",
        refId: evidenceRef,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        artifactId: "submit-empty-payment_state",
        text: expect.stringContaining("Seeded checkout snapshot"),
      },
    });
  });
});

async function tempProjectRootWithFakeAgentBrowser(): Promise<{
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "surface-browser-qa-e2e-"));
  const binDir = path.join(root, "bin");
  const fakeAgentBrowserPath = path.join(binDir, "agent-browser");
  tempRoots.push(root);

  await mkdir(binDir, { recursive: true });
  await writeFile(fakeAgentBrowserPath, fakeAgentBrowserScript(), { mode: 0o755 });
  await mkdir(path.join(root, "fixtures", "browser-qa"), { recursive: true });
  await writeFile(
    path.join(root, "fixtures", "browser-qa", "action-policy.json"),
    await readFile(actionPolicyPath, "utf8"),
  );

  return {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

async function runSurface(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CliProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd,
      env,
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

function fakeAgentBrowserScript(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

if (command === "--version") {
  console.log("agent-browser-fake 1.0.0");
  process.exit(0);
}

if (command === "batch") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    try {
      const parsed = JSON.parse(input);
      if (!Array.isArray(parsed) || parsed.some(item => !Array.isArray(item))) {
        throw new Error("batch input must be an array of argv arrays");
      }
      console.log("{}");
      process.exit(0);
    } catch (error) {
      console.error(String(error));
      process.exit(1);
    }
  });
  process.stdin.resume();
  return;
}

if (command === "snapshot") {
  console.log("Seeded checkout snapshot");
  process.exit(0);
}

if (command === "get" && subcommand === "title") {
  console.log("Seeded checkout snapshot");
  process.exit(0);
}

if (command === "get" && subcommand === "url") {
  console.log("http://127.0.0.1/checkout");
  process.exit(0);
}

if (command === "eval") {
  console.log("false");
  process.exit(0);
}

if (command === "console" || command === "errors" || command === "network" || command === "react" || command === "vitals") {
  console.log("{}");
  process.exit(0);
}

if (command === "is") {
  console.log("true");
  process.exit(0);
}

if (command === "close") {
  console.log("{}");
  process.exit(0);
}

console.log("{}");
process.exit(0);
`;
}
