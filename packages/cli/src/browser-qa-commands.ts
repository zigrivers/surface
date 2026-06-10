import path from "node:path";

import { Command } from "commander";

import {
  createSurfaceError,
  expandExistingFilePattern,
  ok,
  projectRelativePath,
  toPosixPath,
  wildcardMatches,
  type Result,
  type SurfaceError,
} from "@zigrivers/surface-core";

type FlowTargetCliOptions = {
  readonly baseUrl?: string;
  readonly localhost?: boolean;
  readonly target?: string;
  readonly url?: string;
};

type BrowserQaTarget = {
  readonly kind: "url" | "localhost" | "route" | "screenshot" | "component" | "dom";
  readonly ref: string;
};

type BrowserQaRunOutput = {
  readonly candidateFindings: readonly unknown[];
  readonly candidateFlows: readonly unknown[];
  readonly degradation: readonly unknown[];
  readonly evidenceBundles: readonly string[];
  readonly findings: readonly string[];
  readonly flowRuns: readonly unknown[];
  readonly mode: string;
  readonly qaRunId: string;
  readonly target: BrowserQaTarget;
};

type BrowserQaReportFormat = "md" | "json" | "manifest";

type BrowserQaOrchestrator = {
  readonly cleanup: (input: { readonly dryRun?: boolean }) => Promise<
    Result<
      {
        readonly cleaned: readonly string[];
        readonly dryRun: boolean;
        readonly skipped: readonly string[];
      },
      SurfaceError
    >
  >;
  readonly readEvidence: (input: {
    readonly refId: string;
  }) => Promise<
    Result<{ readonly refId: string; readonly summaries: readonly unknown[] }, SurfaceError>
  >;
  readonly reportQa: (input: {
    readonly format?: BrowserQaReportFormat;
    readonly runId: string;
  }) => Promise<
    Result<
      {
        readonly format: BrowserQaReportFormat;
        readonly report: unknown;
      },
      SurfaceError
    >
  >;
  readonly replay: (input: {
    readonly promoteOnRepro?: boolean;
    readonly refId: string;
  }) => Promise<
    Result<{ readonly promotion?: unknown; readonly replayStatus: string }, SurfaceError>
  >;
  readonly promoteCandidateByVerdict: (input: {
    readonly reason: string;
    readonly refId: string;
    readonly verdictId: string;
  }) => Promise<
    Result<{ readonly promotion?: unknown; readonly replayStatus: string }, SurfaceError>
  >;
  readonly runExplore: (input: {
    readonly actionPolicyRef?: string;
    readonly allowedDomains?: readonly string[];
    readonly evidence?: "minimal" | "failures" | "full";
    readonly maxActions: number;
    readonly maxDepth: number;
    readonly maxStates: number;
    readonly network?: "summary" | "har" | "off";
    readonly qaRunId?: string;
    readonly scope?: string;
    readonly sessionMode?: "isolated" | "shared";
    readonly stateLockTimeoutMs?: number;
    readonly target: BrowserQaTarget;
    readonly task?: string;
    readonly video?: "off" | "failures" | "all";
  }) => Promise<
    Result<
      {
        readonly candidateFindings: readonly unknown[];
        readonly candidateFlows: readonly unknown[];
        readonly qaRunId: string;
      },
      SurfaceError
    >
  >;
  readonly runQa: (input: {
    readonly actionPolicyRef?: string;
    readonly allowedDomains?: readonly string[];
    readonly ci?: boolean;
    readonly evidence?: "minimal" | "failures" | "full";
    readonly explore?: boolean;
    readonly flows?: readonly string[];
    readonly maxActions?: number;
    readonly maxDepth?: number;
    readonly maxStates?: number;
    readonly network?: "summary" | "har" | "off";
    readonly scope?: string;
    readonly sessionMode?: "isolated" | "shared";
    readonly stateLockTimeoutMs?: number;
    readonly target: BrowserQaTarget;
    readonly task?: string;
    readonly video?: "off" | "failures" | "all";
  }) => Promise<Result<BrowserQaRunOutput, SurfaceError>>;
};

type BrowserQaFlowRun = {
  readonly evidenceBundles: readonly string[];
  readonly flowId: string;
  readonly highestFailedSeverity?: string;
  readonly id: string;
  readonly status: string;
  readonly target: unknown;
};

