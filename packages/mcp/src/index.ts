import { pathToFileURL } from "node:url";

import {
  DEFAULT_SURFACE_CONFIG,
  createSurfaceComposition,
  createSurfaceError,
  err,
  instantiateLensExecutionPlan,
  isOk,
  ok,
  scoreFinding,
  selectLensExecutionPlan,
  synthesizeBacklog,
  toMcpError,
  type Evidence,
  type Finding,
  type Result,
  type SurfaceConfig,
  type SurfaceComposition,
  type SurfaceCompositionOptions,
  type SurfaceError,
} from "@surface/core";
import type { Backlog, Capture, IssueExport, Target } from "@surface/core/interfaces";
import { z } from "zod";

export const SURFACE_MCP_SERVER_NAME = "surface";
export const SURFACE_MCP_SERVER_VERSION = "1.0.0";
export const SURFACE_MCP_TOOL_SCHEMA_VERSION = "1.0.0";

const TOOL_ORDER = [
  "surface_capture",
  "surface_audit",
  "surface_explain",
  "surface_backlog",
  "surface_gate",
  "surface_validate",
  "surface_baseline",
  "surface_verdict",
  "surface_diff",
  "surface_alternatives",
  "surface_trace",
  "surface_run",
  "surface_next",
  "surface_status",
] as const;

export type SurfaceMcpToolName = (typeof TOOL_ORDER)[number];
export type JsonSchema = Record<string, unknown>;

export type SurfaceMcpToolDefinition = {
  readonly name: SurfaceMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly schemaVersion: string;
  readonly inputSchema: JsonSchema;
};

type InternalSurfaceMcpToolDefinition = SurfaceMcpToolDefinition & {
  readonly inputZodSchema: z.ZodType;
};

export type SurfaceMcpToolRegistry = {
  readonly serverInfo: {
    readonly name: typeof SURFACE_MCP_SERVER_NAME;
    readonly version: typeof SURFACE_MCP_SERVER_VERSION;
  };
  listTools(): readonly SurfaceMcpToolDefinition[];
  getTool(name: SurfaceMcpToolName): SurfaceMcpToolDefinition | undefined;
};

export type SurfaceMcpServer = {
  readonly composition: SurfaceComposition;
  readonly registry: SurfaceMcpToolRegistry;
  callTool<TName extends SurfaceMcpToolName>(
    name: TName,
    input: unknown,
  ): Promise<Result<SurfaceMcpToolOutputMap[TName]>>;
  listTools(): readonly SurfaceMcpToolDefinition[];
};

export type SurfaceMcpServerOptions = SurfaceCompositionOptions & {
  readonly composition?: SurfaceComposition;
};

export type McpToolSchemaCompatibilityInput = {
  readonly current: Pick<SurfaceMcpToolDefinition, "inputSchema" | "name" | "schemaVersion">;
  readonly next: Pick<SurfaceMcpToolDefinition, "inputSchema" | "name" | "schemaVersion">;
};

export type SurfaceMcpAuditOutput = {
  readonly runId: string;
  readonly backlog: Backlog;
  readonly capture: Capture;
  readonly findings: readonly Finding[];
  readonly skippedLenses: readonly {
    readonly lensId: string;
    readonly message: string;
    readonly reason: string;
  }[];
};

export type SurfaceMcpExplainOutput = {
  readonly finding: Finding;
  readonly rationale: string;
  readonly evidence: readonly Evidence[];
};

export type SurfaceMcpStatusOutput = {
  readonly currentStage: string;
  readonly progress: {
    readonly completedRuns: number;
    readonly failedRuns: number;
    readonly findings: number;
  };
  readonly runHistory: readonly {
    readonly runId: string;
    readonly status: "completed" | "failed";
    readonly target?: Target;
    readonly findings: number;
  }[];
};

export type SurfaceMcpToolOutputMap = {
  readonly surface_capture: Capture;
  readonly surface_audit: SurfaceMcpAuditOutput;
  readonly surface_explain: SurfaceMcpExplainOutput;
  readonly surface_backlog: Backlog | IssueExport;
  readonly surface_status: SurfaceMcpStatusOutput;
  readonly surface_gate: never;
  readonly surface_validate: never;
  readonly surface_baseline: never;
  readonly surface_verdict: never;
  readonly surface_diff: never;
  readonly surface_alternatives: never;
  readonly surface_trace: never;
  readonly surface_run: never;
  readonly surface_next: never;
};

