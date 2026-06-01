import { describe, expect, it } from "vitest";

import {
  SURFACE_MCP_SERVER_NAME,
  SURFACE_MCP_SERVER_VERSION,
  assertMcpToolSchemaCompatibility,
  createMcpToolSchemaSnapshot,
  createSurfaceMcpServer,
  createSurfaceMcpToolRegistry,
} from "./index.js";

describe("@surface/mcp bootstrap", () => {
  it("lists versioned Surface tools from the bootstrap registry", () => {
    const registry = createSurfaceMcpToolRegistry();
    const tools = registry.listTools();

    expect(registry.serverInfo).toEqual({
      name: SURFACE_MCP_SERVER_NAME,
      version: SURFACE_MCP_SERVER_VERSION,
    });
    expect(tools).toHaveLength(14);
    expect(tools[0]).toMatchObject({
      name: "surface_capture",
      schemaVersion: "1.0.0",
    });
  });

  it("creates a server facade over the shared core composition", () => {
    const server = createSurfaceMcpServer();

    expect(server.composition.lensRegistry.length).toBeGreaterThan(0);
    expect(server.listTools().map((tool) => tool.name)).toContain("surface_status");
  });

  it("keeps a stable compact schema snapshot for MCP compatibility checks", () => {
    expect(
      createMcpToolSchemaSnapshot().map((tool) => ({
        name: tool.name,
        required: tool.inputSchema.required ?? [],
        schemaVersion: tool.schemaVersion,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "name": "surface_capture",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_audit",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_explain",
          "required": [
            "findingId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_backlog",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_gate",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_validate",
          "required": [
            "runId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_baseline",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_verdict",
          "required": [
            "decision",
            "findingId",
            "rationale",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_diff",
          "required": [
            "after",
            "before",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_alternatives",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_trace",
          "required": [
            "findingId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_run",
          "required": [
            "step",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_next",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_status",
          "required": [],
          "schemaVersion": "1.0.0",
        },
      ]
    `);
  });

  it("requires major version bumps for newly required fields", () => {
    const current = {
      name: "surface_capture",
      schemaVersion: "1.0.0",
      inputSchema: { required: ["target"], type: "object" },
    } as const;

    expect(
      assertMcpToolSchemaCompatibility({
        current,
        next: {
          name: "surface_capture",
          schemaVersion: "1.2.0",
          inputSchema: { required: ["target", "authState"], type: "object" },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "mcp_schema_incompatible" } });
    expect(
      assertMcpToolSchemaCompatibility({
        current,
        next: {
          name: "surface_capture",
          schemaVersion: "2.0.0",
          inputSchema: { required: ["target", "authState"], type: "object" },
        },
      }),
    ).toEqual({ ok: true, value: true });
  });
});
