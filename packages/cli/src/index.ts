#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  DEFAULT_COMPOSITION_STAGE_IDS,
  DEFAULT_SURFACE_CONFIG,
  BacklogSchema,
  DirectSubscriptionChannelIdSchema,
  DepthSchema,
  EvidenceSchema,
  FindingSchema,
  GatePolicySchema,
  ModelFallbackModeSchema,
  PresetSchema,
  ScreenshotEgressPolicySchema,
  SurfaceSarifLogSchema,
  browserQaFlowRunsForGate,
  browserQaFlowSeverityFromWithFlows,
  browserQaGateTargetCli,
  SurfaceConfigLayerSchema,
  SurfaceErrorSchema,
  createGitHubChecksExporter,
  createBoundedAlternatives,
  createTrackedFinding,
  createSurfaceComposition,
  createSurfaceError,
  evaluateGateWithQaFlows,
  createModelEgressLedgerEntry,
  createSarifRenderer,
  assignFindingIdentities,
  deriveFindingIdentity,
  diffTrackedFindings,
  exitCodeForSurfaceError,
  installSubscriptionTempRootProcessCleanupHandlers,
  maskModelArtifactText,
  maskModelPlainText,
  resolveSurfaceConfig,
  toCliErrorEnvelope,
  transitionTrackedFinding,
  type AuditRunnerResult,
  type Backlog,
  type Baseline,
  type CliExitCode,
  type Finding,
  type Evidence,
  type GitHubChecksExport,
  type GitHubChecksExporterOptions,
  type Result,
  type SurfaceSarifLog,
  type SurfaceConfigLayer,
  type SurfaceError,
  type TrackedFinding,
  type TrackedFindingsDiffEntry,
} from "@zigrivers/surface-core";
import type {
  Capture,
  GateResult,
  ProjectStateSnapshot as CoreProjectStateSnapshot,
  Target,
} from "@zigrivers/surface-core/interfaces";
import { Command, CommanderError } from "commander";

import { registerBrowserQaCommands } from "./browser-qa-commands.js";

type SurfaceConfig = typeof DEFAULT_SURFACE_CONFIG;
type ExecutablePipelineStageId = (typeof DEFAULT_COMPOSITION_STAGE_IDS)[number];
type SurfaceCompositionOptions = NonNullable<Parameters<typeof createSurfaceComposition>[0]>;
type CoreSurfaceComposition = ReturnType<typeof createSurfaceComposition>;
type SurfaceCompositionStateDir = {
  readonly stateDir?: unknown;
};
type ConfigIssueDetail = {
  readonly code: string;
  readonly message: string;
  readonly path: string;
};
type VerdictRecord = {
  readonly decision: "accept" | "reject" | "correct" | "defer";
  readonly findingId: string;
  readonly rationale: string;
};
type CliProjectStateSnapshot = CoreProjectStateSnapshot;
type SurfaceComposition = CoreSurfaceComposition;

function compositionProjectRoot(composition: SurfaceComposition): string {
  return composition.lensFactoryOptions.projectRoot ?? process.cwd();
}

function compositionStateDir(composition: SurfaceComposition): string {
  const stateDir = (composition as SurfaceCompositionStateDir).stateDir;

  return typeof stateDir === "string" && stateDir.trim().length > 0 ? stateDir : DEFAULT_STATE_DIR;
}

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
export type SurfaceCliEnv = Readonly<Record<string, string | undefined>>;

