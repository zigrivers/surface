import { z } from "zod";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const CliExitCodeSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type CliExitCode = z.infer<typeof CliExitCodeSchema>;

export const SurfaceErrorKindSchema = z.enum([
  "UsageError",
  "ConfigError",
  "CaptureError",
  "GroundingError",
  "AdapterError",
  "ModelError",
  "IntegrationError",
  "StateError",
  "RuntimeError",
  "McpError",
]);
export type SurfaceErrorKind = z.infer<typeof SurfaceErrorKindSchema>;

export const SurfaceErrorCodeSchema = z.enum([
  "unknown_step",
  "unknown_lens",
  "unknown_export_target",
  "no_target",
  "no_decision_flag",
  "config_invalid",
  "policy_invalid",
  "qa_unavailable",
  "target_not_allowed",
  "action_policy_denied",
  "flow_invalid",
  "flow_step_failed",
  "evidence_unavailable",
  "replay_failed",
  "promotion_rejected",
  "capture_unreachable",
  "auth_injection_failed",
  "capture_failed",
  "grounding_failed",
  "adapter_failed",
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
]);
export type SurfaceErrorCode = z.infer<typeof SurfaceErrorCodeSchema>;

export type SurfaceErrorDefinition = {
  readonly kind: SurfaceErrorKind;
  readonly exitCode: CliExitCode;
};

export const SURFACE_ERROR_DEFINITIONS = {
  unknown_step: { kind: "UsageError", exitCode: 2 },
  unknown_lens: { kind: "UsageError", exitCode: 2 },
  unknown_export_target: { kind: "UsageError", exitCode: 2 },
  no_target: { kind: "UsageError", exitCode: 2 },
  no_decision_flag: { kind: "UsageError", exitCode: 2 },
  config_invalid: { kind: "ConfigError", exitCode: 1 },
  policy_invalid: { kind: "ConfigError", exitCode: 1 },
  qa_unavailable: { kind: "RuntimeError", exitCode: 1 },
  target_not_allowed: { kind: "ConfigError", exitCode: 1 },
  action_policy_denied: { kind: "RuntimeError", exitCode: 1 },
  flow_invalid: { kind: "ConfigError", exitCode: 1 },
  flow_step_failed: { kind: "RuntimeError", exitCode: 1 },
  evidence_unavailable: { kind: "StateError", exitCode: 1 },
  replay_failed: { kind: "RuntimeError", exitCode: 1 },
  promotion_rejected: { kind: "RuntimeError", exitCode: 1 },
  capture_unreachable: { kind: "CaptureError", exitCode: 1 },
  auth_injection_failed: { kind: "CaptureError", exitCode: 1 },
  capture_failed: { kind: "CaptureError", exitCode: 1 },
  grounding_failed: { kind: "GroundingError", exitCode: 1 },
  adapter_failed: { kind: "AdapterError", exitCode: 1 },
  model_unavailable: { kind: "ModelError", exitCode: 1 },
  invalid_model_request: { kind: "ModelError", exitCode: 1 },
  model_request_failed: { kind: "ModelError", exitCode: 1 },
  finding_draft_invalid: { kind: "StateError", exitCode: 1 },
  finding_score_failed: { kind: "StateError", exitCode: 1 },
  backlog_synthesis_failed: { kind: "StateError", exitCode: 1 },
  reconciliation_failed: { kind: "StateError", exitCode: 1 },
  finding_not_found: { kind: "StateError", exitCode: 1 },
  evidence_missing: { kind: "StateError", exitCode: 1 },
  invalid_verdict_transition: { kind: "StateError", exitCode: 1 },
  run_not_found: { kind: "RuntimeError", exitCode: 1 },
  runs_incomparable: { kind: "RuntimeError", exitCode: 1 },
  invalid_run_id: { kind: "RuntimeError", exitCode: 1 },
  invalid_resume_stage: { kind: "RuntimeError", exitCode: 1 },
  validation_run_failed: { kind: "RuntimeError", exitCode: 1 },
  step_failed: { kind: "RuntimeError", exitCode: 1 },
  pipeline_completion_failed: { kind: "RuntimeError", exitCode: 1 },
  export_partial: { kind: "IntegrationError", exitCode: 1 },
  export_failed: { kind: "IntegrationError", exitCode: 1 },
  state_read_failed: { kind: "StateError", exitCode: 1 },
  state_write_failed: { kind: "StateError", exitCode: 1 },
  state_corrupt: { kind: "StateError", exitCode: 1 },
  baseline_write_failed: { kind: "StateError", exitCode: 1 },
  no_findings_to_baseline: { kind: "StateError", exitCode: 1 },
  no_pipeline: { kind: "StateError", exitCode: 1 },
  mcp_schema_incompatible: { kind: "McpError", exitCode: 1 },
} as const satisfies Record<SurfaceErrorCode, SurfaceErrorDefinition>;

