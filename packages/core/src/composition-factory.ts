import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createAgentBrowserCliDriver,
  createBrowserQaExplorer,
  createBrowserQaFlowService,
  createBrowserQaOrchestrator,
  createFileQaEvidenceStore,
  createFileQaRunStore,
  createFlowRunner,
  createReplayPromoter,
  resolveActionPolicy,
  type ActionPolicy,
  type BrowserAction,
  type BrowserQaEvidenceSummary,
  type BrowserQaDriver,
  type BrowserQaFlow,
  type BrowserQaFlowService,
  type BrowserQaLoadedState,
  type BrowserQaOrchestrator,
  type CandidateFinding,
  type EvidenceBundle,
  type FlowRunner,
  type QaEvidenceArtifact,
  type QaEvidenceStore,
  type QaRunStore,
  type QaTarget,
  type ReplayCandidateContext,
  type ReplayConditionResult,
} from "./browser-qa/index.js";
import {
  createAgentBrowserCaptureBackend,
  createCaptureService,
  createPlaywrightCaptureBackend,
  createStaticCaptureBackend,
  type CaptureService,
} from "./capture.js";
import {
  createAuditRunner,
  type AuditRunner,
  type ModelProviderFactory,
  type ResolveSubscriptionProviders,
} from "./audit-runner.js";
import {
  DEFAULT_PIPELINE_STAGE_DEFINITIONS,
  createNoopPipelineHandlers,
  createPipelineOrchestrator,
  type ExecutablePipelineStageId,
  type PipelineOrchestrator,
  type PipelineStageHandler,
} from "./pipeline-orchestrator.js";
import { createGateEvaluator } from "./gate-evaluator.js";
import { createSurfaceError, ok, type Result, type SurfaceError } from "./errors.js";
import type { Finding } from "./findings.js";
import { createFileSystemKnowledgeSource } from "./knowledge-source.js";
import {
  BUILT_IN_LENS_REGISTRY,
  type LensFactoryOptions,
  type LensRegistration,
} from "./lens-registry.js";
import {
  createAgentPlanMarkdownRenderer,
  createBacklogMarkdownRenderer,
  createFindingsJsonRenderer,
  createFindingsMarkdownRenderer,
  createValidationReportMarkdownRenderer,
} from "./report-renderers.js";
import { SURFACE_STATE_DIR, createFileStateStore } from "./state-store.js";
import type { TrackedFinding } from "./tracked-findings.js";
import { createMmrAuditFallback, type MmrAuditFallback } from "./mmr-audit-fallback.js";
import {
  defaultProcessRunner,
  resolveDirectProviders,
  type ProcessRunner,
} from "./subscription-cli-provider.js";
import type {
  CaptureBackend,
  FrameworkAdapter,
  GateEvaluator,
  GroundingTool,
  IssueExporter,
  KnowledgeSource,
  ModelProvider,
  ReportRenderer,
  StateStore,
} from "./interfaces.js";

const DEFAULT_KNOWLEDGE_ROOT_DIR = "content/knowledge";
const BUNDLED_KNOWLEDGE_ROOT_DIR = fileURLToPath(new URL("./content/knowledge/", import.meta.url));
const MONOREPO_KNOWLEDGE_ROOT_DIR = fileURLToPath(
  new URL("../../../content/knowledge/", import.meta.url),
);

export type SurfaceCompositionGeneratedAt = string | (() => string);

export type SurfaceCompositionOptions = {
  readonly browserQa?: Partial<BrowserQaComposition>;
  readonly captureBackends?: readonly CaptureBackend[];
  readonly frameworkAdapters?: readonly FrameworkAdapter[];
  readonly generatedAt?: SurfaceCompositionGeneratedAt;
  readonly gateEvaluator?: GateEvaluator;
  readonly groundingTools?: readonly GroundingTool[];
  readonly issueExporters?: readonly IssueExporter[];
  readonly knowledgeRootDir?: string;
  readonly knowledgeSource?: KnowledgeSource;
  readonly lensFactoryOptions?: LensFactoryOptions;
  readonly lensRegistry?: readonly LensRegistration[];
  readonly mmrFallback?: MmrAuditFallback;
  readonly modelProvider?: ModelProvider;
  readonly modelProviderFactory?: ModelProviderFactory;
  readonly pipelineHandlers?: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>>;
  readonly processRunner?: ProcessRunner;
  readonly projectRoot?: string;
  readonly reportRenderers?: readonly ReportRenderer[];
  readonly resolveSubscriptionProviders?: ResolveSubscriptionProviders;
  readonly stateDir?: string;
  readonly stateStore?: StateStore;
  readonly staticFallback?: CaptureBackend;
  readonly subscriptionProviders?: readonly ModelProvider[];
};

