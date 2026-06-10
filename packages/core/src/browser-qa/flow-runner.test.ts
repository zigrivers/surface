import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createSurfaceError, err, ok } from "../errors.js";
import { createBuiltInSafeActionPolicy } from "./action-policy.js";
import {
  createBrowserQaFlowService,
  createFlowRunner,
  type FlowRunnerDriver,
} from "./flow-runner.js";
import type {
  ActionPolicy,
  BrowserQaFlow,
  CandidateFlow,
  EvidenceBundle,
  FlowRun,
} from "./schemas.js";

describe("FlowRunner", () => {
  it("executes steps in order and captures failed assertion evidence", async () => {
    const driver = makeFakeDriver({
      assertText: vi.fn<FlowRunnerDriver["assertText"]>().mockResolvedValue({
        error: createSurfaceError("flow_step_failed", "missing text"),
        ok: false,
      }),
    });
    const evidenceStore = makeFakeEvidenceStore();
    const runner = createFlowRunner({
      actionPolicy: allowAllActionPolicy(),
      driver,
      evidenceStore,
      now: () => "2026-06-08T12:34:56.000Z",
      qaStore: makeFakeQaStore(),
    });

    const result = await runner.runFlow(makeFlow(), {
      qaRunId: "qa_flow",
      source: { kind: "file", ref: "surface-flows/checkout.yml" },
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.status).toBe("failed");
    expect(result.value.highestFailedSeverity).toBe("high");
    expect(result.value.steps.find((step) => step.id === "submit-empty-payment")).toMatchObject({
      completedAt: "2026-06-08T12:34:56.000Z",
      status: "failed",
    });
    expect(driver.calls.map((call) => call.action)).toEqual(["open", "click", "assert"]);
    expect(evidenceStore.writeBundle).toHaveBeenCalled();
  });

  it("runs teardown without masking the original failure", async () => {
    const driver = makeFakeDriver({
      click: vi
        .fn<FlowRunnerDriver["click"]>()
        .mockResolvedValueOnce({
          error: createSurfaceError("flow_step_failed", "primary click failed"),
          ok: false,
        })
        .mockResolvedValueOnce({
          error: createSurfaceError("flow_step_failed", "teardown failed"),
          ok: false,
        }),
    });
    const runner = createFlowRunner({
      actionPolicy: allowAllActionPolicy(),
      driver,
      evidenceStore: makeFakeEvidenceStore(),
      qaStore: makeFakeQaStore(),
    });

    const result = await runner.runFlow(makeMutatingFlowWithTeardown(), makeRunContext());

    expect(result).toMatchObject({
      ok: true,
      value: {
        degradation: [expect.objectContaining({ scope: "teardown" })],
        status: "failed",
        steps: [expect.objectContaining({ error: "primary click failed", status: "failed" })],
      },
    });
    expect(result.ok ? result.value.steps : []).toContainEqual(
      expect.objectContaining({
        error: "primary click failed",
        id: "pay-now",
        status: "failed",
      }),
    );
    expect(driver.calls.map((call) => call.id)).toEqual(["pay-now", "reset-cart"]);
  });

  it("rejects volatile ref hints when no semantic locator identity is present", async () => {
    const driver = makeFakeDriver();
    const runner = createFlowRunner({
      actionPolicy: allowAllActionPolicy(),
      driver,
      evidenceStore: makeFakeEvidenceStore(),
      qaStore: makeFakeQaStore(),
    });

    const result = await runner.runFlow(
      makeFlow({
        steps: [
          {
            action: "click",
            id: "bad-ref-only",
            locator: { refHint: "@e12" },
          },
        ],
      }),
      makeRunContext(),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
    expect(driver.calls).toEqual([]);
  });

  it("delays between assertion retries", async () => {
    const assertText = vi
      .fn<FlowRunnerDriver["assertText"]>()
      .mockResolvedValueOnce({
        error: createSurfaceError("flow_step_failed", "not ready"),
        ok: false,
      })
      .mockResolvedValueOnce(ok({ exitCode: 0, stderr: "", stdout: "Ready" }));
    const driver = makeFakeDriver({ assertText });
    const runner = createFlowRunner({
      actionPolicy: allowAllActionPolicy(),
      driver,
      evidenceStore: makeFakeEvidenceStore(),
      qaStore: makeFakeQaStore(),
    });

    const result = await runner.runFlow(
      makeFlow({
        steps: [
          {
            action: "assert",
            expect: { text: "Ready" },
            id: "eventually-ready",
            retry: { attempts: 2, delayMs: 1 },
          },
        ],
      }),
      makeRunContext(),
    );

    expect(result).toMatchObject({ ok: true, value: { status: "passed" } });
    expect(assertText).toHaveBeenCalledTimes(2);
  });
});

describe("BrowserQaFlowService", () => {
  it("lists candidate flows separately from flow run history", async () => {
    const listCandidateFlows = vi.fn(() =>
      Promise.resolve(
        ok([
          {
            id: "qflow_checkout",
            qaRunId: "qa_seed",
            sourceRunManifestDigest: "sha256:abc123",
            steps: [],
            title: "Checkout candidate",
          } satisfies CandidateFlow,
        ]),
      ),
    );
    const listFlowRuns = vi.fn(() =>
      Promise.resolve(
        ok([
          {
            evidenceBundles: [],
            findingIds: [],
            flowId: "checkout",
            gateEligible: false,
            id: "flowrun_checkout",
            isolation: { mode: "isolated", mutatesState: false, resetSatisfied: true },
            severity: "medium",
            source: { kind: "file", ref: "surface-flows/checkout.yml" },
            status: "passed",
            steps: [],
            target: { kind: "url", ref: "http://localhost:3000" },
          } satisfies FlowRun,
        ]),
      ),
    );
    const service = createBrowserQaFlowService({
      flowRunner: { runFlow: vi.fn() },
      qaStore: {
        listCandidateFlows,
        listFlowRuns,
        readCandidateFlow: vi.fn(),
        readFlowRun: vi.fn(),
        writeRun: vi.fn(),
      },
    });

    const result = await service.listFlows({ candidates: true });

    expect(result).toMatchObject({
      ok: true,
      value: { flows: [{ id: "qflow_checkout" }] },
    });
    expect(listCandidateFlows).toHaveBeenCalledTimes(1);
    expect(listFlowRuns).not.toHaveBeenCalled();
  });

  it("persists volatile ref hint updates in reviewed flow YAML", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-flow-refs-"));
    const flowDir = path.join(root, "surface-flows");
    await mkdir(flowDir, { recursive: true });
    const flowPath = path.join(flowDir, "settings.yml");
    await writeFile(
      flowPath,
      `schemaVersion: "1.0"
id: settings
title: Settings save
severity: medium
target:
  kind: url
  ref: http://localhost:3000/settings
steps:
  - id: open-settings
    action: open
    url: /settings
  - id: fill-name
    action: fill
    locator:
      label: Display name
      refHint: "@e999"
    value: Updated User
  - id: save-settings
    action: click
    locator:
      role: button
      name: Save settings
      refHint: "@e998"
`,
      "utf8",
    );
    const service = createBrowserQaFlowService({
      flowRunner: { runFlow: vi.fn() },
      projectRoot: root,
      qaStore: {
        listCandidateFlows: vi.fn(),
        listFlowRuns: vi.fn(),
        readCandidateFlow: vi.fn(),
        readFlowRun: vi.fn(),
        writeRun: vi.fn(),
      },
    });

    const result = await service.updateFlowRefs({ flowPath: "surface-flows/settings.yml" });

    expect(result).toMatchObject({ ok: true, value: { flowId: "settings", updatedRefs: 2 } });
    const updated = await readFile(flowPath, "utf8");
    expect(updated).not.toContain("refHint");
    expect(updated).toContain("label: Display name");
    expect(updated).toContain("role: button");
  });

  it("rejects promoted flow output outside surface-flows", async () => {
    const service = createBrowserQaFlowService({
      flowRunner: { runFlow: vi.fn() },
      qaStore: {
        listCandidateFlows: vi.fn(),
        listFlowRuns: vi.fn(),
        readCandidateFlow: vi.fn(() =>
          Promise.resolve(
            ok({
              id: "qflow_checkout",
              qaRunId: "qa_seed",
              sourceRunManifestDigest: "sha256:abc123",
              steps: [],
              title: "Checkout",
            }),
          ),
        ),
        readFlowRun: vi.fn(),
        writeRun: vi.fn(),
      },
    });

    const result = await service.promoteFlow({
      candidateFlowId: "qflow_checkout",
      outPath: "../checkout.yml",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("writes an inferred URL target when promoting candidate flows with absolute open steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-flow-promote-"));
    const flowDir = path.join(root, "surface-flows");
    await mkdir(flowDir, { recursive: true });
    const service = createBrowserQaFlowService({
      flowRunner: { runFlow: vi.fn() },
      projectRoot: root,
      qaStore: {
        listCandidateFlows: vi.fn(),
        listFlowRuns: vi.fn(),
        readCandidateFlow: vi.fn(() =>
          Promise.resolve(
            ok({
              id: "qflow_home",
              qaRunId: "qa_seed",
              sourceRunManifestDigest: "sha256:abc123",
              steps: [{ action: "open", url: "http://localhost:3000/" }],
              title: "Home",
            } satisfies CandidateFlow),
          ),
        ),
        readFlowRun: vi.fn(),
        writeRun: vi.fn(),
      },
    });

    const result = await service.promoteFlow({
      candidateFlowId: "qflow_home",
      outPath: "surface-flows/home.yml",
    });

    expect(result).toMatchObject({ ok: true });
    const promoted = await readFile(path.join(flowDir, "home.yml"), "utf8");
    expect(promoted).toContain(`target:
  kind: url
  ref: http://localhost:3000/`);
  });

  it("reports a missing candidate flow with an actionable promotion error", async () => {
    const missingSidecar = Object.assign(new Error("missing candidate sidecar"), {
      code: "ENOENT",
    });
    const service = createBrowserQaFlowService({
      flowRunner: { runFlow: vi.fn() },
      qaStore: {
        listCandidateFlows: vi.fn(),
        listFlowRuns: vi.fn(),
        readCandidateFlow: vi.fn(() =>
          Promise.resolve(
            err(
              createSurfaceError("state_read_failed", "Failed to read QA sidecar.", {
                cause: missingSidecar,
              }),
            ),
          ),
        ),
        readFlowRun: vi.fn(),
        writeRun: vi.fn(),
      },
    });

    const result = await service.promoteFlow({
      candidateFlowId: "qflow_missing",
      outPath: "surface-flows/promoted.yml",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "flow_invalid",
        details: {
          candidateFlowId: "qflow_missing",
          nextCommand: "surface flow list --candidates --json",
        },
        message: 'Candidate browser QA flow "qflow_missing" was not found.',
      },
    });
  });
});

function makeFlow(overrides: Partial<BrowserQaFlow> = {}): BrowserQaFlow {
  return {
    defaults: {},
    fixtures: [],
    id: "checkout",
    inputs: {},
    schemaVersion: "1.0",
    secrets: {},
    severity: "medium",
    steps: [
      {
        action: "open",
        id: "open-cart",
        url: "/cart",
      },
      {
        action: "click",
        id: "start-checkout",
        locator: { name: "Checkout", role: "button", refHint: "@e12" },
      },
      {
        action: "assert",
        expect: { text: "Card number is required" },
        id: "submit-empty-payment",
        severity: "high",
      },
    ],
    title: "Checkout validation",
    ...overrides,
  };
}

function makeMutatingFlowWithTeardown(): BrowserQaFlow {
  return makeFlow({
    isolation: {
      mode: "isolated",
      mutatesState: true,
      resetRequired: true,
    },
    steps: [
      {
        action: "click",
        id: "pay-now",
        locator: { name: "Pay now", role: "button" },
        severity: "critical",
      },
    ],
    teardown: {
      always: [
        {
          action: "click",
          id: "reset-cart",
          locator: { name: "Reset cart", role: "button" },
        },
      ],
    },
  });
}

function makeRunContext() {
  return {
    qaRunId: "qa_flow",
    source: { kind: "file" as const, ref: "surface-flows/checkout.yml" },
    target: { kind: "url" as const, ref: "http://localhost:3000" },
  };
}

function makeFakeDriver(
  overrides: Partial<FlowRunnerDriver> = {},
): FlowRunnerDriver & { readonly calls: { readonly action: string; readonly id?: string }[] } {
  const calls: { readonly action: string; readonly id?: string }[] = [];
  const pass = () => Promise.resolve(ok({ exitCode: 0, stderr: "", stdout: "{}" }));
  const overriddenAssertText = overrides.assertText;
  const overriddenClick = overrides.click;
  const record =
    (action: string): FlowRunnerDriver["click"] =>
    (input) => {
      calls.push({ action, ...(input.stepId === undefined ? {} : { id: input.stepId }) });
      return pass();
    };
  const driver: FlowRunnerDriver & {
    readonly calls: { readonly action: string; readonly id?: string }[];
  } = {
    assertText: (input) => {
      calls.push({ action: "assert", ...(input.stepId === undefined ? {} : { id: input.stepId }) });
      return overriddenAssertText?.(input) ?? pass();
    },
    assertElementState: () => pass(),
    captureState: () => Promise.resolve(ok({ title: "Checkout" })),
    check: record("check"),
    cleanupStaleSessions: () => Promise.resolve(ok({ cleaned: [], skipped: [] })),
    click: (input) => {
      calls.push({ action: "click", ...(input.stepId === undefined ? {} : { id: input.stepId }) });
      return overriddenClick?.(input) ?? pass();
    },
    dblclick: record("dblclick"),
    fill: record("fill"),
    focus: record("focus"),
    getConsoleSummary: () => Promise.resolve(ok({ pageErrors: [] })),
    getNetworkSummary: () => Promise.resolve(ok({ failedRequests: [] })),
    getReactDiagnostics: () => Promise.resolve(ok({})),
    getVitals: () => Promise.resolve(ok({})),
    hover: record("hover"),
    navigate: record("open"),
    press: record("press"),
    pushState: record("pushstate"),
    scroll: record("scroll"),
    select: record("select"),
    setTheme: record("setTheme"),
    setViewport: record("setViewport"),
    startSession: () =>
      Promise.resolve(
        ok({
          createdAt: "2026-06-08T12:00:00.000Z",
          executableSignature: "agent-browser",
          id: "ab_test",
          lockfilePath: ".surface/tmp/qa/qa_flow/sessions/ab_test/session.lock",
          manifestPath: ".surface/tmp/qa/qa_flow/sessions/ab_test/manifest.json",
          owner: "surface",
          ownerToken: "surface:qa_flow:ab_test",
          processGroup: "ab_test",
          profileDir: ".surface/tmp/qa/qa_flow/sessions/ab_test/profile",
          qaRunId: "qa_flow",
          startedAt: "2026-06-08T12:00:00.000Z",
          target: { kind: "url", ref: "http://localhost:3000" },
        }),
      ),
    stopSession: () => Promise.resolve(ok({ stopped: true })),
    type: record("type"),
    uncheck: record("uncheck"),
    upload: record("upload"),
    wait: record("wait"),
    calls,
  };

  return driver;
}

function makeFakeEvidenceStore() {
  return {
    readArtifactByRegisteredRef: vi.fn(),
    readBundle: vi.fn(),
    writeBundle: vi.fn((input: { readonly bundle: EvidenceBundle }) =>
      Promise.resolve(ok(input.bundle)),
    ),
  };
}

function makeFakeQaStore() {
  return {
    listCandidateFlows: vi.fn(),
    readCandidate: vi.fn(),
    readCandidateFlow: vi.fn(),
    readEvidenceBundle: vi.fn(),
    readFlowRun: vi.fn(),
    readPromotedFinding: vi.fn(),
    readRun: vi.fn(),
    writeCandidate: vi.fn(),
    writeCandidateFlow: vi.fn(),
    writeEvidenceBundle: vi.fn(),
    writeFlowRun: vi.fn((run: FlowRun) => Promise.resolve(ok(run))),
    writePromotedFinding: vi.fn(),
    writeRun: vi.fn(),
  };
}

function allowAllActionPolicy(): ActionPolicy {
  return {
    ...createBuiltInSafeActionPolicy(),
    rules: [
      {
        categories: [
          "navigation",
          "reveal",
          "form",
          "submit",
          "save",
          "delete",
          "clear",
          "upload",
          "payment",
          "account",
          "externally-visible",
          "persistent",
          "unknown",
        ],
        decision: "allow",
        id: "allow-tests",
        locators: [
          { name: "Checkout", role: "button" },
          { name: "Pay now", role: "button" },
          { name: "Reset cart", role: "button" },
        ],
        origins: ["http://localhost:3000"],
        routes: ["/", "/cart"],
      },
    ],
    allowedDomains: ["http://localhost:3000"],
  };
}
