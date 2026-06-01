export const CORE_PACKAGE_NAME = "@surface/core";

export * from "./config.js";
export * from "./errors.js";
export * from "./findings.js";
export * from "./identity.js";
export * from "./logging.js";
export * from "./state-store.js";
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