export type SurfaceMcpToolOutput = SurfaceMcpToolOutputMap[SurfaceMcpToolName];

const TargetSchema = z
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
const AuthStateRefSchema = z.string().min(1);
const RunRefSchema = z.object({ runId: z.string().min(1) }).strict();
const GatePolicyInputSchema = z.record(z.string(), z.unknown());

const TOOL_INPUT_SCHEMAS = {
  surface_capture: z
    .object({
      authState: AuthStateRefSchema.optional(),
      target: TargetSchema,
    })
    .strict(),
  surface_audit: z
    .object({
      authState: AuthStateRefSchema.optional(),
      depth: z
        .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
        .optional(),
      persona: z.string().min(1).optional(),
      preset: z.string().min(1).optional(),
      target: TargetSchema,
      task: z.string().min(1).optional(),
    })
    .strict(),
  surface_explain: z.object({ findingId: z.string().min(1) }).strict(),
  surface_backlog: z
    .object({
      exportTarget: z.string().min(1).optional(),
      runId: z.string().min(1).optional(),
    })
    .strict(),
  surface_gate: z
    .object({
      policy: GatePolicyInputSchema.optional(),
      runId: z.string().min(1).optional(),
    })
    .strict(),
  surface_validate: z.object({ runId: z.string().min(1) }).strict(),
  surface_baseline: z.object({ reason: z.string().min(1).optional() }).strict(),
  surface_verdict: z
    .object({
      decision: z.enum(["accept", "reject", "correct", "defer"]),
      findingId: z.string().min(1),
      rationale: z.string().min(1),
    })
    .strict(),
  surface_diff: z.object({ after: RunRefSchema, before: RunRefSchema }).strict(),
  surface_alternatives: z
    .object({
      authState: AuthStateRefSchema.optional(),
      target: TargetSchema,
    })
    .strict(),
  surface_trace: z.object({ findingId: z.string().min(1) }).strict(),
  surface_run: z
    .object({
      step: z.string().min(1),
      target: TargetSchema.optional(),
    })
    .strict(),
  surface_next: z.object({}).strict(),
  surface_status: z.object({}).strict(),
} as const satisfies Record<SurfaceMcpToolName, z.ZodType>;

const TOOL_METADATA = {
  surface_capture: {
    title: "Capture Target",
    description: "Capture a target into Surface artifacts.",
  },
  surface_audit: {
    title: "Audit Target",
    description: "Run a Surface audit over a target.",
  },
  surface_explain: {
    title: "Explain Finding",
    description: "Explain one Surface finding with evidence.",
  },
  surface_backlog: {
    title: "Read Backlog",
    description: "Return or export the implementation backlog.",
  },
  surface_gate: {
    title: "Evaluate Gate",
    description: "Evaluate the configured Surface quality gate.",
  },
  surface_validate: {
    title: "Validate Run",
    description: "Run validation checks for an audit run.",
  },
  surface_baseline: {
    title: "Create Baseline",
    description: "Baseline current findings for future gate comparisons.",
  },
  surface_verdict: {
    title: "Record Verdict",
    description: "Record a human verdict for a finding.",
  },
  surface_diff: {
    title: "Diff Runs",
    description: "Compare findings across two audit runs.",
  },
  surface_alternatives: {
    title: "Suggest Alternatives",
    description: "Suggest bounded alternatives for a target.",
  },
  surface_trace: {
    title: "Trace Finding",
    description: "Trace a finding through closed-loop state.",
  },
  surface_run: {
    title: "Run Pipeline Step",
    description: "Run a Surface pipeline step.",
  },
  surface_next: {
    title: "List Next Steps",
    description: "List eligible Surface pipeline steps.",
  },
  surface_status: {
    title: "Read Status",
    description: "Read Surface project status.",
  },
} as const satisfies Record<
  SurfaceMcpToolName,
  { readonly title: string; readonly description: string }
>;