export type BrowserQaComposition = {
  readonly driver: BrowserQaDriver;
  readonly evidenceStore: QaEvidenceStore;
  readonly flowRunner: FlowRunner;
  readonly flowService: BrowserQaFlowService;
  readonly orchestrator: BrowserQaOrchestrator;
  readonly qaStore: QaRunStore;
};

export type SurfaceComposition = {
  readonly browserQa: BrowserQaComposition;
  readonly auditRunner: AuditRunner;
  readonly captureBackends: readonly CaptureBackend[];
  readonly captureService: CaptureService;
  readonly frameworkAdapters: readonly FrameworkAdapter[];
  readonly gateEvaluator: GateEvaluator;
  readonly groundingTools: readonly GroundingTool[];
  readonly issueExporters: readonly IssueExporter[];
  readonly knowledgeSource: KnowledgeSource;
  readonly lensFactoryOptions: LensFactoryOptions;
  readonly lensRegistry: readonly LensRegistration[];
  readonly pipelineOrchestrator: PipelineOrchestrator;
  readonly reportRenderers: readonly ReportRenderer[];
  readonly stateDir: string;
  readonly stateStore: StateStore;
};

/**
 * Build the shared core composition root consumed by interface adapters.
 *
 * CLI and MCP should both call this factory and then add package-local plugins
 * through the option arrays. Core wires only core-owned implementations here so
 * package dependencies stay one-way: plugins depend on core, never the reverse.
 */
