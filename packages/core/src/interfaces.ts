import type { SurfaceConfig } from "./config.js";
import type { Result, SurfaceError } from "./errors.js";
import type {
  Evidence,
  EvaluationMethod,
  Finding,
  FindingDraft,
  ToolResultEvidence,
} from "./findings.js";

type MaybePromise<T> = T | Promise<T>;

export type ViewportLabel = "mobile" | "tablet" | "desktop";
export type Theme = "light" | "dark";

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly label: ViewportLabel;
}

// Target kind is the stable capture input contract, not a plugin extension identifier.
export type TargetKind = "url" | "localhost" | "route" | "screenshot" | "component" | "dom";

export interface Target {
  readonly kind: TargetKind;
  readonly ref: string;
  readonly viewport?: Viewport;
  readonly theme?: Theme;
}

export type BuiltInCaptureBackendId = "playwright" | "agent-browser" | "static";
export type CaptureArtifactType =
  | "screenshot"
  | "dom-snapshot"
  | "accessibility-tree"
  | "computed-styles";

export interface CaptureArtifact {
  readonly id: string;
  readonly type: CaptureArtifactType;
  readonly path: string;
  readonly redacted: boolean;
}

export interface DegradationReport {
  readonly skippedArtifacts: CaptureArtifactType[];
  readonly skippedReason: string;
}

// Capture status is a closed lifecycle state machine owned by the Capture domain.
export type CaptureStatus = "requested" | "completed" | "degraded" | "auth-failed" | "unreachable";

export interface Capture {
  readonly id: string;
  readonly target: Target;
  readonly backend: string;
  readonly artifacts: CaptureArtifact[];
  readonly degradation?: DegradationReport;
  readonly capturedAt: string;
  readonly status: CaptureStatus;
}

export interface CaptureOptions {
  readonly config: SurfaceConfig["capture"];
  readonly authStateRef?: string;
}

export interface CaptureBackend {
  readonly id: string;
  detect(): boolean;
  observe(target: Target, options: CaptureOptions): MaybePromise<Result<Capture, SurfaceError>>;
}

export interface SourceFileRef {
  readonly path: string;
  readonly contents: string;
}

export interface ComponentMapEntry {
  readonly component: string;
  readonly file: string;
  readonly selectors: string[];
}

export interface ComponentMap {
  readonly entries: ComponentMapEntry[];
}

export interface FrameworkAdapter {
  readonly id: string;
  supports(file: string): boolean;
  introspect(source: SourceFileRef): MaybePromise<Result<ComponentMap, SurfaceError>>;
}

export interface ToolResult {
  readonly tool: string;
  readonly evidence: ToolResultEvidence[];
}

export interface GroundingTool {
  readonly id: string;
  run(capture: Capture): MaybePromise<Result<ToolResult[], SurfaceError>>;
}

export interface LensContext {
  readonly capture: Capture;
  readonly config: SurfaceConfig;
  readonly evidence: Evidence[];
  readonly knowledge: KnowledgeSource;
}

export interface Lens {
  readonly id: string;
  readonly method: EvaluationMethod;
  readonly requiresModel: boolean;
  readonly requiresLiveDom: boolean;
  evaluate(context: LensContext): MaybePromise<Result<FindingDraft[], SurfaceError>>;
}

export type BuiltInReportFormat =
  | "findings-md"
  | "findings-json"
  | "backlog"
  | "agent-plan"
  | "validation-report"
  | "sarif"
  | "alternatives";

export type ReportFormat = string;

export interface BacklogEntry {
  readonly findingId: string;
  readonly priority: number;
  readonly rank: number;
  readonly demotedAsDuplicateOf?: string;
}

export interface Backlog {
  readonly id: string;
  readonly runId: string;
  readonly entries: BacklogEntry[];
}

export interface Report {
  readonly format: ReportFormat;
  readonly bytes: Uint8Array;
  readonly byteStable: boolean;
}

export interface ReportRenderer {
  readonly format: ReportFormat;
  render(
    findings: readonly Finding[],
    backlog: Backlog,
  ): MaybePromise<Result<Report, SurfaceError>>;
}

export type GatePolicy = SurfaceConfig["reporting"]["gatePolicy"];

export interface GateResult {
  readonly passed: boolean;
  readonly failingFindingIds: string[];
  readonly exitCode: 0 | 1 | 2;
}

export interface GateEvaluator {
  evaluate(
    findings: readonly Finding[],
    policy: GatePolicy,
  ): MaybePromise<Result<GateResult, SurfaceError>>;
}

export interface LocalBacklogRef {
  readonly path: string;
  readonly backlogId: string;
}

export type BuiltInIssueExportTarget = "github" | "linear" | "jira";
export type IssueExportTarget = string;

export interface IssueExport {
  readonly id: string;
  readonly target: IssueExportTarget;
  readonly synced: string[];
  readonly unsynced: string[];
  readonly status: "complete" | "partial" | "failed";
}

export interface IssueExporter {
  readonly target: IssueExportTarget;
  export(backlog: LocalBacklogRef): MaybePromise<Result<IssueExport, SurfaceError>>;
}

export interface KnowledgeEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
}

export interface RelevanceQuery {
  readonly lensId: string;
  readonly appType: string;
  readonly step: string;
}

export interface KnowledgeSource {
  query(relevanceQuery: RelevanceQuery): MaybePromise<Result<KnowledgeEntry[], SurfaceError>>;
  resolve(id: string): MaybePromise<Result<KnowledgeEntry, SurfaceError>>;
}

export interface PersistArtifactIntent {
  readonly kind: "capture" | "report" | "generated";
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

export interface PersistedArtifactRef {
  readonly path: string;
  readonly sha256: string;
}

export interface ProjectStateSnapshot {
  readonly version: string;
  readonly currentStage?: string;
}

export interface StateStore {
  readState(): MaybePromise<Result<ProjectStateSnapshot, SurfaceError>>;
  writeState(state: ProjectStateSnapshot): MaybePromise<Result<ProjectStateSnapshot, SurfaceError>>;
  writeArtifact(
    intent: PersistArtifactIntent,
  ): MaybePromise<Result<PersistedArtifactRef, SurfaceError>>;
}