const INTERNAL_TOOLS = TOOL_ORDER.map((name) => {
  const metadata = TOOL_METADATA[name];
  const inputZodSchema = TOOL_INPUT_SCHEMAS[name];

  return {
    name,
    ...metadata,
    inputZodSchema,
    inputSchema: z.toJSONSchema(inputZodSchema),
    schemaVersion: SURFACE_MCP_TOOL_SCHEMA_VERSION,
  };
}) satisfies readonly InternalSurfaceMcpToolDefinition[];

export function createSurfaceMcpToolRegistry(): SurfaceMcpToolRegistry {
  const toolsByName = new Map<SurfaceMcpToolName, InternalSurfaceMcpToolDefinition>(
    INTERNAL_TOOLS.map((tool) => [tool.name, tool]),
  );

  return {
    serverInfo: {
      name: SURFACE_MCP_SERVER_NAME,
      version: SURFACE_MCP_SERVER_VERSION,
    },
    getTool: (name) => {
      const tool = toolsByName.get(name);

      return tool === undefined ? undefined : publicToolDefinition(tool);
    },
    listTools: () => INTERNAL_TOOLS.map(publicToolDefinition),
  };
}

export function createSurfaceMcpServer(options: SurfaceMcpServerOptions = {}): SurfaceMcpServer {
  const registry = createSurfaceMcpToolRegistry();
  const composition = options.composition ?? createSurfaceComposition(options);
  const session = createSurfaceMcpSessionState();

  return {
    composition,
    callTool: async (name, input) =>
      (await callSurfaceMcpTool({
        composition,
        input,
        name,
        session,
      })) as Result<SurfaceMcpToolOutputMap[typeof name]>,
    registry,
    listTools: () => registry.listTools(),
  };
}

export function createMcpToolSchemaSnapshot(
  registry: SurfaceMcpToolRegistry = createSurfaceMcpToolRegistry(),
): readonly Pick<SurfaceMcpToolDefinition, "inputSchema" | "name" | "schemaVersion">[] {
  return registry.listTools().map((tool) => ({
    inputSchema: tool.inputSchema,
    name: tool.name,
    schemaVersion: tool.schemaVersion,
  }));
}

export function assertMcpToolSchemaCompatibility(
  input: McpToolSchemaCompatibilityInput,
): Result<true, SurfaceError> {
  if (input.current.name !== input.next.name) {
    return mcpSchemaIncompatible(
      "MCP tool names cannot change without a major version bump.",
      input,
    );
  }

  if (!hasMajorVersionIncrement(input.current.schemaVersion, input.next.schemaVersion)) {
    const currentRequired = requiredFields(input.current.inputSchema);
    const nextRequired = requiredFields(input.next.inputSchema);
    const addedRequired = [...nextRequired].filter((field) => !currentRequired.has(field));

    if (addedRequired.length > 0) {
      return mcpSchemaIncompatible(
        "MCP tool schema added required fields without a major version bump.",
        input,
        { addedRequired },
      );
    }
  }

  return ok(true);
}

type SurfaceMcpSessionState = {
  readonly runs: Map<string, SurfaceMcpRunRecord>;
  readonly runOrder: string[];
  nextRunSequence: number;
};

type SurfaceMcpRunRecord = {
  readonly runId: string;
  readonly status: "completed" | "failed";
  readonly backlog: Backlog;
  readonly capture: Capture;
  readonly findings: readonly Finding[];
  readonly skippedLenses: SurfaceMcpAuditOutput["skippedLenses"];
};

type CallSurfaceMcpToolInput = {
  readonly composition: SurfaceComposition;
  readonly input: unknown;
  readonly name: SurfaceMcpToolName;
  readonly session: SurfaceMcpSessionState;
};

function createSurfaceMcpSessionState(): SurfaceMcpSessionState {
  return {
    runs: new Map(),
    runOrder: [],
    nextRunSequence: 1,
  };
}

async function callSurfaceMcpTool(
  input: CallSurfaceMcpToolInput,
): Promise<Result<SurfaceMcpToolOutput>> {
  switch (input.name) {
    case "surface_capture":
      return await callSurfaceCapture(input.composition, input.input);
    case "surface_audit":
      return await callSurfaceAudit(input.composition, input.session, input.input);
    case "surface_explain":
      return callSurfaceExplain(input.session, input.input);
    case "surface_backlog":
      return await callSurfaceBacklog(input.composition, input.session, input.input);
    case "surface_status":
      return callSurfaceStatus(input.session);
    case "surface_gate":
    case "surface_validate":
    case "surface_baseline":
    case "surface_verdict":
    case "surface_diff":
    case "surface_alternatives":
    case "surface_trace":
    case "surface_run":
    case "surface_next":
      return err(
        createSurfaceError("unknown_step", "MCP tool handler is not implemented yet.", {
          details: { tool: input.name },
        }),
      );
  }
}