export const SurfaceErrorSchema = z
  .object({
    kind: SurfaceErrorKindSchema,
    code: SurfaceErrorCodeSchema,
    message: nonEmptyStringSchema,
    cause: z.unknown().optional(),
    details: z.record(nonEmptyStringSchema, z.unknown()).optional(),
  })
  .strict()
  .superRefine((error, context) => {
    const definitions = SURFACE_ERROR_DEFINITIONS as Partial<
      Record<SurfaceErrorCode, SurfaceErrorDefinition>
    >;
    const definition = definitions[error.code];

    if (definition === undefined) {
      return;
    }

    const expectedKind = definition.kind;

    if (error.kind !== expectedKind) {
      context.addIssue({
        code: "custom",
        message: `kind must be ${expectedKind} for code ${error.code}`,
        path: ["kind"],
      });
    }
  });
export type SurfaceError = z.infer<typeof SurfaceErrorSchema>;

export type Result<T, E = SurfaceError> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: E;
    };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E extends SurfaceError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>,
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

export type CreateSurfaceErrorOptions = {
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;
};

export function createSurfaceError(
  code: SurfaceErrorCode,
  message: string,
  options: CreateSurfaceErrorOptions = {},
): SurfaceError {
  const definition = SURFACE_ERROR_DEFINITIONS[code];
  return SurfaceErrorSchema.parse({
    kind: definition.kind,
    code,
    message,
    ...options,
  });
}

export type EdgeErrorContext = {
  readonly judgedRequired?: boolean;
  readonly modelUnavailableIsDegradation?: boolean;
};

export function exitCodeForSurfaceError(
  error: SurfaceError,
  context: EdgeErrorContext = {},
): CliExitCode {
  if (error.code === "model_unavailable") {
    if (context.judgedRequired === true) {
      return 1;
    }

    if (context.modelUnavailableIsDegradation === true) {
      return 0;
    }
  }

  return SURFACE_ERROR_DEFINITIONS[error.code].exitCode;
}

export type CliErrorEnvelope = {
  readonly ok: false;
  readonly command: string;
  readonly schemaVersion: "1.0";
  readonly error: {
    readonly code: SurfaceErrorCode;
    readonly kind: SurfaceErrorKind;
    readonly message: string;
    readonly exitCode: CliExitCode;
    readonly cause?: unknown;
    readonly details?: Record<string, unknown>;
  };
};

export function toCliErrorEnvelope(
  command: string,
  error: SurfaceError,
  context: EdgeErrorContext = {},
): CliErrorEnvelope {
  return {
    ok: false,
    command,
    schemaVersion: "1.0",
    error: {
      code: error.code,
      kind: error.kind,
      message: error.message,
      exitCode: exitCodeForSurfaceError(error, context),
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

export type McpStructuredError = {
  readonly code: SurfaceErrorCode;
  readonly kind: SurfaceErrorKind;
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export function toMcpError(error: SurfaceError): McpStructuredError {
  return {
    code: error.code,
    kind: error.kind,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}
