import { pathToFileURL } from "node:url";

import {
  DEFAULT_SURFACE_CONFIG,
  createTrackedFinding,
  createSurfaceComposition,
  createSurfaceError,
  diffTrackedFindings,
  err,
  instantiateLensExecutionPlan,
  isOk,
  ok,
  scoreFinding,
  selectLensExecutionPlan,
  synthesizeBacklog,
  toMcpError,
  transitionTrackedFinding,
  type Evidence,
  type Finding,
  type TrackedFinding,
  type ValidationCheck,
  type Result,
  type SurfaceConfig,
  type SurfaceComposition,
  type SurfaceCompositionOptions,
  type SurfaceError,
} from "@surface/core";
import type {
  Backlog,
  Baseline,
  Capture,
  GateResult,
  IssueExport,
  ProjectRunRecord,
  ProjectStateSnapshot,
  Target,
} from "@surface/core/interfaces";
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

export type SurfaceMcpValidationOutput = {
  readonly checks: readonly {
    readonly id: string;
    readonly findingId?: string;
    readonly passed: boolean;
    readonly validation: ValidationCheck;
  }[];
};

export type SurfaceMcpBaselineOutput = {
  readonly baselineId: string;
  readonly count: number;
  readonly reason?: string;
};

export type SurfaceMcpVerdictOutput = {
  readonly findingId: string;
  readonly decision: "accept" | "reject" | "correct" | "defer";
  readonly rationale: string;
};

export type SurfaceMcpDiffOutput = {
  readonly resolved: readonly SurfaceMcpDiffEntry[];
  readonly regressed: readonly SurfaceMcpDiffEntry[];
  readonly introduced: readonly SurfaceMcpDiffEntry[];
  readonly stillFailing: readonly SurfaceMcpDiffEntry[];
  readonly identityBroken: readonly SurfaceMcpDiffEntry[];
};

export type SurfaceMcpDiffEntry = {
  readonly findingId?: string;
  readonly identityKey: string;
  readonly status: TrackedFinding["status"];
};

export type SurfaceMcpTraceOutput = {
  readonly trackedFinding: TrackedFinding;
};

export type SurfaceMcpToolOutputMap = {
  readonly surface_capture: Capture;
  readonly surface_audit: SurfaceMcpAuditOutput;
  readonly surface_explain: SurfaceMcpExplainOutput;
  readonly surface_backlog: Backlog | IssueExport;
  readonly surface_status: SurfaceMcpStatusOutput;
  readonly surface_gate: GateResult;
  readonly surface_validate: SurfaceMcpValidationOutput;
  readonly surface_baseline: SurfaceMcpBaselineOutput;
  readonly surface_verdict: SurfaceMcpVerdictOutput;
  readonly surface_diff: SurfaceMcpDiffOutput;
  readonly surface_alternatives: never;
  readonly surface_trace: SurfaceMcpTraceOutput;
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
    callTool: async (name, input) => {
      const hydrated = await hydrateSurfaceMcpSession(composition, session);

      if (!hydrated.ok) {
        return hydrated;
      }

      return (await callSurfaceMcpTool({
        composition,
        input,
        name,
        session,
      })) as Result<SurfaceMcpToolOutputMap[typeof name]>;
    },
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
  readonly baselines: Map<string, SurfaceMcpBaselineRecord>;
  readonly baselineOrder: string[];
  readonly runs: Map<string, SurfaceMcpRunRecord>;
  readonly runOrder: string[];
  readonly trackedByIdentity: Map<string, TrackedFinding>;
  readonly verdicts: Map<string, SurfaceMcpVerdictOutput>;
  nextBaselineSequence: number;
  nextRunSequence: number;
};

type SurfaceMcpRunRecord = {
  readonly runId: string;
  readonly status: "completed" | "failed";
  readonly backlog: Backlog;
  readonly capture: Capture;
  readonly findings: readonly Finding[];
  readonly skippedLenses: SurfaceMcpAuditOutput["skippedLenses"];
  readonly trackedFindings: readonly TrackedFinding[];
};