export type RunSurfaceCliOptions = SurfaceCompositionOptions & {
  readonly argv?: readonly string[];
  readonly composition?: SurfaceComposition;
  readonly env?: SurfaceCliEnv;
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
  readonly model?: ModelAuditOutput;
  readonly reconciliationQuestions?: AuditRunnerResult["reconciliationQuestions"];
  readonly topFinding?: unknown;
};
type ModelAuditOutput = {
  readonly artifactClassesSent: readonly string[];
  readonly attemptedChannels: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly completedChannels: readonly string[];
  readonly unavailableChannels: readonly {
    readonly id: string;
    readonly message: string;
    readonly reason: string;
  }[];
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
type SarifExportOutput = {
  readonly sarif: SurfaceSarifLog;
};
type GitHubChecksExportOutput = {
  readonly checkRun: GitHubChecksExport;
};
type IssueExportOutput = {
  readonly export: unknown;
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
  readonly promotion?: unknown;
  readonly verdict: VerdictRecord;
};
type DiffOutput = {
  readonly identityBroken: readonly TrackedFindingsDiffEntry[];
  readonly introduced: readonly TrackedFindingsDiffEntry[];
  readonly regressed: readonly TrackedFindingsDiffEntry[];
  readonly resolved: readonly TrackedFindingsDiffEntry[];
  readonly stillFailing: readonly TrackedFindingsDiffEntry[];
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
  readonly modelChannel?: readonly string[];
  readonly modelChannels?: string;
  readonly modelDepth?: string;
  readonly modelFallback?: string;
  readonly modelScreenshots?: string | boolean;
};
type BacklogCommandOptions = {
  readonly all?: boolean;
  readonly export?: string;
  readonly run?: string;
};
type GateCommandOptions = {
  readonly actionPolicy?: string;
  readonly baseUrl?: string;
  readonly ci?: boolean;
  readonly localhost?: boolean | string;
  readonly policy?: string;
  readonly run?: string;
  readonly target?: string;
  readonly url?: string;
  readonly withFlows?: boolean | string;
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
  readonly promote?: boolean;
  readonly reason?: string;
  readonly reject?: boolean;
};
type TargetCommandOptions = ConfigCommandOptions & {
  readonly all?: boolean;
  readonly authState?: string;
  readonly component?: string;
  readonly dom?: string;
  readonly evidence?: string;
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
const SURFACE_CLI_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export async function runSurfaceCli(options: RunSurfaceCliOptions = {}): Promise<CliExitCode> {
  installSubscriptionTempRootProcessCleanupHandlers();
  const composition = options.composition ?? createSurfaceComposition(options);
  const env = options.env ?? process.env;
  const io = options.io ?? {};
  const program = createSurfaceCliProgram({ composition, env, io });

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
  readonly env?: SurfaceCliEnv;
  readonly io?: SurfaceCliIo;
}): Command {
  const program = new Command();
  const env = input.env ?? process.env;
  const io = input.io ?? {};

  program
    .name("surface")
    .description("Audit running UIs and produce agent-readable findings.")
    .version(SURFACE_CLI_VERSION.version)
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
      const result = await initializeProject(input.composition, options, env);

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
      const result = await runPipelineStep(input.composition, step, options, env);

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
    .option("--evidence <file>", "load static tool-result evidence JSON for audit")
    .action(async (lens: string | undefined, options: TargetCommandOptions) => {
      const result = await auditTarget(input.composition, lens, options, env);

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
      const result = await readBacklog(input.composition, options, env);

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
    .option("--action-policy <path>", "browser QA flow action policy file")
    .option("--ci", "use CI-oriented exit codes")
    .option("--base-url <url>", "browser QA flow base URL override")
    .option("--localhost", "run browser QA flows against http://localhost:3000")
    .option("--policy <file>", "gate policy file")
    .option("--run <runId>", "run id")
    .option("--target <url>", "browser QA flow target URL")
    .option("--url <url>", "browser QA flow target URL")
    .option("--with-flows [globOrSeverity]", "include verified browser QA flow results")
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
    .option("--promote", "promote a browser QA candidate finding")
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
    .command("cleanup")
    .description("Purge generated Surface artifacts.")
    .argument("[area]", "artifact area to purge: model-egress", "model-egress")
    .action(async (area: string) => {
      const result = await cleanupArtifacts(input.composition, area);

      emitResult({
        command: "cleanup",
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

  registerBrowserQaCommands(program, {
    composition: input.composition,
    emitResult: ({ command, result }) =>
      emitResult({
        command,
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      }),
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
    .option("--depth <depth>", "evaluation depth, 1-5")
    .option("--model-fallback <mode>", "model fallback mode: off, direct, mmr, or auto")
    .option("--model-channels <channels>", "comma-separated subscription model channels")
    .option(
      "--model-channel <channel>",
      "repeatable subscription model channel",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--model-depth <depth>", "model fallback depth, 1-5")
    .option("--model-screenshots [policy]", "allow redacted screenshot metadata")
    .option("--no-model-screenshots", "block screenshot metadata");
}

async function initializeProject(
  composition: SurfaceComposition,
  options: ConfigCommandOptions,
  env: SurfaceCliEnv = {},
): Promise<Result<InitOutput>> {
  const config = configFromOptions(options, env, compositionProjectRoot(composition));

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

async function cleanupArtifacts(
  composition: SurfaceComposition,
  area: string,
): Promise<Result<{ readonly area: string; readonly path: string }>> {
  if (area !== "model-egress") {
    return resultErr(
      createSurfaceError("config_invalid", `Unknown cleanup area "${area}".`, {
        details: { area },
      }),
    );
  }

  const projectRoot = compositionProjectRoot(composition);
  const modelEgressRelativePath = path.join(compositionStateDir(composition), "model-egress");
  const modelEgressOutputPath = modelEgressRelativePath.replace(/\\/g, "/");
  const modelEgressPath = path.join(projectRoot, modelEgressRelativePath);

  try {
    await rm(modelEgressPath, { force: true, recursive: true });
  } catch (cause) {
    return resultErr(
      createSurfaceError("state_write_failed", "Failed to purge model egress artifacts.", {
        cause,
        details: { path: modelEgressOutputPath },
      }),
    );
  }

  return resultOk({
    area,
    path: modelEgressOutputPath,
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
  env: SurfaceCliEnv = {},
): Promise<Result<RunOutput>> {
  if (step !== "all" && !isExecutableStageId(step)) {
    return resultErr(
      createSurfaceError("unknown_step", `Unknown pipeline step "${step}".`, {
        details: { step },
      }),
    );
  }

  const config = configFromOptions(options, env, compositionProjectRoot(composition));

  if (!isResultOk(config)) {
    return config;
  }

  if (config.value.model.effectiveEgressPolicy.mode !== "off") {
    return resultErr(
      createSurfaceError(
        "config_invalid",
        "Model-backed judgement is only supported by surface audit.",
        {
          details: {
            nextCommand: "surface audit",
            step,
          },
        },
      ),
    );
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
  env: SurfaceCliEnv,
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

  const config = configFromOptions(options, env, compositionProjectRoot(composition));

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

  const evidence = await collectGroundingEvidence(composition, capture.value);

  if (!isResultOk(evidence)) {
    return evidence;
  }

  const staticEvidence = await readStaticEvidence(options, compositionProjectRoot(composition));

  if (!isResultOk(staticEvidence)) {
    return staticEvidence;
  }

  const audit = await composition.auditRunner({
    capture: capture.value,
    config: config.value,
    evidence: [...evidence.value, ...staticEvidence.value],
    ...(lens === undefined ? {} : { lensId: lens }),
    runId,
  });

  if (!isResultOk(audit)) {
    return audit;
  }

  const modelEgress = sanitizeModelEgressLedger(audit.value.modelEgress);

  if (!isResultOk(modelEgress)) {
    return modelEgress;
  }

  const auditValue: AuditRunnerResult = {
    ...audit.value,
    modelEgress: modelEgress.value,
  };
  const findings = auditValue.findings;
  const trackedFindings = trackedFindingsForAudit(
    priorState.value,
    runId,
    findings,
    auditValue.skippedLenses,
    auditValue.evaluatedLenses,
    lens === undefined ? undefined : [lens],
  );
  const persistedFindings = persistedFindingsForTrackedState(
    priorState.value,
    findings,
    trackedFindings,
  );
  const backlog = backlogFromFindings(runId, persistedFindings);
  const writtenState = await composition.stateStore.writeState({
    ...priorState.value,
    backlog,
    currentStage: "completed",
    findings: persistedFindings,
    modelEgress: appendModelEgressLedger(priorState.value.modelEgress, auditValue.modelEgress),
    runRecords: [
      ...(priorState.value.runRecords ?? []).filter((record) => record.runId !== runId),
      {
        backlog,
        capture: captureForState(capture.value),
        findings,
        ...(auditValue.reconciliationQuestions === undefined ||
        auditValue.reconciliationQuestions.length === 0
          ? {}
          : { reconciliationQuestions: auditValue.reconciliationQuestions }),
        runId,
        skippedLenses: auditValue.skippedLenses,
        trackedFindings,
      },
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
    ...modelAuditOutput(auditValue),
    ...(auditValue.reconciliationQuestions === undefined ||
    auditValue.reconciliationQuestions.length === 0
      ? {}
      : { reconciliationQuestions: auditValue.reconciliationQuestions }),
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

async function collectGroundingEvidence(
  composition: SurfaceComposition,
  capture: Capture,
): Promise<Result<readonly Evidence[]>> {
  const evidence: Evidence[] = [];

  for (const tool of composition.groundingTools) {
    const result = await tool.run(capture);

    if (!isResultOk(result)) {
      return resultErr(result.error);
    }

    for (const toolResult of result.value) {
      evidence.push(...toolResult.evidence);
    }
  }

  return resultOk(evidence);
}

async function readStaticEvidence(
  options: TargetCommandOptions,
  projectRoot: string,
): Promise<Result<readonly Evidence[]>> {
  if (options.evidence === undefined) {
    return resultOk([]);
  }

  const evidencePath = path.isAbsolute(options.evidence)
    ? options.evidence
    : path.resolve(projectRoot, options.evidence);

  try {
    const parsedJson = JSON.parse(await readFile(evidencePath, "utf8")) as unknown;
    const parsedEvidence = EvidenceSchema.array().safeParse(parsedJson);

    if (!parsedEvidence.success) {
      return resultErr(
        createSurfaceError("config_invalid", "Static evidence file is invalid.", {
          cause: parsedEvidence.error,
          details: { path: options.evidence },
        }),
      );
    }

    return resultOk(parsedEvidence.data);
  } catch (cause) {
    return resultErr(
      createSurfaceError("config_invalid", "Static evidence file could not be read.", {
        cause,
        details: { path: options.evidence },
      }),
    );
  }
}

async function readBacklog(
  composition: SurfaceComposition,
  options: BacklogCommandOptions,
  env: SurfaceCliEnv,
): Promise<
  Result<BacklogOutput | SarifExportOutput | GitHubChecksExportOutput | IssueExportOutput>
> {
  if (
    options.export !== undefined &&
    options.export !== "sarif" &&
    options.export !== "github-checks" &&
    composition.issueExporters.every((exporter) => exporter.target !== options.export)
  ) {
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

  if (options.export === "sarif") {
    const sarif = await renderSarifForBacklog(fullFindingsForState(state.value), backlog);

    if (!isResultOk(sarif)) {
      return sarif;
    }

    return resultOk({
      sarif: sarif.value,
    });
  }

  if (options.export === "github-checks") {
    const githubOptions = githubChecksOptionsFromEnv(env);

    if (!isResultOk(githubOptions)) {
      return githubOptions;
    }

    const sarif = await renderSarifForBacklog(fullFindingsForState(state.value), backlog);

    if (!isResultOk(sarif)) {
      return sarif;
    }

    const exported = await createGitHubChecksExporter(githubOptions.value).export({
      backlog,
      localArtifactPath: ".surface/state.json",
      sarif: sarif.value,
    });

    if (!isResultOk(exported)) {
      return exported;
    }

    return resultOk({ checkRun: exported.value });
  }

  if (options.export !== undefined) {
    const exporter = composition.issueExporters.find(
      (candidate) => candidate.target === options.export,
    );

    if (exporter === undefined) {
      return resultErr(
        createSurfaceError("unknown_export_target", "No CLI issue exporter matched the target.", {
          details: { exportTarget: options.export },
        }),
      );
    }

    const artifact = await composition.stateStore.writeArtifact({
      kind: "report",
      relativePath: "reports/backlog.json",
      bytes: new TextEncoder().encode(JSON.stringify({ backlog })),
    });

    if (!isResultOk(artifact)) {
      return artifact;
    }

    const exported = await exporter.export({
      backlogId: backlog.id,
      path: artifact.value.path,
    });

    if (!isResultOk(exported)) {
      return exported;
    }

    return resultOk({ export: exported.value });
  }

  return resultOk({
    backlog: backlog.entries,
    backlogId: backlog.id,
    runId: backlog.runId,
  });
}

async function renderSarifForBacklog(
  findings: readonly Finding[],
  backlog: Backlog,
): Promise<Result<SurfaceSarifLog>> {
  const rendered = await createSarifRenderer().render(findings, backlog);

  if (!isResultOk(rendered)) {
    return rendered;
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(new TextDecoder().decode(rendered.value.bytes)) as unknown;
  } catch (cause) {
    return resultErr(
      createSurfaceError("export_failed", "SARIF export could not be decoded.", { cause }),
    );
  }

  const sarif = SurfaceSarifLogSchema.safeParse(decoded);

  if (!sarif.success) {
    return resultErr(
      createSurfaceError("export_failed", "SARIF export produced invalid output.", {
        cause: sarif.error,
      }),
    );
  }

  return resultOk(sarif.data);
}

function githubChecksOptionsFromEnv(env: SurfaceCliEnv): Result<GitHubChecksExporterOptions> {
  const repository = env.SURFACE_GITHUB_REPOSITORY ?? env.GITHUB_REPOSITORY;
  const headSha = env.SURFACE_GITHUB_HEAD_SHA ?? env.GITHUB_HEAD_SHA ?? env.GITHUB_SHA;
  const token = env.SURFACE_GITHUB_TOKEN ?? env.GITHUB_TOKEN;
  const checkName = env.SURFACE_GITHUB_CHECK_NAME;

  if (repository === undefined || headSha === undefined || token === undefined) {
    return resultErr(
      createSurfaceError("export_failed", "GitHub Checks export requires PR context and token.", {
        details: {
          missing: [
            repository === undefined ? "GITHUB_REPOSITORY" : undefined,
            headSha === undefined ? "GITHUB_SHA" : undefined,
            token === undefined ? "GITHUB_TOKEN" : undefined,
          ].filter((name): name is string => name !== undefined),
        },
      }),
    );
  }

  const [owner, repo, ...extra] = repository.split("/");

  if (
    owner === undefined ||
    repo === undefined ||
    extra.length > 0 ||
    owner === "" ||
    repo === ""
  ) {
    return resultErr(
      createSurfaceError("export_failed", "GitHub Checks export requires owner/repo context.", {
        details: { repository },
      }),
    );
  }

  return resultOk({
    owner,
    repo,
    headSha,
    token,
    ...(checkName === undefined ? {} : { checkName }),
  });
}

async function gatePolicyForOptions(
  options: GateCommandOptions,
): Promise<Result<SurfaceConfig["reporting"]["gatePolicy"]>> {
  if (options.policy === undefined) {
    return resultOk(DEFAULT_SURFACE_CONFIG.reporting.gatePolicy);
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(await readFile(options.policy, "utf8")) as unknown;
  } catch (cause) {
    return resultErr(
      createSurfaceError("policy_invalid", "Gate policy file could not be read or parsed.", {
        cause,
        details: { path: options.policy },
      }),
    );
  }

  const parsed = GatePolicySchema.safeParse(decoded);

  if (!parsed.success) {
    return resultErr(
      createSurfaceError("policy_invalid", "Gate policy file is invalid.", {
        cause: parsed.error,
        details: { path: options.policy },
      }),
    );
  }

  return resultOk(parsed.data);
}

function trackedFindingsForRunOption(
  state: CliProjectStateSnapshot,
  runId: string | undefined,
): Result<readonly TrackedFinding[]> {
  if (runId === undefined) {
    return resultOk(state.trackedFindings ?? []);
  }

  const record = state.runRecords?.find((candidate) => candidate.runId === runId);

  if (record === undefined) {
    return resultErr(
      createSurfaceError("run_not_found", "No stored run matched the requested run id.", {
        details: { runId },
      }),
    );
  }

  return resultOk(record.trackedFindings);
}

async function validateRun(
  composition: SurfaceComposition,
  options: ValidateCommandOptions,
): Promise<Result<ValidateOutput>> {
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const trackedFindings = trackedFindingsForRunOption(state.value, options.run);

  if (!isResultOk(trackedFindings)) {
    return trackedFindings;
  }

  return resultOk({
    checks: trackedFindings.value.map((trackedFinding) => ({
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
  const state = await composition.stateStore.readState();

  if (!isResultOk(state)) {
    return state;
  }

  const policy = await gatePolicyForOptions(options);

  if (!isResultOk(policy)) {
    return policy;
  }

  const trackedFindings = trackedFindingsForRunOption(state.value, options.run);

  if (!isResultOk(trackedFindings)) {
    return trackedFindings;
  }

  const latestBaseline = state.value.baselines?.at(-1);
  const findings = fullFindingsForState(state.value);

  const gateContext = {
    ...(latestBaseline === undefined ? {} : { baseline: latestBaseline }),
    trackedFindings: trackedFindings.value,
  };
  const gateResult = await composition.gateEvaluator.evaluate(findings, policy.value, gateContext);

  if (!isResultOk(gateResult)) {
    return gateResult;
  }

  if (options.withFlows === undefined) {
    return resultOk({ gateResult: gateResult.value });
  }

  const targetCli = browserQaGateTargetCli(options);

  if (!isResultOk(targetCli)) {
    return targetCli;
  }

  const qaFlowRuns = await browserQaFlowRunsForGate(composition, {
    ...(options.actionPolicy === undefined ? {} : { actionPolicyRef: options.actionPolicy }),
    ci: options.ci === true,
    projectRoot: process.cwd(),
    ...(targetCli.value === undefined ? {} : { targetCli: targetCli.value }),
    withFlows: options.withFlows,
  });

  if (!isResultOk(qaFlowRuns)) {
    return qaFlowRuns;
  }

  const flowAwareGate = evaluateGateWithQaFlows({
    context: gateContext,
    findings,
    policy: {
      ...policy.value,
      failOnFlowSeverityAtOrAbove: browserQaFlowSeverityFromWithFlows(options.withFlows),
    },
    qaFlowRuns: qaFlowRuns.value,
  });

  return isResultOk(flowAwareGate) ? resultOk({ gateResult: flowAwareGate.value }) : flowAwareGate;
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

  const baseline: Baseline = {
    baselineId: `baseline_${Date.now().toString(36)}`,
    identityKeys,
    waivers: [],
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
  if (findingId.startsWith("qfc_")) {
    if (options.promote !== true) {
      return resultErr(
        createSurfaceError(
          "finding_not_found",
          "Browser QA candidate verdicts require --promote.",
          {
            details: { findingId },
          },
        ),
      );
    }

    if (options.reason === undefined || options.reason.length === 0) {
      return resultErr(
        createSurfaceError("no_decision_flag", "Browser QA candidate promotion requires --reason."),
      );
    }

    const decision = candidateVerdictDecisionFromOptions(options);
    if (!isResultOk(decision)) {
      return decision;
    }

    const promotion = await composition.browserQa.orchestrator.promoteCandidateByVerdict({
      refId: findingId,
      reason: options.reason,
      verdictId: `verdict_${Date.now().toString(36)}`,
    });

    if (!isResultOk(promotion)) {
      return promotion;
    }

    return resultOk({
      promotion: promotion.value,
      verdict: {
        decision: decision.value,
        findingId,
        rationale: options.reason,
      },
    });
  }

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

  return resultOk(diffTrackedFindings(before.trackedFindings, after.trackedFindings));
}

async function suggestAlternatives(
  composition: SurfaceComposition,
  options: TargetCommandOptions,
): Promise<Result<AlternativesOutput>> {
  const target = targetFromOptions(options);

  if (!isResultOk(target)) {
    return target;
  }

  const config = configFromOptions(options, {}, compositionProjectRoot(composition));

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
    alternatives: createBoundedAlternatives(target.value),
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

  lines.push(...humanizeModelAudit(data.model));

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

function humanizeModelAudit(model: unknown): readonly string[] {
  if (!isRecord(model)) {
    return [];
  }

  const unavailableChannels = arrayValue(model.unavailableChannels)
    .map((channel) => {
      if (!isRecord(channel)) {
        return undefined;
      }

      const id = stringValue(channel.id);
      const reason = stringValue(channel.reason);

      if (id === undefined && reason === undefined) {
        return undefined;
      }

      return `${id ?? "unknown"}${reason === undefined ? "" : ` (${reason})`}`;
    })
    .filter((channel): channel is string => channel !== undefined);

  return [
    "Model coverage:",
    `- Attempted channels: ${formatStringList(stringArrayValue(model.attemptedChannels))}`,
    `- Completed channels: ${formatStringList(stringArrayValue(model.completedChannels))}`,
    `- Artifact classes sent: ${formatStringList(stringArrayValue(model.artifactClassesSent))}`,
    `- Blocked reasons: ${formatStringList(stringArrayValue(model.blockedReasons))}`,
    `- Unavailable channels: ${formatStringList(unavailableChannels)}`,
  ];
}

function humanizeBacklog(data: unknown, options: { readonly all: boolean }): string {
  if (!isRecord(data)) {
    return `surface backlog: ${JSON.stringify(data)}\n`;
  }

  if (isRecord(data.checkRun)) {
    const checkRun = data.checkRun;
    const target = stringValue(checkRun.target) ?? "github-checks";
    const status = stringValue(checkRun.status) ?? "unknown";
    const annotationCount = numberValue(checkRun.annotationCount) ?? 0;

    return `surface backlog export: ${target} ${status} (${annotationCount} ${plural(
      annotationCount,
      "annotation",
    )})\n`;
  }

  if (isRecord(data.sarif)) {
    const resultCount = arrayValue(data.sarif.runs).flatMap((run) =>
      isRecord(run) ? arrayValue(run.results) : [],
    ).length;

    return `surface backlog export: sarif ${resultCount} ${plural(resultCount, "result")}\n`;
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

function stringArrayValue(value: unknown): readonly string[] {
  return arrayValue(value).filter((entry): entry is string => typeof entry === "string");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatStringList(values: readonly string[]): string {
  return values.length === 0 ? "none" : values.join(", ");
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return count === 1 ? singular : pluralValue;
}

function configFromOptions(
  options: ConfigCommandOptions,
  env: SurfaceCliEnv = {},
  projectRoot: string,
): Result<SurfaceConfig> {
  const cliEvaluation: Record<string, unknown> = {};

  if (options.preset !== undefined) {
    const parsedPreset = PresetSchema.safeParse(options.preset);

    if (!parsedPreset.success) {
      return resultErr(
        createSurfaceError("config_invalid", `Unknown evaluation preset "${options.preset}".`, {
          cause: parsedPreset.error,
          details: { preset: options.preset },
        }),
      );
    }

    cliEvaluation.preset = parsedPreset.data;
  }

  if (options.depth !== undefined) {
    const parsedDepth = parseCliDepthOption(
      options.depth,
      "Evaluation depth must be an integer from 1 to 5.",
      "depth",
    );

    if (!isResultOk(parsedDepth)) {
      return parsedDepth;
    }

    cliEvaluation.depth = parsedDepth.value;
  }

  const envModel = modelConfigLayerFromEnv(env);
  const cliModel = modelConfigLayerFromOptions(options);

  if (!isResultOk(cliModel)) {
    return cliModel;
  }

  const cliLayer: SurfaceConfigLayer = {
    ...(Object.keys(cliEvaluation).length === 0 ? {} : { evaluation: cliEvaluation }),
    ...(cliModel.value === undefined ? {} : { model: cliModel.value }),
  };

  try {
    return resultOk(
      resolveSurfaceConfig({
        ...configLayersFromFiles(env, projectRoot),
        ...(envModel === undefined ? {} : { env: { model: envModel } }),
        ...(Object.keys(cliLayer).length === 0 ? {} : { cli: cliLayer }),
      }),
    );
  } catch (cause) {
    const parsedSurfaceError = SurfaceErrorSchema.safeParse(cause);

    if (parsedSurfaceError.success) {
      return resultErr(parsedSurfaceError.data);
    }

    return resultErr(
      createSurfaceError("config_invalid", "Surface configuration is invalid.", {
        cause,
        details: configErrorDetails(cause),
      }),
    );
  }
}

type ModelConfigLayer = NonNullable<SurfaceConfigLayer["model"]>;

function configLayersFromFiles(
  env: SurfaceCliEnv,
  projectRoot: string,
): {
  readonly project?: SurfaceConfigLayer;
  readonly user?: SurfaceConfigLayer;
} {
  const userConfigPath =
    env.SURFACE_USER_CONFIG_PATH === "off"
      ? undefined
      : (env.SURFACE_USER_CONFIG_PATH ?? path.join(homedir(), ".surface", "config.yml"));
  const projectConfigPath =
    env.SURFACE_PROJECT_CONFIG_PATH === "off"
      ? undefined
      : (env.SURFACE_PROJECT_CONFIG_PATH ?? path.join(projectRoot, ".surface", "config.yml"));

  return {
    ...(userConfigPath === undefined ? {} : layerFromConfigFile(userConfigPath, "user")),
    ...(projectConfigPath === undefined ? {} : layerFromConfigFile(projectConfigPath, "project")),
  };
}

function layerFromConfigFile(
  filePath: string,
  layerName: "project" | "user",
): { readonly project?: SurfaceConfigLayer; readonly user?: SurfaceConfigLayer } {
  let contents: string;

  try {
    contents = readFileSync(filePath, "utf8");
  } catch (cause) {
    if (isMissingConfigFileError(cause)) {
      return {};
    }

    throw cause;
  }

  const parsed = SurfaceConfigLayerSchema.safeParse(parseYaml(contents) ?? {});

  if (!parsed.success) {
    throw new ConfigFileParseError(
      `${layerName} Surface config file is invalid.`,
      layerName,
      filePath,
      zodIssueDetails(parsed.error, layerName) ?? [],
    );
  }

  return { [layerName]: parsed.data };
}

class ConfigFileParseError extends Error {
  constructor(
    message: string,
    readonly layer: "project" | "user",
    readonly path: string,
    readonly configIssues: readonly ConfigIssueDetail[],
  ) {
    super(message);
    this.name = "ConfigFileParseError";
  }
}

function configErrorDetails(cause: unknown): Record<string, unknown> {
  const base =
    cause instanceof Error
      ? { errorMessage: cause.message, errorName: cause.name }
      : { errorMessage: String(cause) };
  const issues = zodIssueDetails(cause);

  return {
    ...base,
    ...(cause instanceof ConfigFileParseError
      ? { issues: cause.configIssues, layer: cause.layer, path: cause.path }
      : issues === undefined
        ? {}
        : { issues }),
  };
}

function zodIssueDetails(
  cause: unknown,
  pathPrefix?: string,
): readonly ConfigIssueDetail[] | undefined {
  if (!isRecord(cause) || !Array.isArray(cause.issues)) {
    return undefined;
  }

  return cause.issues.flatMap((issue) => {
    if (!isRecord(issue) || typeof issue.message !== "string" || typeof issue.code !== "string") {
      return [];
    }

    const rawPath = Array.isArray(issue.path) ? issue.path.map(String) : [];
    const prefixedPath = pathPrefix === undefined ? rawPath : [pathPrefix, ...rawPath];

    return [
      {
        code: issue.code,
        message: issue.message,
        path: prefixedPath.join("."),
      },
    ];
  });
}

function modelConfigLayerFromEnv(env: SurfaceCliEnv): ModelConfigLayer | undefined {
  const fallback: Record<string, unknown> = {};
  const egressPolicy: Record<string, unknown> = {};

  if (env.SURFACE_MODEL_FALLBACK !== undefined) {
    fallback.mode = env.SURFACE_MODEL_FALLBACK;

    if (env.SURFACE_MODEL_FALLBACK !== "off") {
      egressPolicy.mode = "text";
    }
  }

  if (hasByoModelEnv(env) && egressPolicy.mode === undefined) {
    egressPolicy.mode = "text";
  }

  const channels = parseModelChannels(env.SURFACE_MODEL_CHANNELS);

  if (channels.length > 0) {
    fallback.providerOrder = channels;
    fallback.allowedChannels = channels;
  }

  if (env.SURFACE_MODEL_DEPTH !== undefined) {
    const depth = parseOptionalInteger(env.SURFACE_MODEL_DEPTH);

    if (depth !== undefined) {
      fallback.depth = depth;
    }
  }

  applyScreenshotRuntimePolicy(egressPolicy, env.SURFACE_MODEL_SCREENSHOTS);

  return modelLayerFromParts(fallback, egressPolicy);
}

function hasByoModelEnv(env: SurfaceCliEnv): boolean {
  return [
    env.ANTHROPIC_API_KEY,
    env.GEMINI_API_KEY,
    env.OPENAI_API_KEY,
    env.SURFACE_MODEL_BASE_URL,
    env.SURFACE_MODEL_PROVIDER,
  ].some(hasEnvText);
}

function hasEnvText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function modelConfigLayerFromOptions(
  options: ConfigCommandOptions,
): Result<ModelConfigLayer | undefined> {
  const fallback: Record<string, unknown> = {};
  const egressPolicy: Record<string, unknown> = {};

  if (options.modelFallback !== undefined) {
    const parsedFallback = ModelFallbackModeSchema.safeParse(options.modelFallback);

    if (!parsedFallback.success) {
      return resultErr(
        createSurfaceError(
          "config_invalid",
          `Unknown model fallback mode "${options.modelFallback}".`,
          {
            cause: parsedFallback.error,
            details: { modelFallback: options.modelFallback },
          },
        ),
      );
    }

    fallback.mode = parsedFallback.data;

    if (parsedFallback.data !== "off") {
      egressPolicy.mode = "text";
    }
  }

  const channels = parseCliModelChannels([
    options.modelChannels,
    (options.modelChannel ?? []).join(","),
  ]);

  if (!isResultOk(channels)) {
    return channels;
  }

  if (channels.value.length > 0) {
    fallback.providerOrder = channels.value;
    fallback.allowedChannels = channels.value;
  }

  if (options.modelDepth !== undefined) {
    const parsedDepth = parseCliDepthOption(
      options.modelDepth,
      "Model depth must be an integer from 1 to 5.",
      "modelDepth",
    );

    if (!isResultOk(parsedDepth)) {
      return parsedDepth;
    }

    fallback.depth = parsedDepth.value;
  }

  const screenshotPolicy = parseCliScreenshotRuntimePolicy(options.modelScreenshots);

  if (!isResultOk(screenshotPolicy)) {
    return screenshotPolicy;
  }

  if (screenshotPolicy.value !== undefined) {
    egressPolicy.screenshots = screenshotPolicy.value.screenshots;

    if (screenshotPolicy.value.mode !== undefined) {
      egressPolicy.mode = screenshotPolicy.value.mode;
    }
  }

  return resultOk(modelLayerFromParts(fallback, egressPolicy));
}

function parseCliModelChannels(values: readonly (string | undefined)[]): Result<string[]> {
  const channels = values
    .flatMap((value) => rawModelChannels(value))
    .filter((channel, index, allChannels) => allChannels.indexOf(channel) === index);
  const parsedChannels: string[] = [];

  for (const channel of channels) {
    const parsed = DirectSubscriptionChannelIdSchema.safeParse(channel);

    if (!parsed.success) {
      return resultErr(
        createSurfaceError("config_invalid", `Unknown model channel "${channel}".`, {
          cause: parsed.error,
          details: { modelChannel: channel },
        }),
      );
    }

    parsedChannels.push(parsed.data);
  }

  return resultOk(parsedChannels);
}

function parseCliScreenshotRuntimePolicy(
  rawValue: string | boolean | undefined,
): Result<{ readonly mode?: "text-and-screenshots"; readonly screenshots: string } | undefined> {
  if (rawValue === undefined) {
    return resultOk(undefined);
  }

  if (rawValue === false || rawValue === "false" || rawValue === "blocked") {
    return resultOk({ screenshots: "blocked" });
  }

  const value = rawValue === true || rawValue === "true" ? "redacted-only" : rawValue;
  const parsedPolicy = ScreenshotEgressPolicySchema.safeParse(value);

  if (!parsedPolicy.success) {
    return resultErr(
      createSurfaceError("config_invalid", `Unknown model screenshot policy "${String(value)}".`, {
        cause: parsedPolicy.error,
        details: { modelScreenshots: value },
      }),
    );
  }

  return resultOk({
    screenshots: parsedPolicy.data,
    ...(parsedPolicy.data === "redacted-only" ? { mode: "text-and-screenshots" as const } : {}),
  });
}

function modelLayerFromParts(
  fallback: Record<string, unknown>,
  egressPolicy: Record<string, unknown>,
): ModelConfigLayer | undefined {
  const model: Record<string, unknown> = {};

  if (Object.keys(fallback).length > 0) {
    model.fallback = fallback;
  }

  if (Object.keys(egressPolicy).length > 0) {
    model.egressPolicy = egressPolicy;
  }

  return Object.keys(model).length === 0 ? undefined : model;
}

function parseModelChannels(value: string | undefined): string[] {
  return rawModelChannels(value).map((channel) => {
    const parsed = DirectSubscriptionChannelIdSchema.safeParse(channel);
    return parsed.success ? parsed.data : channel;
  });
}

function rawModelChannels(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(",")
    .map((channel) => channel.trim())
    .filter((channel) => channel.length > 0)
    .filter((channel, index, channels) => channels.indexOf(channel) === index);
}

function applyScreenshotRuntimePolicy(
  egressPolicy: Record<string, unknown>,
  rawValue: string | boolean | undefined,
): void {
  if (rawValue === undefined) {
    return;
  }

  if (rawValue === false || rawValue === "false" || rawValue === "blocked") {
    egressPolicy.screenshots = "blocked";
    return;
  }

  const value = rawValue === true || rawValue === "true" ? "redacted-only" : rawValue;
  const parsedPolicy = ScreenshotEgressPolicySchema.safeParse(value);

  if (parsedPolicy.success) {
    egressPolicy.screenshots = parsedPolicy.data;

    if (parsedPolicy.data === "redacted-only") {
      egressPolicy.mode = "text-and-screenshots";
    }
  } else {
    egressPolicy.screenshots = value;
  }
}

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();

  if (!/^[+-]?\d+$/u.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
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
    const captureId = `capture_${nextCliRunId()}`;
    const redactedDom = maskModelArtifactText({
      artifactType: "dom-snapshot",
      text: target.ref,
    }).text;
    const artifact = await composition.stateStore.writeArtifact({
      bytes: Buffer.from(redactedDom, "utf8"),
      kind: "capture",
      relativePath: `captures/${captureId}/dom.html`,
    });

    if (!isResultOk(artifact)) {
      return artifact;
    }

    return resultOk({
      artifacts: [
        {
          id: "dom",
          path: artifact.value.path,
          redacted: redactedDom !== target.ref,
          type: "dom-snapshot",
        },
      ],
      backend: "static",
      capturedAt: new Date(0).toISOString(),
      id: captureId,
      status: "completed",
      target: { ...target, ref: "[redacted-inline-dom]" },
    });
  }

  return await composition.captureService.capture(target, {
    config,
    ...(authStateRef === undefined ? {} : { authStateRef }),
  });
}

function captureForState(capture: Capture): Capture {
  return {
    ...capture,
    ...(capture.verification === undefined
      ? {}
      : {
          verification: {
            ...capture.verification,
            landedUrl: redactStateRef(capture.verification.landedUrl),
            requestedUrl: redactStateRef(capture.verification.requestedUrl),
          },
        }),
    target: {
      ...capture.target,
      ref: redactedTargetRef(capture.target),
    },
  };
}

function redactedTargetRef(target: Target): string {
  if (target.kind === "dom") {
    return "[redacted-inline-dom]";
  }

  return redactStateRef(target.ref);
}

function redactStateRef(value: string): string {
  return maskModelPlainText(redactSensitiveQueryValues(value));
}

function redactSensitiveQueryValues(value: string): string {
  return value.replace(
    /([?&])([^=&#\s]+)=([^&#"'\s]*)/g,
    (match: string, prefix: string, rawKey: string) => {
      const decodedKey = safeDecodeQueryKey(rawKey);

      return isSensitiveQueryKey(decodedKey) ? `${prefix}${rawKey}=[redacted]` : match;
    },
  );
}

function safeDecodeQueryKey(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function isSensitiveQueryKey(value: string): boolean {
  return /token|secret|session|key|auth|credential|password/iu.test(value);
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

function findStoredFinding(state: CliProjectStateSnapshot, findingId: string): Finding | undefined {
  return fullFindingsForState(state).find((finding) => finding.id === findingId);
}

function findStoredTrackedFinding(
  state: CliProjectStateSnapshot,
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

function candidateVerdictDecisionFromOptions(
  options: VerdictCommandOptions,
): Result<VerdictRecord["decision"]> {
  const decisions = [
    options.accept === true ? "accept" : undefined,
    options.reject === true ? "reject" : undefined,
    options.correct === true ? "correct" : undefined,
    options.defer === true ? "defer" : undefined,
  ].filter((decision): decision is VerdictRecord["decision"] => decision !== undefined);

  if (decisions.length > 1) {
    return resultErr(
      createSurfaceError(
        "no_decision_flag",
        "Pass at most one of --accept, --reject, --correct, or --defer for candidate promotion.",
      ),
    );
  }

  return resultOk(decisions[0] ?? "accept");
}

function identityKeysForBaseline(state: CliProjectStateSnapshot): readonly string[] {
  if (state.trackedFindings !== undefined && state.trackedFindings.length > 0) {
    return [...new Set(state.trackedFindings.map((trackedFinding) => trackedFinding.identityKey))];
  }

  return [
    ...new Set(
      fullFindingsForState(state).map((finding) => deriveFindingIdentity(finding).identityKey),
    ),
  ];
}

function backlogForState(
  state: CliProjectStateSnapshot,
  runId: string | undefined,
): Backlog | undefined {
  const parsedBacklog =
    state.backlog === undefined ? undefined : BacklogSchema.safeParse(state.backlog);

  if (parsedBacklog?.success && (runId === undefined || parsedBacklog.data.runId === runId)) {
    return parsedBacklog.data;
  }

  if (state.backlog !== undefined && runId !== undefined && state.backlog.runId !== runId) {
    return undefined;
  }

  const effectiveRunId = runId ?? "current";
  const findings = fullFindingsForState(state);

  return backlogFromFindings(effectiveRunId, findings);
}

function fullFindingsForState(state: CliProjectStateSnapshot): readonly Finding[] {
  return (state.findings ?? [])
    .map((finding) => FindingSchema.safeParse(finding))
    .filter(
      (result): result is { readonly success: true; readonly data: Finding } => result.success,
    )
    .map((result) => result.data);
}

function persistedFindingsForTrackedState(
  previousState: CliProjectStateSnapshot,
  currentFindings: readonly Finding[],
  trackedFindings: readonly TrackedFinding[],
): readonly Finding[] {
  const findingsById = new Map(
    [...fullFindingsForState(previousState), ...currentFindings].map((finding) => [
      finding.id,
      finding,
    ]),
  );
  const seenFindingIds = new Set<string>();
  const persistedFindings: Finding[] = [];

  for (const trackedFinding of trackedFindings) {
    const findingId = trackedFinding.currentFindingId;

    if (findingId === undefined || seenFindingIds.has(findingId)) {
      continue;
    }

    const finding = findingsById.get(findingId);

    if (finding === undefined) {
      continue;
    }

    seenFindingIds.add(findingId);
    persistedFindings.push(finding);
  }

  for (const finding of currentFindings) {
    if (seenFindingIds.has(finding.id)) {
      continue;
    }

    seenFindingIds.add(finding.id);
    persistedFindings.push(finding);
  }

  return persistedFindings;
}

function sanitizeModelEgressLedger(
  entries: AuditRunnerResult["modelEgress"],
): Result<AuditRunnerResult["modelEgress"], SurfaceError> {
  try {
    return resultOk(entries.map((entry) => createModelEgressLedgerEntry(entry)));
  } catch (error) {
    return resultErr(
      createSurfaceError("state_write_failed", "Model egress ledger is invalid.", {
        cause: error,
      }),
    );
  }
}

function backlogFromFindings(runId: string, findings: readonly Finding[]): Backlog {
  return {
    entries: findings.map((finding, index) => ({
      findingId: finding.id,
      priority: Math.max(0, findings.length - index),
      rank: index + 1,
      severityBand: finding.severityBand ?? "P3",
      title: finding.title ?? finding.rationale,
    })),
    id: `backlog_${runId}`,
    runId,
  };
}

// Keep enough model-egress history for recent audits without letting state files grow unbounded.
const MAX_MODEL_EGRESS_LEDGER_ENTRIES = 100;

function appendModelEgressLedger<T>(
  previous: readonly T[] | undefined,
  current: readonly T[],
): readonly T[] {
  return [...(previous ?? []), ...current].slice(-MAX_MODEL_EGRESS_LEDGER_ENTRIES);
}

function parseCliDepthOption(
  value: string,
  message: string,
  detailKey: "depth" | "modelDepth",
): Result<number, SurfaceError> {
  if (!/^[1-5]$/u.test(value)) {
    return resultErr(
      createSurfaceError("config_invalid", message, {
        details: { [detailKey]: value },
      }),
    );
  }

  const parsedDepth = DepthSchema.safeParse(Number(value));

  if (!parsedDepth.success) {
    return resultErr(
      createSurfaceError("config_invalid", message, {
        cause: parsedDepth.error,
        details: { [detailKey]: value },
      }),
    );
  }

  return resultOk(parsedDepth.data);
}

function modelAuditOutput(audit: AuditRunnerResult): { readonly model?: ModelAuditOutput } {
  const attemptedChannels = [
    ...new Set(audit.modelEgress.flatMap((entry) => entry.attemptedChannels)),
  ];
  const completedChannels = [
    ...new Set(audit.modelEgress.flatMap((entry) => entry.completedChannels)),
  ];
  const artifactClassesSent = [
    ...new Set(audit.modelEgress.flatMap((entry) => entry.artifactClassesSent)),
  ];
  const blockedReasons = [
    ...new Set([
      ...audit.blockedReasons,
      ...audit.modelEgress.flatMap((entry) => entry.blockedReasons),
    ]),
  ];
  const unavailableChannels = [
    ...audit.unavailableChannels.map((channel) => ({
      id: channel.id,
      message: sanitizeModelAuditMessage(channel.message),
      reason: channel.reason,
    })),
    ...audit.modelEgress.flatMap((entry) =>
      entry.unavailableChannels.map((channel) => ({
        id: channel.channelId ?? "unknown",
        message: sanitizeModelAuditMessage(channel.message),
        reason: channel.reason,
      })),
    ),
  ];

  if (
    attemptedChannels.length === 0 &&
    completedChannels.length === 0 &&
    artifactClassesSent.length === 0 &&
    blockedReasons.length === 0 &&
    unavailableChannels.length === 0
  ) {
    return {};
  }

  return {
    model: {
      artifactClassesSent,
      attemptedChannels,
      blockedReasons,
      completedChannels,
      unavailableChannels: dedupeUnavailableChannels(unavailableChannels),
    },
  };
}

function dedupeUnavailableChannels(
  channels: readonly { readonly id: string; readonly message: string; readonly reason: string }[],
): ModelAuditOutput["unavailableChannels"] {
  const seen = new Set<string>();
  const deduped: { readonly id: string; readonly message: string; readonly reason: string }[] = [];

  for (const channel of channels) {
    const key = [channel.id, channel.reason, channel.message].join("\0");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(channel);
  }

  return deduped;
}

function sanitizeModelAuditMessage(message: string): string {
  return maskModelPlainText(message);
}

function trackedFindingsForAudit(
  state: CliProjectStateSnapshot,
  runId: string,
  findings: readonly Finding[],
  skippedLenses: readonly { readonly lensId: string }[] = [],
  evaluatedLenses: readonly string[] | undefined = undefined,
  auditScopeLenses: readonly string[] | undefined = undefined,
): readonly TrackedFinding[] {
  const previousByKey = new Map(
    (state.trackedFindings ?? []).map((trackedFinding) => [
      trackedFinding.identityKey,
      trackedFinding,
    ]),
  );
  const previousByFindingId = new Map(
    (state.trackedFindings ?? [])
      .filter((trackedFinding) => trackedFinding.currentFindingId !== undefined)
      .map((trackedFinding) => [trackedFinding.currentFindingId as string, trackedFinding]),
  );
  const currentTracked: TrackedFinding[] = [];
  const currentIdentityKeys = new Set<string>();
  const skippedLensIds = new Set(skippedLenses.map((skip) => skip.lensId));
  const evaluatedLensIds = new Set(evaluatedLenses ?? []);
  const auditScopeWasRequested = auditScopeLenses !== undefined;
  const auditScopeLensIds = new Set(
    (auditScopeLenses ?? []).filter(
      (lensId) => evaluatedLensIds.has(lensId) || skippedLensIds.has(lensId),
    ),
  );
  const identityAssignmentsByFindingId = new Map(
    assignFindingIdentities(findings).map((assignment) => [assignment.findingId, assignment]),
  );

  for (const finding of findings) {
    const identityAssignment = identityAssignmentsByFindingId.get(finding.id);
    const previousWithSameFindingId = previousByFindingId.get(finding.id);

    if (identityAssignment?.status !== "stable") {
      if (
        previousWithSameFindingId !== undefined &&
        !currentIdentityKeys.has(previousWithSameFindingId.identityKey)
      ) {
        currentTracked.push(
          transitionTrackedFinding(previousWithSameFindingId, {
            currentFindingId: finding.id,
            kind: "identity-broken",
            runId,
          }),
        );
        currentIdentityKeys.add(previousWithSameFindingId.identityKey);
      }

      continue;
    }

    const identity = identityAssignment.identity;
    const identityKey = identity.identityKey;
    const previous = previousByKey.get(identityKey);

    if (
      previous === undefined &&
      previousWithSameFindingId !== undefined &&
      previousWithSameFindingId.identityKey !== identityKey &&
      !currentIdentityKeys.has(previousWithSameFindingId.identityKey)
    ) {
      currentTracked.push(
        transitionTrackedFinding(previousWithSameFindingId, {
          currentFindingId: finding.id,
          kind: "identity-broken",
          runId,
        }),
      );
      currentIdentityKeys.add(previousWithSameFindingId.identityKey);
    }

    currentIdentityKeys.add(identityKey);
    currentTracked.push(trackedFindingForCurrentFinding(finding, identity, previous, runId));
  }

  for (const previous of state.trackedFindings ?? []) {
    if (currentIdentityKeys.has(previous.identityKey)) {
      continue;
    }

    if (
      shouldPreservePreviousTrackedFinding(
        previous,
        skippedLensIds,
        evaluatedLensIds,
        auditScopeLensIds,
        auditScopeWasRequested,
      )
    ) {
      currentTracked.push(previous);
      continue;
    }

    currentTracked.push(
      transitionTrackedFinding(previous, {
        kind: "missing",
        runId,
        validationPassed: true,
      }),
    );
  }

  return currentTracked;
}

function shouldPreservePreviousTrackedFinding(
  previous: TrackedFinding,
  skippedLensIds: ReadonlySet<string>,
  evaluatedLensIds: ReadonlySet<string>,
  auditScopeLensIds: ReadonlySet<string>,
  auditScopeWasRequested: boolean,
): boolean {
  const lensId = previous.identity.lens;

  if (auditScopeWasRequested) {
    return !auditScopeLensIds.has(lensId) || skippedLensIds.has(lensId);
  }

  if (evaluatedLensIds.size === 0 && skippedLensIds.size === 0) {
    return true;
  }

  return skippedLensIds.has(lensId) || (evaluatedLensIds.size > 0 && !evaluatedLensIds.has(lensId));
}

function trackedFindingForCurrentFinding(
  finding: Finding,
  identity: TrackedFinding["identity"],
  previous: TrackedFinding | undefined,
  runId: string,
): TrackedFinding {
  if (previous === undefined) {
    return createTrackedFinding({
      finding,
      identity,
      runId,
      validation: validationForFinding(finding),
    });
  }

  return transitionTrackedFinding(previous, {
    finding,
    identity,
    kind: "detected",
    runId,
  });
}

function validationForFinding(finding: Finding): TrackedFinding["validation"] {
  const measuredRule = finding.evidence.find(
    (entry) => entry.kind === "tool-result" && typeof entry.rule === "string",
  );

  if (measuredRule?.kind === "tool-result" && typeof measuredRule.rule === "string") {
    return {
      expectation: `${measuredRule.tool} ${measuredRule.rule} passes`,
      kind: "measured-rule",
    };
  }

  return {
    expectation: `${finding.lens} lens no longer reports ${finding.issueType}`,
    kind: "re-evaluate-lens",
  };
}

function nextCliRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function surfaceErrorForThrown(cause: unknown): SurfaceError {
  if (cause instanceof CommanderError) {
    return createSurfaceError("unknown_step", "Unknown or invalid surface command.", {
      cause,
      details: { commanderCode: cause.code, commanderMessage: cause.message },
    });
  }

  if (cause instanceof Error) {
    return createSurfaceError("unknown_step", "Surface command failed before execution.", {
      cause,
      details: { errorMessage: cause.message, errorName: cause.name },
    });
  }

  return createSurfaceError("unknown_step", "Surface command failed before execution.", {
    details: { errorMessage: String(cause) },
  });
}

function isMissingConfigFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "EISDIR")
  );
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

function isDirectCliInvocation(argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) {
    return false;
  }

  try {
    return realpathSync(new URL(import.meta.url)) === realpathSync(argvEntry);
  } catch {
    return import.meta.url === pathToFileURL(argvEntry).href;
  }
}

if (isDirectCliInvocation(process.argv[1])) {
  process.exitCode = await runSurfaceCli();
}
