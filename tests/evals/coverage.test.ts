// Eval: coverage — every Must-have story has a tagged acceptance skeleton; every AC is tagged.
// Runnable today against tests/acceptance/ + docs/user-stories.md.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const acceptanceText = () =>
  readdirSync(resolve(ROOT, "tests/acceptance"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => read(`tests/acceptance/${f}`))
    .join("\n");

describe("eval:coverage", () => {
  it("every story id in user-stories.md has at least one tagged test case", () => {
    const stories = [...read("docs/user-stories.md").matchAll(/US-\d{3}/g)].map((m) => m[0]);
    const tests = acceptanceText();
    for (const id of new Set(stories)) {
      expect(tests.includes(`[${id}]`), `no tagged test for ${id}`).toBe(true);
    }
  });

  it("the traceability map lists every story", () => {
    const map = read("docs/story-tests-map.md");
    const stories = [...read("docs/user-stories.md").matchAll(/US-\d{3}/g)].map((m) => m[0]);
    for (const id of new Set(stories)) {
      expect(map.includes(id), `story-tests-map missing ${id}`).toBe(true);
    }
  });

  it.skip("[pending build] every implemented AC test maps to production code (feature→code)", () => {});
});
