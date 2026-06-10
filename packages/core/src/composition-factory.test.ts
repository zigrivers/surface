import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  BrowserQaDriver,
  BrowserQaDriverActionInput,
} from "./browser-qa/agent-browser-driver.js";
import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { createSurfaceError, err, ok } from "./errors.js";
import type {
  CaptureBackend,
  FrameworkAdapter,
  GroundingTool,
  IssueExporter,
  ProjectStateSnapshot,
  ReportRenderer,
  StateStore,
} from "./interfaces.js";
import type { LensRegistration } from "./lens-registry.js";
import { createSurfaceComposition } from "./composition-factory.js";
import type { ProcessRunner } from "./subscription-cli-provider.js";

class MemoryStateStore implements StateStore {
  readonly writes: ProjectStateSnapshot[] = [];

  constructor(private state: ProjectStateSnapshot = { version: "1.0" }) {}

  readState() {
    return ok(this.state);
  }

  writeState(state: ProjectStateSnapshot) {
    this.state = state;
    this.writes.push(state);
    return ok(state);
  }

  updateState(updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot) {
    return this.writeState(updater(this.state));
  }

  writeArtifact() {
    return ok({ path: ".surface/reports/findings.json", sha256: "abc123" });
  }
}

describe("createSurfaceComposition", () => {
  it("resolves the default project root to the nearest ancestor with Surface state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "surface-composition-root-"));
    const nested = path.join(root, "apps", "web");
    mkdirSync(path.join(root, ".surface"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    const originalCwd = process.cwd();
    try {
      process.chdir(nested);
      const composition = createSurfaceComposition({ stateStore: new MemoryStateStore() });

      expect(composition.lensFactoryOptions.projectRoot).toBe(realpathSync(root));
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("extracts agent-browser bracket refs for browser QA exploration actions", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "surface-composition-qa-"));
    const driver = makeSnapshotDriver({
      data: {
        origin: "http://localhost:3000/",
        refs: {
          e1: { name: "Browser QA Fixture", role: "heading" },
          e2: { name: "Open modal route", role: "button" },
          e3: { name: "Cart", role: "link" },
        },
        snapshot: `- main
  - heading "Browser QA Fixture" [level=1, ref=e1]
  - navigation
    - link "Cart" [ref=e3]
  - button "Open modal route" [ref=e2]`,
      },
      error: null,
      success: true,
    });

    try {
      const composition = createSurfaceComposition({
        browserQa: { driver },
        projectRoot: root,
        stateStore: new MemoryStateStore(),
      });

      const result = await composition.browserQa.orchestrator.runExplore({
        maxActions: 2,
        maxDepth: 1,
        maxStates: 2,
        qaRunId: "qa_bracket_refs",
        target: { kind: "url", ref: "http://localhost:3000" },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.attemptedActions).toBeGreaterThan(0);
      expect(result.value.candidateFlows[0]?.id).toMatch(/^qflow_/);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not spend exploration actions on passive snapshot headings", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "surface-composition-qa-"));
    const actionCalls: BrowserQaDriverActionInput[] = [];
    const driver = makeSnapshotDriver(
      {
        data: {
          origin: "http://localhost:3000/",
          refs: {
            e1: { name: "Surface Sixth Dogfood", role: "heading" },
            e2: { name: "Overview", role: "heading" },
            e3: { name: "Docs", role: "link" },
            e4: { name: "Open help", role: "button" },
          },
          snapshot: `- main
  - heading "Surface Sixth Dogfood" [level=1, ref=e1]
  - heading "Overview" [level=2, ref=e2]
  - navigation
    - link "Docs" [ref=e3]
  - button "Open help" [ref=e4]`,
        },
        error: null,
        success: true,
      },
      actionCalls,
    );

    try {
      const composition = createSurfaceComposition({
        browserQa: { driver },
        projectRoot: root,
        stateStore: new MemoryStateStore(),
      });

      const result = await composition.browserQa.orchestrator.runExplore({
        maxActions: 2,
        maxDepth: 1,
        maxStates: 2,
        qaRunId: "qa_interactive_refs",
        target: { kind: "url", ref: "http://localhost:3000" },
      });

      expect(result.ok).toBe(true);
      expect(actionCalls.map((call) => call.locator?.refHint)).toEqual(["@e3", "@e3"]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("returns promotion details when replay promotion reproduces a browser QA candidate", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "surface-composition-qa-"));
    let failReplayNavigation = false;
    const baseDriver = makeSnapshotDriver({
      data: {
        origin: "http://localhost:3000/billing",
        refs: {
          e1: { name: "Billing", role: "heading" },
          e2: { name: "Delete account", role: "button" },
        },
        snapshot: `- main
  - heading "Billing" [level=1, ref=e1]
  - button "Delete account" [ref=e2]`,
      },
      error: null,
      success: true,
    });
    const driver: BrowserQaDriver = {
      ...baseDriver,
      navigate: (input) =>
        failReplayNavigation
          ? Promise.resolve(
              err(createSurfaceError("action_policy_denied", "Replay navigation failed.")),
            )
          : baseDriver.navigate(input),
    };

    try {
      const composition = createSurfaceComposition({
        browserQa: { driver },
        projectRoot: root,
        stateStore: new MemoryStateStore(),
      });
      const exploration = await composition.browserQa.orchestrator.runExplore({
        maxActions: 2,
        maxDepth: 1,
        maxStates: 2,
        qaRunId: "qa_replay_promotion",
        target: { kind: "url", ref: "http://localhost:3000/billing" },
      });

      expect(exploration.ok).toBe(true);
      if (!exploration.ok) {
        throw new Error(exploration.error.message);
      }
      const candidateId = exploration.value.candidateFindings[0]?.id;
      expect(candidateId).toMatch(/^qfc_/);

      failReplayNavigation = true;
      const replay = await composition.browserQa.orchestrator.replay({
        promoteOnRepro: true,
        refId: candidateId ?? "",
      });

      expect(replay.ok).toBe(true);
      if (!replay.ok) {
        throw new Error(replay.error.message);
      }
      expect(replay.value.replayStatus).toBe("reproduced");
      expect(typeof replay.value.promotion).toBe("object");
      expect(replay.value.promotion).not.toBeNull();
      const promotion = replay.value.promotion as {
        readonly candidateFindingId?: unknown;
        readonly findingId?: unknown;
        readonly promotionSource?: unknown;
      };
      expect(promotion.candidateFindingId).toBe(candidateId);
      expect(promotion.findingId).toEqual(expect.stringMatching(/^f_/));
      expect(promotion.promotionSource).toBe("replay");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("builds the shared core registry used by interface adapters", async () => {
    const stateStore = new MemoryStateStore();
    const composition = createSurfaceComposition({
      generatedAt: () => "2026-06-01T00:00:00.000Z",
      knowledgeRootDir: "docs/kb",
      projectRoot: "/tmp/surface-project",
      stateStore,
    });

    expect(composition.captureBackends.map((backend) => backend.id)).toEqual([
      "agent-browser",
      "playwright",
      "static",
    ]);
    expect(composition.frameworkAdapters).toEqual([]);
    expect(composition.groundingTools).toEqual([]);
    expect(composition.lensRegistry.map((lens) => lens.id)).toEqual([
      "accessibility",
      "usability",
      "visual-hierarchy",
      "content",
      "responsiveness",
      "conversion",
      "message-clarity",
      "task-completion",
      "agent-implementation",
      "data-density",
      "trust-and-control",
      "trust-and-credibility",
    ]);
    expect(composition.reportRenderers.map((renderer) => renderer.format)).toEqual([
      "findings-json",
      "findings-md",
      "backlog",
      "agent-plan",
      "validation-report",
    ]);
    expect(composition.issueExporters).toEqual([]);
    expect(composition.stateStore).toBe(stateStore);
    expect(composition.auditRunner).toBeDefined();
    expect(composition.pipelineOrchestrator).toBeDefined();

    const run = await composition.pipelineOrchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_composition",
    });

    expect(run.ok).toBe(true);
    expect(stateStore.writes.at(-1)?.currentStage).toBe("completed");
  });

  it("falls back to bundled knowledge when the project has no default catalog", async () => {
    const composition = createSurfaceComposition({
      projectRoot: "/tmp/surface-project-without-knowledge",
      stateStore: new MemoryStateStore(),
    });

    const entry = await composition.knowledgeSource.resolve("kb_usability_nielsen_heuristics");

    expect(entry.ok).toBe(true);
  });

  it("accepts sibling package plugins without making CLI or MCP own composition", () => {
    const captureBackend = {
      id: "custom-browser",
      detect: () => true,
      observe: () => Promise.reject(new Error("not exercised")),
    } satisfies CaptureBackend;
    const frameworkAdapter = {
      id: "custom-framework",
      supports: () => true,
      introspect: () => ok({ entries: [] }),
    } satisfies FrameworkAdapter;
    const groundingTool = {
      id: "custom-grounding",
      run: () => ok([]),
    } satisfies GroundingTool;
    const lens = {
      id: "custom-lens",
      method: "measured",
      requiresLiveDom: false,
      requiresModel: false,
      presets: ["standard"],
    } satisfies LensRegistration;
    const reportRenderer = {
      format: "custom-report",
      render: () => ok({ byteStable: true, bytes: new Uint8Array(), format: "custom-report" }),
    } satisfies ReportRenderer;
    const issueExporter = {
      target: "custom-tracker",
      export: () =>
        ok({
          id: "custom:backlog",
          status: "complete",
          synced: [],
          target: "custom-tracker",
          unsynced: [],
        }),
    } satisfies IssueExporter;

    const composition = createSurfaceComposition({
      captureBackends: [captureBackend],
      frameworkAdapters: [frameworkAdapter],
      groundingTools: [groundingTool],
      issueExporters: [issueExporter],
      lensRegistry: [lens],
      reportRenderers: [reportRenderer],
      stateStore: new MemoryStateStore(),
    });

    expect(composition.captureBackends.map((backend) => backend.id)).toEqual([
      "custom-browser",
      "static",
    ]);
    expect(composition.frameworkAdapters).toEqual([frameworkAdapter]);
    expect(composition.groundingTools).toEqual([groundingTool]);
    expect(composition.lensRegistry).toEqual([lens]);
    expect(composition.reportRenderers).toEqual([reportRenderer]);
    expect(composition.issueExporters).toEqual([issueExporter]);
  });

  it("wires audit runner dependencies and injected process runner", async () => {
    const requests: string[] = [];
    const processRunner: ProcessRunner = {
      enforcedFilesystemIsolation: true,
      run: (request) => {
        requests.push([request.command, ...request.args].join(" "));

        if (request.args.join(" ") === "login status") {
          return { exitCode: 0, stderr: "", stdout: "Logged in using ChatGPT" };
        }

        if (request.args.join(" ") === "--version") {
          return { exitCode: 0, stderr: "", stdout: "codex 0.20.0" };
        }

        return { exitCode: 0, stderr: "", stdout: '{"type":"agent_message","message":"[]"}\n' };
      },
    };
    const lens: LensRegistration = {
      id: "usability",
      method: "judged",
      presets: ["standard"],
      requiresLiveDom: false,
      requiresModel: true,
      create: () => ({
        id: "usability",
        method: "judged",
        requiresLiveDom: false,
        requiresModel: true,
        evaluate: async (context) => {
          await context.model?.complete({
            prompt: { instructions: "Return JSON findings.", input: {} },
            responseFormat: { type: "json" },
          });
          return ok([]);
        },
      }),
    };
    const composition = createSurfaceComposition({
      lensRegistry: [lens],
      processRunner,
      stateStore: new MemoryStateStore(),
    });

    const result = await composition.auditRunner({
      capture: {
        id: "cap_composition",
        target: { kind: "url", ref: "https://example.test" },
        backend: "static",
        artifacts: [],
        capturedAt: "2026-06-08T00:00:00.000Z",
        status: "completed",
      },
      config: {
        ...DEFAULT_SURFACE_CONFIG,
        model: {
          ...DEFAULT_SURFACE_CONFIG.model,
          effectiveEgressPolicy: { mode: "text", screenshots: "blocked" },
          fallback: {
            ...DEFAULT_SURFACE_CONFIG.model.fallback,
            effectiveChannels: ["codex"],
            mode: "direct",
          },
        },
      },
      runId: "run_composition_audit",
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual([]);
    expect(result).toMatchObject({
      value: {
        unavailableChannels: [{ id: "codex", reason: "unsupported-capability" }],
      },
    });
  });
});

function makeSnapshotDriver(
  snapshot: unknown,
  actionCalls: BrowserQaDriverActionInput[] = [],
): BrowserQaDriver {
  const commandResult = { exitCode: 0, stderr: "", stdout: "" };
  const runAction = (input: BrowserQaDriverActionInput) => {
    actionCalls.push(input);
    return Promise.resolve(ok(commandResult));
  };

  return {
    assertElementState: runAction,
    assertText: runAction,
    captureState: () =>
      Promise.resolve(
        ok({
          rawSnapshot: snapshot,
          title: "Browser QA Fixture",
          url: "http://localhost:3000",
        }),
      ),
    check: runAction,
    cleanupStaleSessions: () => Promise.resolve(ok({ cleaned: [], skipped: [] })),
    click: runAction,
    dblclick: runAction,
    fill: runAction,
    focus: runAction,
    getConsoleSummary: () => Promise.resolve(ok({ entries: [] })),
    getNetworkSummary: () => Promise.resolve(ok({ requests: [] })),
    getReactDiagnostics: () => Promise.resolve(ok({ available: false })),
    getVitals: () => Promise.resolve(ok({})),
    hover: runAction,
    navigate: runAction,
    press: runAction,
    pushState: runAction,
    scroll: runAction,
    select: runAction,
    setTheme: runAction,
    setViewport: runAction,
    startSession: (input) =>
      Promise.resolve(
        ok({
          createdAt: "2026-06-10T00:00:00.000Z",
          executableSignature: "test",
          id: "ab_test",
          lockfilePath: ".surface/tmp/qa/qa_bracket_refs/sessions/ab_test/session.lock",
          manifestPath: ".surface/tmp/qa/qa_bracket_refs/sessions/ab_test/session.json",
          owner: "surface" as const,
          ownerToken: "token",
          processGroup: "test",
          profileDir: ".surface/tmp/qa/qa_bracket_refs/sessions/ab_test/profile",
          qaRunId: input.qaRunId,
          startedAt: "2026-06-10T00:00:00.000Z",
          target: input.target,
        }),
      ),
    stopSession: () => Promise.resolve(ok({ stopped: true })),
    type: runAction,
    uncheck: runAction,
    upload: runAction,
    wait: runAction,
  };
}
