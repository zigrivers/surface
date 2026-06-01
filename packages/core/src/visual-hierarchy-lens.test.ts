import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { isOk } from "./errors.js";
import type { Capture } from "./interfaces.js";
import { createFileSystemKnowledgeSource } from "./knowledge-source.js";
import { createVisualHierarchyLens } from "./visual-hierarchy-lens.js";

const knowledge = createFileSystemKnowledgeSource({
  rootDir: fileURLToPath(new URL("../../../content/knowledge/", import.meta.url)),
});

describe("visual hierarchy lens", () => {
  it("emits a cited judged finding when heading scale is indistinguishable from body text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-visual-hierarchy-lens-"));

    try {
      const stylesPath = path.join(root, "computed-styles.json");
      await writeFile(
        stylesPath,
        JSON.stringify([
          styleEntry({ fontSize: "16px", selector: "html > body", tagName: "body" }),
          styleEntry({ fontSize: "16px", selector: "html > body > main > h1", tagName: "h1" }),
          styleEntry({ fontSize: "16px", selector: "html > body > main > p", tagName: "p" }),
        ]),
      );
      const lens = createVisualHierarchyLens({ minHeadingScaleRatio: 1.25 });
      const result = await lens.evaluate({
        capture: captureWithComputedStyles(stylesPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            citedHeuristics: ["kb_visual_hierarchy_type_scale"],
            evidence: [
              {
                kind: "cited-heuristic",
                knowledgeEntryId: "kb_visual_hierarchy_type_scale",
              },
              {
                kind: "dom",
                selector: "html > body > main > h1",
              },
            ],
            issueType: "visual-hierarchy",
            lens: "visual-hierarchy",
            location: { selector: "html > body > main > h1" },
            method: "judged",
          },
        ],
      });
      expect(result.ok && result.value[0]?.rationale).toContain("16px");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not emit findings when heading and body text use a clear type scale", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-visual-hierarchy-lens-"));

    try {
      const stylesPath = path.join(root, "computed-styles.json");
      await writeFile(
        stylesPath,
        JSON.stringify([
          styleEntry({ fontSize: "16px", selector: "html > body", tagName: "body" }),
          styleEntry({ fontSize: "32px", selector: "html > body > main > h1", tagName: "h1" }),
          styleEntry({ fontSize: "18px", selector: "html > body > main > p", tagName: "p" }),
        ]),
      );
      const lens = createVisualHierarchyLens({ minHeadingScaleRatio: 1.25 });
      const result = await lens.evaluate({
        capture: captureWithComputedStyles(stylesPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(result).toEqual({ ok: true, value: [] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("emits a design-system finding when too many font-size token steps appear in one view", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-visual-hierarchy-lens-"));

    try {
      const stylesPath = path.join(root, "computed-styles.json");
      await writeFile(
        stylesPath,
        JSON.stringify([
          styleEntry({ fontSize: "16px", selector: "html > body", tagName: "body" }),
          styleEntry({ fontSize: "32px", selector: "html > body > main > h1", tagName: "h1" }),
          styleEntry({ fontSize: "22px", selector: "html > body > main > h2", tagName: "h2" }),
          styleEntry({ fontSize: "18px", selector: "html > body > main > p", tagName: "p" }),
          styleEntry({
            fontSize: "14px",
            selector: "html > body > main > small",
            tagName: "small",
          }),
        ]),
      );
      const lens = createVisualHierarchyLens({ maxFontSizeSteps: 3, minHeadingScaleRatio: 1.25 });
      const result = await lens.evaluate({
        capture: captureWithComputedStyles(stylesPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            issueType: "design-system-token-drift",
            lens: "visual-hierarchy",
            location: { selector: "html > body" },
          },
        ],
      });
      expect(result.ok && result.value[0]?.rationale).toContain("14px, 16px, 18px, 22px, 32px");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function styleEntry(input: {
  readonly fontSize: string;
  readonly selector: string;
  readonly tagName: string;
}): unknown {
  return {
    backgroundColor: "rgba(0, 0, 0, 0)",
    color: "rgb(17, 24, 39)",
    display: "block",
    fontFamily: "Inter",
    fontSize: input.fontSize,
    id: "",
    index: 0,
    selector: input.selector,
    tagName: input.tagName,
    visibility: "visible",
  };
}

function captureWithComputedStyles(computedStylesPath: string): Capture {
  return {
    id: "cap_visual_hierarchy",
    target: { kind: "url", ref: "https://example.com" },
    backend: "playwright",
    artifacts: [
      {
        id: "computed-styles",
        type: "computed-styles",
        path: computedStylesPath,
        redacted: false,
      },
    ],
    capturedAt: "2026-06-01T00:00:00.000Z",
    status: "completed",
  };
}
