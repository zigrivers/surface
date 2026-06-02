// Eval: structure — project layout matches docs/project-structure.md.
// Runnable today (checks the package skeleton). Code-placement rules become enforceable as code lands.
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const has = (p: string) => existsSync(resolve(ROOT, p));

describe("eval:structure", () => {
  it("the declared monorepo packages exist", () => {
    for (const pkg of [
      "packages/core",
      "packages/cli",
      "packages/mcp",
      "packages/capture",
      "packages/grounding",
      "packages/adapters/react",
      "packages/adapters/vue",
      "packages/adapters/svelte",
      "packages/adapters/agnostic",
      "packages/knowledge",
      "packages/reporters",
    ]) {
      expect(has(pkg), `missing package dir: ${pkg}`).toBe(true);
    }
  });

  it("content/ mirrors the pipeline/knowledge/methodology model", () => {
    for (const dir of ["content/pipeline", "content/knowledge", "content/methodology"]) {
      expect(has(dir), `missing content dir: ${dir}`).toBe(true);
    }
  });

  it.skip("[pending build] no deep cross-package imports (@zigrivers/<pkg>/src/*) — lint-enforced", () => {
    // Once code exists: assert no source imports another package's src/* (published entry points only).
  });
});
