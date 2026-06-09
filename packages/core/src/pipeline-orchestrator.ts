import { z } from "zod";

import { DEFAULT_SURFACE_CONFIG, SurfaceConfigSchema, type SurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import type { ProjectStateSnapshot, StateStore } from "./interfaces.js";

/**
 * Public orchestration surface: PipelineOrchestrator, PipelineRunResult,
 * PipelineEvent, createPipelineOrchestrator, selectPipelineStages, and
 * createNoopPipelineHandlers for prototype/test wiring.
 */
const nonEmptyStringSchema = z
  .string()
  .trim()
  .min(1, { message: "must not be empty or whitespace" });

type MaybePromise<T> = T | Promise<T>;

const PIPELINE_STAGE_DEFINITION_DATA = [
  { id: "discovery", fr: "FR-PIPE-1", minDepth: 1 },
  { id: "persona", fr: "FR-PIPE-2", minDepth: 1 },
  { id: "routes", fr: "FR-PIPE-3", minDepth: 1 },
  { id: "capture", fr: "FR-PIPE-4", minDepth: 1 },
  { id: "heuristic", fr: "FR-PIPE-5", minDepth: 1 },
  { id: "accessibility", fr: "FR-PIPE-6", minDepth: 1 },
  { id: "visual", fr: "FR-PIPE-7", minDepth: 1 },
  { id: "content", fr: "FR-PIPE-8", minDepth: 1 },
  { id: "responsiveness", fr: "FR-PIPE-9", minDepth: 1 },
  { id: "cognitive-walkthrough", fr: "FR-PIPE-10", minDepth: 4 },
  {
    id: "conversion",
    fr: "FR-PIPE-11",
    minDepth: 4,
    presets: ["agent-ready", "conversion-focused", "deep"],
  },
  { id: "innovation", fr: "FR-PIPE-12", minDepth: 5, presets: ["deep"] },
  { id: "synthesis", fr: "FR-PIPE-13", minDepth: 1 },
  { id: "validation", fr: "FR-PIPE-14", minDepth: 1 },
] as const satisfies readonly {
  readonly id: string;
  readonly fr: `FR-PIPE-${number}`;
  readonly minDepth: SurfaceConfig["evaluation"]["depth"];
  readonly presets?: readonly SurfaceConfig["evaluation"]["preset"][];
}[];

const executablePipelineStageIds = PIPELINE_STAGE_DEFINITION_DATA.map((stage) => stage.id) as [
  (typeof PIPELINE_STAGE_DEFINITION_DATA)[number]["id"],
  ...(typeof PIPELINE_STAGE_DEFINITION_DATA)[number]["id"][],
];

export const ExecutablePipelineStageIdSchema = z.enum(executablePipelineStageIds);
export type ExecutablePipelineStageId = z.infer<typeof ExecutablePipelineStageIdSchema>;

export const PipelineStageIdSchema = z.enum([
  ...ExecutablePipelineStageIdSchema.options,
  "pending-completion",
  "completed",
]);
export type PipelineStageId = z.infer<typeof PipelineStageIdSchema>;

const PipelineStateMetadataSchema = z
  .object({
    activeConfig: SurfaceConfigSchema.optional(),
    lastCompletedStage: ExecutablePipelineStageIdSchema.optional(),
    nextEventSequence: z.number().int().nonnegative().optional(),
    runId: nonEmptyStringSchema,
    stageIds: z.array(ExecutablePipelineStageIdSchema),
  })
  .passthrough();
type PipelineStateMetadata = z.infer<typeof PipelineStateMetadataSchema>;

const PipelineEventStageSchema = z.union([
  ExecutablePipelineStageIdSchema,
  z.literal("finalization"),
]);
type PipelineEventStage = z.infer<typeof PipelineEventStageSchema>;

export const PipelineEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("StageAdvanced"),
      runId: nonEmptyStringSchema,
      stage: PipelineEventStageSchema,
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("StageSkipped"),
      runId: nonEmptyStringSchema,
      stage: PipelineEventStageSchema,
      reason: z.string(),
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("AuditRunFailed"),
      runId: nonEmptyStringSchema,
      stage: PipelineEventStageSchema,
      message: z.string(),
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("AuditRunCompleted"),
      runId: nonEmptyStringSchema,
      sequence: z.number().int().nonnegative(),
    })
    .strict(),
]);
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export type PipelineStageDefinition = {
  readonly id: ExecutablePipelineStageId;
  readonly fr: `FR-PIPE-${number}`;
  readonly minDepth: SurfaceConfig["evaluation"]["depth"];
  readonly presets?: readonly SurfaceConfig["evaluation"]["preset"][];
};