type SurfaceMcpBaselineRecord = {
  readonly baselineId: string;
  readonly identityKeys: ReadonlySet<string>;
  readonly reason?: string;
};

type CallSurfaceMcpToolInput = {
  readonly composition: SurfaceComposition;
  readonly input: unknown;
  readonly name: SurfaceMcpToolName;
  readonly session: SurfaceMcpSessionState;
};

function createSurfaceMcpSessionState(): SurfaceMcpSessionState {
  return {
    baselines: new Map(),
    baselineOrder: [],
    runs: new Map(),
    runOrder: [],
    trackedByIdentity: new Map(),
    verdicts: new Map(),
    nextBaselineSequence: 1,
    nextRunSequence: 1,
  };
}

async function hydrateSurfaceMcpSession(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
): Promise<Result<void>> {
  const state = await composition.stateStore.readState();

  if (!state.ok) {
    return state;
  }

  resetSurfaceMcpSessionFromState(session, state.value);

  return ok(undefined);
}

function resetSurfaceMcpSessionFromState(
  session: SurfaceMcpSessionState,
  state: ProjectStateSnapshot,
): void {
  session.baselines.clear();
  session.baselineOrder.length = 0;
  session.runs.clear();
  session.runOrder.length = 0;
  session.trackedByIdentity.clear();
  session.verdicts.clear();

  for (const trackedFinding of state.trackedFindings ?? []) {
    session.trackedByIdentity.set(trackedFinding.identityKey, trackedFinding);
  }

  for (const record of state.runRecords ?? []) {
    const mcpRecord = surfaceMcpRunRecordFromProjectRecord(record);

    if (mcpRecord === undefined) {
      continue;
    }

    session.runs.set(mcpRecord.runId, mcpRecord);
    session.runOrder.push(mcpRecord.runId);

    for (const trackedFinding of mcpRecord.trackedFindings) {
      session.trackedByIdentity.set(trackedFinding.identityKey, trackedFinding);
    }
  }

  for (const baseline of state.baselines ?? []) {
    const mcpBaseline = surfaceMcpBaselineFromProjectBaseline(baseline);
    session.baselines.set(mcpBaseline.baselineId, mcpBaseline);
    session.baselineOrder.push(mcpBaseline.baselineId);
  }

  for (const verdict of state.verdicts ?? []) {
    if (isSurfaceMcpVerdict(verdict)) {
      session.verdicts.set(verdict.findingId, verdict);
    }
  }

  session.nextRunSequence = nextSequenceFromIds(session.runOrder, "run_mcp_");
  session.nextBaselineSequence = nextSequenceFromIds(session.baselineOrder, "baseline_mcp_");
}

function surfaceMcpRunRecordFromProjectRecord(
  record: ProjectRunRecord,
): SurfaceMcpRunRecord | undefined {
  if (
    record.backlog === undefined ||
    record.capture === undefined ||
    record.findings === undefined ||
    record.status === undefined ||
    record.skippedLenses === undefined
  ) {
    return undefined;
  }

  return {
    backlog: record.backlog,
    capture: record.capture,
    findings: record.findings,
    runId: record.runId,
    skippedLenses: record.skippedLenses,
    status: record.status,
    trackedFindings: record.trackedFindings,
  };
}

function surfaceMcpBaselineFromProjectBaseline(baseline: Baseline): SurfaceMcpBaselineRecord {
  return {
    baselineId: baseline.baselineId,
    identityKeys: new Set(baseline.identityKeys),
    ...(baseline.reason === undefined ? {} : { reason: baseline.reason }),
  };
}

