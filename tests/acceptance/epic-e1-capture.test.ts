// Acceptance skeletons — Epic E1: Capture & Inputs (US-001..005).
// One pending test per acceptance criterion, tagged [story][AC]. Implement during TDD.
// Layer hints in comments: unit | integration | e2e (see docs/story-tests-map.md).
import { describe, it } from "vitest";

describe("E1 Capture & Inputs", () => {
  describe("US-001 capture via auto-detected backend [gate]", () => {
    it.skip("[US-001][AC1] reachable target → screenshot+DOM+a11y-tree+computed-styles under .surface/captures/<id> (integration)", () => {});
    it.skip("[US-001][AC2] neither backend installed → static+screenshot fallback; skipped measured checks reported (integration)", () => {});
    it.skip("[US-001][AC3] both backends installed → deterministic selection recorded in capture metadata (integration)", () => {});
  });
  describe("US-002 capture behind auth [gate]", () => {
    it.skip("[US-002][AC1] valid --auth-state → session injected before navigation; authenticated DOM captured (integration)", () => {});
    it.skip("[US-002][AC2] invalid/expired auth-state → auth-injection failure, non-zero exit; never captures login page as target (e2e)", () => {});
  });
  describe("US-003 ingest static & context inputs [gate]", () => {
    it.skip("[US-003][AC1] --component/tokens/--scaffold-docs used as context; recorded which inputs were present (integration)", () => {});
    it.skip("[US-003][AC2] built UI contradicting a design-token → emitted as a finding, not ignored (integration)", () => {});
  });
  describe("US-004 multi-state & dual-theme capture [should]", () => {
    it.skip("[US-004][AC1] task-flow recipe → each reachable state captured; unreachable step reported (integration)", () => {});
    it.skip("[US-004][AC2] prefers-color-scheme toggle → light+dark captured; findings tagged with theme (integration)", () => {});
  });
  describe("US-005 sensitive-data redaction [committed]", () => {
    it.skip("[US-005][AC1] redaction rules → matched content replaced with visible marker; full evidence retained local-only (unit+integration)", () => {});
  });
});