export type PipelineStageContext = {
  readonly runId: string;
  readonly stage: PipelineStageDefinition;
  readonly config: SurfaceConfig;
  readonly state: ProjectStateSnapshot;
};

export type PipelineStageHandler = (
  context: PipelineStageContext,
) => MaybePromise<Result<unknown, SurfaceError>>;

export type PipelineOrchestratorOptions = {
  readonly stateStore: StateStore;
  readonly handlers: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>>;
};

export type PipelineRunInput = {
  readonly runId: string;
  readonly config?: SurfaceConfig;
};

export type PipelineRunResult = {
  readonly runId: string;
  readonly newlyCompletedStages: readonly ExecutablePipelineStageId[];
  readonly skippedStages: readonly {
    readonly stage: ExecutablePipelineStageId;
    readonly reason: string;
  }[];
  readonly events: readonly PipelineEvent[];
};

export interface PipelineOrchestrator {
  /**
   * Resume behavior is driven by matching pipeline metadata for the same run and
   * stage plan. Legacy states without metadata, or states from a different plan,
   * restart the active plan from the beginning. Project state stores one active
   * pipeline run at a time; starting a different runId overwrites prior pipeline
   * metadata rather than preserving concurrent run progress. Callers must
   * serialize run() calls per runId; this orchestrator does not provide locking
   * or compare-and-swap protection around StateStore read/write cycles.
   * Pre-stage write failures happen before metadata can reserve a sequence, so
   * those retries intentionally restart event numbering from the last durable
   * metadata snapshot.
   */
  run(input: PipelineRunInput): Promise<Result<PipelineRunResult, SurfaceError>>;
}

export const DEFAULT_PIPELINE_STAGE_DEFINITIONS =
  PIPELINE_STAGE_DEFINITION_DATA satisfies readonly PipelineStageDefinition[];

const DEFAULT_EXECUTABLE_STAGE_IDS = DEFAULT_PIPELINE_STAGE_DEFINITIONS.map((stage) => stage.id);

type PipelinePlan = {
  readonly stages: readonly PipelineStageDefinition[];
  readonly skippedStages: readonly {
    readonly stage: ExecutablePipelineStageId;
    readonly reason: string;
  }[];
};

/** Select the executable pipeline stages for the configured depth and preset. */
export function selectPipelineStages(
  config: SurfaceConfig = DEFAULT_SURFACE_CONFIG,
): readonly PipelineStageDefinition[] {
  return selectPipelinePlan(config).stages;
}

/** Create explicit no-op handlers for tests and metadata-only prototype wiring. */
export function createNoopPipelineHandlers(
  overrides: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>> = {},
): Record<ExecutablePipelineStageId, PipelineStageHandler> {
  const handlers: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>> = {};

  for (const stageId of DEFAULT_EXECUTABLE_STAGE_IDS) {
    handlers[stageId] = () => ok(null);
  }

  return { ...handlers, ...overrides } as Record<ExecutablePipelineStageId, PipelineStageHandler>;
}

/** Create a stateless orchestrator with metadata-backed resume semantics. */
export function createPipelineOrchestrator(
  options: PipelineOrchestratorOptions,
): PipelineOrchestrator {
  return {
    run: async (input) => runPipeline(options.stateStore, options.handlers, input),
  };
}

