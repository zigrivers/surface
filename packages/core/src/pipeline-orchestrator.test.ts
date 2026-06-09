import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG, type SurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok } from "./errors.js";
import type { ProjectStateSnapshot, StateStore } from "./interfaces.js";
import {
  createNoopPipelineHandlers,
  createPipelineOrchestrator,
  selectPipelineStages,
  type ExecutablePipelineStageId,
  type PipelineEvent,
} from "./pipeline-orchestrator.js";

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

class StaleReadStateStore implements StateStore {
  readonly writes: ProjectStateSnapshot[] = [];
  current: ProjectStateSnapshot;

  constructor(private readonly staleState: ProjectStateSnapshot = { version: "1.0" }) {
    this.current = staleState;
  }

  readState() {
    return ok(this.staleState);
  }

  writeState(state: ProjectStateSnapshot) {
    this.current = state;
    this.writes.push(state);
    return ok(state);
  }

  updateState(updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot) {
    this.current = updater(this.current);
    this.writes.push(this.current);
    return ok(this.current);
  }

  writeArtifact() {
    return ok({ path: ".surface/reports/findings.json", sha256: "abc123" });
  }
}

class FailingWriteStateStore extends MemoryStateStore {
  override writeState() {
    return err(createSurfaceError("state_write_failed", "State write failed."));
  }
}

class FailingReadStateStore extends MemoryStateStore {
  override readState() {
    return err(createSurfaceError("state_read_failed", "State read failed."));
  }
}

class FailingStageCompletionWriteStateStore extends MemoryStateStore {
  constructor(private failuresRemaining = 1) {
    super();
  }

  override writeState(state: ProjectStateSnapshot) {
    if (state.pipeline?.lastCompletedStage === "capture" && this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return err(createSurfaceError("state_write_failed", "Stage completion write failed."));
    }

    return super.writeState(state);
  }
}

class FailingFinalWriteStateStore extends MemoryStateStore {
  constructor(
    state?: ProjectStateSnapshot,
    private failuresRemaining = 1,
  ) {
    super(state);
  }

  override writeState(state: ProjectStateSnapshot) {
    if (state.currentStage === "completed" && this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return err(createSurfaceError("state_write_failed", "Final state write failed."));
    }

    return super.writeState(state);
  }
}

class FailingPendingCompletionWriteStateStore extends MemoryStateStore {
  constructor(private failuresRemaining = 1) {
    super();
  }

  override writeState(state: ProjectStateSnapshot) {
    if (state.currentStage === "pending-completion" && this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return err(createSurfaceError("state_write_failed", "Pending completion write failed."));
    }

    return super.writeState(state);
  }
}

function stateWithPipelinePlan(
  currentStage: string,
  runId: string,
  config = DEFAULT_SURFACE_CONFIG,
  nextEventSequence?: number,
): ProjectStateSnapshot {
  return {
    currentStage,
    version: "1.0",
    pipeline: {
      activeConfig: config,
      ...(nextEventSequence === undefined ? {} : { nextEventSequence }),
      runId,
      stageIds: selectPipelineStages(config).map((stage) => stage.id),
    },
  };
}

