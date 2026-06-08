import { createHash, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import type { BrowserQaExploreInput, BrowserQaExploreResult } from "./explorer.js";
import {
  createQaJsonReport,
  createQaMarkdownReport,
  createQaReportManifest,
  type QaReportManifest,
} from "./reporting.js";
import type {
  CandidateFinding,
  CandidateFlow,
  EvidenceBundle,
  FlowRun,
  FlowRunSummary,
  QaDegradation,
  QaRun,
  QaTarget,
} from "./schemas.js";

export type BrowserQaRunInput = {
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
  readonly qaRunId?: string;
  readonly scope?: string;
  readonly sessionMode?: "isolated" | "shared";
  readonly stateLockTimeoutMs?: number;
  readonly target: QaTarget;
  readonly task?: string;
  readonly video?: "off" | "failures" | "all";
};

export type BrowserQaRunResult = {
  readonly candidateFindings: readonly CandidateFinding[];
  readonly candidateFlows: readonly CandidateFlow[];
  readonly degradation: readonly QaDegradation[];
  readonly evidenceBundles: readonly string[];
  readonly exploration?: {
    readonly candidateFindings: number;
    readonly candidateFlows: number;
    readonly visitedStates: number;
  };
  readonly findings: readonly string[];
  readonly flowRuns: readonly FlowRunSummary[];
  readonly mode: "flow" | "explore" | "hybrid";
  readonly qaRunId: string;
  readonly target: QaTarget;
};

export type BrowserQaExploreCommandInput = Omit<BrowserQaExploreInput, "qaRunId"> & {
  readonly qaRunId?: string;
};

export type BrowserQaExploreCommandResult = BrowserQaExploreResult & {
  readonly qaRunId: string;
};

export type BrowserQaEvidenceSummary = {
  readonly refId: string;
  readonly summaries: readonly unknown[];
};

export type BrowserQaReportFormat = "md" | "json" | "manifest";

export type BrowserQaReportResult = {
  readonly format: BrowserQaReportFormat;
  readonly report: string | QaReportManifest;
};

export type BrowserQaReplayResult = {
  readonly promotion?: unknown;
  readonly replayStatus: string;
};

export type BrowserQaCleanupResult = {
  readonly cleaned: readonly string[];
  readonly dryRun: boolean;
  readonly skipped: readonly string[];
};

export type BrowserQaOrchestratorHarness = {
  readonly cleanupStaleSessions: (input: {
    readonly dryRun: boolean;
  }) => Promise<
    Result<
      { readonly cleaned: readonly string[]; readonly skipped: readonly string[] },
      SurfaceError
    >
  >;
  readonly now?: () => string;
  readonly readEvidence: (input: {
    readonly refId: string;
  }) => Promise<Result<BrowserQaEvidenceSummary, SurfaceError>>;
  readonly readEvidenceBundle?: (input: {
    readonly refId: string;
  }) => Promise<Result<EvidenceBundle, SurfaceError>>;
  readonly readRun?: (input: { readonly runId: string }) => Promise<Result<QaRun, SurfaceError>>;
  readonly replay: (input: {
    readonly promoteOnRepro: boolean;
    readonly refId: string;
  }) => Promise<Result<BrowserQaReplayResult, SurfaceError>>;
  readonly promoteCandidateByVerdict?: (input: {
    readonly refId: string;
    readonly reason: string;
    readonly verdictId: string;
  }) => Promise<Result<BrowserQaReplayResult, SurfaceError>>;
  readonly resolveFlows?: (
    patterns: readonly string[],
  ) => Promise<
    Result<
      { readonly matched: readonly string[]; readonly unmatched: readonly string[] },
      SurfaceError
    >
  >;
  readonly runExplore: (
    input: BrowserQaExploreInput,
  ) => Promise<Result<BrowserQaExploreResult, SurfaceError>>;
  readonly runFlow: (
    flowRef: string,
    input: BrowserQaRunInput,
  ) => Promise<Result<FlowRun, SurfaceError>>;
  readonly writeRun: (run: QaRun) => Promise<Result<QaRun, SurfaceError>>;
};

export type BrowserQaOrchestrator = {
  cleanup(input: {
    readonly dryRun?: boolean;
  }): Promise<Result<BrowserQaCleanupResult, SurfaceError>>;
  readEvidence(input: {
    readonly refId: string;
  }): Promise<Result<BrowserQaEvidenceSummary, SurfaceError>>;
  reportQa(input: {
    readonly format?: BrowserQaReportFormat;
    readonly runId: string;
  }): Promise<Result<BrowserQaReportResult, SurfaceError>>;
  replay(input: {
    readonly promoteOnRepro?: boolean;
    readonly refId: string;
  }): Promise<Result<BrowserQaReplayResult, SurfaceError>>;
  promoteCandidateByVerdict(input: {
    readonly refId: string;
    readonly reason: string;
    readonly verdictId: string;
  }): Promise<Result<BrowserQaReplayResult, SurfaceError>>;
  runExplore(
    input: BrowserQaExploreCommandInput,
  ): Promise<Result<BrowserQaExploreCommandResult, SurfaceError>>;
  runQa(input: BrowserQaRunInput): Promise<Result<BrowserQaRunResult, SurfaceError>>;
};

class DefaultBrowserQaOrchestrator implements BrowserQaOrchestrator {
  readonly #harness: BrowserQaOrchestratorHarness;

  constructor(harness: BrowserQaOrchestratorHarness) {
    this.#harness = harness;
  }

  async runQa(input: BrowserQaRunInput): Promise<Result<BrowserQaRunResult, SurfaceError>> {
    const qaRunId = input.qaRunId ?? qaRunIdFor(input);
    const degradation: QaDegradation[] = [];
    const flowRuns: FlowRun[] = [];
    const cleanup = await this.#harness.cleanupStaleSessions({ dryRun: true });

    if (!cleanup.ok) {
      if (input.ci === true) {
        return cleanup;
      }

      degradation.push({
        code: "stale_session_check_degraded",
        message: "Browser QA stale-session preflight did not complete.",
        scope: "session",
        severity: "warning",
      });
    } else if (cleanup.value.skipped.length > 0 || cleanup.value.cleaned.length > 0) {
      if (input.ci === true) {
        return err(
          createSurfaceError(
            "qa_unavailable",
            "Browser QA found stale Surface-owned sessions before CI launch.",
            {
              details: {
                cleaned: cleanup.value.cleaned,
                skipped: cleanup.value.skipped,
              },
            },
          ),
        );
      }

      degradation.push({
        code: "stale_session_check_degraded",
        details: {
          cleaned: cleanup.value.cleaned,
          skipped: cleanup.value.skipped,
        },
        message: "Browser QA found Surface-owned stale session records before launch.",
        scope: "session",
        severity: "warning",
      });
    }

    if (input.sessionMode === "shared") {
      degradation.push({
        code: "session_mode_shared_degraded",
        message:
          "Shared browser QA session mode is not implemented yet; this run used isolated sessions.",
        scope: "session",
        severity: "warning",
      });
    }

    const requestedFlows = input.flows ?? [];
    const resolvedFlows = await this.#resolveFlows(requestedFlows);

    if (!resolvedFlows.ok) {
      return resolvedFlows;
    }

    if (resolvedFlows.value.unmatched.length > 0) {
      if (input.explore !== true) {
        return err(
          createSurfaceError("flow_invalid", "Browser QA flow glob did not match any files.", {
            details: { unmatched: resolvedFlows.value.unmatched },
          }),
        );
      }

      degradation.push({
        code: "flow_glob_unmatched",
        details: { unmatched: resolvedFlows.value.unmatched },
        message: "Some browser QA flow globs did not match any files.",
        scope: "flow",
        severity: "warning",
      });
    }

    for (const flowRef of resolvedFlows.value.matched) {
      const flow = await this.#harness.runFlow(flowRef, { ...input, qaRunId });

      if (!flow.ok) {
        return flow;
      }

      flowRuns.push(flow.value);
    }

    const shouldExplore = input.explore === true || flowRuns.length === 0;
    const exploration = shouldExplore
      ? await this.#harness.runExplore({
          maxActions: input.maxActions ?? 25,
          maxDepth: input.maxDepth ?? 2,
          maxStates: input.maxStates ?? 10,
          ...(input.actionPolicyRef === undefined
            ? {}
            : { actionPolicyRef: input.actionPolicyRef }),
          ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
          ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
          ...(input.network === undefined ? {} : { network: input.network }),
          qaRunId,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.sessionMode === undefined ? {} : { sessionMode: input.sessionMode }),
          ...(input.stateLockTimeoutMs === undefined
            ? {}
            : { stateLockTimeoutMs: input.stateLockTimeoutMs }),
          target: input.target,
          ...(input.task === undefined ? {} : { task: input.task }),
          ...(input.video === undefined ? {} : { video: input.video }),
        })
      : undefined;

    if (exploration !== undefined && !exploration.ok) {
      return exploration;
    }

    const explorationValue = exploration?.value;
    const mode =
      flowRuns.length > 0 && explorationValue !== undefined
        ? "hybrid"
        : flowRuns.length > 0
          ? "flow"
          : "explore";
    const result: BrowserQaRunResult = {
      candidateFindings: explorationValue?.candidateFindings ?? [],
      candidateFlows: explorationValue?.candidateFlows ?? [],
      degradation: [...degradation, ...(explorationValue?.degradation ?? [])],
      evidenceBundles: uniqueStrings([
        ...flowRuns.flatMap((flowRun) => flowRun.evidenceBundles),
        ...(explorationValue?.candidateFindings.map((candidate) => candidate.evidenceBundleId) ??
          []),
      ]),
      ...(explorationValue === undefined
        ? {}
        : {
            exploration: {
              candidateFindings: explorationValue.candidateFindings.length,
              candidateFlows: explorationValue.candidateFlows.length,
              visitedStates: explorationValue.visitedStates,
            },
          }),
      findings: uniqueStrings(flowRuns.flatMap((flowRun) => flowRun.findingIds)),
      flowRuns: flowRuns.map(flowRunSummaryFor),
      mode,
      qaRunId,
      target: input.target,
    };
    const written = await this.#harness.writeRun(qaRunForResult(result));

    if (!written.ok) {
      return written;
    }

    return ok(result);
  }

  async runExplore(
    input: BrowserQaExploreCommandInput,
  ): Promise<Result<BrowserQaExploreCommandResult, SurfaceError>> {
    const qaRunId = input.qaRunId ?? qaRunIdFor({ target: input.target });
    const cleanup = await this.#harness.cleanupStaleSessions({ dryRun: true });

    if (!cleanup.ok) {
      return cleanup;
    }

    const explored = await this.#harness.runExplore({
      ...input,
      qaRunId,
    });

    if (!explored.ok) {
      return explored;
    }

    const result: BrowserQaRunResult = {
      candidateFindings: explored.value.candidateFindings,
      candidateFlows: explored.value.candidateFlows,
      degradation: [...explored.value.degradation],
      evidenceBundles: uniqueStrings(
        explored.value.candidateFindings.map((candidate) => candidate.evidenceBundleId),
      ),
      exploration: {
        candidateFindings: explored.value.candidateFindings.length,
        candidateFlows: explored.value.candidateFlows.length,
        visitedStates: explored.value.visitedStates,
      },
      findings: [],
      flowRuns: [],
      mode: "explore",
      qaRunId,
      target: input.target,
    };
    const written = await this.#harness.writeRun(qaRunForResult(result));
    if (!written.ok) {
      return written;
    }

    return ok({ ...explored.value, qaRunId });
  }

  readEvidence(input: {
    readonly refId: string;
  }): Promise<Result<BrowserQaEvidenceSummary, SurfaceError>> {
    return this.#harness.readEvidence(input);
  }

  async reportQa(input: {
    readonly format?: BrowserQaReportFormat;
    readonly runId: string;
  }): Promise<Result<BrowserQaReportResult, SurfaceError>> {
    if (this.#harness.readRun === undefined || this.#harness.readEvidenceBundle === undefined) {
      return err(
        createSurfaceError(
          "qa_unavailable",
          "Browser QA reports require a QA run store and evidence store.",
        ),
      );
    }

    const run = await this.#harness.readRun({ runId: input.runId });

    if (!run.ok) {
      return run;
    }

    const evidenceBundles: EvidenceBundle[] = [];
    for (const refId of run.value.evidenceBundles) {
      const bundle = await this.#harness.readEvidenceBundle({ refId });

      if (!bundle.ok) {
        return bundle;
      }

      evidenceBundles.push(bundle.value);
    }

    const format = input.format ?? "md";
    const reportInput = {
      evidenceBundles,
      qaRun: run.value,
      reportId: run.value.id,
    };

    if (format === "md") {
      return ok({ format, report: createQaMarkdownReport(reportInput) });
    }

    return ok({
      format,
      report:
        format === "json" ? createQaJsonReport(reportInput) : createQaReportManifest(reportInput),
    });
  }

  replay(input: {
    readonly promoteOnRepro?: boolean;
    readonly refId: string;
  }): Promise<Result<BrowserQaReplayResult, SurfaceError>> {
    return this.#harness.replay({
      promoteOnRepro: input.promoteOnRepro === true,
      refId: input.refId,
    });
  }

  promoteCandidateByVerdict(input: {
    readonly refId: string;
    readonly reason: string;
    readonly verdictId: string;
  }): Promise<Result<BrowserQaReplayResult, SurfaceError>> {
    if (this.#harness.promoteCandidateByVerdict === undefined) {
      return Promise.resolve(
        err(
          createSurfaceError(
            "promotion_rejected",
            "Browser QA candidate verdict promotion is unavailable.",
          ),
        ),
      );
    }

    return this.#harness.promoteCandidateByVerdict(input);
  }

  async cleanup(input: {
    readonly dryRun?: boolean;
  }): Promise<Result<BrowserQaCleanupResult, SurfaceError>> {
    const dryRun = input.dryRun === true;
    const cleanup = await this.#harness.cleanupStaleSessions({ dryRun });

    return cleanup.ok ? ok({ ...cleanup.value, dryRun }) : cleanup;
  }

  async #resolveFlows(
    flows: readonly string[],
  ): Promise<
    Result<
      { readonly matched: readonly string[]; readonly unmatched: readonly string[] },
      SurfaceError
    >
  > {
    if (flows.length === 0) {
      return ok({ matched: [], unmatched: [] });
    }

    if (this.#harness.resolveFlows !== undefined) {
      return this.#harness.resolveFlows(flows);
    }

    return resolveFlowPatternsFromCwd(flows);
  }
}

