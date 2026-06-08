import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { expandExistingFilePattern, wildcardMatches } from "../glob-utils.js";
import type { FlowTargetCliOptions } from "./flow-parser.js";
import type { QaSeverity } from "./schemas.js";

export type BrowserQaFlowRunForGate = {
  readonly flowId?: string;
  readonly gateEligible?: boolean;
  readonly highestFailedSeverity?: QaSeverity;
  readonly id: string;
  readonly source?: {
    readonly ref?: string;
  };
  readonly status: "passed" | "failed" | "degraded";
};

export type BrowserQaGateTargetCliOptions = {
  readonly baseUrl?: string | undefined;
  readonly localhost?: boolean | string | undefined;
  readonly target?: string | undefined;
  readonly url?: string | undefined;
};

export type BrowserQaGateFlowRunsInput = {
  readonly actionPolicyRef?: string;
  readonly ci: boolean;
  readonly projectRoot?: string;
  readonly targetCli?: FlowTargetCliOptions;
  readonly withFlows: boolean | string;
};

type BrowserQaStoreForGate = {
  readonly listFlowRuns: () => Promise<Result<readonly BrowserQaFlowRunForGate[], SurfaceError>>;
};

type BrowserQaFlowServiceForGate = {
  readonly runFlowFile: (input: {
    readonly actionPolicyRef?: string;
    readonly ci?: boolean;
    readonly flowPath: string;
    readonly targetCli?: FlowTargetCliOptions;
    readonly writeRun?: boolean;
  }) => Promise<Result<{ readonly flowRun: BrowserQaFlowRunForGate }, SurfaceError>>;
};

export async function browserQaFlowRunsForGate(
  composition: unknown,
  input: BrowserQaGateFlowRunsInput,
): Promise<Result<readonly BrowserQaFlowRunForGate[], SurfaceError>> {
  const qaStore = browserQaStoreForGateFromComposition(composition);

  if (qaStore === undefined) {
    return err(createSurfaceError("qa_unavailable", "Browser QA flow runs are not available."));
  }

  const flowRuns = await qaStore.listFlowRuns();

  if (!flowRuns.ok) {
    return flowRuns;
  }

  const glob = browserQaFlowGlobFromWithFlows(input.withFlows);
  const matched =
    glob === undefined
      ? flowRuns.value
      : flowRuns.value.filter((flowRun) => browserQaFlowRunMatchesGlob(flowRun, glob));

  if (matched.length > 0) {
    return ok(matched);
  }

  const runFlows = await runDiscoveredBrowserQaFlowsForGate(composition, input);
  if (!runFlows.ok || runFlows.value.length > 0) {
    return runFlows;
  }

  if (input.ci) {
    return err(
      createSurfaceError("qa_unavailable", "No browser QA flow evidence matched --with-flows.", {
        details: { withFlows: input.withFlows },
      }),
    );
  }

  return ok(matched);
}

export function browserQaGateTargetCli(
  options: BrowserQaGateTargetCliOptions,
): Result<FlowTargetCliOptions | undefined, SurfaceError> {
  if (typeof options.localhost === "string") {
    return err(
      createSurfaceError(
        "no_target",
        "--localhost is a boolean browser QA flag. Use --url or --target for custom local ports.",
        { details: { localhost: options.localhost } },
      ),
    );
  }

  const targetFlags = [
    options.target === undefined ? undefined : "--target",
    options.url === undefined ? undefined : "--url",
    options.localhost === true ? "--localhost" : undefined,
  ].filter((value): value is string => value !== undefined);

  if (targetFlags.length > 1) {
    return err(
      createSurfaceError("no_target", "Browser QA target flags are mutually exclusive.", {
        details: { targetFlags },
      }),
    );
  }

  const value = {
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.localhost === true ? { localhost: true } : {}),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.url === undefined ? {} : { url: options.url }),
  };

  return ok(Object.keys(value).length === 0 ? undefined : value);
}