async function callSurfaceCapture(
  composition: SurfaceComposition,
  rawInput: unknown,
): Promise<Result<Capture>> {
  const parsed = parseToolInput("surface_capture", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  return await composition.captureService.capture(
    targetForCore(parsed.value.target),
    captureOptionsFor(DEFAULT_SURFACE_CONFIG, parsed.value.authState),
  );
}

async function callSurfaceAudit(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Promise<Result<SurfaceMcpAuditOutput>> {
  const parsed = parseToolInput("surface_audit", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const config = configForAuditInput(parsed.value);
  const capture = await composition.captureService.capture(
    targetForCore(parsed.value.target),
    captureOptionsFor(config, parsed.value.authState),
  );

  if (!capture.ok) {
    return capture;
  }

  const evidence = await groundingEvidenceFor(composition, capture.value);

  if (!evidence.ok) {
    return evidence;
  }

  const plan = selectLensExecutionPlan({
    capture: capture.value,
    config,
    modelAvailability: {
      available: false,
      message: "No MCP model provider is configured.",
      reason: "no-model-configured",
    },
    registry: composition.lensRegistry,
  });
  const findings = await findingsForPlan(composition, config, capture.value, evidence.value, plan);

  if (!findings.ok) {
    return findings;
  }

  const runId = nextRunId(session);
  const backlog = synthesizeBacklog(runId, findings.value);

  if (!backlog.ok) {
    return backlog;
  }

  const record: SurfaceMcpRunRecord = {
    backlog: backlog.value,
    capture: capture.value,
    findings: findings.value,
    runId,
    skippedLenses: plan.skipped,
    status: "completed",
  };
  session.runs.set(runId, record);
  session.runOrder.push(runId);

  return ok({
    backlog: record.backlog,
    capture: record.capture,
    findings: record.findings,
    runId: record.runId,
    skippedLenses: record.skippedLenses,
  });
}

function callSurfaceExplain(
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Result<SurfaceMcpExplainOutput> {
  const parsed = parseToolInput("surface_explain", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const finding = findStoredFinding(session, parsed.value.findingId);

  if (finding === undefined) {
    return err(
      createSurfaceError("finding_not_found", "No stored MCP finding matched the requested id.", {
        details: { findingId: parsed.value.findingId },
      }),
    );
  }

  if (finding.evidence.length === 0) {
    return err(
      createSurfaceError("evidence_missing", "Stored MCP finding has no evidence to explain.", {
        details: { findingId: finding.id },
      }),
    );
  }

  return ok({
    evidence: finding.evidence,
    finding,
    rationale: finding.rationale,
  });
}

async function callSurfaceBacklog(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Promise<Result<Backlog | IssueExport>> {
  const parsed = parseToolInput("surface_backlog", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const record = runRecordFor(session, parsed.value.runId);

  if (record === undefined) {
    return err(
      createSurfaceError("run_not_found", "No stored MCP run matched the requested backlog.", {
        details: { runId: parsed.value.runId ?? null },
      }),
    );
  }

  if (parsed.value.exportTarget === undefined) {
    return ok(record.backlog);
  }

  const exporter = composition.issueExporters.find(
    (candidate) => candidate.target === parsed.value.exportTarget,
  );

  if (exporter === undefined) {
    return err(
      createSurfaceError(
        "unknown_export_target",
        "No issue exporter matched the MCP backlog target.",
        {
          details: { exportTarget: parsed.value.exportTarget },
        },
      ),
    );
  }

  const artifact = await composition.stateStore.writeArtifact({
    bytes: new TextEncoder().encode(JSON.stringify(record.backlog, null, 2)),
    kind: "report",
    relativePath: `reports/${record.runId}/backlog.json`,
  });

  if (!artifact.ok) {
    return artifact;
  }

  const exported = await exporter.export({
    backlogId: record.backlog.id,
    path: artifact.value.path,
  });

  if (!exported.ok) {
    return exported;
  }

  if (exported.value.status === "partial") {
    return err(
      createSurfaceError("export_partial", "MCP backlog export completed partially.", {
        details: { exportId: exported.value.id, target: exported.value.target },
      }),
    );
  }

  return ok(exported.value);
}

function callSurfaceStatus(session: SurfaceMcpSessionState): Result<SurfaceMcpStatusOutput> {
  const runHistory = session.runOrder
    .map((runId) => session.runs.get(runId))
    .filter((record): record is SurfaceMcpRunRecord => record !== undefined)
    .map((record) => ({
      findings: record.findings.length,
      runId: record.runId,
      status: record.status,
      target: record.capture.target,
    }));
  const completedRuns = runHistory.filter((entry) => entry.status === "completed").length;
  const failedRuns = runHistory.filter((entry) => entry.status === "failed").length;

  return ok({
    currentStage: runHistory.at(-1)?.status === "completed" ? "completed" : "pending",
    progress: {
      completedRuns,
      failedRuns,
      findings: runHistory.reduce((total, entry) => total + entry.findings, 0),
    },
    runHistory,
  });
}

async function groundingEvidenceFor(
  composition: SurfaceComposition,
  capture: Capture,
): Promise<Result<readonly Evidence[]>> {
  const evidence: Evidence[] = [];

  for (const tool of composition.groundingTools) {
    const result = await tool.run(capture);

    if (!result.ok) {
      return result;
    }

    for (const toolResult of result.value) {
      evidence.push(...toolResult.evidence);
    }
  }

  return ok(evidence);
}

async function findingsForPlan(
  composition: SurfaceComposition,
  config: SurfaceConfig,
  capture: Capture,
  evidence: readonly Evidence[],
  plan: ReturnType<typeof selectLensExecutionPlan>,
): Promise<Result<readonly Finding[]>> {
  const findings: Finding[] = [];
  const lenses = instantiateLensExecutionPlan(plan, composition.lensFactoryOptions);

  for (const { lens } of lenses) {
    const drafts = await lens.evaluate({
      capture,
      config,
      evidence: [...evidence],
      knowledge: composition.knowledgeSource,
    });

    if (!drafts.ok) {
      return drafts;
    }

    for (const draft of drafts.value) {
      const scored = scoreFinding(draft, config.findings);

      if (!scored.ok) {
        return scored;
      }

      findings.push(scored.value);
    }
  }

  return ok(findings);
}

function configForAuditInput(
  input: z.infer<(typeof TOOL_INPUT_SCHEMAS)["surface_audit"]>,
): SurfaceConfig {
  return {
    ...DEFAULT_SURFACE_CONFIG,
    capture: { ...DEFAULT_SURFACE_CONFIG.capture },
    evaluation: {
      ...DEFAULT_SURFACE_CONFIG.evaluation,
      ...(input.depth === undefined ? {} : { depth: input.depth }),
      ...(input.preset === undefined
        ? {}
        : { preset: input.preset as SurfaceConfig["evaluation"]["preset"] }),
    },
    findings: { ...DEFAULT_SURFACE_CONFIG.findings },
    reporting: { ...DEFAULT_SURFACE_CONFIG.reporting },
  };
}

function captureOptionsFor(
  config: SurfaceConfig,
  authStateRef: string | undefined,
): { readonly authStateRef?: string; readonly config: SurfaceConfig["capture"] } {
  return {
    config: config.capture,
    ...(authStateRef === undefined ? {} : { authStateRef }),
  };
}

function targetForCore(input: z.infer<typeof TargetSchema>): Target {
  return {
    kind: input.kind,
    ref: input.ref,
    ...(input.theme === undefined ? {} : { theme: input.theme }),
    ...(input.viewport === undefined
      ? {}
      : {
          viewport: {
            height: input.viewport.height,
            label: input.viewport.label,
            width: input.viewport.width,
          },
        }),
  };
}

function parseToolInput<TName extends SurfaceMcpToolName>(
  name: TName,
  input: unknown,
): Result<z.infer<(typeof TOOL_INPUT_SCHEMAS)[TName]>> {
  const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(input);

  if (!parsed.success) {
    return err(
      createSurfaceError("config_invalid", "MCP tool input did not match the registered schema.", {
        cause: parsed.error,
        details: { tool: name },
      }),
    );
  }

  return ok(parsed.data as z.infer<(typeof TOOL_INPUT_SCHEMAS)[TName]>);
}

function nextRunId(session: SurfaceMcpSessionState): string {
  const runId = `run_mcp_${session.nextRunSequence.toString().padStart(4, "0")}`;
  session.nextRunSequence += 1;

  return runId;
}

function runRecordFor(
  session: SurfaceMcpSessionState,
  runId: string | undefined,
): SurfaceMcpRunRecord | undefined {
  if (runId !== undefined) {
    return session.runs.get(runId);
  }

  const latestRunId = session.runOrder.at(-1);

  return latestRunId === undefined ? undefined : session.runs.get(latestRunId);
}

function findStoredFinding(
  session: SurfaceMcpSessionState,
  findingId: string,
): Finding | undefined {
  for (const runId of session.runOrder) {
    const record = session.runs.get(runId);
    const finding = record?.findings.find((candidate) => candidate.id === findingId);

    if (finding !== undefined) {
      return finding;
    }
  }

  return undefined;
}

export async function createSurfaceSdkMcpServer(
  options: SurfaceMcpServerOptions = {},
): Promise<unknown> {
  const surfaceServer = createSurfaceMcpServer(options);

  const [{ McpServer }] = await Promise.all([import("@modelcontextprotocol/sdk/server/mcp.js")]);
  const server = new McpServer({
    name: SURFACE_MCP_SERVER_NAME,
    version: SURFACE_MCP_SERVER_VERSION,
  }) as SdkMcpServer;

  for (const tool of INTERNAL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputZodSchema,
        title: tool.title,
      },
      async (input) => mcpToolCallResult(await surfaceServer.callTool(tool.name, input)),
    );
  }

  return server;
}

export async function runSurfaceMcpStdioServer(
  options: SurfaceMcpServerOptions = {},
): Promise<void> {
  const [{ StdioServerTransport }, server] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    createSurfaceSdkMcpServer(options),
  ]);

  await (server as SdkMcpServer).connect(new StdioServerTransport());
}

type SdkMcpServer = {
  connect(transport: unknown): Promise<void>;
  registerTool(
    name: string,
    config: {
      readonly description: string;
      readonly inputSchema: unknown;
      readonly title: string;
    },
    handler: (input: unknown) => unknown,
  ): void;
};

function mcpToolCallResult(result: Result<SurfaceMcpToolOutput>): {
  readonly content: readonly { readonly text: string; readonly type: "text" }[];
  readonly isError?: true;
  readonly structuredContent: unknown;
} {
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

function publicToolDefinition(tool: InternalSurfaceMcpToolDefinition): SurfaceMcpToolDefinition {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    schemaVersion: tool.schemaVersion,
    title: tool.title,
  };
}

function requiredFields(schema: JsonSchema): ReadonlySet<string> {
  const required = schema.required;

  return Array.isArray(required)
    ? new Set(required.filter((field): field is string => typeof field === "string"))
    : new Set();
}

function hasMajorVersionIncrement(currentVersion: string, nextVersion: string): boolean {
  const currentMajor = majorVersion(currentVersion);
  const nextMajor = majorVersion(nextVersion);

  return currentMajor !== undefined && nextMajor !== undefined && nextMajor > currentMajor;
}

function majorVersion(version: string): number | undefined {
  const match = /^(\d+)\./u.exec(version);
  const value = match?.[1];

  if (value === undefined) {
    return undefined;
  }

  const major = Number(value);

  return Number.isInteger(major) ? major : undefined;
}

function mcpSchemaIncompatible(
  message: string,
  input: McpToolSchemaCompatibilityInput,
  details: Record<string, unknown> = {},
): Result<never, SurfaceError> {
  return err(
    createSurfaceError("mcp_schema_incompatible", message, {
      details: {
        current: {
          name: input.current.name,
          schemaVersion: input.current.schemaVersion,
        },
        next: {
          name: input.next.name,
          schemaVersion: input.next.schemaVersion,
        },
        ...details,
      },
    }),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSurfaceMcpStdioServer();
}
