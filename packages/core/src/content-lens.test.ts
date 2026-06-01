import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { createContentMicrocopyLens } from "./content-lens.js";
import { isOk } from "./errors.js";
import type { Capture } from "./interfaces.js";
import { createFileSystemKnowledgeSource } from "./knowledge-source.js";

const knowledge = createFileSystemKnowledgeSource({
  rootDir: fileURLToPath(new URL("../../../content/knowledge/", import.meta.url)),
});

describe("content microcopy lens", () => {
  it("emits a cited judged finding for high reading-grade DOM copy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-content-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<!doctype html>
        <main>
          <h1>Operational transformation enablement</h1>
          <p>
            The comprehensive administrative orchestration interface facilitates
            multidimensional configuration initialization, institutionalizes
            implementation governance, and operationalizes cross-functional
            prioritization procedures before users can continue.
          </p>
        </main>`,
      );
      const lens = createContentMicrocopyLens({ maxReadingGrade: 8 });
      const result = await lens.evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            citedHeuristics: ["kb_content_plain_language_readability"],
            evidence: [
              {
                kind: "cited-heuristic",
                knowledgeEntryId: "kb_content_plain_language_readability",
              },
            ],
            issueType: "readability",
            lens: "content",
            location: { selector: "body" },
            method: "judged",
          },
        ],
      });
      expect(result.ok && result.value[0]?.title).toContain("reading grade");
      expect(result.ok && result.value[0]?.rationale).toContain("Flesch-Kincaid");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not emit readability findings for clear short copy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-content-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(domPath, "<main><h1>Save changes</h1><p>Review your order.</p></main>");
      const lens = createContentMicrocopyLens({ maxReadingGrade: 8 });
      const result = await lens.evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(result).toEqual({ ok: true, value: [] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function captureWithDom(domPath: string): Capture {
  return {
    id: "cap_content",
    target: { kind: "url", ref: "https://example.com" },
    backend: "playwright",
    artifacts: [{ id: "dom", type: "dom-snapshot", path: domPath, redacted: false }],
    capturedAt: "2026-06-01T00:00:00.000Z",
    status: "completed",
  };
}
