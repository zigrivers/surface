import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createSurfaceComposition, ok } from "@zigrivers/surface-core";

import { runSurfaceCli } from "./index.js";

type TestFlowRun = {
  readonly evidenceBundles: readonly string[];
  readonly findingIds: readonly string[];
  readonly flowId: string;
  readonly id: string;
  readonly isolation: {
    readonly mode: "isolated";
    readonly mutatesState: boolean;
    readonly resetSatisfied: boolean;
  };
  readonly severity: "high";
  readonly source: { readonly kind: "file"; readonly ref: string };
  readonly status: "passed";
  readonly steps: readonly unknown[];
  readonly target: { readonly kind: "url"; readonly ref: string };
};

describe("surface flow CLI", () => {
  it("rejects --localhost values for browser QA commands", async () => {
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "flow",
        "run",
        "surface-flows/checkout.yml",
        "--localhost=5173",
      ],
      io: { stderr: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("--localhost");
  });

  it("prints a JSON envelope for flow run", async () => {
    const flowPath = await writeFlowFile();
    const stdout: string[] = [];
    const flowService = makeFlowService();
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "flow",
        "run",
        flowPath,
        "--url",
        "http://localhost:5173",
      ],
      composition: createCompositionWithFlowService(flowService),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "flow run",
      data: { flowRunId: "flowrun_checkout" },
      ok: true,
      schemaVersion: "1.0",
    });
    expect(flowService.runFlowFile).toHaveBeenCalledWith(
      expect.objectContaining({
        flowPath,
        targetCli: { url: "http://localhost:5173" },
      }),
    );
  });

  it("prints JSON envelopes for flow lifecycle commands", async () => {
    const flowPath = await writeFlowFile();
    const flowService = makeFlowService();
    const composition = createCompositionWithFlowService(flowService);

    await expectJsonCommand(["flow", "list"], composition, {
      command: "flow list",
      data: { flows: [expect.objectContaining({ id: "flowrun_checkout" })] },
    });
    await expectJsonCommand(["flow", "show", "checkout"], composition, {
      command: "flow show",
      data: { flow: { id: "checkout" } },
    });
    await expectJsonCommand(
      ["flow", "promote", "qflow_checkout", "--out", path.join(path.dirname(flowPath), "out.yml")],
      composition,
      {
        command: "flow promote",
        data: { candidateFlowId: "qflow_checkout", status: "written" },
      },
    );
    await expectJsonCommand(["flow", "update-refs", flowPath], composition, {
      command: "flow update-refs",
      data: { flowId: "checkout", updatedRefs: 1 },
    });
  });
});

describe("surface qa CLI", () => {
  it("prints the QA JSON envelope", async () => {
    const stdout: string[] = [];
    const orchestrator = makeOrchestrator();
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "qa", "--url", "http://localhost:3000", "--explore"],
      composition: createCompositionWithBrowserQa({ orchestrator }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("")) as {
      readonly command: string;
      readonly data: {
        readonly candidateFindings: readonly unknown[];
        readonly candidateFlows: readonly unknown[];
        readonly qaRunId: string;
      };
      readonly ok: boolean;
      readonly schemaVersion: string;
    };

    expect(parsed.command).toBe("qa");
    expect(parsed.ok).toBe(true);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.data.qaRunId).toMatch(/^qa_/);
    expect(parsed.data.candidateFindings).toEqual([]);
    expect(parsed.data.candidateFlows).toEqual([]);
    expect(orchestrator.runQa).toHaveBeenCalledWith(
      expect.objectContaining({
        explore: true,
        target: { kind: "url", ref: "http://localhost:3000" },
      }),
    );
  });

  it("rejects multiple target flags with usage exit code", async () => {
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "qa", "--url", "http://localhost:3000", "--localhost"],
      composition: createCompositionWithBrowserQa({ orchestrator: makeOrchestrator() }),
      io: { stderr: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("mutually exclusive");
  });

  it("prints QA reports by requested format", async () => {
    const stdout: string[] = [];
    const orchestrator = makeOrchestrator();
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "report",
        "qa",
        "--run",
        "qa_cli",
        "--format",
        "manifest",
      ],
      composition: createCompositionWithBrowserQa({ orchestrator }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "report qa",
      data: {
        format: "manifest",
        report: { qaRunId: "qa_cli" },
      },
      ok: true,
      schemaVersion: "1.0",
    });
    expect(orchestrator.reportQa).toHaveBeenCalledWith({
      format: "manifest",
      runId: "qa_cli",
    });
  });
});

