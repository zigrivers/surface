export const CORE_PACKAGE_NAME = "@surface/core";

export * from "./app-type-overlays.js";
export * from "./capture.js";
export * from "./config.js";
export * from "./content-lens.js";
export * from "./discovery.js";
export * from "./errors.js";
export * from "./findings.js";
export * from "./gate-evaluator.js";
export * from "./github-issue-exporter.js";
export * from "./identity.js";
export * from "./knowledge-source.js";
export * from "./lens-registry.js";
export * from "./logging.js";
export * from "./model-provider.js";
export * from "./pipeline-orchestrator.js";
export * from "./report-renderers.js";
export * from "./state-store.js";
export * from "./visual-hierarchy-lens.js";
export { createTrackedFinding, transitionTrackedFinding } from "./tracked-findings.js";
export type {
  CreateTrackedFindingInput,
  FindingStatus,
  GateDisposition,
  TrackedFinding,
  TrackedFindingHistoryEntry,
  TrackedFindingTransition,
  ValidationCheck,
} from "./tracked-findings.js";
