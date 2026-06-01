#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  DEFAULT_COMPOSITION_STAGE_IDS,
  DEFAULT_SURFACE_CONFIG,
  DepthSchema,
  PresetSchema,
  createSurfaceComposition,
  createSurfaceError,
  exitCodeForSurfaceError,
  toCliErrorEnvelope,
} from "@surface/core";
import { Command, CommanderError } from "commander";

type CliExitCode = 0 | 1 | 2;
type SurfaceError = ReturnType<typeof createSurfaceError>;
type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SurfaceError };
type SurfaceConfig = typeof DEFAULT_SURFACE_CONFIG;
type ExecutablePipelineStageId = (typeof DEFAULT_COMPOSITION_STAGE_IDS)[number];
type SurfaceCompositionOptions = NonNullable<Parameters<typeof createSurfaceComposition>[0]>;
type CoreSurfaceComposition = ReturnType<typeof createSurfaceComposition>;
type MaybePromise<T> = T | Promise<T>;
type Target = {
  readonly kind: "url" | "localhost" | "route" | "screenshot" | "component" | "dom";
  readonly ref: string;
};
type CaptureArtifact = {
  readonly id: string;
  readonly type: string;
  readonly path: string;
  readonly redacted: boolean;
};
type Capture = {
  readonly id: string;
  readonly backend: string;
  readonly artifacts: readonly CaptureArtifact[];
  readonly degradation?: {
    readonly skippedArtifacts: readonly string[];
    readonly skippedReason: string;
  };
};
type ProjectStateSnapshot = {
  readonly version: string;
  readonly currentStage?: string;
  readonly pipeline?: {
    readonly lastCompletedStage?: string | undefined;
  };
};
type SurfaceComposition = {
  readonly captureService: {
    capture(
      target: Target,
      options: {
        readonly config: SurfaceConfig["capture"];
        readonly authStateRef?: string;
      },
    ): Promise<Result<Capture>>;
  };
  readonly lensRegistry: readonly {
    readonly id: string;
  }[];
  readonly pipelineOrchestrator: {
    run(input: { readonly config: SurfaceConfig; readonly runId: string }): Promise<
      Result<{
        readonly runId: string;
      }>
    >;
  };
  readonly stateStore: {
    readState(): MaybePromise<Result<ProjectStateSnapshot>>;
    writeState(state: ProjectStateSnapshot): MaybePromise<Result<ProjectStateSnapshot>>;
  };
};

export type CliEnvelope<T> =
  | {
      readonly ok: true;
      readonly command: string;
      readonly schemaVersion: "1.0";
      readonly data: T;
    }
  | {
      readonly ok: false;
      readonly command: string;
      readonly schemaVersion: "1.0";
      readonly error: {
        readonly code: SurfaceError["code"];
        readonly kind: SurfaceError["kind"];
        readonly message: string;
        readonly exitCode: CliExitCode;
        readonly whatFailed: string;
        readonly likelyCause: string;
        readonly nextCommand: string;
        readonly details?: Record<string, unknown>;
      };
    };

export type SurfaceCliIo = {
  readonly stdout?: (chunk: string) => void;
  readonly stderr?: (chunk: string) => void;
};

export type RunSurfaceCliOptions = SurfaceCompositionOptions & {
  readonly argv?: readonly string[];
  readonly composition?: CoreSurfaceComposition | SurfaceComposition;
  readonly io?: SurfaceCliIo;
};

