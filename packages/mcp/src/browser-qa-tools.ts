import {
  createSurfaceError,
  err,
  isOk,
  ok,
  toMcpError,
  type Result,
  type SurfaceError,
} from "@zigrivers/surface-core";
import { z } from "zod";

export const BROWSER_QA_MCP_TOOL_NAMES = [
  "surface_qa",
  "surface_explore",
  "surface_flow_run",
  "surface_flow_list",
  "surface_flow_promote",
  "surface_evidence",
  "surface_replay",
  "surface_report_qa",
  "surface_artifact_read",
] as const;

export const BROWSER_QA_MCP_SERVER_TOOL_NAMES = [
  "surface_qa",
  "surface_explore",
  "surface_flow_run",
  "surface_flow_list",
  "surface_flow_promote",
  "surface_evidence",
  "surface_replay",
  "surface_report_qa",
  "surface_artifact_read",
] as const;

export type BrowserQaMcpToolName = (typeof BROWSER_QA_MCP_TOOL_NAMES)[number];
export type BrowserQaMcpServerToolName = (typeof BROWSER_QA_MCP_SERVER_TOOL_NAMES)[number];

export type BrowserQaMcpServerToolOutputMap = {
  readonly [Name in BrowserQaMcpServerToolName]: unknown;
};

export type BrowserQaMcpToolCallResult = {
  readonly content: readonly { readonly text: string; readonly type: "text" }[];
  readonly isError?: true;
  readonly structuredContent: unknown;
};

export type BrowserQaMcpToolDefinition = {
  readonly description: string;
  readonly handler: (input: unknown) => Promise<BrowserQaMcpToolCallResult>;
  readonly inputSchema: Record<string, unknown>;
  readonly inputZodSchema: z.ZodType;
  readonly name: BrowserQaMcpToolName;
  readonly schemaVersion: string;
  readonly title: string;
};

export type BrowserQaMcpHandlers = {
  readonly artifactRead: (input: SurfaceArtifactReadInput) => Promise<Result<unknown>>;
  readonly evidence: (input: SurfaceEvidenceInput) => Promise<Result<unknown>>;
  readonly explore: (input: SurfaceExploreInput) => Promise<Result<unknown>>;
  readonly flowList: (input: SurfaceFlowListInput) => Promise<Result<unknown>>;
  readonly flowPromote: (input: SurfaceFlowPromoteInput) => Promise<Result<unknown>>;
  readonly flowRun: (input: SurfaceFlowRunInput) => Promise<Result<unknown>>;
  readonly qa: (input: SurfaceQaInput) => Promise<Result<unknown>>;
  readonly replay: (input: SurfaceReplayInput) => Promise<Result<unknown>>;
  readonly reportQa: (input: SurfaceReportQaInput) => Promise<Result<unknown>>;
};

const BROWSER_QA_MCP_TOOL_SCHEMA_VERSION = "1.0.0";