export function createBrowserQaOrchestrator(
  harness: BrowserQaOrchestratorHarness,
): BrowserQaOrchestrator {
  return new DefaultBrowserQaOrchestrator(harness);
}

function qaRunForResult(result: BrowserQaRunResult): QaRun {
  const now = new Date().toISOString();
  const hasFailedFlow = result.flowRuns.some((flowRun) => flowRun.status === "failed");
  const hasDegradedFlow = result.flowRuns.some((flowRun) => flowRun.status === "degraded");

  return {
    candidateFindings: result.candidateFindings.map((candidate) => candidate.id),
    candidateFlows: result.candidateFlows.map((flow) => flow.id),
    completedAt: now,
    degradation: [...result.degradation],
    evidenceBundles: [...result.evidenceBundles],
    ...(result.exploration === undefined ? {} : { exploration: result.exploration }),
    findings: [...result.findings],
    flowRuns: result.flowRuns.map((flowRun) => ({ ...flowRun })),
    id: result.qaRunId,
    manifestPath: `.surface/qa/runs/${result.qaRunId}/manifest.json`,
    mode: result.mode,
    startedAt: now,
    status: hasFailedFlow
      ? "failed"
      : result.degradation.length > 0 || hasDegradedFlow
        ? "degraded"
        : "completed",
    target: result.target,
  };
}