async function runPipeline(
  stateStore: StateStore,
  handlers: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>>,
  input: PipelineRunInput,
): Promise<Result<PipelineRunResult, SurfaceError>> {
  const parsedRunId = nonEmptyStringSchema.safeParse(input.runId);

  if (!parsedRunId.success) {
    return err(
      createSurfaceError("invalid_run_id", "Pipeline run id is invalid.", {
        cause: parsedRunId.error,
        details: { events: [] },
      }),
    );
  }

  const parsedConfig = SurfaceConfigSchema.safeParse(input.config ?? DEFAULT_SURFACE_CONFIG);

  if (!parsedConfig.success) {
    return err(
      createSurfaceError("config_invalid", "Pipeline configuration is invalid.", {
        cause: parsedConfig.error,
        details: { events: [] },
      }),
    );
  }

  const events: PipelineEvent[] = [];
  const initialState = await stateStore.readState();

  if (!isOk(initialState)) {
    return err(
      createSurfaceError("state_read_failed", "Pipeline state read failed.", {
        cause: initialState.error,
        details: { events },
      }),
    );
  }

  const plan = selectPipelinePlan(parsedConfig.data);

  if (plan.stages.length === 0) {
    return err(
      createSurfaceError("config_invalid", "Pipeline configuration selected no stages.", {
        details: { events },
      }),
    );
  }

  const sequence = new PipelineSequenceTracker(
    initialEventSequenceFor(initialState.value, parsedRunId.data),
  );
  const resumeIndex = resumeIndexFor(
    initialState.value,
    parsedRunId.data,
    plan.stages,
    parsedConfig.data,
  );
  const freshRun = !hasMatchingPipelineMetadata(
    initialState.value,
    parsedRunId.data,
    plan.stages,
    parsedConfig.data,
  );

  if (!resumeIndex.ok) {
    return err(withEventDetails(resumeIndex.error, events));
  }

  // Skipped-stage events are emitted once for a run. Matching pipeline metadata
  // means prior invocations have already assigned sequence numbers for them.
  if (freshRun) {
    for (const skipped of plan.skippedStages) {
      events.push(
        PipelineEventSchema.parse({
          type: "StageSkipped",
          runId: parsedRunId.data,
          stage: skipped.stage,
          reason: skipped.reason,
          sequence: sequence.emit(),
        }),
      );
    }
  }

  if (resumeIndex.value === "already-completed") {
    events.push(
      PipelineEventSchema.parse({
        type: "AuditRunCompleted",
        runId: parsedRunId.data,
        sequence: sequence.lastEmittedOrZero(),
      }),
    );

    return ok({
      runId: parsedRunId.data,
      newlyCompletedStages: [],
      skippedStages: plan.skippedStages,
      events,
    });
  }

  const stagesToRun =
    resumeIndex.value === "pending-completion" ? [] : plan.stages.slice(resumeIndex.value);
  const missingHandlers = stagesToRun
    .filter((stage) => handlers[stage.id] === undefined)
    .map((stage) => stage.id);

  if (missingHandlers.length > 0) {
    const firstMissing = missingHandlers[0]!;

    // Missing handlers are config-level failures before any state write occurs;
    // their events are transient diagnostics and are not sequence-reserved.
    events.push(
      PipelineEventSchema.parse({
        type: "AuditRunFailed",
        runId: parsedRunId.data,
        stage: firstMissing,
        message: `Pipeline stage ${firstMissing} has no registered handler.`,
        sequence: sequence.current,
      }),
    );

    return err(
      createSurfaceError("config_invalid", "Pipeline handlers are missing for selected stages.", {
        details: { missingHandlers, events },
      }),
    );
  }

  const newlyCompletedStages: ExecutablePipelineStageId[] = [];

  for (const stage of stagesToRun) {
    const stateWrite = await updatePipelineState(stateStore, (state) =>
      stateWithPipelineMetadata(
        state,
        stage.id,
        parsedRunId.data,
        plan.stages,
        sequence.nextAfterFailureSlot(),
        parsedConfig.data,
      ),
    );

    if (!isOk(stateWrite)) {
      return failWithAuditEvent({
        cause: stateWrite.error,
        code: "step_failed",
        errorMessage: `Pipeline stage ${stage.id} failed.`,
        events,
        message: stateWrite.error.message,
        runId: parsedRunId.data,
        sequence: sequence.current,
        stage: stage.id,
      });
    }

    events.push(
      PipelineEventSchema.parse({
        type: "StageAdvanced",
        runId: parsedRunId.data,
        stage: stage.id,
        sequence: sequence.emit(),
      }),
    );

    let stageResult: Result<unknown, SurfaceError>;

    try {
      stageResult = await handlers[stage.id]!({
        runId: parsedRunId.data,
        stage,
        config: parsedConfig.data,
        state: stateWrite.value,
      });
    } catch (error) {
      return failWithAuditEvent({
        cause: error,
        code: "step_failed",
        errorMessage: `Pipeline stage ${stage.id} failed.`,
        events,
        message: messageForThrownError(error),
        runId: parsedRunId.data,
        sequence: sequence.current,
        stage: stage.id,
      });
    }

    if (!isOk(stageResult)) {
      return failWithAuditEvent({
        cause: stageResult.error,
        code: "step_failed",
        errorMessage: `Pipeline stage ${stage.id} failed.`,
        events,
        message: stageResult.error.message,
        runId: parsedRunId.data,
        sequence: sequence.current,
        stage: stage.id,
      });
    }

    const stageCompletionWrite = await updatePipelineState(stateStore, (state) =>
      stateWithCompletedStageMetadata(
        state,
        stage.id,
        parsedRunId.data,
        plan.stages,
        sequence.current,
        parsedConfig.data,
      ),
    );

    if (!isOk(stageCompletionWrite)) {
      return failWithAuditEvent({
        cause: stageCompletionWrite.error,
        code: "step_failed",
        errorMessage: `Pipeline stage ${stage.id} failed.`,
        events,
        message: stageCompletionWrite.error.message,
        runId: parsedRunId.data,
        sequence: sequence.current,
        stage: stage.id,
      });
    }

    newlyCompletedStages.push(stage.id);
  }

  if (resumeIndex.value !== "pending-completion") {
    const pendingWrite = await updatePipelineState(stateStore, (state) =>
      stateWithPipelineMetadata(
        state,
        "pending-completion",
        parsedRunId.data,
        plan.stages,
        sequence.nextAfterCurrent(),
        parsedConfig.data,
      ),
    );

    if (!isOk(pendingWrite)) {
      return failWithAuditEvent({
        cause: pendingWrite.error,
        code: "pipeline_completion_failed",
        errorMessage: "Pipeline completion failed.",
        events,
        message: pendingWrite.error.message,
        runId: parsedRunId.data,
        sequence: sequence.current,
        stage: "finalization",
      });
    }
  }

  const completedWrite = await updatePipelineState(stateStore, (state) =>
    stateWithPipelineMetadata(
      state,
      "completed",
      parsedRunId.data,
      plan.stages,
      sequence.nextAfterCurrent(),
      parsedConfig.data,
    ),
  );

  if (!isOk(completedWrite)) {
    return failWithAuditEvent({
      cause: completedWrite.error,
      code: "pipeline_completion_failed",
      errorMessage: "Pipeline completion failed.",
      events,
      message: completedWrite.error.message,
      runId: parsedRunId.data,
      sequence: sequence.current,
      stage: "finalization",
    });
  }

  events.push(
    PipelineEventSchema.parse({
      type: "AuditRunCompleted",
      runId: parsedRunId.data,
      sequence: sequence.emit(),
    }),
  );

  return ok({
    runId: parsedRunId.data,
    newlyCompletedStages,
    skippedStages: plan.skippedStages,
    events,
  });
}

