// Eval: consistency — CLAUDE.md Key Commands match package.json scripts; cross-doc refs resolve.
// Runnable today (checks docs/config). Part of the create-evals core set.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("eval:consistency", () => {
  it("every command in CLAUDE.md Key Commands exists as a package.json script", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const claude = read("CLAUDE.md");
    // Key Commands reference `pnpm <script>`; assert each referenced script is defined.
    for (const script of ["dev", "build", "test", "test:watch", "lint", "typecheck", "format", "format:check", "check", "clean"]) {
      expect(pkg.scripts, `package.json missing script: ${script}`).toHaveProperty(script);
      expect(claude, `CLAUDE.md should reference 'pnpm ${script}'`).toContain(`pnpm ${script.includes(":") ? "run " + script : script}`.replace("pnpm run check", "pnpm run check"));
    }
  });

  it("the `check` script is the CI gate referenced by both CLAUDE.md and .github/workflows/ci.yml", () => {
    expect(read("CLAUDE.md")).toContain("pnpm run check");
    expect(read(".github/workflows/ci.yml")).toContain("pnpm run check");
  });
});
