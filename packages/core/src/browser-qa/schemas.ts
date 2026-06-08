import { z } from "zod";

const NonEmptyStringSchema = z.string().trim().min(1);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^sha256:[A-Fa-f0-9_-]+$/);
const ArtifactPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes(".."), {
    message: "path must not contain traversal segments",
  });

export const QaRunIdSchema = z.string().regex(/^qa_[A-Za-z0-9_-]+$/);
export const FlowRunIdSchema = z.string().regex(/^flowrun_[A-Za-z0-9_-]+$/);
export const CandidateFindingIdSchema = z.string().regex(/^qfc_[A-Za-z0-9_-]+$/);
export const CandidateFlowIdSchema = z.string().regex(/^qflow_[A-Za-z0-9_-]+$/);
export const EvidenceBundleIdSchema = z.string().regex(/^ev_[A-Za-z0-9_-]+$/);
export const QaSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type QaSeverity = z.infer<typeof QaSeveritySchema>;
export const QaStatusSchema = z.enum(["completed", "degraded", "failed"]);

export const QaTargetSchema = z
  .object({
    kind: z.enum(["url", "localhost", "route", "screenshot", "component", "dom"]),
    ref: NonEmptyStringSchema,
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
export type QaTarget = z.infer<typeof QaTargetSchema>;

export const QaDegradationSchema = z
  .object({
    code: NonEmptyStringSchema,
    details: z.record(NonEmptyStringSchema, z.unknown()).optional(),
    message: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    severity: z.enum(["info", "warning", "error"]).default("warning"),
  })
  .strict();
export type QaDegradation = z.infer<typeof QaDegradationSchema>;

export const BrowserLocatorSchema = z
  .object({
    label: NonEmptyStringSchema.optional(),
    name: NonEmptyStringSchema.optional(),
    placeholder: NonEmptyStringSchema.optional(),
    refHint: z
      .string()
      .regex(/^@e[0-9]+$/)
      .optional(),
    role: NonEmptyStringSchema.optional(),
    selector: NonEmptyStringSchema.optional(),
    testId: NonEmptyStringSchema.optional(),
    text: NonEmptyStringSchema.optional(),
  })
  .strict();
export type BrowserLocator = z.infer<typeof BrowserLocatorSchema>;

export const BrowserActionNameSchema = z.enum([
  "open",
  "pushstate",
  "click",
  "dblclick",
  "hover",
  "focus",
  "fill",
  "type",
  "press",
  "check",
  "uncheck",
  "select",
  "upload",
  "scroll",
  "wait",
  "capture",
  "assert",
  "setViewport",
  "setTheme",
]);
export type BrowserActionName = z.infer<typeof BrowserActionNameSchema>;

export const BrowserActionSchema = z
  .object({
    action: BrowserActionNameSchema,
    locator: BrowserLocatorSchema.optional(),
    url: NonEmptyStringSchema.optional(),
    value: z.string().optional(),
  })
  .strict();
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const BrowserQaFlowStepSchema = BrowserActionSchema.extend({
  capture: z
    .union([
      z.boolean(),
      z
        .object({
          evidence: z.enum(["minimal", "failures", "full"]).optional(),
          label: NonEmptyStringSchema.optional(),
        })
        .strict(),
    ])
    .optional(),
  expect: z.record(NonEmptyStringSchema, z.unknown()).optional(),
  id: NonEmptyStringSchema,
  retry: z.record(NonEmptyStringSchema, z.unknown()).optional(),
  severity: QaSeveritySchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  wait: z.record(NonEmptyStringSchema, z.unknown()).optional(),
}).strict();
export type BrowserQaFlowStep = z.infer<typeof BrowserQaFlowStepSchema>;

export const BrowserQaFlowSchema = z
  .object({
    actionPolicy: z
      .object({
        ref: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
    defaults: z.record(NonEmptyStringSchema, z.unknown()).default({}),
    fixtures: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            path: ArtifactPathSchema,
          })
          .strict(),
      )
      .default([]),
    id: NonEmptyStringSchema,
    inputs: z.record(NonEmptyStringSchema, z.unknown()).default({}),
    isolation: z
      .object({
        fixtureAccountId: NonEmptyStringSchema.optional(),
        mode: z.enum(["isolated", "shared"]).default("isolated"),
        mutatesState: z.boolean().default(false),
        resetEndpointId: NonEmptyStringSchema.optional(),
        resetRequired: z.boolean().default(false),
      })
      .strict()
      .optional(),
    schemaVersion: z.literal("1.0"),
    secrets: z
      .record(
        NonEmptyStringSchema,
        z
          .object({
            fromEnv: NonEmptyStringSchema,
          })
          .strict(),
      )
      .default({}),
    severity: QaSeveritySchema.default("medium"),
    steps: z.array(BrowserQaFlowStepSchema).min(1),
    target: QaTargetSchema.optional(),
    teardown: z
      .object({
        always: z.array(BrowserQaFlowStepSchema).default([]),
      })
      .strict()
      .optional(),
    title: NonEmptyStringSchema,
  })
  .strict();
export type BrowserQaFlow = z.infer<typeof BrowserQaFlowSchema>;

export const ActionPolicyCategorySchema = z.enum([
  "navigation",
  "reveal",
  "form",
  "submit",
  "save",
  "delete",
  "clear",
  "upload",
  "payment",
  "account",
  "externally-visible",
  "persistent",
  "unknown",
]);
export type ActionPolicyCategory = z.infer<typeof ActionPolicyCategorySchema>;

export const ActionPolicyRuleSchema = z
  .object({
    actions: z.array(BrowserActionNameSchema).optional(),
    categories: z.array(ActionPolicyCategorySchema).optional(),
    decision: z.enum(["allow", "deny"]),
    id: NonEmptyStringSchema,
    locators: z.array(BrowserLocatorSchema).optional(),
    origins: z.array(NonEmptyStringSchema).optional(),
    routes: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();
export type ActionPolicyRule = z.infer<typeof ActionPolicyRuleSchema>;

export const ResetEndpointSchema = z
  .object({
    id: NonEmptyStringSchema,
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    origin: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
  })
  .strict();
export type ResetEndpoint = z.infer<typeof ResetEndpointSchema>;

export const FixtureAccountSchema = z
  .object({
    fixtureRef: NonEmptyStringSchema.optional(),
    id: NonEmptyStringSchema,
  })
  .strict();
export type FixtureAccount = z.infer<typeof FixtureAccountSchema>;

export const EnvironmentGroupSchema = z
  .object({
    id: NonEmptyStringSchema,
    origins: z.array(NonEmptyStringSchema),
  })
  .strict();
export type EnvironmentGroup = z.infer<typeof EnvironmentGroupSchema>;

export const ActionPolicySchema = z
  .object({
    allowedDomains: z.array(NonEmptyStringSchema).default([]),
    environmentGroups: z.array(EnvironmentGroupSchema).default([]),
    fixtureAccounts: z.array(FixtureAccountSchema).default([]),
    resetEndpoints: z.array(ResetEndpointSchema).default([]),
    rules: z.array(ActionPolicyRuleSchema).default([]),
  })
  .strict();
export type ActionPolicy = z.infer<typeof ActionPolicySchema>;

export const ActionPolicyDecisionSchema = z
  .object({
    allowed: z.boolean(),
    category: ActionPolicyCategorySchema,
    code: z.enum(["action_policy_denied", "target_not_allowed"]).optional(),
    matchedRuleId: NonEmptyStringSchema.optional(),
    reason: NonEmptyStringSchema,
  })
  .strict();
export type ActionPolicyDecision = z.infer<typeof ActionPolicyDecisionSchema>;

export const FlowStepResultSchema = z
  .object({
    action: BrowserActionSchema,
    completedAt: IsoTimestampSchema.optional(),
    error: NonEmptyStringSchema.optional(),
    evidenceBundleIds: z.array(EvidenceBundleIdSchema).default([]),
    id: NonEmptyStringSchema,
    severity: QaSeveritySchema.optional(),
    startedAt: IsoTimestampSchema.optional(),
    status: z.enum(["passed", "failed", "degraded", "skipped"]),
  })
  .strict();
export type FlowStepResult = z.infer<typeof FlowStepResultSchema>;

export const FlowRunSummarySchema = z
  .object({
    findingIds: z.array(NonEmptyStringSchema).default([]).optional(),
    flowId: NonEmptyStringSchema,
    gateEligible: z.boolean().optional(),
    id: FlowRunIdSchema,
    status: z.enum(["passed", "failed", "degraded"]),
  })
  .strict();
export type FlowRunSummary = z.infer<typeof FlowRunSummarySchema>;

export const FlowRunSchema = z
  .object({
    actionPolicyRef: ArtifactPathSchema.optional(),
    evidenceBundles: z.array(EvidenceBundleIdSchema),
    findingIds: z.array(NonEmptyStringSchema),
    flowId: NonEmptyStringSchema,
    gateEligible: z.boolean(),
    highestFailedSeverity: QaSeveritySchema.optional(),
    id: FlowRunIdSchema,
    isolation: z
      .object({
        mode: z.enum(["isolated", "shared"]),
        mutatesState: z.boolean(),
        resetSatisfied: z.boolean(),
      })
      .strict(),
    severity: QaSeveritySchema,
    source: z
      .object({
        kind: z.enum(["file", "surface-state"]),
        ref: NonEmptyStringSchema,
      })
      .strict(),
    status: z.enum(["passed", "failed", "degraded"]),
    steps: z.array(FlowStepResultSchema),
    target: QaTargetSchema,
  })
  .strict();
export type FlowRun = z.infer<typeof FlowRunSchema>;

export const ExplorationSummarySchema = z
  .object({
    candidateFindings: z.number().int().nonnegative(),
    candidateFlows: z.number().int().nonnegative(),
    visitedStates: z.number().int().nonnegative(),
  })
  .strict();
export type ExplorationSummary = z.infer<typeof ExplorationSummarySchema>;

export const QaRunSchema = z
  .object({
    candidateFindings: z.array(CandidateFindingIdSchema),
    candidateFlows: z.array(CandidateFlowIdSchema),
    completedAt: IsoTimestampSchema.optional(),
    degradation: z.array(QaDegradationSchema),
    evidenceBundles: z.array(EvidenceBundleIdSchema),
    exploration: ExplorationSummarySchema.optional(),
    findings: z.array(NonEmptyStringSchema),
    flowRuns: z.array(FlowRunSummarySchema),
    id: QaRunIdSchema,
    manifestPath: ArtifactPathSchema,
    mode: z.enum(["flow", "explore", "hybrid"]),
    startedAt: IsoTimestampSchema,
    status: QaStatusSchema,
    target: QaTargetSchema,
  })
  .strict();
export type QaRun = z.infer<typeof QaRunSchema>;

export const ExplorationStateSchema = z
  .object({
    actionPath: z.array(BrowserActionSchema),
    actionPathHash: NonEmptyStringSchema,
    annotatedScreenshotRef: NonEmptyStringSchema.optional(),
    authStatus: z.enum(["authenticated", "anonymous", "auth-drift", "reauthenticated"]),
    consoleSummary: z.record(NonEmptyStringSchema, z.unknown()).optional(),
    depth: z.number().int().nonnegative(),
    dialogState: NonEmptyStringSchema.optional(),
    discoveredElements: z.array(z.record(NonEmptyStringSchema, z.unknown())),
    framePath: z.array(NonEmptyStringSchema).optional(),
    id: NonEmptyStringSchema,
    networkSummary: z.record(NonEmptyStringSchema, z.unknown()).optional(),
    reauthFlowRef: NonEmptyStringSchema.optional(),
    snapshotRef: NonEmptyStringSchema.optional(),
    stateId: NonEmptyStringSchema,
    theme: z.enum(["light", "dark"]).optional(),
    title: NonEmptyStringSchema.optional(),
    url: NonEmptyStringSchema,
    viewport: QaTargetSchema.shape.viewport.unwrap(),
  })
  .strict();
export type ExplorationState = z.infer<typeof ExplorationStateSchema>;

export const CandidateFindingSchema = z
  .object({
    actionPath: z.array(BrowserActionSchema),
    category: z.enum([
      "visual",
      "functional",
      "ux",
      "content",
      "performance",
      "console",
      "accessibility",
    ]),
    confidence: z.enum(["candidate", "replayed", "verified"]),
    evidenceBundleId: EvidenceBundleIdSchema,
    gateEligible: z.boolean(),
    id: CandidateFindingIdSchema,
    identityConfidence: z.enum(["none", "low", "medium", "high"]),
    promotion: z
      .object({
        findingId: NonEmptyStringSchema,
        promotedAt: IsoTimestampSchema,
        reason: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
    promotionSource: z.enum(["replay", "measurement", "human-verdict"]).optional(),
    qaRunId: QaRunIdSchema,
    replayStatus: z.enum(["not-run", "reproduced", "not-reproduced", "blocked", "not-replayable"]),
    replayable: z.boolean(),
    severity: QaSeveritySchema,
    sourceRunManifestDigest: DigestSchema,
    title: NonEmptyStringSchema,
  })
  .strict();
export type CandidateFinding = z.infer<typeof CandidateFindingSchema>;

export const CandidateFlowSchema = z
  .object({
    evidenceBundleId: EvidenceBundleIdSchema.optional(),
    id: CandidateFlowIdSchema,
    qaRunId: QaRunIdSchema,
    sourceRunManifestDigest: DigestSchema,
    steps: z.array(BrowserActionSchema),
    title: NonEmptyStringSchema,
  })
  .strict();
export type CandidateFlow = z.infer<typeof CandidateFlowSchema>;

export const QaEvidenceArtifactSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.enum([
      "annotated-screenshot",
      "step-screenshot",
      "repro-video",
      "browser-snapshot",
      "dom-snapshot",
      "console-log",
      "network-summary",
      "har",
      "react-tree",
      "react-inspect",
      "react-render-profile",
      "vitals",
      "trace",
    ]),
    mcpReadable: z.boolean(),
    mediaType: NonEmptyStringSchema,
    path: ArtifactPathSchema,
    redacted: z.boolean(),
    sensitiveRaw: z.boolean(),
    sha256: DigestSchema,
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();
export type QaEvidenceArtifact = z.infer<typeof QaEvidenceArtifactSchema>;

export const ReproStepSchema = z
  .object({
    action: BrowserActionSchema,
    index: z.number().int().positive(),
    label: NonEmptyStringSchema,
  })
  .strict();
export type ReproStep = z.infer<typeof ReproStepSchema>;

export const EvidenceBundleSchema = z
  .object({
    artifacts: z.array(QaEvidenceArtifactSchema),
    candidateFindingId: CandidateFindingIdSchema.optional(),
    checksums: z.record(NonEmptyStringSchema, DigestSchema),
    containsSensitiveRaw: z.boolean(),
    findingId: NonEmptyStringSchema.optional(),
    id: EvidenceBundleIdSchema,
    manifestPath: ArtifactPathSchema,
    qaRunId: QaRunIdSchema,
    redacted: z.boolean(),
    reproSteps: z.array(ReproStepSchema),
    sanitizedAtCapture: z.boolean(),
    sourceCaptureArtifactIds: z.array(NonEmptyStringSchema),
    sourceRunManifestDigest: DigestSchema,
  })
  .strict();
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const QaRunSidecarSchema = QaRunSchema.extend({
  manifestDigest: DigestSchema.optional(),
});
export type QaRunSidecar = z.infer<typeof QaRunSidecarSchema>;

export const CandidateFindingSidecarSchema = CandidateFindingSchema.extend({
  sidecarDigest: DigestSchema.optional(),
});
export type CandidateFindingSidecar = z.infer<typeof CandidateFindingSidecarSchema>;

export const CandidateFlowSidecarSchema = CandidateFlowSchema.extend({
  sidecarDigest: DigestSchema.optional(),
});
export type CandidateFlowSidecar = z.infer<typeof CandidateFlowSidecarSchema>;

export const EvidenceBundleSidecarSchema = EvidenceBundleSchema.extend({
  sidecarDigest: DigestSchema.optional(),
});
export type EvidenceBundleSidecar = z.infer<typeof EvidenceBundleSidecarSchema>;

export const PromotedFindingSidecarSchema = z
  .object({
    artifactChecksums: z.record(NonEmptyStringSchema, DigestSchema),
    candidateFindingId: CandidateFindingIdSchema,
    evidenceBundleId: EvidenceBundleIdSchema,
    findingId: NonEmptyStringSchema,
    promotedAt: IsoTimestampSchema,
    promotionSource: z.enum(["replay", "measurement", "human-verdict"]),
    qaRunId: QaRunIdSchema,
    reason: NonEmptyStringSchema,
    sourceRunManifestDigest: DigestSchema,
  })
  .strict();
export type PromotedFindingSidecar = z.infer<typeof PromotedFindingSidecarSchema>;