async function updatePipelineState(
  stateStore: StateStore,
  updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot,
): Promise<Result<ProjectStateSnapshot, SurfaceError>> {
  if (stateStore.updateState !== undefined) {
    return await stateStore.updateState(updater);
  }

  const current = await stateStore.readState();

  if (!isOk(current)) {
    return current;
  }

  return await stateStore.writeState(updater(current.value));
}

function selectPipelinePlan(config: SurfaceConfig): PipelinePlan {
  const stageDefinitions: readonly PipelineStageDefinition[] = DEFAULT_PIPELINE_STAGE_DEFINITIONS;
  const stages: PipelineStageDefinition[] = [];
  const skippedStages: {
    readonly stage: ExecutablePipelineStageId;
    readonly reason: string;
  }[] = [];

  for (const stage of stageDefinitions) {
    const includedByDepth = config.evaluation.depth >= stage.minDepth;
    const includedByPreset = stage.presets?.includes(config.evaluation.preset) ?? false;

    if (includedByDepth || includedByPreset) {
      stages.push(stage);
    } else {
      skippedStages.push({
        stage: stage.id,
        reason:
          stage.presets === undefined
            ? `requires depth ${stage.minDepth}`
            : `requires depth ${stage.minDepth} or preset ${stage.presets.join("|")}`,
      });
    }
  }

  return { stages, skippedStages };
}