describe("PipelineOrchestrator", () => {
  it("selects a deterministic depth and preset aware stage plan", () => {
    const standardStages = selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id);
    const deepStages = selectPipelineStages({
      ...DEFAULT_SURFACE_CONFIG,
      evaluation: { ...DEFAULT_SURFACE_CONFIG.evaluation, depth: 5, preset: "deep" },
    }).map((stage) => stage.id);
    const conversionStages = selectPipelineStages({
      ...DEFAULT_SURFACE_CONFIG,
      evaluation: {
        ...DEFAULT_SURFACE_CONFIG.evaluation,
        depth: 3,
        preset: "conversion-focused",
      },
    }).map((stage) => stage.id);

    expect(standardStages).toEqual([
      "discovery",
      "persona",
      "routes",
      "capture",
      "heuristic",
      "accessibility",
      "visual",
      "content",
      "responsiveness",
      "synthesis",
      "validation",
    ]);
    expect(deepStages).toEqual([
      "discovery",
      "persona",
      "routes",
      "capture",
      "heuristic",
      "accessibility",
      "visual",
      "content",
      "responsiveness",
      "cognitive-walkthrough",
      "conversion",
      "innovation",
      "synthesis",
      "validation",
    ]);
    expect(conversionStages).toContain("conversion");
    expect(conversionStages).not.toContain("innovation");
    expect(
      ([1, 2, 3, 4, 5] as const).every(
        (depth) =>
          selectPipelineStages({
            ...DEFAULT_SURFACE_CONFIG,
            evaluation: { ...DEFAULT_SURFACE_CONFIG.evaluation, depth },
          }).length > 0,
      ),
    ).toBe(true);
  });

  it("resumes from matching pipeline metadata without re-emitting skipped stages", async () => {
    const stateStore = new MemoryStateStore(stateWithPipelinePlan("capture", "run_resume"));
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: ({ stage }) => {
          executed.push(stage.id);
          return ok({ captureId: "cap_1" });
        },
        accessibility: ({ stage }) => {
          executed.push(stage.id);
          return ok([]);
        },
        validation: ({ stage }) => {
          executed.push(stage.id);
          return ok({ passed: true });
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_resume",
    });

    expect(isOk(result)).toBe(true);
    expect(executed).toEqual(["capture", "accessibility", "validation"]);
    expect(stateStore.writes.map((state) => state.currentStage)).toEqual([
      "capture",
      "capture",
      "heuristic",
      "heuristic",
      "accessibility",
      "accessibility",
      "visual",
      "visual",
      "content",
      "content",
      "responsiveness",
      "responsiveness",
      "synthesis",
      "synthesis",
      "validation",
      "validation",
      "pending-completion",
      "completed",
    ]);
    expect(result).toMatchObject({
      value: {
        newlyCompletedStages: [
          "capture",
          "heuristic",
          "accessibility",
          "visual",
          "content",
          "responsiveness",
          "synthesis",
          "validation",
        ],
        runId: "run_resume",
      },
    });
    expect(result.ok && result.value.events.map((event) => event.type)).toEqual([
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "StageAdvanced",
      "AuditRunCompleted",
    ]);
  });

  it("restarts same-run metadata when active config changes without changing the stage plan", async () => {
    const changedConfig = {
      ...DEFAULT_SURFACE_CONFIG,
      evaluation: {
        ...DEFAULT_SURFACE_CONFIG.evaluation,
        appType: "marketing",
      },
    } satisfies SurfaceConfig;
    const stateStore = new MemoryStateStore(
      stateWithPipelinePlan("capture", "run_config_changed", DEFAULT_SURFACE_CONFIG),
    );
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        discovery: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
        capture: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: changedConfig,
      runId: "run_config_changed",
    });

    expect(isOk(result)).toBe(true);
    expect(executed[0]).toBe("discovery");
    expect(stateStore.writes[0]).toMatchObject({
      currentStage: "discovery",
      pipeline: {
        activeConfig: {
          evaluation: {
            appType: "marketing",
          },
        },
      },
    });
  });

  it("resumes after a durably completed stage without rerunning its handler", async () => {
    const stateStore = new MemoryStateStore({
      currentStage: "capture",
      version: "1.0",
      pipeline: {
        activeConfig: DEFAULT_SURFACE_CONFIG,
        lastCompletedStage: "capture",
        nextEventSequence: 4,
        runId: "run_stage_completion_resume",
        stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
      },
    });
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
        heuristic: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_stage_completion_resume",
    });

    expect(result).toMatchObject({
      value: {
        runId: "run_stage_completion_resume",
      },
    });
    expect(executed).toEqual(["heuristic"]);
    expect(result.ok && result.value.newlyCompletedStages[0]).toBe("heuristic");
  });

  it("preserves legacy resume behavior when active config metadata is absent", async () => {
    const stateStore = new MemoryStateStore({
      currentStage: "capture",
      version: "1.0",
      pipeline: {
        lastCompletedStage: "capture",
        nextEventSequence: 4,
        runId: "run_legacy_active_config",
        stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
      },
    });
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        discovery: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
        heuristic: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_legacy_active_config",
    });

    expect(isOk(result)).toBe(true);
    expect(executed).toEqual(["heuristic"]);
    expect(stateStore.writes[0]).toMatchObject({
      currentStage: "heuristic",
      pipeline: {
        activeConfig: DEFAULT_SURFACE_CONFIG,
      },
    });
  });

  it("returns the completed fast path for matching completed metadata", async () => {
    const executed: ExecutablePipelineStageId[] = [];
    const stateStore = new MemoryStateStore({
      currentStage: "completed",
      version: "1.0",
      pipeline: {
        activeConfig: DEFAULT_SURFACE_CONFIG,
        nextEventSequence: 12,
        runId: "run_already_completed",
        stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
      },
    });
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        validation: ({ stage }) => {
          executed.push(stage.id);
          return ok(null);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_already_completed",
    });

    expect(result).toMatchObject({
      value: {
        events: [{ runId: "run_already_completed", sequence: 11, type: "AuditRunCompleted" }],
        newlyCompletedStages: [],
        runId: "run_already_completed",
      },
    });
    expect(executed).toEqual([]);
    expect(stateStore.writes).toEqual([]);
  });

  it("rejects empty run ids", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new MemoryStateStore(),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "   ",
    });

    expect(result).toMatchObject({ error: { code: "invalid_run_id", details: { events: [] } } });
  });

  it("normalizes padded run ids before writing metadata", async () => {
    const stateStore = new MemoryStateStore();
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "  run_trimmed  ",
    });

    expect(result).toMatchObject({ value: { runId: "run_trimmed" } });
    expect(stateStore.writes[0]?.pipeline?.runId).toBe("run_trimmed");
  });

  it("returns state_read_failed with an empty event list when the initial read fails", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new FailingReadStateStore(),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_initial_read_failed",
    });

    expect(result).toMatchObject({
      error: {
        code: "state_read_failed",
        details: { events: [] },
      },
    });
  });

  it("stops on stage failure and records AuditRunFailed without advancing further", async () => {
    const stateStore = new MemoryStateStore();
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: () => err(createSurfaceError("capture_failed", "Capture backend failed.")),
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_failed",
    });

    expect(result).toMatchObject({
      error: {
        code: "step_failed",
        details: { stage: "capture" },
      },
    });
    expect(stateStore.writes.at(-1)).toMatchObject({ currentStage: "capture" });
    expect(!result.ok && result.error.details?.events).toMatchObject([
      { type: "StageSkipped", stage: "cognitive-walkthrough" },
      { type: "StageSkipped", stage: "conversion" },
      { type: "StageSkipped", stage: "innovation" },
      { type: "StageAdvanced", stage: "discovery" },
      { type: "StageAdvanced", stage: "persona" },
      { type: "StageAdvanced", stage: "routes" },
      { type: "StageAdvanced", stage: "capture" },
      { type: "AuditRunFailed", stage: "capture" },
    ]);
  });

  it("does not reuse a failure event sequence when retrying a failed stage", async () => {
    const stateStore = new MemoryStateStore();
    let captureAttempts = 0;
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: () => {
          captureAttempts += 1;
          return captureAttempts === 1
            ? err(createSurfaceError("capture_failed", "Capture backend failed."))
            : ok(null);
        },
      }),
      stateStore,
    });

    const failedResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_retry_after_stage_failure",
    });
    const retryResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_retry_after_stage_failure",
    });

    if (failedResult.ok || !retryResult.ok) {
      throw new Error("expected first run to fail and retry to succeed");
    }

    const failureEvents = failedResult.error.details?.events as PipelineEvent[] | undefined;
    const failureSequence = failureEvents?.at(-1)?.sequence;
    const retryCaptureSequence = retryResult.value.events.find(
      (event) => event.type === "StageAdvanced" && event.stage === "capture",
    )?.sequence;

    expect(captureAttempts).toBe(2);
    expect(failureSequence).toBeDefined();
    expect(retryCaptureSequence).toBeGreaterThan(failureSequence!);
  });

  it("retries a stage when its post-handler completion marker fails to persist", async () => {
    const stateStore = new FailingStageCompletionWriteStateStore();
    let captureCalls = 0;
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: () => {
          captureCalls += 1;
          return ok(null);
        },
      }),
      stateStore,
    });

    const failedResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_stage_completion_write_failed",
    });
    const retryResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_stage_completion_write_failed",
    });

    expect(failedResult).toMatchObject({
      error: {
        code: "step_failed",
        details: { stage: "capture" },
      },
    });
    expect(retryResult).toMatchObject({
      value: {
        runId: "run_stage_completion_write_failed",
      },
    });
    expect(captureCalls).toBe(2);
  });

  it("fails selected stages with missing handlers instead of silently completing", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: {},
      stateStore: new MemoryStateStore(),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_missing_handlers",
    });

    expect(result).toMatchObject({ error: { code: "config_invalid" } });
    expect(!result.ok && result.error.details?.missingHandlers).toEqual([
      "discovery",
      "persona",
      "routes",
      "capture",
      "heuristic",
      "accessibility",
      "visual",
      "content",
      "responsiveness",
      "synthesis",
      "validation",
    ]);
    expect(!result.ok && result.error.details?.events).toMatchObject([
      { type: "StageSkipped", stage: "cognitive-walkthrough" },
      { type: "StageSkipped", stage: "conversion" },
      { type: "StageSkipped", stage: "innovation" },
      { type: "AuditRunFailed", stage: "discovery" },
    ]);
  });

  it("emits AuditRunFailed when state persistence fails before stage work", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new FailingWriteStateStore(),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_state_failed",
    });

    expect(result).toMatchObject({
      error: {
        code: "step_failed",
        details: { stage: "discovery" },
      },
    });
    expect(!result.ok && result.error.details?.events).toMatchObject([
      { type: "StageSkipped", stage: "cognitive-walkthrough" },
      { type: "StageSkipped", stage: "conversion" },
      { type: "StageSkipped", stage: "innovation" },
      { type: "AuditRunFailed", stage: "discovery" },
    ]);
  });

  it("emits a finalization failure when completed state persistence fails", async () => {
    const stateStore = new FailingFinalWriteStateStore();
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_final_state_failed",
    });

    expect(result).toMatchObject({
      error: {
        code: "pipeline_completion_failed",
        details: { stage: "finalization" },
      },
    });
    expect(stateStore.writes.at(-1)).toMatchObject({ currentStage: "pending-completion" });
    expect(!result.ok && result.error.details?.events).toMatchObject([
      { type: "StageSkipped", stage: "cognitive-walkthrough" },
      { type: "StageSkipped", stage: "conversion" },
      { type: "StageSkipped", stage: "innovation" },
      { type: "StageAdvanced", stage: "discovery" },
      { type: "StageAdvanced", stage: "persona" },
      { type: "StageAdvanced", stage: "routes" },
      { type: "StageAdvanced", stage: "capture" },
      { type: "StageAdvanced", stage: "heuristic" },
      { type: "StageAdvanced", stage: "accessibility" },
      { type: "StageAdvanced", stage: "visual" },
      { type: "StageAdvanced", stage: "content" },
      { type: "StageAdvanced", stage: "responsiveness" },
      { type: "StageAdvanced", stage: "synthesis" },
      { type: "StageAdvanced", stage: "validation" },
      { type: "AuditRunFailed", stage: "finalization" },
    ]);
  });

  it("retries completion without rerunning the last stage handler", async () => {
    const stateStore = new FailingFinalWriteStateStore();
    let validationCalls = 0;
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        validation: () => {
          validationCalls += 1;
          return ok(null);
        },
      }),
      stateStore,
    });

    const failedResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_final_retry",
    });
    const retryResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_final_retry",
    });

    expect(failedResult).toMatchObject({ error: { code: "pipeline_completion_failed" } });
    expect(retryResult).toMatchObject({
      value: {
        newlyCompletedStages: [],
        runId: "run_final_retry",
      },
    });
    expect(validationCalls).toBe(1);
    expect(stateStore.writes.at(-1)).toMatchObject({ currentStage: "completed" });
  });

  it("retries finalization when pending-completion state persistence fails", async () => {
    const stateStore = new FailingPendingCompletionWriteStateStore();
    let validationCalls = 0;
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        validation: () => {
          validationCalls += 1;
          return ok(null);
        },
      }),
      stateStore,
    });

    const failedResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_pending_completion_retry",
    });
    const retryResult = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_pending_completion_retry",
    });

    expect(failedResult).toMatchObject({ error: { code: "pipeline_completion_failed" } });
    expect(retryResult).toMatchObject({
      value: {
        newlyCompletedStages: [],
        runId: "run_pending_completion_retry",
      },
    });
    expect(validationCalls).toBe(1);
    expect(stateStore.writes.at(-1)).toMatchObject({ currentStage: "completed" });
  });

  it("re-reads state between stages so handler writes are preserved", async () => {
    const stateStore = new MemoryStateStore();
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: ({ state }) => {
          stateStore.writeState({
            ...state,
            pipeline: {
              ...state.pipeline,
              handlerMarker: "preserved",
              runId: "run_preserve_handler_state",
              stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
            },
          });
          return ok(null);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_preserve_handler_state",
    });

    expect(result).toMatchObject({ value: { runId: "run_preserve_handler_state" } });
    expect(stateStore.writes.at(-1)?.pipeline?.handlerMarker).toBe("preserved");
  });

  it("applies stage transitions through updateState so stale reads do not discard handler writes", async () => {
    const stateStore = new StaleReadStateStore();
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers({
        capture: () => {
          const updated = stateStore.updateState((state) => ({
            ...state,
            pipeline: {
              ...state.pipeline,
              runId: state.pipeline?.runId ?? "run_atomic_preserve_handler_state",
              stageIds:
                state.pipeline?.stageIds ??
                selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
              handlerMarker: "preserved",
            },
          }));

          return updated.ok ? ok(null) : err(updated.error);
        },
      }),
      stateStore,
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_atomic_preserve_handler_state",
    });

    expect(result).toMatchObject({ value: { runId: "run_atomic_preserve_handler_state" } });
    expect(stateStore.current.pipeline?.handlerMarker).toBe("preserved");
  });

  it("restarts when stored plan metadata differs from the active plan", async () => {
    const deepConfig = {
      ...DEFAULT_SURFACE_CONFIG,
      evaluation: { ...DEFAULT_SURFACE_CONFIG.evaluation, depth: 5, preset: "deep" },
    } as const;
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(
        Object.fromEntries(
          selectPipelineStages(deepConfig).map((stage) => [
            stage.id,
            ({ stage: contextStage }) => {
              executed.push(contextStage.id);
              return ok(null);
            },
          ]),
        ),
      ),
      stateStore: new MemoryStateStore(
        stateWithPipelinePlan("completed", "run_plan_change", DEFAULT_SURFACE_CONFIG, 17),
      ),
    });

    const result = await orchestrator.run({
      config: deepConfig,
      runId: "run_plan_change",
    });

    expect(result).toMatchObject({ value: { runId: "run_plan_change" } });

    if (!result.ok) {
      throw new Error("expected plan-change resume to succeed");
    }

    expect(result.value.newlyCompletedStages).toEqual([
      "discovery",
      "persona",
      "routes",
      "capture",
      "heuristic",
      "accessibility",
      "visual",
      "content",
      "responsiveness",
      "cognitive-walkthrough",
      "conversion",
      "innovation",
      "synthesis",
      "validation",
    ]);
    expect(result.value.events[0]).toMatchObject({ sequence: 17, stage: "discovery" });
    expect(executed[0]).toBe("discovery");
  });

  it("rejects unknown resume stages when metadata matches the active run and plan", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new MemoryStateStore({
        currentStage: "not-a-stage",
        version: "1.0",
        pipeline: {
          activeConfig: DEFAULT_SURFACE_CONFIG,
          runId: "run_invalid_resume",
          stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
        },
      }),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_invalid_resume",
    });

    expect(result).toMatchObject({ error: { code: "invalid_resume_stage" } });
    expect(!result.ok && result.error.details?.events).toEqual([]);
  });

  it("resumes at the next active stage after a skipped stored stage", async () => {
    const executed: ExecutablePipelineStageId[] = [];
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(
        Object.fromEntries(
          selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => [
            stage.id,
            ({ stage: contextStage }) => {
              executed.push(contextStage.id);
              return ok(null);
            },
          ]),
        ),
      ),
      stateStore: new MemoryStateStore({
        currentStage: "cognitive-walkthrough",
        version: "1.0",
        pipeline: {
          activeConfig: DEFAULT_SURFACE_CONFIG,
          runId: "run_skipped_stored_stage",
          stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
        },
      }),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_skipped_stored_stage",
    });

    expect(result).toMatchObject({
      value: {
        newlyCompletedStages: ["synthesis", "validation"],
      },
    });
    expect(executed).toEqual(["synthesis", "validation"]);
  });

  it("restarts legacy currentStage snapshots without pipeline plan metadata", async () => {
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new MemoryStateStore({
        currentStage: "synthesis",
        version: "1.0",
      }),
    });

    const result = await orchestrator.run({
      config: DEFAULT_SURFACE_CONFIG,
      runId: "run_skipped_resume",
    });

    expect(result).toMatchObject({
      value: {
        newlyCompletedStages: [
          "discovery",
          "persona",
          "routes",
          "capture",
          "heuristic",
          "accessibility",
          "visual",
          "content",
          "responsiveness",
          "synthesis",
          "validation",
        ],
      },
    });
  });

  it("restarts legacy completed snapshots as a fresh run for the active plan", async () => {
    const deepConfig = {
      ...DEFAULT_SURFACE_CONFIG,
      evaluation: { ...DEFAULT_SURFACE_CONFIG.evaluation, depth: 5, preset: "deep" },
    } as const;
    const orchestrator = createPipelineOrchestrator({
      handlers: createNoopPipelineHandlers(),
      stateStore: new MemoryStateStore({
        currentStage: "completed",
        version: "1.0",
      }),
    });

    const result = await orchestrator.run({
      config: deepConfig,
      runId: "run_legacy_completed",
    });

    expect(result).toMatchObject({
      value: {
        newlyCompletedStages: [
          "discovery",
          "persona",
          "routes",
          "capture",
          "heuristic",
          "accessibility",
          "visual",
          "content",
          "responsiveness",
          "cognitive-walkthrough",
          "conversion",
          "innovation",
          "synthesis",
          "validation",
        ],
      },
    });
  });
});
