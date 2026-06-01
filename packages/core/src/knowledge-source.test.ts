import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createFileSystemKnowledgeSource,
  isOk,
  loadKnowledgeEntries,
  queryKnowledgeEntries,
} from "./index.js";
import type { KnowledgeEntry } from "./interfaces.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file-system knowledge source", () => {
  it("loads markdown entries with cited summary, deep guidance, and freshness metadata", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/contrast.md": contrastEntry,
      "navigation/wayfinding.md": navigationEntry,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toMatchObject({
      id: "kb_wcag_143",
      title: "Contrast minimum",
      category: "accessibility",
      summary: "Text needs enough contrast to remain readable.",
      deepGuidance: "Compare foreground and background colors against WCAG 2.2 AA thresholds.",
      citation: {
        source: "WCAG 2.2 Success Criterion 1.4.3",
        retrievedAt: "2026-05-31T00:00:00.000Z",
      },
      freshness: {
        volatility: "stable",
        lastReviewed: "2026-05-31T00:00:00.000Z",
      },
      appliesToAppTypes: ["generic", "e-commerce"],
      appliesToLenses: ["accessibility", "visual-hierarchy"],
      steps: ["evaluate"],
      sourcePath: "accessibility/contrast.md",
    });
  });

  it("queries relevant entries by lens, app type, and step with deterministic ranking", () => {
    const entries = [
      knowledgeEntryFixture({
        id: "kb_generic_contrast",
        appliesToAppTypes: ["generic"],
        appliesToLenses: ["accessibility"],
      }),
      knowledgeEntryFixture({
        id: "kb_ecommerce_contrast",
        appliesToAppTypes: ["e-commerce"],
        appliesToLenses: ["accessibility"],
      }),
      knowledgeEntryFixture({
        id: "kb_navigation",
        appliesToAppTypes: ["generic"],
        appliesToLenses: ["navigation"],
      }),
      knowledgeEntryFixture({
        id: "kb_capture_only",
        appliesToAppTypes: ["generic"],
        appliesToLenses: ["accessibility"],
        steps: ["capture"],
      }),
    ];

    const result = queryKnowledgeEntries(entries, {
      lensId: "accessibility",
      appType: "e-commerce",
      step: "evaluate",
    });

    expect(result.map((entry) => entry.id)).toEqual([
      "kb_ecommerce_contrast",
      "kb_generic_contrast",
    ]);
  });

  it("resolves entries by id and returns a SurfaceError result for missing entries", async () => {
    const rootDir = await createKnowledgeRoot({ "accessibility/contrast.md": contrastEntry });
    const source = createFileSystemKnowledgeSource({ rootDir });

    const resolved = await source.resolve("kb_wcag_143");
    const missing = await source.resolve("kb_missing");

    expect(isOk(resolved)).toBe(true);
    expect(isOk(missing)).toBe(false);

    if (isOk(missing)) {
      return;
    }

    expect(missing.error).toMatchObject({
      code: "config_invalid",
      details: { id: "kb_missing" },
    });
  });

  it("rejects entries missing required sections or citation metadata", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/invalid.md": `---
id: kb_invalid
title: Invalid entry
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
This entry is missing deep guidance and citation metadata.
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(false);

    if (isOk(result)) {
      return;
    }

    expect(result.error).toMatchObject({
      code: "config_invalid",
      message: "One or more knowledge entries are invalid.",
    });
  });

  it("keeps nested headings and fenced code inside the active section", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/code.md": `---
id: kb_code_block
title: Code block guidance
category: accessibility
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
citation:
  source: Fixture source
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Use semantic markup.

## Deep Guidance
### Preserve subheadings
Keep the surrounding explanation.

\`\`\`bash
# This is a comment, not a knowledge section.
echo "ok"
\`\`\`
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]?.deepGuidance).toContain("### Preserve subheadings");
    expect(result.value[0]?.deepGuidance).toContain("# This is a comment");
  });

  it("rejects freshness and citation dates that are not parseable", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/invalid-date.md": `---
id: kb_invalid_date
title: Invalid date
category: accessibility
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
citation:
  source: Fixture source
  retrievedAt: not-a-date
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Summary.

## Deep Guidance
Deep guidance.
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(false);
  });

  it("rejects headings whose section bodies are empty", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/empty-section.md": `---
id: kb_empty_section
title: Empty section
category: accessibility
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
citation:
  source: Fixture source
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary

## Deep Guidance
Deep guidance.
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(false);
  });

  it("stops section capture at unrelated sibling headings", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/sibling.md": `---
id: kb_sibling
title: Sibling heading
category: accessibility
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
citation:
  source: Fixture source
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Summary content.

## Appendix
This should not leak into summary.

## Deep Guidance
Deep content.
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]?.summary).toBe("Summary content.");
  });

  it("rejects entries without relevance lenses", async () => {
    const rootDir = await createKnowledgeRoot({
      "accessibility/no-lens.md": `---
id: kb_no_lens
title: No lens
category: accessibility
appliesToAppTypes: [generic]
citation:
  source: Fixture source
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Summary.

## Deep Guidance
Deep guidance.
`,
    });

    const result = await loadKnowledgeEntries({ rootDir });

    expect(isOk(result)).toBe(false);
  });
});

async function createKnowledgeRoot(entries: Record<string, string>): Promise<string> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "surface-kb-"));
  tempDirs.push(rootDir);

  for (const [relativePath, contents] of Object.entries(entries)) {
    const filePath = path.join(rootDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }

  return rootDir;
}

function knowledgeEntryFixture(overrides: Partial<KnowledgeEntry>): KnowledgeEntry {
  return { ...baseKnowledgeEntry(), ...overrides };
}

function baseKnowledgeEntry(): KnowledgeEntry {
  return {
    id: "kb_fixture",
    title: "Fixture",
    category: "accessibility" as const,
    summary: "Summary.",
    deepGuidance: "Deep guidance.",
    citation: {
      source: "Fixture source",
      retrievedAt: "2026-05-31T00:00:00.000Z",
    },
    freshness: {
      volatility: "stable" as const,
      lastReviewed: "2026-05-31T00:00:00.000Z",
    },
    appliesToAppTypes: ["generic"] as const,
    appliesToLenses: ["accessibility"],
    steps: ["evaluate"],
    tags: [],
  };
}

const contrastEntry = `---
id: kb_wcag_143
title: Contrast minimum
category: accessibility
appliesToAppTypes: [generic, e-commerce]
appliesToLenses: [accessibility, visual-hierarchy]
steps: [evaluate]
tags: [contrast, readability]
citation:
  source: WCAG 2.2 Success Criterion 1.4.3
  url: https://www.w3.org/TR/WCAG22/#contrast-minimum
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Text needs enough contrast to remain readable.

## Deep Guidance
Compare foreground and background colors against WCAG 2.2 AA thresholds.
`;

const navigationEntry = `---
id: kb_navigation_orientation
title: Navigation orientation
category: navigation
appTypes: [generic]
lensIds: [navigation]
steps: [evaluate]
citation:
  source: Nielsen Norman Group
  retrievedAt: 2026-05-31
freshness:
  volatility: evolving
  lastReviewed: 2026-05-31
---

## Summary
Navigation should orient users.

## Deep Guidance
Keep labels, current location, and available next actions clear.
`;
