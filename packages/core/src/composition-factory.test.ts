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
    expect(composition.pipelineOrchestrator).toBeDefined();

    const run = await composition.pipelineOrchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_composition",
    });

    expect(run.ok).toBe(true);
    expect(stateStore.writes.at(-1)?.currentStage).toBe("completed");
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
});