type BrowserQaFlowService = {
  readonly listFlows: (input?: {
    readonly candidates?: boolean;
  }) => Promise<Result<{ readonly flows: readonly unknown[] }, SurfaceError>>;
  readonly promoteFlow: (input: {
    readonly candidateFlowId: string;
    readonly outPath: string;
  }) => Promise<
    Result<
      {
        readonly candidateFlowId: string;
        readonly outPath: string;
        readonly status: "written";
      },
      SurfaceError
    >
  >;
  readonly runFlowFile: (input: {
    readonly actionPolicyRef?: string;
    readonly ci?: boolean;
    readonly flowPath: string;
    readonly targetCli?: FlowTargetCliOptions;
  }) => Promise<
    Result<
      {
        readonly flowRun: BrowserQaFlowRun;
        readonly qaRunId: string;
      },
      SurfaceError
    >
  >;
  readonly showFlow: (id: string) => Promise<Result<{ readonly flow: unknown }, SurfaceError>>;
  readonly updateFlowRefs: (input: {
    readonly flowPath: string;
  }) => Promise<Result<{ readonly flowId: string; readonly updatedRefs: number }, SurfaceError>>;
};

export type BrowserQaCliOptions = {
  readonly composition: unknown;
  readonly emitResult: <T>(input: {
    readonly command: string;
    readonly result: Result<T, SurfaceError>;
  }) => void;
  readonly jsonRequested: () => boolean;
  readonly stdout: (chunk: string) => void;
};

type FlowRunCommandOptions = {
  readonly actionPolicy?: string;
  readonly baseUrl?: string;
  readonly ci?: boolean;
  readonly localhost?: boolean | string;
  readonly target?: string;
  readonly url?: string;
};

type FlowListCommandOptions = {
  readonly candidates?: boolean;
};

type FlowPromoteCommandOptions = {
  readonly out: string;
};

type BrowserQaTargetCommandOptions = {
  readonly component?: string;
  readonly dom?: string;
  readonly localhost?: boolean | string;
  readonly route?: string;
  readonly screenshot?: string;
  readonly target?: string;
  readonly url?: string;
};

type BrowserQaCommandOptions = BrowserQaTargetCommandOptions & {
  readonly actionPolicy?: string;
  readonly allowedDomains?: string[];
  readonly ci?: boolean;
  readonly evidence?: string;
  readonly explore?: boolean;
  readonly flows?: string[];
  readonly maxActions?: string;
  readonly maxDepth?: string;
  readonly maxStates?: string;
  readonly network?: string;
  readonly scope?: string;
  readonly sessionMode?: string;
  readonly stateLockTimeout?: string;
  readonly task?: string;
  readonly video?: string;
};

type BrowserQaCleanupCommandOptions = {
  readonly dryRun?: boolean;
};

type BrowserQaReplayCommandOptions = {
  readonly promoteOnRepro?: boolean;
};

type BrowserQaReportCommandOptions = {
  readonly format?: string;
  readonly run: string;
};

type FlowRunOutput = {
  readonly evidenceBundles: readonly string[];
  readonly flowId: string;
  readonly flowRunId: string;
  readonly highestFailedSeverity?: string;
  readonly qaRunId: string;
  readonly status: string;
  readonly target: unknown;
};