export function createSurfaceComposition(
  options: SurfaceCompositionOptions = {},
): SurfaceComposition {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const stateDir = options.stateDir ?? SURFACE_STATE_DIR;
  const staticFallback = options.staticFallback ?? createStaticCaptureBackend();
  const browserBackends = options.captureBackends ?? [
    createAgentBrowserCaptureBackend(),
    createPlaywrightCaptureBackend(),
  ];
  const captureBackends = [...browserBackends, staticFallback];
  const stateStore =
    options.stateStore ??
    createFileStateStore({
      projectRoot,
      stateDir,
    });
  const knowledgeSource =
    options.knowledgeSource ??
    createFileSystemKnowledgeSource({
      rootDir: resolveKnowledgeRootDir(projectRoot, options.knowledgeRootDir),
    });
  const lensFactoryOptions = {
    projectRoot,
    ...(options.lensFactoryOptions ?? {}),
  } satisfies LensFactoryOptions;
  const reportRenderers =
    options.reportRenderers ??
    defaultReportRenderers(options.generatedAt ?? (() => new Date().toISOString()));
  const pipelineHandlers =
    options.pipelineHandlers === undefined
      ? createNoopPipelineHandlers()
      : createNoopPipelineHandlers(options.pipelineHandlers);
  const qaStore =
    options.browserQa?.qaStore ??
    createFileQaRunStore({
      projectRoot,
      stateStore,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  const evidenceStore =
    options.browserQa?.evidenceStore ??
    createFileQaEvidenceStore({
      projectRoot,
      stateStore,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  const browserQaDriver =
    options.browserQa?.driver ??
    createAgentBrowserCliDriver({
      projectRoot,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  const flowRunner =
    options.browserQa?.flowRunner ??
    createFlowRunner({
      driver: browserQaDriver,
      evidenceStore,
      qaStore,
    });
  const flowService =
    options.browserQa?.flowService ??
    createBrowserQaFlowService({
      flowRunner,
      projectRoot,
      qaStore,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  const createExplorerForPolicy = (actionPolicy: ActionPolicy) =>
    createBrowserQaExplorer({
      actionPolicy,
      executeAction: (action) => executeBrowserQaAction(browserQaDriver, action),
      loadState: async ({ depth, target }) => {
        const snapshot = await browserQaDriver.captureState();
        return snapshot.ok
          ? {
              ok: true,
              value: loadedStateForSnapshot({
                depth,
                snapshot: snapshot.value,
                target,
              }),
            }
          : snapshot;
      },
      shouldCreateCandidateFlow: (state) => state.actions.length > 0,
      writeCandidate: (candidate) => qaStore.writeCandidate(candidate),
      writeCandidateFlow: (flow) => qaStore.writeCandidateFlow(flow),
      writeEvidenceBundle: (input) => evidenceStore.writeBundle(input),
    });
  const replayPromoter = createReplayPromoter({
    readCandidate: (id) => qaStore.readCandidate(id),
    readEvidenceBundle: (id) => evidenceStore.readBundle(id),
    replayCandidateCondition: (candidate, context) =>
      replayCandidateWithFlow({
        candidate,
        context,
        flowRunner,
        qaStore,
      }),
    writeCandidate: (candidate) => qaStore.writeCandidate(candidate),
    writePromotedFinding: (promotion) => qaStore.writePromotedFinding(promotion),
    writeTrackedFinding: (trackedFinding, finding) =>
      writePromotedFindingToProjectState({
        ...(finding === undefined ? {} : { finding }),
        stateStore,
        trackedFinding,
      }),
  });
  const orchestrator =
    options.browserQa?.orchestrator ??
    createBrowserQaOrchestrator({
      cleanupStaleSessions: (input) => browserQaDriver.cleanupStaleSessions(input),
      readEvidence: ({ refId }) => readBrowserQaEvidenceRef({ evidenceStore, qaStore, refId }),
      readEvidenceBundle: ({ refId }) => evidenceStore.readBundle(refId),
      readRun: ({ runId }) => qaStore.readRun(runId),
      resolveFlows: (patterns) => resolveBrowserQaFlowPatterns(projectRoot, patterns),
      replay: async ({ promoteOnRepro, refId }) => {
        if (!refId.startsWith("qfc_")) {
          return {
            error: createSurfaceError(
              "replay_failed",
              "Only QA candidate findings are replayable.",
            ),
            ok: false,
          };
        }

        const replay = await replayPromoter.replayCandidate(refId, {
          promoteOnRepro,
          qaRunId: `qa_replay_${Date.now().toString(36)}`,
        });

        return replay.ok
          ? { ok: true, value: { replayStatus: replay.value.replayStatus } }
          : replay;
      },
      promoteCandidateByVerdict: async ({ reason, refId, verdictId }) => {
        if (!refId.startsWith("qfc_")) {
          return {
            error: createSurfaceError(
              "promotion_rejected",
              "Only QA candidate findings can be promoted by browser QA verdict.",
            ),
            ok: false,
          };
        }

        const promoted = await replayPromoter.promoteCandidateByVerdict(refId, {
          reason,
          verdictId,
        });

        return promoted.ok
          ? {
              ok: true,
              value: {
                promotion: promoted.value.promotedFinding ?? promoted.value.promotion,
                replayStatus: promoted.value.replayStatus,
              },
            }
          : promoted;
      },
      runExplore: async (input) => {
        const policy = await resolveBrowserQaActionPolicy({
          ...(input.actionPolicyRef === undefined
            ? {}
            : { actionPolicyRef: input.actionPolicyRef }),
          ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
          projectRoot,
        });

        if (!policy.ok) {
          return policy;
        }

        const explorer = createExplorerForPolicy(policy.value);
        const session = await browserQaDriver.startSession({
          qaRunId: input.qaRunId,
          target: input.target,
        });

        if (!session.ok) {
          return session;
        }

        try {
          return await explorer.explore(input);
        } finally {
          await browserQaDriver.stopSession(session.value.id);
        }
      },
      runFlow: async (flowRef, input) => {
        const flow = await flowService.runFlowFile({
          ...(input.actionPolicyRef === undefined
            ? {}
            : { actionPolicyRef: input.actionPolicyRef }),
          ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
          ...(input.ci === undefined ? {} : { ci: input.ci }),
          flowPath: flowRef,
          ...(input.qaRunId === undefined ? {} : { qaRunId: input.qaRunId }),
          targetCli: { target: input.target.ref },
          writeRun: false,
        });

        return flow.ok ? { ok: true, value: flow.value.flowRun } : flow;
      },
      writeRun: (run) => qaStore.writeRun(run),
    });
  const processRunner = options.processRunner ?? defaultProcessRunner;
  const resolveSubscriptionProviders =
    options.resolveSubscriptionProviders ??
    ((config) => resolveDirectProviders(config, processRunner));
  const mmrFallback = options.mmrFallback ?? createMmrAuditFallback();

  return {
    auditRunner: createAuditRunner({
      artifactWriter: stateStore,
      knowledgeSource,
      lensFactoryOptions,
      lensRegistry: options.lensRegistry ?? BUILT_IN_LENS_REGISTRY,
      mmrFallback,
      resolveSubscriptionProviders,
      ...(options.modelProvider === undefined ? {} : { modelProvider: options.modelProvider }),
      ...(options.modelProviderFactory === undefined
        ? {}
        : { modelProviderFactory: options.modelProviderFactory }),
      ...(options.subscriptionProviders === undefined
        ? {}
        : { subscriptionProviders: options.subscriptionProviders }),
    }),
    browserQa: {
      driver: browserQaDriver,
      evidenceStore,
      flowRunner,
      flowService,
      orchestrator,
      qaStore,
    },
    captureBackends,
    captureService: createCaptureService({
      artifactWriter: stateStore,
      backends: browserBackends,
      staticFallback,
    }),
    frameworkAdapters: options.frameworkAdapters ?? [],
    gateEvaluator: options.gateEvaluator ?? createGateEvaluator(),
    groundingTools: options.groundingTools ?? [],
    issueExporters: options.issueExporters ?? [],
    knowledgeSource,
    lensFactoryOptions,
    lensRegistry: options.lensRegistry ?? BUILT_IN_LENS_REGISTRY,
    pipelineOrchestrator: createPipelineOrchestrator({
      handlers: pipelineHandlers,
      stateStore,
    }),
    reportRenderers,
    stateDir,
    stateStore,
  };
}

function defaultReportRenderers(
  generatedAt: SurfaceCompositionGeneratedAt,
): readonly ReportRenderer[] {
  return [
    createFindingsJsonRenderer({ generatedAt: generatedAtValue(generatedAt) }),
    createFindingsMarkdownRenderer(),
    createBacklogMarkdownRenderer(),
    createAgentPlanMarkdownRenderer(),
    createValidationReportMarkdownRenderer(),
  ];
}

function generatedAtValue(generatedAt: SurfaceCompositionGeneratedAt): string {
  return typeof generatedAt === "function" ? generatedAt() : generatedAt;
}

async function executeBrowserQaAction(driver: BrowserQaDriver, action: BrowserAction) {
  const input = {
    ...(action.locator === undefined ? {} : { locator: action.locator }),
    ...(action.url === undefined ? {} : { url: action.url }),
    ...(action.value === undefined ? {} : { value: action.value }),
  };

  switch (action.action) {
    case "open":
      return asUndefined(await driver.navigate(input));
    case "pushstate":
      return asUndefined(await driver.pushState(input));
    case "click":
      return asUndefined(await driver.click(input));
    case "dblclick":
      return asUndefined(await driver.dblclick(input));
    case "hover":
      return asUndefined(await driver.hover(input));
    case "focus":
      return asUndefined(await driver.focus(input));
    case "fill":
      return asUndefined(await driver.fill(input));
    case "type":
      return asUndefined(await driver.type(input));
    case "press":
      return asUndefined(await driver.press(input));
    case "check":
      return asUndefined(await driver.check(input));
    case "uncheck":
      return asUndefined(await driver.uncheck(input));
    case "select":
      return asUndefined(await driver.select(input));
    case "upload":
      return asUndefined(await driver.upload(input));
    case "scroll":
      return asUndefined(await driver.scroll(input));
    case "wait":
      return asUndefined(await driver.wait(input));
    case "capture":
      return asUndefined(await driver.captureState());
    case "assert":
      return asUndefined(await driver.assertText(input));
    case "setViewport":
      return asUndefined(await driver.setViewport(input));
    case "setTheme":
      return asUndefined(await driver.setTheme(input));
  }
}

async function resolveBrowserQaActionPolicy(input: {
  readonly actionPolicyRef?: string;
  readonly allowedDomains?: readonly string[];
  readonly projectRoot: string;
}): Promise<Result<ActionPolicy, SurfaceError>> {
  const resolved = await resolveActionPolicy({
    ...(input.actionPolicyRef === undefined ? {} : { policyRef: input.actionPolicyRef }),
    projectRoot: input.projectRoot,
  });

  if (!resolved.ok) {
    return resolved;
  }

  if (input.allowedDomains === undefined || input.allowedDomains.length === 0) {
    return ok(resolved.value.policy);
  }

  return ok({
    ...resolved.value.policy,
    allowedDomains: [
      ...new Set([...resolved.value.policy.allowedDomains, ...input.allowedDomains]),
    ],
  });
}

function asUndefined<T>(result: {
  readonly error?: unknown;
  readonly ok: boolean;
  readonly value?: T;
}): Result<undefined, SurfaceError> {
  return result.ok
    ? ok(undefined)
    : {
        error: (result as { readonly error: SurfaceError }).error,
        ok: false,
      };
}

function loadedStateForSnapshot(input: {
  readonly depth: number;
  readonly snapshot: Record<string, unknown>;
  readonly target: QaTarget;
}): BrowserQaLoadedState {
  const rawSnapshot = input.snapshot.rawSnapshot ?? input.snapshot;
  const title = stringField(input.snapshot, "title");
  const url = stringField(input.snapshot, "url") ?? input.target.ref;

  return {
    actions: actionsForSnapshot(rawSnapshot),
    authStatus: "anonymous",
    depth: input.depth,
    ...(title === undefined ? {} : { title }),
    url,
  };
}

function actionsForSnapshot(snapshot: unknown): BrowserAction[] {
  const text = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
  const actions: BrowserAction[] = [];
  const seenRefs = new Set<string>();

  for (const line of text.split(/\r?\n/u)) {
    const ref = structuralRefForSnapshotLine(line);
    if (ref === undefined || seenRefs.has(ref)) {
      continue;
    }

    seenRefs.add(ref);
    const label = line
      .replace(ref, "")
      .replace(/[-*#[\]"{}]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 80);
    const locator = {
      refHint: ref,
      ...(label.length === 0 ? {} : { name: label }),
    };

    actions.push({ action: "hover", locator });
    actions.push({ action: "focus", locator });
  }

  return actions;
}

const SNAPSHOT_ROLE_PREFIX =
  /^(?:[-*]\s*)?(?:button|link|textbox|input|checkbox|radio|combobox|option|menuitem|tab|dialog|heading|img|image|text)\b/iu;

function structuralRefForSnapshotLine(line: string): string | undefined {
  const trimmed = line.trim();
  const direct = trimmed.match(/^@e[0-9]+\b/u)?.[0];
  if (direct !== undefined) {
    return direct;
  }

  if (!SNAPSHOT_ROLE_PREFIX.test(trimmed)) {
    return undefined;
  }

  return trimmed.match(/\b@e[0-9]+\b/u)?.[0];
}

async function replayCandidateWithFlow(input: {
  readonly candidate: CandidateFinding;
  readonly context: ReplayCandidateContext;
  readonly flowRunner: FlowRunner;
  readonly qaStore: QaRunStore;
}): Promise<Result<ReplayConditionResult, SurfaceError>> {
  if (input.candidate.actionPath.length === 0) {
    return ok({ reproduced: false });
  }

  const sourceRun = await input.qaStore.readRun(input.candidate.qaRunId);
  if (!sourceRun.ok) {
    return { error: sourceRun.error, ok: false };
  }

  const flow: BrowserQaFlow = {
    defaults: {},
    fixtures: [],
    id: `replay_${safeCompositionId(input.candidate.id)}`,
    inputs: {},
    schemaVersion: "1.0",
    secrets: {},
    severity: input.candidate.severity,
    steps: input.candidate.actionPath.map((action, index) => ({
      ...action,
      capture: index === input.candidate.actionPath.length - 1,
      id: `replay-${index + 1}`,
    })),
    title: `Replay ${input.candidate.id}`,
  };
  const replay = await input.flowRunner.runFlow(flow, {
    qaRunId: input.context.qaRunId,
    source: { kind: "surface-state", ref: input.candidate.id },
    target: sourceRun.value.target,
  });

  if (!replay.ok) {
    return { error: replay.error, ok: false };
  }

  return ok({
    ...(replay.value.evidenceBundles[0] === undefined
      ? {}
      : { evidenceBundleId: replay.value.evidenceBundles[0] }),
    reproduced: replay.value.status === "failed",
  });
}

async function readBrowserQaEvidenceRef(input: {
  readonly evidenceStore: QaEvidenceStore;
  readonly qaStore: QaRunStore;
  readonly refId: string;
}): Promise<Result<BrowserQaEvidenceSummary, SurfaceError>> {
  if (input.refId.startsWith("ev_")) {
    const bundle = await input.evidenceStore.readBundle(input.refId);
    return bundle.ok
      ? evidenceSummary(input.refId, [bundle.value])
      : evidenceUnavailable(input.refId, bundle.error);
  }

  if (input.refId.startsWith("qa_")) {
    const run = await input.qaStore.readRun(input.refId);
    if (!run.ok) {
      return evidenceUnavailable(input.refId, run.error);
    }

    const bundles = await readBundles(input.evidenceStore, run.value.evidenceBundles);
    return ok({
      refId: input.refId,
      summaries: [
        {
          evidenceBundles: run.value.evidenceBundles,
          flowRuns: run.value.flowRuns,
          kind: "qa-run",
          qaRunId: run.value.id,
          status: run.value.status,
        },
        ...bundleArtifactSummaries(bundles),
      ],
    });
  }

  if (input.refId.startsWith("qfc_")) {
    const candidate = await input.qaStore.readCandidate(input.refId);
    if (!candidate.ok) {
      return evidenceUnavailable(input.refId, candidate.error);
    }

    const bundle = await input.evidenceStore.readBundle(candidate.value.evidenceBundleId);
    return bundle.ok
      ? ok({
          refId: input.refId,
          summaries: [
            {
              evidenceBundleId: candidate.value.evidenceBundleId,
              kind: "candidate-finding",
              replayStatus: candidate.value.replayStatus,
              severity: candidate.value.severity,
              title: candidate.value.title,
            },
            ...bundleArtifactSummaries([bundle.value]),
          ],
        })
      : evidenceUnavailable(input.refId, bundle.error);
  }

  if (input.refId.startsWith("qflow_")) {
    const flow = await input.qaStore.readCandidateFlow(input.refId);
    return flow.ok
      ? ok({
          refId: input.refId,
          summaries: [
            {
              evidenceBundleId: flow.value.evidenceBundleId,
              kind: "candidate-flow",
              steps: flow.value.steps.length,
              title: flow.value.title,
            },
          ],
        })
      : evidenceUnavailable(input.refId, flow.error);
  }

  if (input.refId.startsWith("f_")) {
    const promoted = await input.qaStore.readPromotedFinding(input.refId);
    if (!promoted.ok) {
      return evidenceUnavailable(input.refId, promoted.error);
    }

    const bundle = await input.evidenceStore.readBundle(promoted.value.evidenceBundleId);
    return bundle.ok
      ? ok({
          refId: input.refId,
          summaries: [
            {
              candidateFindingId: promoted.value.candidateFindingId,
              evidenceBundleId: promoted.value.evidenceBundleId,
              findingId: promoted.value.findingId,
              kind: "promoted-finding",
              promotionSource: promoted.value.promotionSource,
            },
            ...bundleArtifactSummaries([bundle.value]),
          ],
        })
      : evidenceUnavailable(input.refId, bundle.error);
  }

  if (input.refId.startsWith("flowrun_")) {
    const flowRun = await input.qaStore.readFlowRun(input.refId);
    return flowRun.ok
      ? ok({
          refId: input.refId,
          summaries: [
            {
              evidenceBundles: flowRun.value.evidenceBundles,
              flowId: flowRun.value.flowId,
              kind: "flow-run",
              status: flowRun.value.status,
            },
          ],
        })
      : evidenceUnavailable(input.refId, flowRun.error);
  }

  return evidenceUnavailable(input.refId);
}

async function readBundles(
  evidenceStore: QaEvidenceStore,
  ids: readonly string[],
): Promise<EvidenceBundle[]> {
  const bundles: EvidenceBundle[] = [];

  for (const id of ids) {
    const bundle = await evidenceStore.readBundle(id);
    if (bundle.ok) {
      bundles.push(bundle.value);
    }
  }

  return bundles;
}

function evidenceSummary(
  refId: string,
  bundles: readonly EvidenceBundle[],
): Result<BrowserQaEvidenceSummary, SurfaceError> {
  return ok({
    refId,
    summaries: bundleArtifactSummaries(bundles),
  });
}

function bundleArtifactSummaries(bundles: readonly EvidenceBundle[]) {
  return bundles.flatMap((bundle) =>
    bundle.artifacts.map((artifact) => ({
      bundleId: bundle.id,
      ...artifactSummary(artifact),
    })),
  );
}

function artifactSummary(artifact: QaEvidenceArtifact) {
  return {
    id: artifact.id,
    mediaType: artifact.mediaType,
    path: artifact.path,
    redacted: artifact.redacted,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
  };
}

function evidenceUnavailable(
  refId: string,
  cause?: unknown,
): Result<BrowserQaEvidenceSummary, SurfaceError> {
  return {
    error: createSurfaceError("evidence_unavailable", "QA evidence ref is unavailable.", {
      ...(cause === undefined ? {} : { cause }),
      details: { refId },
    }),
    ok: false,
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function safeCompositionId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/gu, "_");
}

async function resolveBrowserQaFlowPatterns(
  projectRoot: string,
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
    const expanded = await expandBrowserQaFlowPattern(projectRoot, pattern);

    if (expanded.length === 0) {
      unmatched.push(pattern);
      continue;
    }

    matched.push(...expanded);
  }

  return ok({
    matched: [...new Set(matched)],
    unmatched,
  });
}

async function expandBrowserQaFlowPattern(
  projectRoot: string,
  pattern: string,
): Promise<readonly string[]> {
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.join(projectRoot, pattern);

  if (!absolutePattern.includes("*")) {
    try {
      const entry = await stat(absolutePattern);
      return entry.isFile() ? [projectRelativePath(projectRoot, absolutePattern)] : [];
    } catch {
      return [];
    }
  }

  const root = globSearchRoot(absolutePattern);
  const files = await listFilesIfPresent(root);
  const normalizedPattern = toPosixPath(absolutePattern);

  return files
    .map((file) => path.resolve(file))
    .filter((file) => wildcardMatches(normalizedPattern, toPosixPath(file)))
    .map((file) => projectRelativePath(projectRoot, file));
}

function globSearchRoot(pattern: string): string {
  const firstWildcard = pattern.indexOf("*");
  const prefix = pattern.slice(0, firstWildcard);
  const slash = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));

  return slash <= 0 ? "." : prefix.slice(0, slash);
}

async function listFilesIfPresent(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);

        if (entry.isDirectory()) {
          return listFilesIfPresent(entryPath);
        }

        return entry.isFile() ? [entryPath] : [];
      }),
    );

    return files.flat();
  } catch {
    return [];
  }
}

function wildcardMatches(glob: string, value: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*");

  return new RegExp(`^${escaped}$`, "u").test(value);
}

function projectRelativePath(projectRoot: string, value: string): string {
  const relative = path.relative(projectRoot, value);
  return relative.startsWith("..") ? value : toPosixPath(relative);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

async function writePromotedFindingToProjectState(input: {
  readonly finding?: Finding;
  readonly stateStore: StateStore;
  readonly trackedFinding: TrackedFinding;
}): Promise<Result<TrackedFinding, SurfaceError>> {
  const state = await input.stateStore.readState();
  if (!state.ok) {
    return state;
  }

  const existingFindings = state.value.findings ?? [];
  const findings =
    input.finding === undefined
      ? existingFindings
      : [...existingFindings.filter((finding) => finding.id !== input.finding?.id), input.finding];
  const trackedFindings = [
    ...(state.value.trackedFindings ?? []).filter(
      (trackedFinding) =>
        trackedFinding.identityKey !== input.trackedFinding.identityKey &&
        trackedFinding.currentFindingId !== input.trackedFinding.currentFindingId,
    ),
    input.trackedFinding,
  ];
  const written = await input.stateStore.writeState({
    ...state.value,
    findings,
    trackedFindings,
  });

  return written.ok ? ok(input.trackedFinding) : written;
}

export const DEFAULT_COMPOSITION_STAGE_IDS = DEFAULT_PIPELINE_STAGE_DEFINITIONS.map(
  (stage) => stage.id,
);

function resolveKnowledgeRootDir(
  projectRoot: string,
  knowledgeRootDir: string | undefined,
): string {
  const projectKnowledgeRoot = path.resolve(
    projectRoot,
    knowledgeRootDir ?? DEFAULT_KNOWLEDGE_ROOT_DIR,
  );

  if (knowledgeRootDir !== undefined || existsSync(projectKnowledgeRoot)) {
    return projectKnowledgeRoot;
  }

  return (
    [BUNDLED_KNOWLEDGE_ROOT_DIR, MONOREPO_KNOWLEDGE_ROOT_DIR].find((candidate) =>
      existsSync(candidate),
    ) ?? projectKnowledgeRoot
  );
}
