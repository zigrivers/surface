import { describe, expect, expectTypeOf, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG, createSurfaceError, err, isOk, ok } from "./index.js";
import type {
  Backlog,
  Capture,
  CaptureBackend,
  FrameworkAdapter,
  GateEvaluator,
  GroundingTool,
  IssueExporter,
  KnowledgeSource,
  Lens,
  ModelProvider,
  ReportRenderer,
  StateStore,
  Target,
} from "./interfaces.js";

const target: Target = {
  kind: "url",
  ref: "http://localhost:3000",
};

const capture: Capture = {
  id: "cap_1",
  target,
  backend: "static",
  artifacts: [
    { id: "a1", type: "dom-snapshot", path: ".surface/captures/cap_1/dom.html", redacted: true },
  ],
  capturedAt: "2026-05-31T18:00:00.000Z",
  status: "completed",
};

describe("published plugin interfaces", () => {
  it("publishes the expected extension point interface names", () => {
    expectTypeOf<CaptureBackend>().toHaveProperty("observe");
    expectTypeOf<FrameworkAdapter>().toHaveProperty("introspect");
    expectTypeOf<GroundingTool>().toHaveProperty("run");
    expectTypeOf<Lens>().toHaveProperty("evaluate");
    expectTypeOf<ModelProvider>().toHaveProperty("complete");
    expectTypeOf<ReportRenderer>().toHaveProperty("render");
    expectTypeOf<GateEvaluator>().toHaveProperty("evaluate");
    expectTypeOf<IssueExporter>().toHaveProperty("export");
    expectTypeOf<KnowledgeSource>().toHaveProperty("resolve");
    expectTypeOf<StateStore>().toHaveProperty("writeArtifact");
  });

  it("allows leaf-style plugin implementations without importing leaf packages", async () => {
    const backend: CaptureBackend = {
      id: "static",
      detect: () => true,
      observe: () => ok(capture),
    };

    const adapter: FrameworkAdapter = {
      id: "agnostic",
      supports: (file) => file.endsWith(".html"),
      introspect: () =>
        ok({ entries: [{ component: "Page", file: "index.html", selectors: ["main"] }] }),
    };

    const grounding: GroundingTool = {
      id: "backend",
      run: () =>
        ok([
          {
            tool: "backend",
            evidence: [
              {
                kind: "tool-result",
                tool: "backend",
                rule: "static-dom-present",
                measuredValue: "main",
              },
            ],
          },
        ]),
    };

    const knowledge: KnowledgeSource = {
      query: () =>
        ok([{ id: "kb_empty_state", title: "Empty states", summary: "Offer recovery." }]),
      resolve: () =>
        ok({ id: "kb_empty_state", title: "Empty states", summary: "Offer recovery." }),
    };

    const lens: Lens = {
      id: "empty-state",
      method: "judged",
      requiresModel: true,
      requiresLiveDom: false,
      evaluate: async (context) => {
        if (context.model === undefined) {
          return err(createSurfaceError("model_unavailable", "No model provider is configured."));
        }

        const completion = await context.model.complete({
          prompt: {
            instructions: "Find empty-state issues.",
            input: { captureId: context.capture.id },
          },
        });

        if (!isOk(completion)) {
          return err(completion.error);
        }

        return ok([]);
      },
    };
    const model: ModelProvider = {
      id: "openai",
      availability: () => ok({ available: true, provider: "openai", model: "quality-model" }),
      complete: () => ok({ provider: "openai", model: "quality-model", text: "[]" }),
    };

    expect(backend.detect()).toBe(true);
    expect((await backend.observe(target, { config: DEFAULT_SURFACE_CONFIG.capture })).ok).toBe(
      true,
    );
    expect(adapter.supports("index.html")).toBe(true);
    expect((await grounding.run(capture)).ok).toBe(true);
    expect((await knowledge.resolve("kb_empty_state")).ok).toBe(true);
    expect(
      (
        await lens.evaluate({
          capture,
          config: DEFAULT_SURFACE_CONFIG,
          evidence: [],
          knowledge,
          model,
        })
      ).ok,
    ).toBe(true);
  });

  it("types reporter, exporter, gate, and state-store boundaries as Result-returning seams", async () => {
    const backlog: Backlog = { id: "b1", runId: "run_1", entries: [] };
    const renderer: ReportRenderer = {
      format: "findings-json",
      render: () =>
        ok({ format: "findings-json", bytes: new Uint8Array([123, 125]), byteStable: true }),
    };
    const gate: GateEvaluator = {
      evaluate: () => ok({ passed: true, failingFindingIds: [], exitCode: 0 }),
    };
    const exporter: IssueExporter = {
      target: "github",
      export: () => err(createSurfaceError("export_failed", "GitHub export failed. Retry later.")),
    };
    const stateStore: StateStore = {
      readState: () => ok({ version: "1.0" }),
      updateState: (updater) => ok(updater({ version: "1.0" })),
      writeState: (state) => ok(state),
      writeArtifact: () => ok({ path: ".surface/findings/findings.json", sha256: "abc123" }),
    };

    expect((await renderer.render([], backlog)).ok).toBe(true);
    expect((await gate.evaluate([], DEFAULT_SURFACE_CONFIG.reporting.gatePolicy)).ok).toBe(true);
    expect(
      (await exporter.export({ path: ".surface/backlog.json", backlogId: backlog.id })).ok,
    ).toBe(false);
    expect(
      (
        await stateStore.writeArtifact({
          kind: "report",
          relativePath: "findings.json",
          bytes: new Uint8Array(),
        })
      ).ok,
    ).toBe(true);
  });
});