export function registerBrowserQaCommands(program: Command, options: BrowserQaCliOptions): void {
  const orchestrator = orchestratorFromComposition(options.composition);
  const qa = addBrowserQaTargetOptions(
    program.command("qa").description("Run agent-led browser QA."),
  );
  addBrowserQaExecutionOptions(qa)
    .option("--flows <glob>", "run reviewed flow file or glob", collectOption, [])
    .option("--explore", "enable bounded autonomous exploration")
    .option("--task <task>", "task text for deterministic exploration scoring")
    .option("--scope <scope>", "scope text for deterministic exploration scoring")
    .option("--ci", "fail closed when browser QA preflight checks cannot be verified")
    .option("--max-depth <n>", "maximum exploration depth")
    .option("--max-actions <n>", "maximum attempted exploration actions")
    .option("--max-states <n>", "maximum unique states to visit");

  qa.command("cleanup")
    .description("Clean up stale Surface-owned browser QA sessions.")
    .option("--dry-run", "report stale sessions without cleaning")
    .action(async (commandOptions: BrowserQaCleanupCommandOptions) => {
      options.emitResult({
        command: "qa cleanup",
        result: await orchestrator.cleanup({ dryRun: commandOptions.dryRun === true }),
      });
    });

  qa.action(async (commandOptions: BrowserQaCommandOptions) => {
    const target = targetFromBrowserQaOptions(commandOptions);
    if (!target.ok) {
      options.emitResult({ command: "qa", result: target });
      return;
    }
    const executionOptions = browserQaExecutionOptions(commandOptions);
    if (!executionOptions.ok) {
      options.emitResult({ command: "qa", result: executionOptions });
      return;
    }

    options.emitResult({
      command: "qa",
      result: await orchestrator.runQa({
        ...executionOptions.value,
        ...(commandOptions.ci === undefined ? {} : { ci: commandOptions.ci }),
        ...(commandOptions.explore === undefined ? {} : { explore: commandOptions.explore }),
        ...(commandOptions.flows === undefined || commandOptions.flows.length === 0
          ? {}
          : { flows: commandOptions.flows }),
        ...numberOption("maxActions", commandOptions.maxActions),
        ...numberOption("maxDepth", commandOptions.maxDepth),
        ...numberOption("maxStates", commandOptions.maxStates),
        ...(commandOptions.scope === undefined ? {} : { scope: commandOptions.scope }),
        target: target.value,
        ...(commandOptions.task === undefined ? {} : { task: commandOptions.task }),
      }),
    });
  });

  const explore = addBrowserQaTargetOptions(
    program.command("explore").description("Run focused browser QA exploration."),
  );
  addBrowserQaExecutionOptions(explore)
    .option("--task <task>", "task text for deterministic exploration scoring")
    .option("--scope <scope>", "scope text for deterministic exploration scoring")
    .option("--max-depth <n>", "maximum exploration depth", "2")
    .option("--max-actions <n>", "maximum attempted exploration actions", "25")
    .option("--max-states <n>", "maximum unique states to visit", "10")
    .action(async (commandOptions: BrowserQaCommandOptions) => {
      const target = targetFromBrowserQaOptions(commandOptions);
      if (!target.ok) {
        options.emitResult({ command: "explore", result: target });
        return;
      }
      const executionOptions = browserQaExecutionOptions(commandOptions);
      if (!executionOptions.ok) {
        options.emitResult({ command: "explore", result: executionOptions });
        return;
      }

      options.emitResult({
        command: "explore",
        result: await orchestrator.runExplore({
          ...executionOptions.value,
          maxActions: parsePositiveIntOption(commandOptions.maxActions, 25),
          maxDepth: parsePositiveIntOption(commandOptions.maxDepth, 2),
          maxStates: parsePositiveIntOption(commandOptions.maxStates, 10),
          ...(commandOptions.scope === undefined ? {} : { scope: commandOptions.scope }),
          target: target.value,
          ...(commandOptions.task === undefined ? {} : { task: commandOptions.task }),
        }),
      });
    });

  program
    .command("evidence")
    .description("Read redacted browser QA evidence metadata.")
    .argument("<ref>", "QA run, finding, candidate, or evidence ref")
    .action(async (refId: string) => {
      options.emitResult({
        command: "evidence",
        result: await orchestrator.readEvidence({ refId }),
      });
    });

  program
    .command("replay")
    .description("Replay a browser QA finding or candidate.")
    .argument("<ref>", "finding or candidate ref")
    .option("--promote-on-repro", "promote candidate when replay reproduces the issue")
    .action(async (refId: string, commandOptions: BrowserQaReplayCommandOptions) => {
      options.emitResult({
        command: "replay",
        result: await orchestrator.replay({
          promoteOnRepro: commandOptions.promoteOnRepro === true,
          refId,
        }),
      });
    });

  program
    .command("report")
    .description("Render Surface reports.")
    .command("qa")
    .description("Render a browser QA report.")
    .requiredOption("--run <runId>", "QA run id")
    .option("--format <format>", "report format: md, json, or manifest", "md")
    .action(async (commandOptions: BrowserQaReportCommandOptions) => {
      const format = qaReportFormatFromOption(commandOptions.format);
      if (!format.ok) {
        options.emitResult({ command: "report qa", result: format });
        return;
      }

      const result = await orchestrator.reportQa({
        format: format.value,
        runId: commandOptions.run,
      });

      if (
        result.ok &&
        format.value === "md" &&
        !options.jsonRequested() &&
        typeof result.value.report === "string"
      ) {
        options.stdout(result.value.report);
        return;
      }

      options.emitResult({
        command: "report qa",
        result,
      });
    });

  const flow = program.command("flow").description("Run and manage browser QA flows.");
  const flowService = flowServiceFromComposition(options.composition);

  flow
    .command("run")
    .description("Run a deterministic browser QA flow.")
    .argument("<flow>", "flow YAML file")
    .option("--action-policy <path>", "override the flow action policy file")
    .option("--target <url>", "override the flow target URL")
    .option("--url <url>", "target URL alias")
    .option("--localhost", "use http://localhost:3000; custom ports use --url")
    .option("--base-url <url>", "replace only the target origin")
    .option("--ci", "fail closed for CI flow policy violations")
    .action(async (flowPath: string, commandOptions: FlowRunCommandOptions) => {
      const targetCli = targetCliFromFlowOptions(commandOptions);
      if (!targetCli.ok) {
        options.emitResult({ command: "flow run", result: targetCli });
        return;
      }

      const expanded = await expandFlowArgument(process.cwd(), flowPath);
      if (!expanded.ok) {
        options.emitResult({ command: "flow run", result: expanded });
        return;
      }

      const runs: FlowRunOutput[] = [];
      for (const matchedFlowPath of expanded.value.matched) {
        const result = await flowService.runFlowFile({
          ...(commandOptions.actionPolicy === undefined
            ? {}
            : { actionPolicyRef: commandOptions.actionPolicy }),
          ...(commandOptions.ci === undefined ? {} : { ci: commandOptions.ci }),
          flowPath: matchedFlowPath,
          targetCli: targetCli.value,
        });

        if (!result.ok) {
          options.emitResult({ command: "flow run", result });
          return;
        }

        runs.push(flowRunOutputFor(result.value));
      }

      const output: Result<
        FlowRunOutput | { readonly count: number; readonly runs: FlowRunOutput[] },
        SurfaceError
      > =
        expanded.value.fromGlob || runs.length !== 1
          ? ok({ count: runs.length, runs })
          : ok(runs[0] as FlowRunOutput);

      options.emitResult({
        command: "flow run",
        result: output,
      });
    });

  flow
    .command("list")
    .description("List browser QA flow runs or candidate flows.")
    .option("--candidates", "list candidate flows")
    .action(async (commandOptions: FlowListCommandOptions) => {
      options.emitResult({
        command: "flow list",
        result: await flowService.listFlows({ candidates: commandOptions.candidates === true }),
      });
    });

  flow
    .command("show")
    .description("Show a browser QA flow run, candidate, or reviewed flow.")
    .argument("<id>", "flow id")
    .action(async (id: string) => {
      options.emitResult({
        command: "flow show",
        result: await flowService.showFlow(id),
      });
    });

  flow
    .command("promote")
    .description("Promote a candidate flow into a source-controlled YAML flow.")
    .argument("<candidate-flow-id>", "candidate flow id")
    .requiredOption("--out <path>", "output flow YAML path")
    .action(async (candidateFlowId: string, commandOptions: FlowPromoteCommandOptions) => {
      options.emitResult({
        command: "flow promote",
        result: await flowService.promoteFlow({
          candidateFlowId,
          outPath: commandOptions.out,
        }),
      });
    });

  flow
    .command("update-refs")
    .description("Refresh volatile browser element refs in a reviewed flow.")
    .argument("<flow>", "flow YAML file")
    .action(async (flowPath: string) => {
      options.emitResult({
        command: "flow update-refs",
        result: await flowService.updateFlowRefs({ flowPath }),
      });
    });
}

