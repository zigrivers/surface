// Acceptance skeletons — Epic E5: Closed Loop, State & Baselines (US-040..042).
import { describe, it } from "vitest";

describe("E5 Closed Loop, State & Baselines", () => {
  describe("US-040 stable finding identity across re-runs [gate]", () => {
    it.skip("[US-040][AC1] unchanged defect → same id, still-failing; fixed → resolved; reappeared → regressed; unmatchable anchor → identity-broken (never silent resolved) (integration)", () => {});
  });
  describe("US-041 concurrency-safe, resumable state [gate]", () => {
    it.skip("[US-041][AC1] two overlapping runs → state access locked; neither corrupts the store (integration)", () => {});
    it.skip("[US-041][AC2] interrupted run → re-invoke resumes from currentStage, not half-written (integration)", () => {});
  });
  describe("US-042 baseline & waivers [committed]", () => {
    it.skip("[US-042][AC1] `surface baseline` → snapshot; `gate` thereafter fails only on net-new/expired findings (integration)", () => {});
    it.skip("[US-042][AC2] waiver with expiry → on expiry the finding re-activates; gateDisposition returns to active (unit)", () => {});
  });
});