/**
 * Resume decision table:
 * - no matching metadata, missing metadata, or a changed plan restarts at 0
 * - completed and pending-completion are terminal/finalization sentinels
 * - lastCompletedStage matching currentStage resumes at the next active stage
 * - otherwise currentStage is the next stage to execute
 *
 * Returned events from run() contain only events newly generated by that call,
 * plus a terminal AuditRunCompleted for the already-completed fast path.
 */
function resumeIndexFor(
  state: ProjectStateSnapshot,
  runId: string,
  stages: readonly PipelineStageDefinition[],
  config: SurfaceConfig,
): Result<number | "already-completed" | "pending-completion", SurfaceError> {
  const currentStage = state.currentStage;
  const stateMetadata = pipelineStateMetadataFor(state);
  const planStageIds = stages.map((stage) => stage.id);
  const statePlanChanged =
    stateMetadata !== undefined &&
    (stateMetadata.runId !== runId ||
      !sameStagePlan(stateMetadata.stageIds, planStageIds) ||
      !sameActiveConfig(stateMetadata.activeConfig, config));

  if (currentStage === undefined || stateMetadata === undefined || statePlanChanged) {
    return ok(0);
  }

  if (currentStage === "completed") {
    return ok("already-completed");
  }

  if (currentStage === "pending-completion") {
    return ok("pending-completion");
  }

  const parsedStage = ExecutablePipelineStageIdSchema.safeParse(currentStage);

  if (!parsedStage.success) {
    return err(
      createSurfaceError(
        "invalid_resume_stage",
        `Cannot resume unknown pipeline stage: ${currentStage}.`,
        {
          cause: parsedStage.error,
        },
      ),
    );
  }

  if (stateMetadata.lastCompletedStage === parsedStage.data) {
    const nextStageIndex = nextActiveStageIndexAfter(parsedStage.data, stages);

    return nextStageIndex === undefined ? ok("pending-completion") : ok(nextStageIndex);
  }

  const stageIndex = stages.findIndex((stage) => stage.id === parsedStage.data);

  if (stageIndex !== -1) {
    return ok(stageIndex);
  }

  const nextStageIndex = nextActiveStageIndexAfter(parsedStage.data, stages);

  return nextStageIndex === undefined ? ok("already-completed") : ok(nextStageIndex);
}

function pipelineStateMetadataFor(state: ProjectStateSnapshot): PipelineStateMetadata | undefined {
  const parsedMetadata = PipelineStateMetadataSchema.safeParse(state.pipeline);

  return parsedMetadata.success ? parsedMetadata.data : undefined;
}

/**
 * Metadata stores the next unused event sequence for a runId. A changed plan
 * restarts stage execution, but keeps the sequence monotonic for the same run.
 */
function initialEventSequenceFor(state: ProjectStateSnapshot, runId: string): number {
  const stateMetadata = pipelineStateMetadataFor(state);

  if (stateMetadata === undefined || stateMetadata.runId !== runId) {
    return 0;
  }

  return stateMetadata.nextEventSequence ?? 0;
}

/** True only when metadata belongs to the same run and exact executable plan. */
function hasMatchingPipelineMetadata(
  state: ProjectStateSnapshot,
  runId: string,
  stages: readonly PipelineStageDefinition[],
  config: SurfaceConfig,
): boolean {
  const stateMetadata = pipelineStateMetadataFor(state);

  return (
    stateMetadata !== undefined &&
    stateMetadata.runId === runId &&
    sameActiveConfig(stateMetadata.activeConfig, config) &&
    sameStagePlan(
      stateMetadata.stageIds,
      stages.map((stage) => stage.id),
    )
  );
}

