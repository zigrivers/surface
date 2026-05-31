// Eval: adherence — coding-standards patterns (no `any`, no default exports in libs, no console.log,
// zod at boundaries, measured⇒tool-evidence). Mostly pending until code exists; the lint config
// already encodes several of these as errors (eslint.config.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("eval:adherence", () => {
  it("lint config encodes the non-negotiable rules (no-explicit-any, no-floating-promises, no console)", () => {
    const eslint = read("eslint.config.mjs");
    expect(eslint).toContain('"@typescript-eslint/no-explicit-any": "error"');
    expect(eslint).toContain('"@typescript-eslint/no-floating-promises": "error"');
    expect(eslint).toContain('"no-console"');
  });

  it.skip("[pending build] every finding-emitting fn sets `method`; measured ⇒ ≥1 tool-result evidence (ADR-005/FND-I1)", () => {});
  it.skip("[pending build] no default exports in library packages (named exports only)", () => {});
  it.skip("[pending build] external input parsed with zod at package boundaries", () => {});
  it.skip("[pending build] no leftover TODO/stub markers (No-Laziness principle)", () => {});
});