function addBrowserQaTargetOptions(command: Command): Command {
  return command
    .option("--target <url>", "target URL")
    .option("--url <url>", "target URL alias")
    .option("--localhost", "use http://localhost:3000; custom ports use --url")
    .option("--route <route>", "application route")
    .option("--screenshot <path>", "screenshot path")
    .option("--component <name>", "component reference")
    .option("--dom <html>", "DOM snapshot");
}

function addBrowserQaExecutionOptions(command: Command): Command {
  return command
    .option("--action-policy <path>", "action policy file for browser QA")
    .option("--allowed-domains <domain>", "additional allowed browser QA domain", collectOption, [])
    .option("--evidence <mode>", "evidence mode: minimal, failures, or full")
    .option("--session-mode <mode>", "session mode: isolated or shared")
    .option("--network <mode>", "network evidence mode: summary, har, or off")
    .option("--video <mode>", "video evidence mode: off, failures, or all")
    .option("--state-lock-timeout <ms>", "state lock timeout in milliseconds");
}

function targetCliFromFlowOptions(
  options: FlowRunCommandOptions,
): Result<FlowTargetCliOptions, SurfaceError> {
  if (typeof options.localhost === "string") {
    return {
      error: createSurfaceError(
        "no_target",
        "--localhost is a boolean browser QA flag. Use --url or --target for custom local ports.",
        { details: { localhost: options.localhost } },
      ),
      ok: false,
    };
  }

  const targetFlags = [
    options.target === undefined ? undefined : "--target",
    options.url === undefined ? undefined : "--url",
    options.localhost === true ? "--localhost" : undefined,
  ].filter((value): value is string => value !== undefined);

  if (targetFlags.length > 1) {
    return {
      error: createSurfaceError("no_target", "Browser QA target flags are mutually exclusive.", {
        details: { targetFlags },
      }),
      ok: false,
    };
  }

  return ok({
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.localhost === true ? { localhost: true } : {}),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.url === undefined ? {} : { url: options.url }),
  });
}

