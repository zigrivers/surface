// Eval: cross-doc — canonical terminology + path consistency across the doc corpus.
// Runnable today. Guards the ubiquitous language (coding-standards §Naming, domain-models).
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("eval:cross-doc", () => {
  it("canonical vocabulary is used (no banned synonyms for `method`/`gatedForHuman`)", () => {
    // The trust spine uses method:"measured"|"judged" and gatedForHuman — assert presence,
    // and that no doc introduces a synonym like "humanGated" or "isMeasured".
    const findings = read("docs/domain-models/findings.md");
    expect(findings).toContain("gatedForHuman");
    expect(findings).toMatch(/"measured"\s*\|\s*"judged"|measured.*judged/);
    for (const banned of ["humanGated", "isMeasured", "measuredFlag"]) {
      expect(findings.includes(banned), `banned synonym present: ${banned}`).toBe(false);
    }
  });

  it("referenced ADRs exist on disk (no dangling ADR links in the index)", () => {
    const index = read("docs/adrs/index.md");
    const refs = [...index.matchAll(/ADR-(\d{3})-[a-z-]+\.md/g)].map((m) => m[0]);
    for (const ref of new Set(refs)) {
      expect(existsSync(resolve(ROOT, "docs/adrs", ref)), `missing ADR file: ${ref}`).toBe(true);
    }
  });

  it("tech-stack runtime matches engines (Node >= 22)", () => {
    expect(read("docs/tech-stack.md")).toMatch(/Node\.js.*(LTS)?.*≥\s*22|>=\s*22/);
    expect(JSON.parse(read("package.json")).engines.node).toContain("22");
  });
});
