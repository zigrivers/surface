export const CORE_PACKAGE_NAME = "@surface/core";

export { createAccessibilityLens } from "./accessibility-lens.js";
export * from "./app-type-overlays.js";
export * from "./capture.js";
export * from "./composition-factory.js";
export * from "./config.js";
export * from "./context-ingestor.js";
export * from "./content-lens.js";
export * from "./discovery.js";
export * from "./errors.js";
export * from "./export-redaction.js";
export * from "./findings.js";
export * from "./gate-evaluator.js";
export * from "./github-checks-exporter.js";
export * from "./github-issue-exporter.js";
export * from "./identity.js";
export * from "./knowledge-source.js";
export { LIGHTHOUSE_ACCESSIBILITY_AUDIT_IDS } from "./lighthouse-audits.js";
export * from "./lens-registry.js";
export * from "./logging.js";
export * from "./model-provider.js";
export * from "./pipeline-orchestrator.js";
export * from "./reconciliation.js";
export * from "./report-renderers.js";
export * from "./responsiveness-states-lens.js";
export * from "./state-store.js";
export * from "./third-party-issue-exporter.js";
export * from "./usability-heuristic-lens.js";
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
