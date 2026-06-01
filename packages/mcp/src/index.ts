import { pathToFileURL } from "node:url";

import {
  createSurfaceComposition,
  createSurfaceError,
  err,
  ok,
  toMcpError,
  type Result,
  type SurfaceComposition,
  type SurfaceCompositionOptions,
  type SurfaceError,
} from "@surface/core";
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
  listTools(): readonly SurfaceMcpToolDefinition[];
};

export type SurfaceMcpServerOptions = SurfaceCompositionOptions & {
  readonly composition?: SurfaceComposition;
};

export type McpToolSchemaCompatibilityInput = {
  readonly current: Pick<SurfaceMcpToolDefinition, "inputSchema" | "name" | "schemaVersion">;
  readonly next: Pick<SurfaceMcpToolDefinition, "inputSchema" | "name" | "schemaVersion">;
};

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

  return {
    composition,
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

export async function createSurfaceSdkMcpServer(
  options: SurfaceMcpServerOptions = {},
): Promise<unknown> {
  createSurfaceMcpServer(options);

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
      () => ({
        content: [
          {
            text: `${tool.name} handler is provided by follow-up Surface MCP tool packages.`,
            type: "text",
          },
        ],
        isError: true,
        structuredContent: toMcpError(
          createSurfaceError("unknown_step", "MCP tool handler is not implemented yet.", {
            details: { tool: tool.name },
          }),
        ),
      }),
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
    handler: () => unknown,
  ): void;
};

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