function flowRunSummaryFor(run: FlowRun): FlowRunSummary {
  return {
    findingIds: run.findingIds,
    flowId: run.flowId,
    gateEligible: run.gateEligible,
    id: run.id,
    status: run.status,
  };
}

async function resolveFlowPatternsFromCwd(
  patterns: readonly string[],
): Promise<
  Result<
    { readonly matched: readonly string[]; readonly unmatched: readonly string[] },
    SurfaceError
  >
> {
  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const pattern of patterns) {
    const expanded = pattern.includes("*")
      ? await expandFlowPatternFromCwd(pattern)
      : (await pathExists(path.resolve(process.cwd(), pattern)))
        ? [toPosixPath(pattern)]
        : [];

    if (expanded.length === 0) {
      unmatched.push(pattern);
    } else {
      matched.push(...expanded);
    }
  }

  return ok({ matched: [...new Set(matched)], unmatched });
}

async function expandFlowPatternFromCwd(pattern: string): Promise<readonly string[]> {
  const normalized = toPosixPath(pattern);
  const searchRoot = flowPatternSearchRoot(normalized);
  const files = await listFiles(path.resolve(process.cwd(), searchRoot));

  return files
    .map((file) => toPosixPath(path.relative(process.cwd(), file)))
    .filter((file) => wildcardMatches(normalized, file))
    .toSorted();
}

function flowPatternSearchRoot(pattern: string): string {
  const wildcardIndex = pattern.indexOf("*");
  const prefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf("/");

  return slashIndex === -1 ? "." : prefix.slice(0, slashIndex);
}

async function listFiles(root: string): Promise<readonly string[]> {
  try {
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) {
      return rootStats.isFile() ? [root] : [];
    }

    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(root, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : Promise.resolve([entryPath]);
      }),
    );

    return nested.flat();
  } catch {
    return [];
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    const stats = await stat(value);
    return stats.isFile();
  } catch {
    return false;
  }
}

function wildcardMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*");

  return new RegExp(`^${escaped}$`, "u").test(value);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function qaRunIdFor(input: { readonly target: QaTarget }): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(input.target))
    .digest("hex")
    .slice(0, 12);
  return `qa_${digest}_${randomUUID().slice(0, 8)}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