function isSurfaceMcpVerdict(verdict: {
  readonly decision: string;
  readonly findingId: string;
  readonly rationale: string;
}): verdict is SurfaceMcpVerdictOutput {
  return (
    verdict.decision === "accept" ||
    verdict.decision === "reject" ||
    verdict.decision === "correct" ||
    verdict.decision === "defer"
  );
}

async function persistSurfaceMcpSession(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
): Promise<Result<void>> {
  const updateState = stateSnapshotForMcpSession(session);

  if (composition.stateStore.updateState !== undefined) {
    const updated = await composition.stateStore.updateState(updateState);

    return updated.ok ? ok(undefined) : updated;
  }

  const current = await composition.stateStore.readState();

  if (!current.ok) {
    return current;
  }

  const written = await composition.stateStore.writeState(updateState(current.value));

  return written.ok ? ok(undefined) : written;
}

function stateSnapshotForMcpSession(
  session: SurfaceMcpSessionState,
): (state: ProjectStateSnapshot) => ProjectStateSnapshot {
  return (state) => {
    const runRecords = session.runOrder
      .map((runId) => session.runs.get(runId))
      .filter((record): record is SurfaceMcpRunRecord => record !== undefined)
      .map(projectRunRecordFromSurfaceMcpRecord);
    const latestRun = runRecords.at(-1);
    const baselines = session.baselineOrder
      .map((baselineId) => session.baselines.get(baselineId))
      .filter((baseline): baseline is SurfaceMcpBaselineRecord => baseline !== undefined)
      .map(projectBaselineFromSurfaceMcpBaseline);
    const trackedFindings = [...session.trackedByIdentity.values()];
    const verdicts = [...session.verdicts.values()];
    const currentStage = latestRun?.status ?? state.currentStage;

    return {
      ...state,
      ...(latestRun?.backlog === undefined ? {} : { backlog: latestRun.backlog }),
      ...(currentStage === undefined ? {} : { currentStage }),
      ...(latestRun?.findings === undefined ? {} : { findings: latestRun.findings }),
      baselines,
      runRecords,
      trackedFindings,
      verdicts,
    };
  };
}

function projectRunRecordFromSurfaceMcpRecord(record: SurfaceMcpRunRecord): ProjectRunRecord {
  return {
    backlog: record.backlog,
    capture: record.capture,
    findings: record.findings,
    runId: record.runId,
    skippedLenses: record.skippedLenses,
    status: record.status,
    trackedFindings: record.trackedFindings,
  };
}

function projectBaselineFromSurfaceMcpBaseline(baseline: SurfaceMcpBaselineRecord): Baseline {
  return {
    baselineId: baseline.baselineId,
    identityKeys: [...baseline.identityKeys],
    ...(baseline.reason === undefined ? {} : { reason: baseline.reason }),
    waivers: [],
  };
}

function nextSequenceFromIds(ids: readonly string[], prefix: string): number {
  let maxSequence = 0;

  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      continue;
    }

    const sequence = Number.parseInt(id.slice(prefix.length), 10);

    if (Number.isInteger(sequence)) {
      maxSequence = Math.max(maxSequence, sequence);
    }
  }

  return maxSequence + 1;
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
    case "surface_gate":
      return await callSurfaceGate(input.composition, input.session, input.input);
    case "surface_validate":
      return callSurfaceValidate(input.session, input.input);
    case "surface_baseline":
      return await callSurfaceBaseline(input.composition, input.session, input.input);
    case "surface_verdict":
      return await callSurfaceVerdict(input.composition, input.session, input.input);
    case "surface_diff":
      return callSurfaceDiff(input.session, input.input);
    case "surface_trace":
      return callSurfaceTrace(input.session, input.input);
    case "surface_status":
      return callSurfaceStatus(input.session);
    case "surface_alternatives":
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

  const trackedFindings = trackedFindingsForRun(session, runId, findings.value);

  const record: SurfaceMcpRunRecord = {
    backlog: backlog.value,
    capture: capture.value,
    findings: findings.value,
    runId,
    skippedLenses: plan.skipped,
    status: "completed",
    trackedFindings,
  };
  session.runs.set(runId, record);
  session.runOrder.push(runId);

  const persisted = await persistSurfaceMcpSession(composition, session);

  if (!persisted.ok) {
    return persisted;
  }

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