export function browserQaFlowSeverityFromWithFlows(withFlows: boolean | string): QaSeverity {
  return typeof withFlows === "string" && isQaGateSeverity(withFlows) ? withFlows : "high";
}

async function runDiscoveredBrowserQaFlowsForGate(
  composition: unknown,
  input: BrowserQaGateFlowRunsInput,
): Promise<Result<readonly BrowserQaFlowRunForGate[], SurfaceError>> {
  const flowService = browserQaFlowServiceForGateFromComposition(composition);

  if (flowService === undefined) {
    return ok([]);
  }

  const flowPaths = await expandBrowserQaGateFlowPatterns(
    browserQaFlowPatternsForWithFlows(input.withFlows),
    input.projectRoot,
  );
  if (flowPaths.length === 0) {
    return ok([]);
  }

  if (input.ci && input.targetCli === undefined) {
    return err(
      createSurfaceError(
        "target_not_allowed",
        "Browser QA gate flows in CI require --url, --target, --localhost, or --base-url.",
      ),
    );
  }

  const flowRuns: BrowserQaFlowRunForGate[] = [];

  for (const flowPath of flowPaths) {
    const result = await flowService.runFlowFile({
      ...(input.actionPolicyRef === undefined ? {} : { actionPolicyRef: input.actionPolicyRef }),
      ...(input.ci ? { ci: true } : {}),
      flowPath,
      ...(input.targetCli === undefined ? {} : { targetCli: input.targetCli }),
      writeRun: false,
    });

    if (!result.ok) {
      if (input.ci) {
        return result;
      }

      continue;
    }

    flowRuns.push(result.value.flowRun);
  }

  return ok(flowRuns);
}

function browserQaStoreForGateFromComposition(
  composition: unknown,
): BrowserQaStoreForGate | undefined {
  const candidate = composition as {
    readonly browserQa?: {
      readonly qaStore?: Partial<BrowserQaStoreForGate>;
    };
  };

  return typeof candidate.browserQa?.qaStore?.listFlowRuns === "function"
    ? (candidate.browserQa.qaStore as BrowserQaStoreForGate)
    : undefined;
}

function browserQaFlowServiceForGateFromComposition(
  composition: unknown,
): BrowserQaFlowServiceForGate | undefined {
  const candidate = composition as {
    readonly browserQa?: {
      readonly flowService?: Partial<BrowserQaFlowServiceForGate>;
    };
  };

  return typeof candidate.browserQa?.flowService?.runFlowFile === "function"
    ? (candidate.browserQa.flowService as BrowserQaFlowServiceForGate)
    : undefined;
}

function browserQaFlowGlobFromWithFlows(withFlows: boolean | string): string | undefined {
  return typeof withFlows === "string" && !isQaGateSeverity(withFlows) ? withFlows : undefined;
}

function browserQaFlowPatternsForWithFlows(withFlows: boolean | string): readonly string[] {
  const glob = browserQaFlowGlobFromWithFlows(withFlows);
  return glob === undefined ? ["surface-flows/*.yml", "surface-flows/*.yaml"] : [glob];
}

function browserQaFlowRunMatchesGlob(flowRun: BrowserQaFlowRunForGate, glob: string): boolean {
  return [flowRun.id, flowRun.flowId, flowRun.source?.ref]
    .filter((value): value is string => value !== undefined)
    .some((value) => wildcardMatches(glob, value));
}

async function expandBrowserQaGateFlowPatterns(
  patterns: readonly string[],
  projectRoot: string | undefined,
): Promise<readonly string[]> {
  const expanded = await Promise.all(
    patterns.map((pattern) =>
      expandExistingFilePattern(pattern, projectRoot === undefined ? {} : { projectRoot }),
    ),
  );
  return [...new Set(expanded.flat())];
}

function isQaGateSeverity(value: string): value is QaSeverity {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}