type StatusOutput = {
  readonly progress: {
    readonly hasPipeline: boolean;
  };
  readonly currentStage: string;
  readonly runHistory: readonly unknown[];
};
type InitOutput = {
  readonly stateDir: string;
  readonly config: SurfaceConfig;
};
type RunOutput = {
  readonly runId: string;
  readonly stage: string;
  readonly status: "completed";
};
type NextOutput = {
  readonly eligible: readonly string[];
};
type CaptureOutput = {
  readonly captureId: string;
  readonly backend: string;
  readonly artifacts: Capture["artifacts"];
  readonly degradation?: Capture["degradation"];
};
type AuditOutput = {
  readonly runId: string;
  readonly findingCount: number;
  readonly backlogId: string;
  readonly topFinding?: unknown;
};
type ConfigCommandOptions = {
  readonly preset?: string;
  readonly depth?: string;
};
type TargetCommandOptions = ConfigCommandOptions & {
  readonly all?: boolean;
  readonly authState?: string;
  readonly component?: string;
  readonly dom?: string;
  readonly localhost?: string | boolean;
  readonly persona?: string;
  readonly route?: string;
  readonly screenshot?: string;
  readonly task?: string;
  readonly url?: string;
};

const CLI_SCHEMA_VERSION = "1.0";
const DEFAULT_STATE_DIR = ".surface";
const DEFAULT_LOCALHOST_TARGET = "http://localhost:3000";

export async function runSurfaceCli(options: RunSurfaceCliOptions = {}): Promise<CliExitCode> {
  const composition = options.composition ?? createSurfaceComposition(options);
  const io = options.io ?? {};
  const program = createSurfaceCliProgram({ composition, io });

  try {
    await program.parseAsync([...(options.argv ?? process.argv)], { from: "node" });

    return 0;
  } catch (cause) {
    if (cause instanceof CliHandledError) {
      return cause.exitCode;
    }

    const error = surfaceErrorForThrown(cause);
    const command = commandNameFor(program, options.argv ?? process.argv);
    const exitCode = exitCodeForSurfaceError(error);

    writeEnvelope(
      io.stderr ?? ((chunk) => process.stderr.write(chunk)),
      errorEnvelope(command, error, exitCode),
    );

    return exitCode;
  }
}

