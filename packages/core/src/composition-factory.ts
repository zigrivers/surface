import path from "node:path";

import {
  createCaptureService,
  createPlaywrightCaptureBackend,
  createStaticCaptureBackend,
  type CaptureService,
} from "./capture.js";
import {
  DEFAULT_PIPELINE_STAGE_DEFINITIONS,
  createNoopPipelineHandlers,
  createPipelineOrchestrator,
  type ExecutablePipelineStageId,
  type PipelineOrchestrator,
  type PipelineStageHandler,
} from "./pipeline-orchestrator.js";
import { createGateEvaluator } from "./gate-evaluator.js";
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
import { createFileStateStore } from "./state-store.js";
import type {
  CaptureBackend,
  FrameworkAdapter,
  GateEvaluator,
  GroundingTool,
  IssueExporter,
  KnowledgeSource,
  ReportRenderer,
  StateStore,
} from "./interfaces.js";

const DEFAULT_KNOWLEDGE_ROOT_DIR = "content/knowledge";

export type SurfaceCompositionGeneratedAt = string | (() => string);

export type SurfaceCompositionOptions = {
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
  readonly pipelineHandlers?: Partial<Record<ExecutablePipelineStageId, PipelineStageHandler>>;
  readonly projectRoot?: string;
  readonly reportRenderers?: readonly ReportRenderer[];
  readonly stateDir?: string;
  readonly stateStore?: StateStore;
  readonly staticFallback?: CaptureBackend;
};

export type SurfaceComposition = {
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
  const staticFallback = options.staticFallback ?? createStaticCaptureBackend();
  const browserBackends = options.captureBackends ?? [createPlaywrightCaptureBackend()];
  const captureBackends = [...browserBackends, staticFallback];
  const stateStore =
    options.stateStore ??
    createFileStateStore({
      projectRoot,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  const knowledgeSource =
    options.knowledgeSource ??
    createFileSystemKnowledgeSource({
      rootDir: path.resolve(projectRoot, options.knowledgeRootDir ?? DEFAULT_KNOWLEDGE_ROOT_DIR),
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

  return {
    captureBackends,
    captureService: createCaptureService({
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

export const DEFAULT_COMPOSITION_STAGE_IDS = DEFAULT_PIPELINE_STAGE_DEFINITIONS.map(
  (stage) => stage.id,
);