function browserQaExecutionOptions(commandOptions: BrowserQaCommandOptions): Result<
  {
    readonly actionPolicyRef?: string;
    readonly allowedDomains?: readonly string[];
    readonly evidence?: "minimal" | "failures" | "full";
    readonly network?: "summary" | "har" | "off";
    readonly sessionMode?: "isolated" | "shared";
    readonly stateLockTimeoutMs?: number;
    readonly video?: "off" | "failures" | "all";
  },
  SurfaceError
> {
  const evidence = enumOption(commandOptions.evidence, ["minimal", "failures", "full"], "evidence");
  if (!evidence.ok) {
    return evidence;
  }

  const network = enumOption(commandOptions.network, ["summary", "har", "off"], "network");
  if (!network.ok) {
    return network;
  }

  const sessionMode = enumOption(
    commandOptions.sessionMode,
    ["isolated", "shared"],
    "session-mode",
  );
  if (!sessionMode.ok) {
    return sessionMode;
  }

  const video = enumOption(commandOptions.video, ["off", "failures", "all"], "video");
  if (!video.ok) {
    return video;
  }

  return ok({
    ...(commandOptions.actionPolicy === undefined
      ? {}
      : { actionPolicyRef: commandOptions.actionPolicy }),
    ...(commandOptions.allowedDomains === undefined || commandOptions.allowedDomains.length === 0
      ? {}
      : { allowedDomains: commandOptions.allowedDomains }),
    ...(evidence.value === undefined ? {} : { evidence: evidence.value }),
    ...(network.value === undefined ? {} : { network: network.value }),
    ...(sessionMode.value === undefined ? {} : { sessionMode: sessionMode.value }),
    ...(commandOptions.stateLockTimeout === undefined
      ? {}
      : { stateLockTimeoutMs: parsePositiveIntOption(commandOptions.stateLockTimeout, 0) }),
    ...(video.value === undefined ? {} : { video: video.value }),
  });
}

function enumOption<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  field: string,
): Result<T | undefined, SurfaceError> {
  if (value === undefined) {
    return ok(undefined);
  }

  if ((allowed as readonly string[]).includes(value)) {
    return ok(value as T);
  }

  return {
    error: createSurfaceError("config_invalid", "Browser QA option value is invalid.", {
      details: { allowed, field, value },
    }),
    ok: false,
  };
}

async function expandFlowArgument(
  projectRoot: string,
  flowPath: string,
): Promise<
  Result<{ readonly fromGlob: boolean; readonly matched: readonly string[] }, SurfaceError>
> {
  if (!flowPath.includes("*")) {
    return ok({ fromGlob: false, matched: [flowPath] });
  }

  const absolutePattern = path.isAbsolute(flowPath) ? flowPath : path.join(projectRoot, flowPath);
  const normalizedPattern = toPosixPath(absolutePattern);
  const matched = (await expandExistingFilePattern(absolutePattern))
    .map((file) => path.resolve(file))
    .filter((file) => wildcardMatches(normalizedPattern, toPosixPath(file)))
    .map((file) => projectRelativePath(projectRoot, file));

  if (matched.length === 0) {
    return {
      error: createSurfaceError("flow_invalid", "Browser QA flow glob did not match any files.", {
        details: { flowPath },
      }),
      ok: false,
    };
  }

  return ok({ fromGlob: true, matched: [...new Set(matched)] });
}

