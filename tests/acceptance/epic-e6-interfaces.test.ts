// Acceptance skeletons — Epic E6: Interfaces (CLI / MCP / Skill) (US-050..052).
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertMcpToolSchemaCompatibility,
  createSurfaceMcpToolRegistry,
} from "../../packages/mcp/src/index.js";
import { runSurfaceCli } from "../../packages/cli/src/index.js";
import { createSurfaceComposition, ok } from "../../packages/core/src/index.js";
import type { Capture, Target } from "../../packages/core/src/index.js";

const execFileAsync = promisify(execFile);
const runnerMapperPath = fileURLToPath(
  new URL("../../.agents/skills/surface-runner/scripts/map_intent.mjs", import.meta.url),
);

describe("E6 Interfaces", () => {
  describe("US-050 POSIX-conformant CLI [gate]", () => {
    it("[US-050][AC1] any command --json → machine-readable; exit 0 success / 1 error / 2 usage (e2e)", async () => {
      const stdout: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "status"],
        composition: createSurfaceComposition({
          stateStore: {
            readState: () => ok({ version: "1.0" }),
            writeArtifact: () =>
              Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
            writeState: (state) => ok(state),
          },
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "status",
        ok: true,
        schemaVersion: "1.0",
      });
    });

    it("[US-050][AC2] unknown subcommand → exit 2 usage error (e2e)", async () => {
      const stderr: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "unknown-command"],
        io: { stderr: (chunk) => stderr.push(chunk) },
      });

      expect(exitCode).toBe(2);
      expect(JSON.parse(stderr.at(-1) ?? "")).toMatchObject({
        error: { code: "unknown_step", exitCode: 2 },
        ok: false,
      });
    });

    it("[US-050][AC3] every error states what failed, likely cause, next command (US-050 actionable errors) (unit)", async () => {
      const stderr: string[] = [];
      await runSurfaceCli({
        argv: ["node", "surface", "--json", "unknown-command"],
        io: { stderr: (chunk) => stderr.push(chunk) },
      });

      expect(JSON.parse(stderr.at(-1) ?? "")).toMatchObject({
        error: {
          likelyCause: expect.any(String),
          nextCommand: "surface --help",
          whatFailed: expect.stringContaining("unknown_step"),
        },
      });
    });

    it("[US-050][AC4] core verbs accept target flags and preserve JSON envelopes (e2e)", async () => {
      const stdout: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
        composition: createSurfaceComposition({
          captureBackends: [
            {
              id: "acceptance",
              detect: () => true,
              observe: (target: Target) =>
                ok({
                  artifacts: [],
                  backend: "acceptance",
                  capturedAt: "2026-06-01T00:00:00.000Z",
                  id: "capture_acceptance",
                  status: "requested",
                  target,
                } satisfies Capture),
            },
          ],
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "capture",
        data: {
          backend: "acceptance",
          captureId: "capture_acceptance",
        },
        ok: true,
        schemaVersion: "1.0",
      });
    });

    it("[US-050][AC5] findings loop verbs preserve JSON envelopes (e2e)", async () => {
      const stdout: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "explain", "finding_acceptance"],
        composition: createSurfaceComposition({
          stateStore: {
            readState: () =>
              ok({
                findings: [
                  {
                    citedHeuristics: ["wcag-1.4.3"],
                    evidence: [{ kind: "tool-result", tool: "axe" }],
                    id: "finding_acceptance",
                    rationale: "Acceptance finding rationale.",
                  },
                ],
                version: "1.0",
              }),
            writeArtifact: () =>
              Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
            writeState: (state) => ok(state),
          },
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "explain",
        data: {
          finding: { id: "finding_acceptance" },
          rationale: "Acceptance finding rationale.",
        },
        ok: true,
        schemaVersion: "1.0",
      });
    });
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
        "surface_qa",
        "surface_explore",
        "surface_flow_run",
        "surface_flow_list",
        "surface_flow_promote",
        "surface_evidence",
        "surface_replay",
        "surface_report_qa",
        "surface_artifact_read",
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
    it("[US-052][AC1] NL intent → maps to the correct surface command and confirms the action (integration)", async () => {
      const { stdout } = await execFileAsync(process.execPath, [
        runnerMapperPath,
        "Please audit http://localhost:3000/checkout and tell me the next action.",
      ]);

      expect(JSON.parse(stdout)).toMatchObject({
        command: ["surface", "audit", "--localhost", "http://localhost:3000/checkout", "--json"],
        confirmation:
          "Mapped intent to surface audit for http://localhost:3000/checkout. Confirm before running: surface audit --localhost http://localhost:3000/checkout --json",
        intent: "audit",
        mcpTool: "surface_audit",
        target: { kind: "localhost", ref: "http://localhost:3000/checkout" },
        transport: "cli",
      });
    });
  });
});
