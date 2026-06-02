import { describe, expect, it } from "vitest";

import {
  SURFACE_ERROR_DEFINITIONS,
  SurfaceErrorCodeSchema,
  SurfaceErrorSchema,
  createSurfaceError,
  err,
  exitCodeForSurfaceError,
  ok,
  toCliErrorEnvelope,
  toMcpError,
} from "./errors.js";

const API_CONTRACT_ERROR_CODES = [
  "unknown_step",
  "unknown_lens",
  "unknown_export_target",
  "no_target",
  "no_decision_flag",
  "config_invalid",
  "policy_invalid",
  "capture_unreachable",
  "auth_injection_failed",
  "capture_failed",
  "model_unavailable",
  "invalid_model_request",
  "model_request_failed",
  "finding_draft_invalid",
  "finding_score_failed",
  "backlog_synthesis_failed",
  "reconciliation_failed",
  "finding_not_found",
  "evidence_missing",
  "invalid_verdict_transition",
  "run_not_found",
  "runs_incomparable",
  "invalid_run_id",
  "invalid_resume_stage",
  "validation_run_failed",
  "step_failed",
  "pipeline_completion_failed",
  "export_partial",
  "export_failed",
  "state_read_failed",
  "state_write_failed",
  "state_corrupt",
  "baseline_write_failed",
  "no_findings_to_baseline",
  "no_pipeline",
  "mcp_schema_incompatible",
] as const;

describe("SurfaceError and Result", () => {
  it("wraps success and failure package-boundary results", () => {
    expect(ok("captured")).toEqual({ ok: true, value: "captured" });

    const error = createSurfaceError(
      "capture_unreachable",
      "Could not reach http://localhost:3000. Start the app and rerun surface capture.",
    );
    expect(err(error)).toEqual({ ok: false, error });
  });

  it("derives taxonomy kind and CLI exit codes from stable error codes", () => {
    const usage = createSurfaceError(
      "unknown_lens",
      "Unknown lens visual-noise. Run surface audit --help to list lenses.",
    );
    expect(usage.kind).toBe("UsageError");
    expect(exitCodeForSurfaceError(usage)).toBe(2);

    const config = createSurfaceError(
      "config_invalid",
      "Could not parse .surface/config.yml. Fix the YAML and rerun surface init.",
    );
    expect(config.kind).toBe("ConfigError");
    expect(exitCodeForSurfaceError(config)).toBe(1);
  });

  it("treats model_unavailable as audit degradation but judged-required failure", () => {
    const modelUnavailable = createSurfaceError(
      "model_unavailable",
      "No model provider is configured. Set a BYO key or rerun measured-only.",
    );

    expect(
      exitCodeForSurfaceError(modelUnavailable, {
        modelUnavailableIsDegradation: true,
      }),
    ).toBe(0);
    expect(
      exitCodeForSurfaceError(modelUnavailable, {
        modelUnavailableIsDegradation: true,
        judgedRequired: false,
      }),
    ).toBe(0);
    expect(exitCodeForSurfaceError(modelUnavailable)).toBe(1);
    expect(exitCodeForSurfaceError(modelUnavailable, { judgedRequired: true })).toBe(1);
    expect(
      exitCodeForSurfaceError(modelUnavailable, {
        modelUnavailableIsDegradation: true,
        judgedRequired: true,
      }),
    ).toBe(1);
  });

  it("validates code-kind consistency and actionable messages", () => {
    expect(() =>
      SurfaceErrorSchema.parse({
        kind: "UsageError",
        code: "config_invalid",
        message: "Fix .surface/config.yml and rerun surface init.",
      }),
    ).toThrow(/kind/);

    expect(() =>
      SurfaceErrorSchema.parse({
        kind: "ConfigError",
        code: "config_invalid",
        message: "   ",
      }),
    ).toThrow(/whitespace/);
  });

  it("maps errors to CLI envelopes and MCP structured errors", () => {
    const error = createSurfaceError(
      "mcp_schema_incompatible",
      "The MCP client schema is incompatible. Upgrade surface or the client integration.",
      { cause: "client requested schema 2.x", details: { expectedVersion: "1.x" } },
    );

    expect(toCliErrorEnvelope("audit", error)).toEqual({
      ok: false,
      command: "audit",
      schemaVersion: "1.0",
      error: {
        code: "mcp_schema_incompatible",
        kind: "McpError",
        message: error.message,
        exitCode: 1,
        cause: "client requested schema 2.x",
        details: { expectedVersion: "1.x" },
      },
    });
    expect(toMcpError(error)).toEqual({
      code: "mcp_schema_incompatible",
      kind: "McpError",
      message: error.message,
      details: { expectedVersion: "1.x" },
    });
  });

  it("keeps the runtime code map aligned with the documented API catalog", () => {
    expect([...SurfaceErrorCodeSchema.options].sort()).toEqual(
      [...API_CONTRACT_ERROR_CODES].sort(),
    );
    expect(Object.keys(SURFACE_ERROR_DEFINITIONS).sort()).toEqual(
      [...API_CONTRACT_ERROR_CODES].sort(),
    );
  });
});
