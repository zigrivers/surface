// CLI end-to-end smoke test (skeleton — pending until packages/cli ships a `surface` binary).
//
// surface has NO frontend of its own (it audits OTHER apps' UIs), so e2e here is CLI e2e:
// spawn the built `surface` binary and assert its contract (NFR-CLI-1) + a closed-loop smoke
// on a seeded fixture app. Playwright is used INTERNALLY for capture-backend tests
// (ADR-015 capture matrix), not for testing a surface frontend (there is none).
//
// Run: pnpm --filter @surface/cli test (once the CLI exists). Until then these are `.skip`.

import { describe, it, expect } from "vitest";
// import { execa } from "execa"; // enable once @surface/cli is built
// const SURFACE = "node packages/cli/dist/index.js"; // or the linked `surface` bin

describe.skip("surface CLI e2e (contract + closed loop)", () => {
  it("`--version` exits 0 and prints a semver", async () => {
    // const { exitCode, stdout } = await execa(SURFACE, ["--version"]);
    // expect(exitCode).toBe(0);
    // expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
    expect(true).toBe(true); // placeholder
  });

  it("unknown subcommand exits 2 (usage error) — NFR-CLI-1", async () => {
    // const { exitCode } = await execa(SURFACE, ["bogus"], { reject: false });
    // expect(exitCode).toBe(2);
  });

  it("`audit --localhost --json` on a seeded fixture produces schema-valid findings.json", async () => {
    // start a local fixture server with seeded defects (contrast fail, focus trap, tiny target),
    // run: execa(SURFACE, ["audit", "--localhost", "--json"])
    // expect ok:true envelope; parse data.findings against the Finding schema (zod);
    // assert at least one measured finding carries tool-result evidence (method-integrity).
  });

  it("closed loop: fix the fixture, re-audit → finding becomes resolved (stable identity)", async () => {
    // baseline audit → note a finding id; apply the suggestedPatch to the fixture;
    // re-audit → same identity key transitions to `resolved`; an unmatchable anchor would be
    // `identity-broken`, never silently resolved (FR-RULE-3, ADR-010).
  });

  it("`gate --ci` exits 1 on a new measured P0/P1 and 0 when clean (FR-RULE-4)", async () => {
    // assert gate evaluates SeverityBand; never fails on judged/gatedForHuman.
  });
});
