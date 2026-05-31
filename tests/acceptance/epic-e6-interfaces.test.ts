// Acceptance skeletons — Epic E6: Interfaces (CLI / MCP / Skill) (US-050..052).
import { describe, it } from "vitest";

describe("E6 Interfaces", () => {
  describe("US-050 POSIX-conformant CLI [gate]", () => {
    it.skip("[US-050][AC1] any command --json → machine-readable; exit 0 success / 1 error / 2 usage (e2e)", () => {});
    it.skip("[US-050][AC2] unknown subcommand → exit 2 usage error (e2e)", () => {});
    it.skip("[US-050][AC3] every error states what failed, likely cause, next command (US-050 actionable errors) (unit)", () => {});
  });
  describe("US-051 MCP server for native agent embedding [gate]", () => {
    it.skip("[US-051][AC1] list tools → surface capabilities appear with versioned schemas (integration)", () => {});
    it.skip("[US-051][AC2] incompatible schema change → major version increments (NFR-MCP-1 snapshot test) (unit)", () => {});
  });
  describe("US-052 natural-language runner skill [gate]", () => {
    it.skip("[US-052][AC1] NL intent → maps to the correct surface command and confirms the action (integration)", () => {});
  });
});
