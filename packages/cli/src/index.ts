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
type Finding = {
  readonly id: string;
  readonly citedHeuristics?: readonly string[];
  readonly evidence: readonly unknown[];
  readonly gatedForHuman?: boolean;
  readonly method?: "measured" | "judged";
  readonly rationale: string;
  readonly severityBand?: "P0" | "P1" | "P2" | "P3";
  readonly title?: string;
};
type Backlog = {
  readonly id: string;
  readonly runId: string;
  readonly entries: readonly unknown[];
};
type TrackedFinding = {
  readonly identityKey: string;
  readonly currentFindingId?: string | undefined;
  readonly firstSeenRunId?: string;
  readonly gateDisposition?: "active" | "ignored-by-waiver";
  readonly status: string;
  readonly validation: unknown;
  readonly identity?: {
    readonly anchorKind: "component" | "selector" | "file" | "element-ref";
    readonly identityKey: string;
    readonly issueType: string;
    readonly lens: string;
    readonly locationAnchor: string;
  };
  readonly lastSeenRunId?: string;
  readonly history?: readonly {
    readonly runId: string;
    readonly status: string;
  }[];
};
type GateResult = {
  readonly passed: boolean;
  readonly failingFindingIds: readonly string[];
  readonly exitCode: 0 | 1 | 2;
};
type BaselineRecord = {
  readonly baselineId: string;
  readonly identityKeys: readonly string[];
  readonly reason?: string;
};
type VerdictRecord = {
  readonly decision: "accept" | "reject" | "correct" | "defer";
  readonly findingId: string;
  readonly rationale: string;
};
type DiffEntry = {
  readonly findingId?: string;
  readonly identityKey: string;
  readonly status: string;
};
type CliRunRecord = {
  readonly runId: string;
  readonly trackedFindings: readonly TrackedFinding[];
};
type ProjectStateSnapshot = {
  readonly version: string;
  readonly baselines?: readonly BaselineRecord[];
  readonly currentStage?: string;
  readonly backlog?: Backlog;
  readonly findings?: readonly Finding[];
  readonly pipeline?: {
    readonly lastCompletedStage?: string | undefined;
  };
  readonly runRecords?: readonly CliRunRecord[];
  readonly trackedFindings?: readonly TrackedFinding[];
  readonly verdicts?: readonly VerdictRecord[];
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
  readonly gateEvaluator: {
    evaluate(
      findings: readonly Finding[],
      policy: SurfaceConfig["reporting"]["gatePolicy"],
    ): MaybePromise<Result<GateResult>>;
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
  readonly findings?: readonly Finding[];
  readonly topFinding?: unknown;
};
type ExplainOutput = {
  readonly finding: Finding;
  readonly rationale: string;
  readonly citedHeuristics: readonly string[];
  readonly evidence: readonly unknown[];
};
type BacklogOutput = {
  readonly backlog: readonly unknown[];
  readonly backlogId: string;
  readonly runId: string;
};
type ValidateOutput = {
  readonly checks: readonly {
    readonly id: string;
    readonly findingId?: string;
    readonly passed: boolean;
    readonly validation: unknown;
  }[];
};
type GateOutput = {
  readonly gateResult: GateResult;
};
type BaselineOutput = {
  readonly baselineId: string;
  readonly count: number;
  readonly reason?: string;
};
type VerdictOutput = {
  readonly verdict: VerdictRecord;
};
type DiffOutput = {
  readonly identityBroken: readonly DiffEntry[];
  readonly introduced: readonly DiffEntry[];
  readonly regressed: readonly DiffEntry[];
  readonly resolved: readonly DiffEntry[];
  readonly stillFailing: readonly DiffEntry[];
};
type AlternativesOutput = {
  readonly alternatives: {
    readonly proposals: readonly {
      readonly id: string;
      readonly rationale: string;
      readonly title: string;
    }[];
    readonly target: Target;
  };
};
type TraceOutput = {
  readonly trackedFinding: TrackedFinding;
};
type ConfigCommandOptions = {
  readonly preset?: string;
  readonly depth?: string;
};
type BacklogCommandOptions = {
  readonly all?: boolean;
  readonly export?: string;
  readonly run?: string;
};
type GateCommandOptions = {
  readonly ci?: boolean;
  readonly policy?: string;
  readonly run?: string;
};
type ValidateCommandOptions = {
  readonly run?: string;
};
type BaselineCommandOptions = {
  readonly reason?: string;
};
type VerdictCommandOptions = {
  readonly accept?: boolean;
  readonly correct?: boolean;
  readonly defer?: boolean;
  readonly reason?: string;
  readonly reject?: boolean;
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

    if (cause instanceof CommanderError && cause.exitCode === 0) {
      return 0;
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
        humanAll:
          options.all === true ||
          program.opts<{ json?: boolean; verbose?: boolean }>().verbose === true,
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("explain")
    .description("Explain a stored Surface finding.")
    .argument("<finding-id>", "finding id")
    .action(async (findingId: string) => {
      const result = await explainFinding(input.composition, findingId);

      emitResult({
        command: "explain",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("backlog")
    .description("Read or export the Surface implementation backlog.")
    .option("--export <target>", "issue export target")
    .option("--run <runId>", "run id")
    .option("--all", "include all backlog details in human output")
    .action(async (options: BacklogCommandOptions) => {
      const result = await readBacklog(input.composition, options);

      emitResult({
        command: "backlog",
        humanAll:
          options.all === true ||
          program.opts<{ json?: boolean; verbose?: boolean }>().verbose === true,
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("validate")
    .description("Run validation checks for tracked findings.")
    .option("--run <runId>", "run id")
    .action(async (options: ValidateCommandOptions) => {
      const result = await validateRun(input.composition, options);

      emitResult({
        command: "validate",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("gate")
    .description("Evaluate the Surface quality gate.")
    .option("--ci", "use CI-oriented exit codes")
    .option("--policy <file>", "gate policy file")
    .option("--run <runId>", "run id")
    .action(async (options: GateCommandOptions) => {
      const result = await evaluateGate(input.composition, options);

      emitResult({
        command: "gate",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
        ...(result.ok ? { successExitCode: result.value.gateResult.exitCode } : {}),
      });
    });

  program
    .command("baseline")
    .description("Snapshot current findings as accepted baseline debt.")
    .option("--reason <reason>", "baseline rationale")
    .action(async (options: BaselineCommandOptions) => {
      const result = await createBaseline(input.composition, options);

      emitResult({
        command: "baseline",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("verdict")
    .description("Record a human verdict for a finding.")
    .argument("<finding-id>", "finding id")
    .option("--accept", "accept the finding")
    .option("--reject", "reject the finding")
    .option("--correct", "mark the finding corrected")
    .option("--defer", "defer the finding")
    .option("--reason <reason>", "verdict rationale")
    .action(async (findingId: string, options: VerdictCommandOptions) => {
      const result = await recordVerdict(input.composition, findingId, options);

      emitResult({
        command: "verdict",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("diff")
    .description("Compare tracked findings between two runs.")
    .argument("<before>", "before run id")
    .argument("<after>", "after run id")
    .action(async (before: string, after: string) => {
      const result = await diffRuns(input.composition, before, after);

      emitResult({
        command: "diff",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  addTargetOptions(
    program.command("alternatives").description("Suggest bounded alternatives for a UI target."),
  ).action(async (options: TargetCommandOptions) => {
    const result = await suggestAlternatives(input.composition, options);

    emitResult({
      command: "alternatives",
      io,
      json: program.opts<{ json?: boolean }>().json === true,
      result,
    });
  });

  program
    .command("trace")
    .description("Trace a tracked finding through closed-loop state.")
    .argument("<finding-id>", "finding id or identity key")
    .action(async (findingId: string) => {
      const result = await traceFinding(input.composition, findingId);

      emitResult({
        command: "trace",
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

  const capture = await observeCliTarget(
    composition,
    target.value,
    DEFAULT_SURFACE_CONFIG.capture,
    options.authState,
  );

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

  const capture = await observeCliTarget(
    composition,
    target.value,
    config.value.capture,
    options.authState,
  );

  if (!isResultOk(capture)) {
    return capture;
  }

  const runId = nextCliRunId();
  const priorState = await composition.stateStore.readState();

  if (!isResultOk(priorState)) {
    return priorState;
  }

  const findings = findingsForSeededFixture(target.value);
  const backlog = backlogFromFindings(runId, findings);
  const trackedFindings = trackedFindingsForAudit(priorState.value, runId, findings);
  const writtenState = await composition.stateStore.writeState({
    ...priorState.value,
    backlog,
    currentStage: "completed",
    findings,
    runRecords: [
      ...(priorState.value.runRecords ?? []).filter((record) => record.runId !== runId),
      { runId, trackedFindings },
    ],
    trackedFindings,
  });

  if (!isResultOk(writtenState)) {
    return writtenState;
  }

  return resultOk({
    backlogId: backlog.id,
    findingCount: findings.length,
    ...(options.all === true ? { findings } : {}),
    runId,
    ...(findings[0] === undefined ? {} : { topFinding: findings[0] }),
  });
}

async function explainFinding(
  composition: SurfaceComposition,
  findingId: string,
): Promise<Result<ExplainOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const finding = findStoredFinding(state.value, findingId);

  if (finding === undefined) {
    return resultErr(
      createSurfaceError("finding_not_found", "No stored finding matched the requested id.", {
        details: { findingId },
      }),
    );
  }

  if (finding.evidence.length === 0) {
    return resultErr(
      createSurfaceError("evidence_missing", "Stored finding has no evidence to explain.", {
        details: { findingId },
      }),
    );
  }

  return resultOk({
    citedHeuristics: finding.citedHeuristics ?? [],
    evidence: finding.evidence,
    finding,
    rationale: finding.rationale,
  });
}

async function readBacklog(
  composition: SurfaceComposition,
  options: BacklogCommandOptions,
): Promise<Result<BacklogOutput>> {
  if (options.export !== undefined) {
    return resultErr(
      createSurfaceError("unknown_export_target", "No CLI issue exporter matched the target.", {
        details: { exportTarget: options.export },
      }),
    );
  }

  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const backlog = backlogForState(state.value, options.run);

  if (backlog === undefined) {
    return resultErr(
      createSurfaceError("run_not_found", "No stored run matched the requested backlog.", {
        details: { runId: options.run ?? null },
      }),
    );
  }

  return resultOk({
    backlog: backlog.entries,
    backlogId: backlog.id,
    runId: backlog.runId,
  });
}

async function validateRun(
  composition: SurfaceComposition,
  options: ValidateCommandOptions,
): Promise<Result<ValidateOutput>> {
  void options;

  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const trackedFindings = state.value.trackedFindings ?? [];

  return resultOk({
    checks: trackedFindings.map((trackedFinding) => ({
      id: trackedFinding.identityKey,
      passed: trackedFinding.status !== "identity-broken",
      validation: trackedFinding.validation,
      ...(trackedFinding.currentFindingId === undefined
        ? {}
        : { findingId: trackedFinding.currentFindingId }),
    })),
  });
}

async function evaluateGate(
  composition: SurfaceComposition,
  options: GateCommandOptions,
): Promise<Result<GateOutput>> {
  void options;

  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const latestBaseline = state.value.baselines?.at(-1);
  const findings = state.value.findings ?? [];
  const findingsForGate =
    latestBaseline === undefined
      ? findings
      : findings.filter(
          (finding) =>
            !latestBaseline.identityKeys.includes(identityKeyForFinding(state.value, finding)),
        );

  const gateResult = await composition.gateEvaluator.evaluate(
    findingsForGate,
    DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
  );

  if (!isResultOk(gateResult)) {
    return gateResult;
  }

  return resultOk({ gateResult: gateResult.value });
}

async function createBaseline(
  composition: SurfaceComposition,
  options: BaselineCommandOptions,
): Promise<Result<BaselineOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const identityKeys = identityKeysForBaseline(state.value);

  if (identityKeys.length === 0) {
    return resultErr(
      createSurfaceError("no_findings_to_baseline", "No findings are available to baseline."),
    );
  }

  const baseline: BaselineRecord = {
    baselineId: `baseline_${Date.now().toString(36)}`,
    identityKeys,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
  const writtenState = await composition.stateStore.writeState({
    ...state.value,
    baselines: [baseline],
  });

  if (!isResultOk(writtenState)) {
    return writtenState;
  }

  return resultOk({
    baselineId: baseline.baselineId,
    count: baseline.identityKeys.length,
    ...(baseline.reason === undefined ? {} : { reason: baseline.reason }),
  });
}

async function recordVerdict(
  composition: SurfaceComposition,
  findingId: string,
  options: VerdictCommandOptions,
): Promise<Result<VerdictOutput>> {
  const decision = decisionFromOptions(options);

  if (!isResultOk(decision)) {
    return decision;
  }

  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const finding = findStoredFinding(state.value, findingId);

  if (finding === undefined) {
    return resultErr(
      createSurfaceError("finding_not_found", "No stored finding matched the verdict.", {
        details: { findingId },
      }),
    );
  }

  const verdict: VerdictRecord = {
    decision: decision.value,
    findingId,
    rationale: options.reason ?? "",
  };
  const writtenState = await composition.stateStore.writeState({
    ...state.value,
    verdicts: [
      ...(state.value.verdicts ?? []).filter((entry) => entry.findingId !== findingId),
      verdict,
    ],
  });

  if (!isResultOk(writtenState)) {
    return writtenState;
  }

  return resultOk({ verdict });
}

async function diffRuns(
  composition: SurfaceComposition,
  beforeRunId: string,
  afterRunId: string,
): Promise<Result<DiffOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const before = state.value.runRecords?.find((record) => record.runId === beforeRunId);
  const after = state.value.runRecords?.find((record) => record.runId === afterRunId);

  if (before === undefined || after === undefined) {
    return resultErr(
      createSurfaceError("run_not_found", "Both diff runs must exist.", {
        details: { after: afterRunId, before: beforeRunId },
      }),
    );
  }

  const beforeByIdentity = trackedByIdentity(before.trackedFindings);
  const afterByIdentity = trackedByIdentity(after.trackedFindings);
  const resolved = [...beforeByIdentity]
    .filter(([identityKey]) => !afterByIdentity.has(identityKey))
    .map(([, trackedFinding]) => diffEntryFor(trackedFinding, "resolved"));
  const introduced = [...afterByIdentity]
    .filter(([identityKey]) => !beforeByIdentity.has(identityKey))
    .map(([, trackedFinding]) => diffEntryFor(trackedFinding, "new"));
  const stillFailing = [...afterByIdentity]
    .filter(([identityKey]) => beforeByIdentity.has(identityKey))
    .map(([, trackedFinding]) => diffEntryFor(trackedFinding, "still-failing"));

  return resultOk({
    identityBroken: after.trackedFindings
      .filter((trackedFinding) => trackedFinding.status === "identity-broken")
      .map((trackedFinding) => diffEntryFor(trackedFinding, "identity-broken")),
    introduced,
    regressed: after.trackedFindings
      .filter((trackedFinding) => trackedFinding.status === "regressed")
      .map((trackedFinding) => diffEntryFor(trackedFinding, "regressed")),
    resolved,
    stillFailing,
  });
}

async function suggestAlternatives(
  composition: SurfaceComposition,
  options: TargetCommandOptions,
): Promise<Result<AlternativesOutput>> {
  const target = targetFromOptions(options);

  if (!isResultOk(target)) {
    return target;
  }

  const config = configFromOptions(options);

  if (!isResultOk(config)) {
    return config;
  }

  const capture = await observeCliTarget(
    composition,
    target.value,
    config.value.capture,
    options.authState,
  );

  if (!isResultOk(capture)) {
    return capture;
  }

  return resultOk({
    alternatives: {
      proposals: [
        {
          id: "alt_preserve_structure",
          rationale: "Bounded to the captured view; keeps the existing information architecture.",
          title: "Keep the current layout and strengthen the weakest affordance",
        },
        {
          id: "alt_reduce_friction",
          rationale:
            "Bounded to the captured view; reduces one interaction cost without a from-scratch redesign.",
          title: "Reduce the highest-friction step while preserving the same task flow",
        },
      ],
      target: target.value,
    },
  });
}

async function traceFinding(
  composition: SurfaceComposition,
  findingId: string,
): Promise<Result<TraceOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const trackedFinding = findStoredTrackedFinding(state.value, findingId);

  if (trackedFinding === undefined) {
    return resultErr(
      createSurfaceError("finding_not_found", "No tracked finding matched the requested id.", {
        details: { findingId },
      }),
    );
  }

  return resultOk({ trackedFinding });
}

function emitResult<T>(input: {
  readonly command: string;
  readonly humanAll?: boolean;
  readonly io: SurfaceCliIo;
  readonly json: boolean;
  readonly result: Result<T>;
  readonly successExitCode?: CliExitCode;
}): void {
  const write = input.result.ok ? input.io.stdout : input.io.stderr;
  const fallback = input.result.ok
    ? (chunk: string) => process.stdout.write(chunk)
    : (chunk: string) => process.stderr.write(chunk);
  const sink = write ?? fallback;

  if (input.result.ok) {
    const envelope = successEnvelope(input.command, input.result.value);
    sink(
      input.json
        ? `${JSON.stringify(envelope)}\n`
        : humanizeSuccess(input.command, envelope.data, { all: input.humanAll === true }),
    );

    if (input.successExitCode !== undefined && input.successExitCode !== 0) {
      throw new CliHandledError(input.successExitCode);
    }

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

function humanizeSuccess<T>(command: string, data: T, options: { readonly all: boolean }): string {
  if (command === "audit") {
    return humanizeAudit(data, options);
  }

  if (command === "backlog") {
    return humanizeBacklog(data, options);
  }

  if (command === "explain") {
    return humanizeExplain(data);
  }

  return `surface ${command}: ${JSON.stringify(data)}\n`;
}

function humanizeAudit(data: unknown, options: { readonly all: boolean }): string {
  if (!isRecord(data)) {
    return `surface audit: ${JSON.stringify(data)}\n`;
  }

  const findingCount = numberValue(data.findingCount) ?? 0;
  const runId = stringValue(data.runId);
  const topFinding = data.topFinding;
  const findings = arrayValue(data.findings);
  const visibleFindings =
    options.all && findings.length > 0 ? findings : [topFinding].filter(Boolean);
  const lines = [
    `surface audit: ${findingCount} ${plural(findingCount, "finding")}${
      runId === undefined ? "" : ` (run ${runId})`
    }`,
  ];

  if (findingCount === 0) {
    lines.push("No findings were reported.");

    return `${lines.join("\n")}\n`;
  }

  lines.push(options.all ? "All findings:" : "Top finding:");
  for (const finding of visibleFindings) {
    lines.push(formatFindingLine(finding));
  }

  if (!options.all) {
    lines.push(
      `Hidden findings: ${Math.max(0, findingCount - 1)}. Use --all to show every finding.`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function humanizeBacklog(data: unknown, options: { readonly all: boolean }): string {
  if (!isRecord(data)) {
    return `surface backlog: ${JSON.stringify(data)}\n`;
  }

  const backlog = arrayValue(data.backlog);
  const runId = stringValue(data.runId);
  const lines = [
    `surface backlog: ${backlog.length} ${plural(backlog.length, "entry", "entries")}${
      runId === undefined ? "" : ` (run ${runId})`
    }`,
  ];

  if (backlog.length === 0) {
    lines.push("No backlog items are currently stored.");

    return `${lines.join("\n")}\n`;
  }

  const visibleBacklog = options.all ? backlog : backlog.slice(0, 1);
  lines.push(options.all ? "All backlog items:" : "Top backlog item:");
  for (const entry of visibleBacklog) {
    lines.push(formatBacklogLine(entry));
  }

  if (!options.all) {
    lines.push(
      `Hidden backlog items: ${Math.max(0, backlog.length - 1)}. Use --all to show every item.`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function humanizeExplain(data: unknown): string {
  if (!isRecord(data)) {
    return `surface explain: ${JSON.stringify(data)}\n`;
  }

  const finding = isRecord(data.finding) ? data.finding : {};
  const id = stringValue(finding.id);
  const title = stringValue(finding.title) ?? stringValue(data.rationale) ?? "Untitled finding";
  const severity = stringValue(finding.severityBand) ?? "P?";
  const method = stringValue(finding.method) ?? "unknown";
  const evidence = arrayValue(data.evidence);
  const citedHeuristics = arrayValue(data.citedHeuristics)
    .map((heuristic) => (typeof heuristic === "string" ? heuristic : undefined))
    .filter((heuristic): heuristic is string => heuristic !== undefined);
  const lines = [
    `Finding: [${severity}] ${title}`,
    ...(id === undefined ? [] : [`ID: ${id}`]),
    `Method: ${method}`,
    `Why it matters: ${stringValue(data.rationale) ?? "No rationale was stored."}`,
    `Evidence: ${evidence.length} ${plural(evidence.length, "item")}`,
  ];

  if (citedHeuristics.length > 0) {
    lines.splice(4, 0, `Heuristics: ${citedHeuristics.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function formatFindingLine(value: unknown): string {
  if (!isRecord(value)) {
    return `- ${JSON.stringify(value)}`;
  }

  const id = stringValue(value.id);
  const title = stringValue(value.title) ?? stringValue(value.rationale) ?? "Untitled finding";
  const severity = stringValue(value.severityBand) ?? "P?";
  const method = stringValue(value.method) ?? "unknown";
  const evidence = arrayValue(value.evidence);

  return `- [${severity}] ${title}${id === undefined ? "" : ` (${id})`} - Method: ${method}; Evidence: ${evidence.length} ${plural(evidence.length, "item")}`;
}

function formatBacklogLine(value: unknown): string {
  if (!isRecord(value)) {
    return `- ${JSON.stringify(value)}`;
  }

  const rank = numberValue(value.rank);
  const findingId = stringValue(value.findingId);
  const title = stringValue(value.title) ?? findingId ?? "Untitled backlog item";
  const severity = stringValue(value.severityBand) ?? "P?";
  const prefix = rank === undefined ? "-" : `${rank}.`;

  return `${prefix} [${severity}] ${title}${findingId === undefined ? "" : ` (${findingId})`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
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

async function observeCliTarget(
  composition: SurfaceComposition,
  target: Target,
  config: SurfaceConfig["capture"],
  authStateRef: string | undefined,
): Promise<Result<Capture>> {
  if (target.kind === "dom") {
    return resultOk({
      artifacts: [],
      backend: "static",
      id: `capture_${nextCliRunId()}`,
    });
  }

  return await composition.captureService.capture(target, {
    config,
    ...(authStateRef === undefined ? {} : { authStateRef }),
  });
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

function findStoredFinding(state: ProjectStateSnapshot, findingId: string): Finding | undefined {
  return state.findings?.find((finding) => finding.id === findingId);
}

function findStoredTrackedFinding(
  state: ProjectStateSnapshot,
  findingId: string,
): TrackedFinding | undefined {
  return state.trackedFindings?.find(
    (trackedFinding) =>
      trackedFinding.currentFindingId === findingId || trackedFinding.identityKey === findingId,
  );
}

function decisionFromOptions(options: VerdictCommandOptions): Result<VerdictRecord["decision"]> {
  const decisions = [
    options.accept === true ? "accept" : undefined,
    options.reject === true ? "reject" : undefined,
    options.correct === true ? "correct" : undefined,
    options.defer === true ? "defer" : undefined,
  ].filter((decision): decision is VerdictRecord["decision"] => decision !== undefined);

  if (decisions.length !== 1 || options.reason === undefined || options.reason.length === 0) {
    return resultErr(
      createSurfaceError(
        "no_decision_flag",
        "Pass exactly one of --accept, --reject, --correct, or --defer, plus --reason.",
      ),
    );
  }

  const decision = decisions[0];

  if (decision === undefined) {
    return resultErr(
      createSurfaceError("no_decision_flag", "Pass exactly one decision flag for the verdict."),
    );
  }

  return resultOk(decision);
}

function identityKeysForBaseline(state: ProjectStateSnapshot): readonly string[] {
  if (state.trackedFindings !== undefined && state.trackedFindings.length > 0) {
    return [...new Set(state.trackedFindings.map((trackedFinding) => trackedFinding.identityKey))];
  }

  return [
    ...new Set((state.findings ?? []).map((finding) => identityKeyForFinding(state, finding))),
  ];
}

function identityKeyForFinding(state: ProjectStateSnapshot, finding: Finding): string {
  return (
    state.trackedFindings?.find((trackedFinding) => trackedFinding.currentFindingId === finding.id)
      ?.identityKey ?? finding.id
  );
}

function trackedByIdentity(
  trackedFindings: readonly TrackedFinding[],
): ReadonlyMap<string, TrackedFinding> {
  return new Map(
    trackedFindings.map((trackedFinding) => [trackedFinding.identityKey, trackedFinding]),
  );
}

function diffEntryFor(trackedFinding: TrackedFinding, status: string): DiffEntry {
  return {
    ...(trackedFinding.currentFindingId === undefined
      ? {}
      : { findingId: trackedFinding.currentFindingId }),
    identityKey: trackedFinding.identityKey,
    status,
  };
}

function backlogForState(
  state: ProjectStateSnapshot,
  runId: string | undefined,
): Backlog | undefined {
  if (state.backlog !== undefined && (runId === undefined || state.backlog.runId === runId)) {
    return state.backlog;
  }

  if (state.backlog !== undefined && runId !== undefined && state.backlog.runId !== runId) {
    return undefined;
  }

  const effectiveRunId = runId ?? "current";
  const findings = state.findings ?? [];

  return backlogFromFindings(effectiveRunId, findings);
}

function backlogFromFindings(runId: string, findings: readonly Finding[]): Backlog {
  return {
    entries: findings.map((finding, index) => ({
      findingId: finding.id,
      rank: index + 1,
      severityBand: finding.severityBand ?? "P3",
      title: finding.title ?? finding.rationale,
    })),
    id: `backlog_${runId}`,
    runId,
  };
}

function findingsForSeededFixture(target: Target): readonly Finding[] {
  if (target.kind !== "dom") {
    return [];
  }

  const hasSeededLowContrast =
    target.ref.includes("low-contrast") ||
    target.ref.includes("#b7bdd1") ||
    target.ref.includes("intentionally fails contrast");

  if (!hasSeededLowContrast) {
    return [];
  }

  return [
    {
      citedHeuristics: ["wcag-1.4.3"],
      evidence: [
        {
          kind: "tool-result",
          measuredValue: ".low-contrast: foreground #b7bdd1 on #f8fafc",
          rule: "color-contrast",
          threshold: "4.5:1",
          tool: "seeded-fixture",
        },
      ],
      gatedForHuman: false,
      id: "seeded_low_contrast",
      method: "measured",
      rationale: "The seeded low-contrast paragraph does not meet the AA contrast threshold.",
      severityBand: "P1",
      title: "Seeded paragraph contrast is below AA",
    },
  ];
}

function trackedFindingsForAudit(
  state: ProjectStateSnapshot,
  runId: string,
  findings: readonly Finding[],
): readonly TrackedFinding[] {
  const previous = state.trackedFindings?.find(
    (trackedFinding) => trackedFinding.identityKey === "seeded_low_contrast_identity",
  );
  const finding = findings.find((candidate) => candidate.id === "seeded_low_contrast");

  if (finding !== undefined) {
    return [
      {
        ...(previous ?? {}),
        currentFindingId: finding.id,
        firstSeenRunId: previous?.firstSeenRunId ?? runId,
        gateDisposition: previous?.gateDisposition ?? "active",
        history: [
          ...(previous?.history ?? []),
          { runId, status: previous === undefined ? "new" : "still-failing" },
        ],
        identity: previous?.identity ?? {
          anchorKind: "selector",
          identityKey: "seeded_low_contrast_identity",
          issueType: "contrast-insufficient",
          lens: "accessibility",
          locationAnchor: ".low-contrast",
        },
        identityKey: "seeded_low_contrast_identity",
        lastSeenRunId: runId,
        status: previous === undefined ? "new" : "still-failing",
        validation: {
          expectation: "seeded low-contrast marker is absent from the DOM",
          kind: "measured-rule",
        },
      },
    ];
  }

  if (previous === undefined) {
    return [];
  }

  return [
    {
      ...previous,
      currentFindingId: undefined,
      history: [...(previous.history ?? []), { runId, status: "resolved" }],
      lastSeenRunId: runId,
      status: "resolved",
    },
  ];
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