function stateWithPipelineMetadata(
  state: ProjectStateSnapshot,
  currentStage: PipelineStageId,
  runId: string,
  stages: readonly PipelineStageDefinition[],
  nextEventSequence: number,
  config: SurfaceConfig,
): ProjectStateSnapshot & { readonly pipeline: PipelineStateMetadata } {
  const pipeline = pipelineWithoutCompletionMarker(state);

  return {
    ...state,
    currentStage,
    pipeline: {
      ...pipeline,
      activeConfig: config,
      nextEventSequence,
      runId,
      stageIds: stages.map((stage) => stage.id),
    },
  };
}

function stateWithCompletedStageMetadata(
  state: ProjectStateSnapshot,
  completedStage: ExecutablePipelineStageId,
  runId: string,
  stages: readonly PipelineStageDefinition[],
  nextEventSequence: number,
  config: SurfaceConfig,
): ProjectStateSnapshot & { readonly pipeline: PipelineStateMetadata } {
  const base = stateWithPipelineMetadata(
    state,
    completedStage,
    runId,
    stages,
    nextEventSequence,
    config,
  );

  return {
    ...base,
    pipeline: {
      ...base.pipeline,
      lastCompletedStage: completedStage,
    },
  };
}

function pipelineWithoutCompletionMarker(state: ProjectStateSnapshot): Record<string, unknown> {
  const pipeline: Record<string, unknown> =
    state.pipeline === undefined ? {} : { ...state.pipeline };

  delete pipeline.lastCompletedStage;

  return pipeline;
}

function failWithAuditEvent(args: {
  readonly cause: unknown;
  readonly code: "step_failed" | "pipeline_completion_failed";
  readonly errorMessage: string;
  readonly events: PipelineEvent[];
  readonly message: string;
  readonly runId: string;
  readonly sequence: number;
  readonly stage: PipelineEventStage;
}): Result<never, SurfaceError> {
  args.events.push(
    PipelineEventSchema.parse({
      type: "AuditRunFailed",
      runId: args.runId,
      stage: args.stage,
      message: args.message,
      sequence: args.sequence,
    }),
  );

  return err(
    createSurfaceError(args.code, args.errorMessage, {
      cause: args.cause,
      details: { stage: args.stage, events: args.events },
    }),
  );
}

function messageForThrownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

class PipelineSequenceTracker {
  constructor(private nextSequence: number) {}

  get current(): number {
    return this.nextSequence;
  }

  emit(): number {
    const emitted = this.nextSequence;
    this.nextSequence += 1;
    return emitted;
  }

  nextAfterCurrent(): number {
    return this.nextSequence + 1;
  }

  nextAfterFailureSlot(): number {
    return this.nextSequence + 2;
  }

  lastEmittedOrZero(): number {
    return Math.max(this.nextSequence - 1, 0);
  }
}

function sameStagePlan(
  left: readonly ExecutablePipelineStageId[],
  right: readonly ExecutablePipelineStageId[],
): boolean {
  return left.length === right.length && left.every((stageId, index) => stageId === right[index]);
}

function sameActiveConfig(
  storedConfig: SurfaceConfig | undefined,
  activeConfig: SurfaceConfig,
): boolean {
  if (storedConfig === undefined) {
    return true;
  }

  return JSON.stringify(storedConfig) === JSON.stringify(activeConfig);
}

function nextActiveStageIndexAfter(
  currentStage: ExecutablePipelineStageId,
  stages: readonly PipelineStageDefinition[],
): number | undefined {
  const currentOrderIndex = DEFAULT_EXECUTABLE_STAGE_IDS.indexOf(currentStage);
  const nextIndex = stages.findIndex(
    (stage) => DEFAULT_EXECUTABLE_STAGE_IDS.indexOf(stage.id) > currentOrderIndex,
  );

  return nextIndex === -1 ? undefined : nextIndex;
}

function withEventDetails(error: SurfaceError, events: readonly PipelineEvent[]): SurfaceError {
  return createSurfaceError(error.code, error.message, {
    cause: error.cause,
    details: { ...error.details, events },
  });
}
