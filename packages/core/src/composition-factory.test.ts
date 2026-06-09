import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { ok } from "./errors.js";
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