export function createSurfaceCliProgram(input: {
  readonly composition: SurfaceComposition;
  readonly io?: SurfaceCliIo;
}): Command {
  const program = new Command();
  const io = input.io ?? {};

  program
    .name("surface")
    .description("Audit running UIs and produce agent-readable findings.")
    .version("0.0.0")
    .exitOverride()
    .configureOutput({
      writeErr: (chunk) => {
        if (!program.opts<{ json?: boolean }>().json) {
          (io.stderr ?? ((value) => process.stderr.write(value)))(chunk);
        }
      },
      writeOut: (chunk) => (io.stdout ?? ((value) => process.stdout.write(value)))(chunk),
    })
    .option("--json", "emit machine-readable JSON")
    .option("--verbose", "emit verbose human output");

  program
    .command("init")
    .description("Initialize Surface project state.")
    .option("--preset <preset>", "evaluation preset")
    .option("--depth <depth>", "evaluation depth, 1-5")
    .option("--force", "reinitialize state")
    .action(async (options: ConfigCommandOptions) => {
      const result = await initializeProject(input.composition, options);

      emitResult({
        command: "init",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("status")
    .description("Read Surface project status.")
    .action(async () => {
      const result = await readStatus(input.composition);

      emitResult({
        command: "status",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("run")
    .description("Run a Surface pipeline step or the full pipeline.")
    .argument("<step>", "pipeline stage id or all")
    .option("--preset <preset>", "evaluation preset")
    .option("--depth <depth>", "evaluation depth, 1-5")
    .action(async (step: string, options: ConfigCommandOptions) => {
      const result = await runPipelineStep(input.composition, step, options);

      emitResult({
        command: "run",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("next")
    .description("List eligible Surface pipeline steps.")
    .action(async () => {
      const result = await readNext(input.composition);

      emitResult({
        command: "next",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  addTargetOptions(
    program.command("capture").description("Observe a UI target and emit capture metadata."),
  ).action(async (options: TargetCommandOptions) => {
    const result = await captureTarget(input.composition, options);

    emitResult({
      command: "capture",
      io,
      json: program.opts<{ json?: boolean }>().json === true,
      result,
    });
  });

  addTargetOptions(
    program
      .command("audit")
      .description("Capture a target and synthesize finding/backlog metadata.")
      .argument("[lens]", "optional lens id"),
  )
    .option("--all", "include all findings in human output")
    .action(async (lens: string | undefined, options: TargetCommandOptions) => {
      const result = await auditTarget(input.composition, lens, options);

      emitResult({
        command: "audit",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  return program;
}

function addTargetOptions(command: Command): Command {
  return command
    .option("--url <url>", "capture an absolute URL")
    .option("--localhost [url]", "capture a local development URL")
    .option("--route <route>", "capture an application route")
    .option("--screenshot <path>", "capture from a screenshot file")
    .option("--component <name>", "capture a component reference")
    .option("--dom <html>", "capture from a DOM snapshot string")
    .option("--auth-state <path>", "inject browser auth state before navigation")
    .option("--persona <persona>", "persona context for the audit")
    .option("--task <task>", "task context for the audit")
    .option("--preset <preset>", "evaluation preset")
    .option("--depth <depth>", "evaluation depth, 1-5");
}

async function initializeProject(
  composition: SurfaceComposition,
  options: ConfigCommandOptions,
): Promise<Result<InitOutput>> {
  const config = configFromOptions(options);

  if (!isResultOk(config)) {
    return config;
  }

  const state = await composition.stateStore.writeState({
    currentStage: "initialized",
    version: "1.0",
  });

  if (!isResultOk(state)) {
    return state;
  }

  return resultOk({
    config: config.value,
    stateDir: DEFAULT_STATE_DIR,
  });
}

async function readStatus(composition: SurfaceComposition): Promise<Result<StatusOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  return {
    ok: true,
    value: {
      currentStage: state.value.currentStage ?? state.value.pipeline?.lastCompletedStage ?? "new",
      progress: { hasPipeline: state.value.pipeline !== undefined },
      runHistory: [],
    },
  };
}

async function runPipelineStep(
  composition: SurfaceComposition,
  step: string,
  options: ConfigCommandOptions,
): Promise<Result<RunOutput>> {
  if (step !== "all" && !isExecutableStageId(step)) {
    return resultErr(
      createSurfaceError("unknown_step", `Unknown pipeline step "${step}".`, {
        details: { step },
      }),
    );
  }

  const config = configFromOptions(options);

  if (!isResultOk(config)) {
    return config;
  }

  const runId = nextCliRunId();
  const run = await composition.pipelineOrchestrator.run({ config: config.value, runId });

  if (!isResultOk(run)) {
    return resultErr(
      createSurfaceError("step_failed", `Surface run ${runId} failed.`, {
        cause: run.error,
        details: { runId, stage: step },
      }),
    );
  }

  return resultOk({
    runId: run.value.runId,
    stage: step,
    status: "completed",
  });
}

async function readNext(composition: SurfaceComposition): Promise<Result<NextOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const lastCompletedStage = state.value.pipeline?.lastCompletedStage;
  const eligible =
    lastCompletedStage === undefined
      ? ["run discovery", "run all"]
      : eligibleStagesAfter(lastCompletedStage).map((stage) => `run ${stage}`);

  return resultOk({ eligible });
}

async function captureTarget(
  composition: SurfaceComposition,
  options: TargetCommandOptions,
): Promise<Result<CaptureOutput>> {
  const target = targetFromOptions(options);

  if (!isResultOk(target)) {
    return target;
  }

  const capture = await composition.captureService.capture(target.value, {
    config: DEFAULT_SURFACE_CONFIG.capture,
    ...(options.authState === undefined ? {} : { authStateRef: options.authState }),
  });

  if (!isResultOk(capture)) {
    return capture;
  }

  return resultOk(captureOutput(capture.value));
}

async function auditTarget(
  composition: SurfaceComposition,
  lens: string | undefined,
  options: TargetCommandOptions,
): Promise<Result<AuditOutput>> {
  if (lens !== undefined && !inputLensExists(composition, lens)) {
    return resultErr(
      createSurfaceError("unknown_lens", `Unknown audit lens "${lens}".`, {
        details: { lens },
      }),
    );
  }

  const target = targetFromOptions(options);

  if (!isResultOk(target)) {
    return target;
  }

  const config = configFromOptions(options);

  if (!isResultOk(config)) {
    return config;
  }

  const capture = await composition.captureService.capture(target.value, {
    config: config.value.capture,
    ...(options.authState === undefined ? {} : { authStateRef: options.authState }),
  });

  if (!isResultOk(capture)) {
    return capture;
  }

  const runId = nextCliRunId();

  return resultOk({
    backlogId: `backlog_${runId}`,
    findingCount: 0,
    runId,
  });
}

function emitResult<T>(input: {
  readonly command: string;
  readonly io: SurfaceCliIo;
  readonly json: boolean;
  readonly result: Result<T>;
}): void {
  const write = input.result.ok ? input.io.stdout : input.io.stderr;
  const fallback = input.result.ok
    ? (chunk: string) => process.stdout.write(chunk)
    : (chunk: string) => process.stderr.write(chunk);
  const sink = write ?? fallback;

  if (input.result.ok) {
    const envelope = successEnvelope(input.command, input.result.value);
    sink(
      input.json ? `${JSON.stringify(envelope)}\n` : humanizeSuccess(input.command, envelope.data),
    );

    return;
  }

  const exitCode = exitCodeForSurfaceError(input.result.error);
  sink(JSON.stringify(errorEnvelope(input.command, input.result.error, exitCode)) + "\n");
  throw new CliHandledError(exitCode);
}

function resultOk<T>(value: T): Result<T> {
  return { ok: true, value };
}

function resultErr(error: SurfaceError): Result<never> {
  return { error, ok: false };
}

function isResultOk<T>(result: Result<T>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

function successEnvelope<T>(command: string, data: T): Extract<CliEnvelope<T>, { ok: true }> {
  return {
    command,
    data,
    ok: true,
    schemaVersion: CLI_SCHEMA_VERSION,
  };
}

function errorEnvelope(
  command: string,
  error: SurfaceError,
  exitCode: CliExitCode,
): CliEnvelope<never> {
  const coreEnvelope = toCliErrorEnvelope(command, error);

  return {
    command,
    error: {
      code: coreEnvelope.error.code,
      exitCode,
      kind: coreEnvelope.error.kind,
      likelyCause: likelyCauseFor(error),
      message: coreEnvelope.error.message,
      nextCommand: nextCommandFor(error),
      whatFailed: whatFailedFor(command, error),
      ...(coreEnvelope.error.details === undefined ? {} : { details: coreEnvelope.error.details }),
    },
    ok: false,
    schemaVersion: CLI_SCHEMA_VERSION,
  };
}

function writeEnvelope(write: (chunk: string) => void, envelope: CliEnvelope<never>): void {
  write(`${JSON.stringify(envelope)}\n`);
}

function humanizeSuccess<T>(command: string, data: T): string {
  return `surface ${command}: ${JSON.stringify(data)}\n`;
}

function configFromOptions(options: ConfigCommandOptions): Result<SurfaceConfig> {
  const preset =
    options.preset === undefined ? DEFAULT_SURFACE_CONFIG.evaluation.preset : options.preset;
  const parsedPreset = PresetSchema.safeParse(preset);

  if (!parsedPreset.success) {
    return resultErr(
      createSurfaceError("config_invalid", `Unknown evaluation preset "${preset}".`, {
        cause: parsedPreset.error,
        details: { preset },
      }),
    );
  }

  const depth =
    options.depth === undefined
      ? DEFAULT_SURFACE_CONFIG.evaluation.depth
      : Number.parseInt(options.depth, 10);
  const parsedDepth = DepthSchema.safeParse(depth);

  if (!parsedDepth.success) {
    return resultErr(
      createSurfaceError("config_invalid", "Evaluation depth must be an integer from 1 to 5.", {
        cause: parsedDepth.error,
        details: { depth: options.depth },
      }),
    );
  }

  return resultOk({
    ...DEFAULT_SURFACE_CONFIG,
    evaluation: {
      ...DEFAULT_SURFACE_CONFIG.evaluation,
      depth: parsedDepth.data,
      preset: parsedPreset.data,
    },
  });
}

function targetFromOptions(options: TargetCommandOptions): Result<Target> {
  if (options.url !== undefined) {
    return resultOk({ kind: "url", ref: options.url });
  }

  if (options.localhost !== undefined) {
    return resultOk({
      kind: "localhost",
      ref: typeof options.localhost === "string" ? options.localhost : DEFAULT_LOCALHOST_TARGET,
    });
  }

  if (options.route !== undefined) {
    return resultOk({ kind: "route", ref: options.route });
  }

  if (options.screenshot !== undefined) {
    return resultOk({ kind: "screenshot", ref: options.screenshot });
  }

  if (options.component !== undefined) {
    return resultOk({ kind: "component", ref: options.component });
  }

  if (options.dom !== undefined) {
    return resultOk({ kind: "dom", ref: options.dom });
  }

  return resultErr(
    createSurfaceError(
      "no_target",
      "No target given. Pass --url, --localhost, --route, --screenshot, --component, or --dom.",
    ),
  );
}

function captureOutput(capture: Capture): CaptureOutput {
  return {
    artifacts: capture.artifacts,
    backend: capture.backend,
    captureId: capture.id,
    ...(capture.degradation === undefined ? {} : { degradation: capture.degradation }),
  };
}

function isExecutableStageId(step: string): step is ExecutablePipelineStageId {
  return DEFAULT_COMPOSITION_STAGE_IDS.includes(step as ExecutablePipelineStageId);
}

function eligibleStagesAfter(lastCompletedStage: string): readonly ExecutablePipelineStageId[] {
  const index = DEFAULT_COMPOSITION_STAGE_IDS.findIndex((stage) => stage === lastCompletedStage);

  if (index === -1) {
    return DEFAULT_COMPOSITION_STAGE_IDS;
  }

  return DEFAULT_COMPOSITION_STAGE_IDS.slice(index + 1);
}

function inputLensExists(composition: SurfaceComposition, lens: string): boolean {
  return composition.lensRegistry.some((registration) => registration.id === lens);
}

function nextCliRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function surfaceErrorForThrown(cause: unknown): SurfaceError {
  if (cause instanceof CommanderError) {
    return createSurfaceError("unknown_step", "Unknown or invalid surface command.", {
      cause,
      details: { commanderCode: cause.code },
    });
  }

  return createSurfaceError("unknown_step", "Surface command failed before execution.", { cause });
}

function commandNameFor(program: Command, argv: readonly string[]): string {
  return program.args[0] ?? argv.find((arg) => !arg.startsWith("-") && arg !== "node") ?? "surface";
}

function whatFailedFor(command: string, error: SurfaceError): string {
  return `surface ${command} failed with ${error.code}`;
}

function likelyCauseFor(error: SurfaceError): string {
  if (error.kind === "UsageError") {
    return "The command name or arguments do not match the Surface CLI contract.";
  }

  return "Surface could not complete the requested operation with the current project state.";
}

function nextCommandFor(error: SurfaceError): string {
  if (error.code === "no_target") {
    return "surface capture --url <url> --json";
  }

  if (error.kind === "UsageError") {
    return "surface --help";
  }

  return "surface status --json";
}

class CliHandledError extends Error {
  constructor(readonly exitCode: CliExitCode) {
    super("Surface CLI result already emitted.");
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSurfaceCli();
}