function flowRunOutputFor(value: {
  readonly flowRun: BrowserQaFlowRun;
  readonly qaRunId: string;
}): FlowRunOutput {
  const flowRun = value.flowRun;

  return {
    evidenceBundles: flowRun.evidenceBundles,
    flowId: flowRun.flowId,
    flowRunId: flowRun.id,
    ...(flowRun.highestFailedSeverity === undefined
      ? {}
      : { highestFailedSeverity: flowRun.highestFailedSeverity }),
    qaRunId: value.qaRunId,
    status: flowRun.status,
    target: flowRun.target,
  };
}

function targetFromBrowserQaOptions(
  options: BrowserQaTargetCommandOptions,
): Result<BrowserQaTarget, SurfaceError> {
  if (typeof options.localhost === "string") {
    return {
      error: createSurfaceError(
        "no_target",
        "--localhost is a boolean browser QA flag. Use --url or --target for custom local ports.",
        { details: { localhost: options.localhost } },
      ),
      ok: false,
    };
  }

  const targets = [
    options.target === undefined ? undefined : { kind: "url" as const, ref: options.target },
    options.url === undefined ? undefined : { kind: "url" as const, ref: options.url },
    options.localhost === true
      ? { kind: "localhost" as const, ref: "http://localhost:3000" }
      : undefined,
    options.route === undefined ? undefined : { kind: "route" as const, ref: options.route },
    options.screenshot === undefined
      ? undefined
      : { kind: "screenshot" as const, ref: options.screenshot },
    options.component === undefined
      ? undefined
      : { kind: "component" as const, ref: options.component },
    options.dom === undefined ? undefined : { kind: "dom" as const, ref: options.dom },
  ].filter((value): value is BrowserQaTarget => value !== undefined);

  if (targets.length !== 1) {
    return {
      error: createSurfaceError(
        "no_target",
        targets.length === 0
          ? "No browser QA target given."
          : "Browser QA target flags are mutually exclusive.",
      ),
      ok: false,
    };
  }

  const [target] = targets;
  if (target === undefined) {
    return {
      error: createSurfaceError("no_target", "No browser QA target given."),
      ok: false,
    };
  }

  return ok(target);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePositiveIntOption(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOption(
  key: "maxActions" | "maxDepth" | "maxStates",
  value: string | undefined,
): Partial<Record<typeof key, number>> {
  return value === undefined ? {} : { [key]: parsePositiveIntOption(value, 0) };
}

function qaReportFormatFromOption(
  value: string | undefined,
): Result<BrowserQaReportFormat, SurfaceError> {
  if (value === undefined || value === "md" || value === "json" || value === "manifest") {
    return ok(value ?? "md");
  }

  return {
    error: createSurfaceError("unknown_export_target", "Unknown browser QA report format.", {
      details: { format: value },
    }),
    ok: false,
  };
}

function createUnavailableOrchestrator(): BrowserQaOrchestrator {
  const unavailable = () =>
    Promise.resolve({
      error: createSurfaceError(
        "qa_unavailable",
        "Browser QA orchestrator is not available in this Surface composition.",
      ),
      ok: false as const,
    });

  return {
    cleanup: unavailable,
    promoteCandidateByVerdict: unavailable,
    readEvidence: unavailable,
    reportQa: unavailable,
    replay: unavailable,
    runExplore: unavailable,
    runQa: unavailable,
  };
}

function createUnavailableFlowService(): BrowserQaFlowService {
  const unavailable = () =>
    Promise.resolve({
      error: createSurfaceError(
        "qa_unavailable",
        "Browser QA flow services are not available in this Surface composition.",
      ),
      ok: false as const,
    });

  return {
    listFlows: unavailable,
    promoteFlow: unavailable,
    runFlowFile: unavailable,
    showFlow: unavailable,
    updateFlowRefs: unavailable,
  };
}

function orchestratorFromComposition(composition: unknown): BrowserQaOrchestrator {
  const candidate = composition as {
    readonly browserQa?: {
      readonly orchestrator?: BrowserQaOrchestrator;
    };
  };

  return candidate.browserQa?.orchestrator ?? createUnavailableOrchestrator();
}

function flowServiceFromComposition(composition: unknown): BrowserQaFlowService {
  const candidate = composition as {
    readonly browserQa?: {
      readonly flowService?: BrowserQaFlowService;
    };
  };

  return candidate.browserQa?.flowService ?? createUnavailableFlowService();
}
