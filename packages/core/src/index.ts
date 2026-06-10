export const CORE_PACKAGE_NAME = "@zigrivers/surface-core";

export { createAccessibilityLens } from "./accessibility-lens.js";
export * from "./app-type-overlays.js";
export * from "./browser-qa/index.js";
export * from "./audit-runner.js";
export * from "./capture.js";
export * from "./composition-factory.js";
export * from "./config.js";
export * from "./context-ingestor.js";
export * from "./content-lens.js";
export * from "./discovery.js";
export * from "./errors.js";
export * from "./export-redaction.js";
export * from "./findings.js";
export * from "./flow-lenses.js";
export * from "./gate-evaluator.js";
export {
  evaluateGateWithQaFlows,
  type FlowAwareGateInput,
  type FlowAwareGatePolicy,
  type FlowAwareGateResult,
  type QaGateCandidateFinding,
  type QaGateFlowRun,
} from "./gate-evaluator.js";
export * from "./github-checks-exporter.js";
export * from "./github-issue-exporter.js";
export * from "./glob-utils.js";
export * from "./identity.js";
export { isNodeErrorWithCode, parseJson } from "./internal-utils.js";
export * from "./knowledge-source.js";
export { LIGHTHOUSE_ACCESSIBILITY_AUDIT_IDS } from "./lighthouse-audits.js";
export * from "./lens-registry.js";
export * from "./logging.js";
export * from "./model-egress.js";
export * from "./model-provider.js";
export * from "./mmr-audit-fallback.js";
export * from "./multi-state-capture.js";
export * from "./pipeline-orchestrator.js";
export * from "./project-state-projections.js";
export * from "./reconciliation.js";
export * from "./report-renderers.js";
export * from "./responsiveness-states-lens.js";
export * from "./state-store.js";
export * from "./subscription-cli-provider.js";
export * from "./third-party-issue-exporter.js";
export * from "./usability-heuristic-lens.js";
export * from "./verdicts.js";
export * from "./visual-hierarchy-lens.js";
export {
  applyWaiversToTrackedFindings,
  createBaseline,
  createTrackedFinding,
  diffTrackedFindings,
  isWaiverActive,
  transitionTrackedFinding,
} from "./tracked-findings.js";
export type {
  ApplyWaiversInput,
  Baseline,
  CreateBaselineInput,
  CreateTrackedFindingInput,
  DiffableTrackedFinding,
  FindingStatus,
  GateDisposition,
  TrackedFinding,
  TrackedFindingsDiff,
  TrackedFindingsDiffEntry,
  TrackedFindingHistoryEntry,
  TrackedFindingTransition,
  ValidationCheck,
  Waiver,
} from "./tracked-findings.js";
