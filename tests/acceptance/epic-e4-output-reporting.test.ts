// Acceptance skeletons — Epic E4: Output & Reporting (US-030..032).
import { describe, it } from "vitest";

describe("E4 Output & Reporting", () => {
  describe("US-030 human + machine artifacts [gate]", () => {
    it.skip("[US-030][AC1] audit complete → findings.md (plain-language, evidence) + findings.json (stable IDs, documented schema) both produced (integration)", () => {});
  });
  describe("US-031 explain a finding to a non-designer [gate]", () => {
    it.skip("[US-031][AC1] `explain <id>` → plain-language rationale + cited heuristic + verifiable evidence (integration)", () => {});
    it.skip("[US-031][AC2] terminal output: no color-only meaning; ANSI-degradable; --json byte-stable (NFR-OWNOUT-1) (unit)", () => {});
  });
  describe("US-032 CI-native reporters: SARIF + PR annotations [committed]", () => {
    it.skip("[US-032][AC1] `--export sarif` → valid SARIF v2.1.0 (unit)", () => {});
    it.skip("[US-032][AC2] PR context + token → findings post as GitHub Checks/annotations; local artifacts remain source of truth (integration)", () => {});
  });
});