const TargetInputSchema = z
  .object({
    kind: z.enum(["url", "localhost", "route", "screenshot", "component", "dom"]),
    ref: z.string().min(1),
    theme: z.enum(["light", "dark"]).optional(),
    viewport: z
      .object({
        height: z.number().int().positive(),
        label: z.enum(["mobile", "tablet", "desktop"]),
        width: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SurfaceQaInputSchema = z
  .object({
    actionPolicyRef: z.string().min(1).optional(),
    allowedDomains: z.array(z.string().min(1)).optional(),
    ci: z.boolean().optional(),
    evidence: z.enum(["minimal", "failures", "full"]).optional(),
    explore: z.boolean().optional(),
    flows: z.array(z.string().min(1)).optional(),
    maxActions: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
    maxStates: z.number().int().positive().optional(),
    network: z.enum(["summary", "har", "off"]).optional(),
    scope: z.string().min(1).optional(),
    sessionMode: z.enum(["isolated", "shared"]).optional(),
    stateLockTimeoutMs: z.number().int().positive().optional(),
    target: TargetInputSchema,
    task: z.string().min(1).optional(),
    video: z.enum(["off", "failures", "all"]).optional(),
  })
  .strict();
const SurfaceExploreInputSchema = z
  .object({
    actionPolicyRef: z.string().min(1).optional(),
    allowedDomains: z.array(z.string().min(1)).optional(),
    evidence: z.enum(["minimal", "failures", "full"]).optional(),
    maxActions: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
    maxStates: z.number().int().positive().optional(),
    network: z.enum(["summary", "har", "off"]).optional(),
    scope: z.string().min(1).optional(),
    sessionMode: z.enum(["isolated", "shared"]).optional(),
    stateLockTimeoutMs: z.number().int().positive().optional(),
    target: TargetInputSchema,
    task: z.string().min(1).optional(),
    video: z.enum(["off", "failures", "all"]).optional(),
  })
  .strict();
const SurfaceFlowRunInputSchema = z
  .object({
    actionPolicyRef: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    ci: z.boolean().optional(),
    flowPath: z.string().min(1),
    localhost: z.boolean().optional(),
    target: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (input) =>
      [input.target, input.url, input.localhost === true ? "localhost" : undefined].filter(
        (value) => value !== undefined,
      ).length <= 1,
    "Pass at most one of target, url, or localhost.",
  );
const SurfaceFlowListInputSchema = z.object({ candidates: z.boolean().optional() }).strict();
const SurfaceFlowPromoteInputSchema = z
  .object({
    candidateFlowId: z.string().min(1),
    outPath: z.string().min(1),
  })
  .strict();
const SurfaceEvidenceInputSchema = z.object({ refId: z.string().min(1) }).strict();
const SurfaceReplayInputSchema = z
  .object({
    promoteOnRepro: z.boolean().optional(),
    refId: z.string().min(1),
  })
  .strict();
const SurfaceReportQaInputSchema = z
  .object({
    format: z.enum(["md", "json", "manifest"]).optional(),
    runId: z.string().min(1),
  })
  .strict();
const SurfaceArtifactReadInputSchema = z
  .object({
    artifactId: z.string().min(1),
    maxBytes: z.number().int().positive().max(65_536).optional(),
    refId: z.string().min(1),
  })
  .strict();

export type SurfaceQaInput = z.infer<typeof SurfaceQaInputSchema>;
export type SurfaceExploreInput = z.infer<typeof SurfaceExploreInputSchema>;
export type SurfaceFlowRunInput = z.infer<typeof SurfaceFlowRunInputSchema>;
export type SurfaceFlowListInput = z.infer<typeof SurfaceFlowListInputSchema>;
export type SurfaceFlowPromoteInput = z.infer<typeof SurfaceFlowPromoteInputSchema>;
export type SurfaceEvidenceInput = z.infer<typeof SurfaceEvidenceInputSchema>;
export type SurfaceReplayInput = z.infer<typeof SurfaceReplayInputSchema>;
export type SurfaceReportQaInput = z.infer<typeof SurfaceReportQaInputSchema>;
export type SurfaceArtifactReadInput = z.infer<typeof SurfaceArtifactReadInputSchema>;

export const BROWSER_QA_MCP_SERVER_INPUT_SCHEMAS = {
  surface_qa: SurfaceQaInputSchema,
  surface_explore: SurfaceExploreInputSchema,
  surface_flow_run: SurfaceFlowRunInputSchema,
  surface_flow_list: SurfaceFlowListInputSchema,
  surface_flow_promote: SurfaceFlowPromoteInputSchema,
  surface_evidence: SurfaceEvidenceInputSchema,
  surface_replay: SurfaceReplayInputSchema,
  surface_report_qa: SurfaceReportQaInputSchema,
  surface_artifact_read: SurfaceArtifactReadInputSchema,
} as const satisfies Record<BrowserQaMcpServerToolName, z.ZodType>;

const BROWSER_QA_MCP_TOOL_INPUT_SCHEMAS = BROWSER_QA_MCP_SERVER_INPUT_SCHEMAS satisfies Record<
  BrowserQaMcpToolName,
  z.ZodType
>;

export const BROWSER_QA_MCP_SERVER_TOOL_METADATA = {
  surface_qa: {
    description: "Run agent-led browser QA over a target.",
    title: "Run Browser QA",
  },
  surface_explore: {
    description: "Run bounded browser QA exploration.",
    title: "Explore Browser QA",
  },
  surface_flow_run: {
    description: "Run a reviewed browser QA flow.",
    title: "Run Browser QA Flow",
  },
  surface_flow_list: {
    description: "List browser QA flow runs or candidate flows.",
    title: "List Browser QA Flows",
  },
  surface_flow_promote: {
    description: "Promote a candidate browser QA flow.",
    title: "Promote Browser QA Flow",
  },
  surface_evidence: {
    description: "Read redacted browser QA evidence metadata.",
    title: "Read Browser QA Evidence",
  },
  surface_replay: {
    description: "Replay a browser QA candidate or finding.",
    title: "Replay Browser QA Finding",
  },
  surface_report_qa: {
    description: "Render a browser QA report.",
    title: "Render Browser QA Report",
  },
  surface_artifact_read: {
    description: "Read a bounded MCP-approved browser QA artifact by registered refs.",
    title: "Read Browser QA Artifact",
  },
} as const satisfies Record<
  BrowserQaMcpServerToolName,
  { readonly description: string; readonly title: string }
>;

const BROWSER_QA_MCP_TOOL_METADATA = BROWSER_QA_MCP_SERVER_TOOL_METADATA satisfies Record<
  BrowserQaMcpToolName,
  { readonly description: string; readonly title: string }
>;

const BROWSER_QA_MCP_SERVER_TOOL_NAME_SET = new Set<string>(BROWSER_QA_MCP_SERVER_TOOL_NAMES);
const REGISTERED_REF_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/u;

export function createBrowserQaMcpTools(
  handlers: BrowserQaMcpHandlers,
): readonly BrowserQaMcpToolDefinition[] {
  return BROWSER_QA_MCP_TOOL_NAMES.map((name) => {
    const metadata = BROWSER_QA_MCP_TOOL_METADATA[name];
    const inputZodSchema = BROWSER_QA_MCP_TOOL_INPUT_SCHEMAS[name];

    return {
      name,
      ...metadata,
      handler: async (input) =>
        mcpToolCallResult(await callBrowserQaMcpTool({ handlers, input, name })),
      inputSchema: z.toJSONSchema(inputZodSchema),
      inputZodSchema,
      schemaVersion: BROWSER_QA_MCP_TOOL_SCHEMA_VERSION,
    };
  });
}

export function createBrowserQaMcpHandlers(composition: unknown): BrowserQaMcpHandlers {
  const browserQa = browserQaFromComposition(composition);
  const orchestrator = browserQa?.orchestrator;
  const flowService = browserQa?.flowService;
  const evidenceStore = browserQa?.evidenceStore;

  return {
    artifactRead: (input) =>
      evidenceStore?.readArtifactByRegisteredRef(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA evidence artifact reads are unavailable.")),
    evidence: (input) =>
      orchestrator?.readEvidence(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA evidence reads are unavailable.")),
    explore: (input) =>
      orchestrator?.runExplore({
        ...input,
        maxActions: input.maxActions ?? 25,
        maxDepth: input.maxDepth ?? 2,
        maxStates: input.maxStates ?? 10,
      }) ?? Promise.resolve(qaMcpUnavailable("Browser QA exploration is unavailable.")),
    flowList: (input) =>
      flowService?.listFlows(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA flow listing is unavailable.")),
    flowPromote: (input) =>
      flowService?.promoteFlow(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA flow promotion is unavailable.")),
    flowRun: (input) =>
      flowService?.runFlowFile({
        ...(input.actionPolicyRef === undefined ? {} : { actionPolicyRef: input.actionPolicyRef }),
        ...(input.ci === undefined ? {} : { ci: input.ci }),
        flowPath: input.flowPath,
        targetCli: targetCliForFlowRun(input),
      }) ?? Promise.resolve(qaMcpUnavailable("Browser QA flow running is unavailable.")),
    qa: (input) =>
      orchestrator?.runQa(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA orchestration is unavailable.")),
    replay: (input) =>
      orchestrator?.replay(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA replay is unavailable.")),
    reportQa: (input) =>
      orchestrator?.reportQa(input) ??
      Promise.resolve(qaMcpUnavailable("Browser QA reports are unavailable.")),
  };
}

export function isBrowserQaMcpServerToolName(name: string): name is BrowserQaMcpServerToolName {
  return BROWSER_QA_MCP_SERVER_TOOL_NAME_SET.has(name);
}

export async function callBrowserQaMcpTool(input: {
  readonly handlers: BrowserQaMcpHandlers;
  readonly input: unknown;
  readonly name: BrowserQaMcpToolName;
}): Promise<Result<unknown>> {
  const parsed = parseBrowserQaToolInput(input.name, input.input);

  if (!parsed.ok) {
    return parsed;
  }

  switch (input.name) {
    case "surface_qa":
      return await input.handlers.qa(parsed.value as SurfaceQaInput);
    case "surface_explore":
      return await input.handlers.explore(parsed.value as SurfaceExploreInput);
    case "surface_flow_run":
      return await input.handlers.flowRun(parsed.value as SurfaceFlowRunInput);
    case "surface_flow_list":
      return await input.handlers.flowList(parsed.value as SurfaceFlowListInput);
    case "surface_flow_promote":
      return await input.handlers.flowPromote(parsed.value as SurfaceFlowPromoteInput);
    case "surface_evidence":
      return await input.handlers.evidence(parsed.value as SurfaceEvidenceInput);
    case "surface_replay":
      return await input.handlers.replay(parsed.value as SurfaceReplayInput);
    case "surface_report_qa":
      return await input.handlers.reportQa(parsed.value as SurfaceReportQaInput);
    case "surface_artifact_read":
      return await callArtifactReadHandler(
        input.handlers,
        parsed.value as SurfaceArtifactReadInput,
      );
  }
}

type BrowserQaCompositionLike = {
  readonly browserQa?: {
    readonly evidenceStore?: {
      readonly readArtifactByRegisteredRef: (
        input: SurfaceArtifactReadInput,
      ) => Promise<Result<unknown>>;
    };
    readonly flowService?: {
      readonly listFlows: (input: SurfaceFlowListInput) => Promise<Result<unknown>>;
      readonly promoteFlow: (input: SurfaceFlowPromoteInput) => Promise<Result<unknown>>;
      readonly runFlowFile: (input: {
        readonly actionPolicyRef?: string;
        readonly ci?: boolean;
        readonly flowPath: string;
        readonly targetCli: {
          readonly baseUrl?: string;
          readonly localhost?: boolean;
          readonly target?: string;
          readonly url?: string;
        };
      }) => Promise<Result<unknown>>;
    };
    readonly orchestrator?: {
      readonly readEvidence: (input: SurfaceEvidenceInput) => Promise<Result<unknown>>;
      readonly replay: (input: SurfaceReplayInput) => Promise<Result<unknown>>;
      readonly reportQa: (input: SurfaceReportQaInput) => Promise<Result<unknown>>;
      readonly runExplore: (input: SurfaceExploreInput) => Promise<Result<unknown>>;
      readonly runQa: (input: SurfaceQaInput) => Promise<Result<unknown>>;
    };
  };
};

function parseBrowserQaToolInput(name: BrowserQaMcpToolName, input: unknown): Result<unknown> {
  const parsed = BROWSER_QA_MCP_TOOL_INPUT_SCHEMAS[name].safeParse(input);

  if (!parsed.success) {
    return err(
      createSurfaceError("config_invalid", "Browser QA MCP input did not match its schema.", {
        cause: parsed.error,
        details: { tool: name },
      }),
    );
  }

  return ok(parsed.data);
}

async function callArtifactReadHandler(
  handlers: BrowserQaMcpHandlers,
  input: SurfaceArtifactReadInput,
): Promise<Result<unknown>> {
  const refCheck = validateRegisteredRef(input.refId, "refId");

  if (!refCheck.ok) {
    return refCheck;
  }

  const artifactCheck = validateRegisteredRef(input.artifactId, "artifactId");

  if (!artifactCheck.ok) {
    return artifactCheck;
  }

  return await handlers.artifactRead({ ...input, maxBytes: input.maxBytes ?? 8192 });
}

function validateRegisteredRef(value: string, field: string): Result<true> {
  if (!REGISTERED_REF_ID_PATTERN.test(value) || value.includes("..")) {
    return err(
      createSurfaceError("config_invalid", "Browser QA artifact reads require registered ids.", {
        details: { field },
      }),
    );
  }

  return ok(true);
}

function browserQaFromComposition(composition: unknown): BrowserQaCompositionLike["browserQa"] {
  return (composition as BrowserQaCompositionLike).browserQa;
}

function targetCliForFlowRun(input: SurfaceFlowRunInput): {
  readonly baseUrl?: string;
  readonly localhost?: boolean;
  readonly target?: string;
  readonly url?: string;
} {
  return {
    ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
    ...(input.localhost === true ? { localhost: true } : {}),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.url === undefined ? {} : { url: input.url }),
  };
}

function qaMcpUnavailable(message: string): Result<never, SurfaceError> {
  return err(createSurfaceError("qa_unavailable", message));
}

function mcpToolCallResult(result: Result<unknown>): BrowserQaMcpToolCallResult {
  if (isOk(result)) {
    return {
      content: [{ text: JSON.stringify(result.value, null, 2), type: "text" }],
      structuredContent: result.value,
    };
  }

  return {
    content: [{ text: result.error.message, type: "text" }],
    isError: true,
    structuredContent: toMcpError(result.error),
  };
}