async function expectJsonCommand(
  argv: readonly string[],
  composition: ReturnType<typeof createSurfaceComposition>,
  expected: Record<string, unknown>,
): Promise<void> {
  const stdout: string[] = [];
  const exitCode = await runSurfaceCli({
    argv: ["node", "surface", "--json", ...argv],
    composition,
    io: { stdout: (chunk) => stdout.push(chunk) },
  });

  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout.join(""))).toMatchObject({
    ok: true,
    schemaVersion: "1.0",
    ...expected,
  });
}

async function writeFlowFile(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "surface-flow-cli-"));
  const flowPath = path.join(root, "checkout.yml");
  await writeFile(
    flowPath,
    `
schemaVersion: "1.0"
id: checkout
title: Checkout
steps:
  - id: open-cart
    action: open
    url: /cart
`,
    "utf8",
  );

  return flowPath;
}

function makeFlowService() {
  return {
    listFlows: vi.fn(() =>
      Promise.resolve(
        ok({
          flows: [{ flowId: "checkout", id: "flowrun_checkout", status: "passed" }],
        }),
      ),
    ),
    promoteFlow: vi.fn((input: { readonly candidateFlowId: string; readonly outPath: string }) =>
      Promise.resolve(
        ok({
          candidateFlowId: input.candidateFlowId,
          outPath: input.outPath,
          status: "written" as const,
        }),
      ),
    ),
    runFlowFile: vi.fn(() =>
      Promise.resolve(
        ok({
          flowRun: makeFlowRun(),
          qaRunId: "qa_flow",
        }),
      ),
    ),
    showFlow: vi.fn(() =>
      Promise.resolve(
        ok({
          flow: { id: "checkout" },
        }),
      ),
    ),
    updateFlowRefs: vi.fn(() =>
      Promise.resolve(
        ok({
          flowId: "checkout",
          updatedRefs: 1,
        }),
      ),
    ),
  };
}

function createCompositionWithFlowService(flowService: ReturnType<typeof makeFlowService>) {
  return createCompositionWithBrowserQa({ flowService });
}

function createCompositionWithBrowserQa(browserQa: Record<string, unknown>) {
  return {
    ...createSurfaceComposition(),
    browserQa,
  } as unknown as ReturnType<typeof createSurfaceComposition>;
}

function makeFlowRun(): TestFlowRun {
  return {
    evidenceBundles: [],
    findingIds: [],
    flowId: "checkout",
    id: "flowrun_checkout",
    isolation: { mode: "isolated", mutatesState: false, resetSatisfied: false },
    severity: "high",
    source: { kind: "file", ref: "surface-flows/checkout.yml" },
    status: "passed",
    steps: [],
    target: { kind: "url", ref: "http://localhost:5173" },
  };
}

function makeOrchestrator() {
  return {
    cleanup: vi.fn(() => Promise.resolve(ok({ cleaned: [], dryRun: false, skipped: [] }))),
    readEvidence: vi.fn(() => Promise.resolve(ok({ refId: "ev_checkout", summaries: [] }))),
    reportQa: vi.fn(() =>
      Promise.resolve(
        ok({
          format: "manifest" as const,
          report: { qaRunId: "qa_cli" },
        }),
      ),
    ),
    replay: vi.fn(() => Promise.resolve(ok({ replayStatus: "not-reproduced" }))),
    promoteCandidateByVerdict: vi.fn(() =>
      Promise.resolve(ok({ promotion: {}, replayStatus: "not-run" })),
    ),
    runExplore: vi.fn(() =>
      Promise.resolve(
        ok({
          candidateFindings: [],
          candidateFlows: [],
          qaRunId: "qa_explore",
        }),
      ),
    ),
    runQa: vi.fn(() =>
      Promise.resolve(
        ok({
          candidateFindings: [],
          candidateFlows: [],
          degradation: [],
          evidenceBundles: [],
          findings: [],
          flowRuns: [],
          mode: "explore",
          qaRunId: "qa_cli",
          target: { kind: "url", ref: "http://localhost:3000" },
        }),
      ),
    ),
  };
}
