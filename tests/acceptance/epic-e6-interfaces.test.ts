// Acceptance skeletons — Epic E6: Interfaces (CLI / MCP / Skill) (US-050..052).
import { describe, expect, it } from "vitest";

import {
  assertMcpToolSchemaCompatibility,
  createSurfaceMcpToolRegistry,
} from "../../packages/mcp/src/index.js";

describe("E6 Interfaces", () => {
  describe("US-050 POSIX-conformant CLI [gate]", () => {
    it.skip("[US-050][AC1] any command --json → machine-readable; exit 0 success / 1 error / 2 usage (e2e)", () => {});
    it.skip("[US-050][AC2] unknown subcommand → exit 2 usage error (e2e)", () => {});
    it.skip("[US-050][AC3] every error states what failed, likely cause, next command (US-050 actionable errors) (unit)", () => {});
  });
  describe("US-051 MCP server for native agent embedding [gate]", () => {
    it("[US-051][AC1] list tools → surface capabilities appear with versioned schemas (integration)", () => {
      const registry = createSurfaceMcpToolRegistry();
      const tools = registry.listTools();

      expect(tools.map((tool) => tool.name)).toEqual([
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
      ]);
      expect(tools.every((tool) => tool.schemaVersion === "1.0.0")).toBe(true);
      expect(tools.find((tool) => tool.name === "surface_capture")?.inputSchema).toMatchObject({
        properties: {
          target: {
            properties: {
              kind: { enum: ["url", "localhost", "route", "screenshot", "component", "dom"] },
              ref: { type: "string" },
            },
            required: ["kind", "ref"],
            type: "object",
          },
        },
        required: ["target"],
        type: "object",
      });
    });

    it("[US-051][AC2] incompatible schema change → major version increments (NFR-MCP-1 snapshot test) (unit)", () => {
      expect(
        assertMcpToolSchemaCompatibility({
          current: {
            name: "surface_capture",
            schemaVersion: "1.0.0",
            inputSchema: { required: ["target"], type: "object" },
          },
          next: {
            name: "surface_capture",
            schemaVersion: "1.1.0",
            inputSchema: { required: ["target", "authState"], type: "object" },
          },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "mcp_schema_incompatible" },
      });
      expect(
        assertMcpToolSchemaCompatibility({
          current: {
            name: "surface_capture",
            schemaVersion: "1.0.0",
            inputSchema: { required: ["target"], type: "object" },
          },
          next: {
            name: "surface_capture",
            schemaVersion: "2.0.0",
            inputSchema: { required: ["target", "authState"], type: "object" },
          },
        }),
      ).toMatchObject({ ok: true });
    });
  });
  describe("US-052 natural-language runner skill [gate]", () => {
    it.skip("[US-052][AC1] NL intent → maps to the correct surface command and confirms the action (integration)", () => {});
  });
});