async function callSurfaceGate(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Promise<Result<GateResult>> {
  const parsed = parseToolInput("surface_gate", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const record = runRecordFor(session, parsed.value.runId);

  if (record === undefined) {
    return err(
      createSurfaceError("run_not_found", "No stored MCP run matched the requested gate.", {
        details: { runId: parsed.value.runId ?? null },
      }),
    );
  }

  const baseline = latestBaseline(session);
  const baselineIdentityKeys = baseline?.identityKeys ?? new Set<string>();
  const findings = record.findings.filter((finding) => {
    const tracked = trackedFindingForRunFinding(record, finding.id);

    return tracked === undefined || !baselineIdentityKeys.has(tracked.identityKey);
  });
  const policy =
    parsed.value.policy === undefined
      ? DEFAULT_SURFACE_CONFIG.reporting.gatePolicy
      : (parsed.value.policy as SurfaceConfig["reporting"]["gatePolicy"]);

  return await composition.gateEvaluator.evaluate(findings, policy);
}

function callSurfaceValidate(
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Result<SurfaceMcpValidationOutput> {
  const parsed = parseToolInput("surface_validate", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const record = runRecordFor(session, parsed.value.runId);

  if (record === undefined) {
    return err(
      createSurfaceError("run_not_found", "No stored MCP run matched the requested validation.", {
        details: { runId: parsed.value.runId },
      }),
    );
  }

  return ok({
    checks: record.trackedFindings.map((trackedFinding) => ({
      id: trackedFinding.identityKey,
      passed: trackedFinding.status !== "identity-broken",
      validation: trackedFinding.validation,
      ...(trackedFinding.currentFindingId === undefined
        ? {}
        : { findingId: trackedFinding.currentFindingId }),
    })),
  });
}

async function callSurfaceBaseline(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Promise<Result<SurfaceMcpBaselineOutput>> {
  const parsed = parseToolInput("surface_baseline", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const record = runRecordFor(session, undefined);

  if (record === undefined || record.trackedFindings.length === 0) {
    return err(
      createSurfaceError("no_findings_to_baseline", "No MCP findings are available to baseline."),
    );
  }

  const baselineId = nextBaselineId(session);
  const baseline: SurfaceMcpBaselineRecord = {
    baselineId,
    identityKeys: new Set(
      record.trackedFindings.map((trackedFinding) => trackedFinding.identityKey),
    ),
    ...(parsed.value.reason === undefined ? {} : { reason: parsed.value.reason }),
  };
  session.baselines.set(baselineId, baseline);
  session.baselineOrder.push(baselineId);

  const persisted = await persistSurfaceMcpSession(composition, session);

  if (!persisted.ok) {
    return persisted;
  }

  return ok({
    baselineId,
    count: baseline.identityKeys.size,
    ...(baseline.reason === undefined ? {} : { reason: baseline.reason }),
  });
}

async function callSurfaceVerdict(
  composition: SurfaceComposition,
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Promise<Result<SurfaceMcpVerdictOutput>> {
  const parsed = parseToolInput("surface_verdict", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const finding = findStoredFinding(session, parsed.value.findingId);

  if (finding === undefined) {
    return err(
      createSurfaceError("finding_not_found", "No stored MCP finding matched the verdict.", {
        details: { findingId: parsed.value.findingId },
      }),
    );
  }

  const verdict = {
    decision: parsed.value.decision,
    findingId: parsed.value.findingId,
    rationale: parsed.value.rationale,
  } satisfies SurfaceMcpVerdictOutput;
  session.verdicts.set(parsed.value.findingId, verdict);

  const persisted = await persistSurfaceMcpSession(composition, session);

  if (!persisted.ok) {
    return persisted;
  }

  return ok(verdict);
}

function callSurfaceDiff(
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Result<SurfaceMcpDiffOutput> {
  const parsed = parseToolInput("surface_diff", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const before = runRecordFor(session, parsed.value.before.runId);
  const after = runRecordFor(session, parsed.value.after.runId);

  if (before === undefined || after === undefined) {
    return err(
      createSurfaceError("run_not_found", "Both MCP diff runs must exist.", {
        details: { after: parsed.value.after.runId, before: parsed.value.before.runId },
      }),
    );
  }

  return ok(diffTrackedFindings(before.trackedFindings, after.trackedFindings));
}

function callSurfaceTrace(
  session: SurfaceMcpSessionState,
  rawInput: unknown,
): Result<SurfaceMcpTraceOutput> {
  const parsed = parseToolInput("surface_trace", rawInput);

  if (!parsed.ok) {
    return parsed;
  }

  const trackedFinding = findStoredTrackedFinding(session, parsed.value.findingId);

  if (trackedFinding === undefined) {
    return err(
      createSurfaceError("finding_not_found", "No tracked MCP finding matched the requested id.", {
        details: { findingId: parsed.value.findingId },
      }),
    );
  }

  return ok({ trackedFinding });
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

function nextBaselineId(session: SurfaceMcpSessionState): string {
  const baselineId = `baseline_mcp_${session.nextBaselineSequence.toString().padStart(4, "0")}`;
  session.nextBaselineSequence += 1;

  return baselineId;
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

function trackedFindingsForRun(
  session: SurfaceMcpSessionState,
  runId: string,
  findings: readonly Finding[],
): readonly TrackedFinding[] {
  return findings.map((finding) => {
    const initial = createTrackedFinding({
      finding,
      runId,
      validation: validationForFinding(finding),
    });
    const previous = session.trackedByIdentity.get(initial.identityKey);
    const trackedFinding =
      previous === undefined
        ? initial
        : transitionTrackedFinding(previous, { finding, kind: "detected", runId });

    session.trackedByIdentity.set(trackedFinding.identityKey, trackedFinding);

    return trackedFinding;
  });
}

function validationForFinding(finding: Finding): ValidationCheck {
  if (finding.method === "measured") {
    const toolEvidence = finding.evidence.find((entry) => entry.kind === "tool-result");

    return {
      expectation:
        toolEvidence === undefined
          ? `${finding.lens}/${finding.issueType} remains resolved.`
          : `${toolEvidence.tool} ${toolEvidence.rule} passes for ${locationLabelFor(finding)}.`,
      kind: "measured-rule",
    };
  }

  return {
    expectation: `${finding.lens}/${finding.issueType} should be re-evaluated at ${locationLabelFor(
      finding,
    )}.`,
    kind: "re-evaluate-lens",
  };
}

function locationLabelFor(finding: Finding): string {
  return (
    finding.location.elementRef ??
    finding.location.selector ??
    finding.location.component ??
    finding.location.file ??
    finding.id
  );
}

function latestBaseline(session: SurfaceMcpSessionState): SurfaceMcpBaselineRecord | undefined {
  const baselineId = session.baselineOrder.at(-1);

  return baselineId === undefined ? undefined : session.baselines.get(baselineId);
}

function trackedFindingForRunFinding(
  record: SurfaceMcpRunRecord,
  findingId: string,
): TrackedFinding | undefined {
  return record.trackedFindings.find(
    (trackedFinding) => trackedFinding.currentFindingId === findingId,
  );
}

function findStoredTrackedFinding(
  session: SurfaceMcpSessionState,
  findingId: string,
): TrackedFinding | undefined {
  for (const trackedFinding of session.trackedByIdentity.values()) {
    if (trackedFinding.currentFindingId === findingId) {
      return trackedFinding;
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
