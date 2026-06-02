// Acceptance skeletons — Epic E7: Integrations (US-060..061) + Epic E8: KB/Presets/Multi-model (US-070..071).
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BUILT_IN_LENS_REGISTRY,
  createFileSystemKnowledgeSource,
  createGitHubIssueExporter,
  createJiraIssueExporter,
  createLinearIssueExporter,
  loadKnowledgeEntries,
  isOk,
  type Backlog,
} from "../../packages/core/src/index.js";

const backlog = {
  id: "bk_us_060",
  runId: "run_us_060",
  entries: [
    {
      findingId: "f_checkout_contrast",
      title: "Checkout button contrast is below AA",
      rationale: "Low contrast makes the primary checkout action hard to read.",
      location: { selector: ".checkout-button" },
      priority: 0.8,
      rank: 1,
    },
  ],
} satisfies Backlog;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("E7 Integrations", () => {
  describe("US-060 GitHub Issues export [gate]", () => {
    it("[US-060][AC1] token + --export github → issues created with finding context (integration)", async () => {
      const projectRoot = await writeBacklogFixture(backlog);
      const created: unknown[] = [];
      const exporter = createGitHubIssueExporter({
        owner: "surface",
        repo: "fixture",
        token: "ghp_test",
        projectRoot,
        client: {
          issues: {
            create: (input) => {
              created.push(input);
              return Promise.resolve({ data: { number: 1 } });
            },
          },
        },
      });

      const result = await exporter.export({
        backlogId: backlog.id,
        path: ".surface/reports/backlog.json",
      });

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        return;
      }

      expect(result.value).toMatchObject({
        synced: ["f_checkout_contrast"],
        unsynced: [],
        status: "complete",
      });
      expect(created[0]).toMatchObject({
        owner: "surface",
        repo: "fixture",
        title: "[Surface] 1. f_checkout_contrast",
      });
      expect(JSON.stringify(created[0])).toContain("Local backlog artifact");
      expect(JSON.stringify(created[0])).toContain("Checkout button contrast is below AA");
      expect(JSON.stringify(created[0])).toContain("selector=`.checkout-button`");
    });

    it("[US-060][AC2] rate-limit/API failure → retry w/ backoff, write backlog locally, report unsynced, exit non-zero (integration)", async () => {
      const projectRoot = await writeBacklogFixture(backlog);
      const waits: number[] = [];
      const exporter = createGitHubIssueExporter({
        owner: "surface",
        repo: "fixture",
        projectRoot,
        initialBackoffMs: 5,
        maxAttempts: 2,
        wait: (milliseconds) => {
          waits.push(milliseconds);
          return Promise.resolve();
        },
        client: {
          issues: {
            create: () => Promise.reject(Object.assign(new Error("rate limited"), { status: 429 })),
          },
        },
      });

      const result = await exporter.export({
        backlogId: backlog.id,
        path: ".surface/reports/backlog.json",
      });

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        return;
      }

      expect(result.value).toMatchObject({
        synced: [],
        unsynced: ["f_checkout_contrast"],
        status: "failed",
      });
      expect(waits).toEqual([5]);
    });
  });
  describe("US-061 Linear/Jira export & token parsers [should]", () => {
    it("[US-061][AC1] --export linear|jira → items created per that vendor's API within rate limits (integration)", async () => {
      const projectRoot = await writeBacklogFixture(backlog);
      const linearCreated: unknown[] = [];
      const jiraCreated: unknown[] = [];
      const linear = createLinearIssueExporter({
        teamId: "team_surface",
        projectRoot,
        maxAttempts: 2,
        client: {
          createIssue: (input) => {
            linearCreated.push(input);
            return Promise.resolve({ id: "lin_1" });
          },
        },
      });
      const jira = createJiraIssueExporter({
        projectKey: "SURF",
        projectRoot,
        maxAttempts: 2,
        client: {
          createIssue: (input) => {
            jiraCreated.push(input);
            return Promise.resolve({ key: "SURF-1" });
          },
        },
      });

      const linearResult = await linear.export({
        backlogId: backlog.id,
        path: ".surface/reports/backlog.json",
      });
      const jiraResult = await jira.export({
        backlogId: backlog.id,
        path: ".surface/reports/backlog.json",
      });

      expect(isOk(linearResult)).toBe(true);
      expect(isOk(jiraResult)).toBe(true);

      if (!isOk(linearResult) || !isOk(jiraResult)) {
        return;
      }

      expect(linearResult.value).toMatchObject({
        target: "linear",
        synced: ["f_checkout_contrast"],
        unsynced: [],
        status: "complete",
      });
      expect(jiraResult.value).toMatchObject({
        target: "jira",
        synced: ["f_checkout_contrast"],
        unsynced: [],
        status: "complete",
      });
      expect(linearCreated[0]).toMatchObject({
        teamId: "team_surface",
        title: "[Surface] 1. f_checkout_contrast",
      });
      expect(jiraCreated[0]).toMatchObject({
        fields: {
          project: { key: "SURF" },
          summary: "[Surface] 1. f_checkout_contrast",
        },
      });
      expect(JSON.stringify(linearCreated[0])).toContain("Checkout button contrast is below AA");
      expect(JSON.stringify(jiraCreated[0])).toContain("selector=`.checkout-button`");
    });
  });
});

async function writeBacklogFixture(value: Backlog): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-us-060-"));
  tempDirs.push(projectRoot);
  const filePath = path.join(projectRoot, ".surface", "reports", "backlog.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ backlog: value }));
  return projectRoot;
}

describe("E8 Knowledge Base, Presets & Multi-model", () => {
  describe("US-070 inspectable, cited knowledge base [gate]", () => {
    it("[US-070][AC1] finding cites a heuristic → KB entry has ## Summary/## Deep Guidance, source citation, freshness metadata (unit)", async () => {
      const rootDir = await writeKnowledgeFixture();
      const knowledge = createFileSystemKnowledgeSource({ rootDir });

      const relevant = await knowledge.query({
        lensId: "accessibility",
        appType: "generic",
        step: "evaluate",
      });
      const resolved = await knowledge.resolve("kb_wcag_143");

      expect(isOk(relevant)).toBe(true);
      expect(isOk(resolved)).toBe(true);

      if (!isOk(relevant) || !isOk(resolved)) {
        return;
      }

      expect(relevant.value.map((entry) => entry.id)).toContain("kb_wcag_143");
      expect(resolved.value).toMatchObject({
        id: "kb_wcag_143",
        title: "Contrast minimum",
        category: "accessibility",
        summary: "Text contrast must keep content readable.",
        deepGuidance: "Use WCAG 2.2 AA contrast thresholds for normal and large text.",
        citation: {
          source: "WCAG 2.2 Success Criterion 1.4.3",
          url: "https://www.w3.org/TR/WCAG22/#contrast-minimum",
          retrievedAt: "2026-05-31T00:00:00.000Z",
        },
        freshness: {
          volatility: "stable",
          lastReviewed: "2026-05-31T00:00:00.000Z",
        },
      });
    });

    it("[US-070][AC2] shipped KB content covers every gate category with authored, cited entries (structure)", async () => {
      const result = await loadKnowledgeEntries({
        rootDir: path.join(process.cwd(), "content", "knowledge"),
        includeDrafts: true,
      });
      const activeResult = await loadKnowledgeEntries({
        rootDir: path.join(process.cwd(), "content", "knowledge"),
      });

      expect(isOk(result)).toBe(true);
      expect(isOk(activeResult)).toBe(true);

      if (!isOk(result) || !isOk(activeResult)) {
        return;
      }

      const requiredCategories = [
        "accessibility",
        "agent-implementation",
        "conversion",
        "core-heuristics",
        "design-systems",
        "forms",
        "navigation",
        "platform-web",
        "states",
        "visual-content",
      ];

      expect(activeResult.value.map((entry) => entry.category)).toEqual(
        expect.arrayContaining(requiredCategories),
      );
      const supportedLensIds = new Set(BUILT_IN_LENS_REGISTRY.map((lens) => lens.id));

      const placeholderEntries = result.value.filter(
        (entry) =>
          entry.draft === true ||
          entry.tags?.includes("todo") === true ||
          entry.sourcePath?.endsWith("todo.md") === true ||
          (entry.title ?? "").includes("placeholder"),
      );

      expect(placeholderEntries).toEqual([]);

      for (const entry of activeResult.value) {
        expect(entry.draft).not.toBe(true);
        expect(entry.tags ?? []).not.toContain("todo");
        expect(entry.sourcePath).not.toMatch(/todo\.md$/);
        expect(entry.title ?? "").not.toContain("placeholder");
        expect(entry.citation?.source).not.toMatch(/^TODO:/);
        expect(entry.summary).not.toContain("TODO:");
        expect(entry.deepGuidance).not.toContain("TODO:");
        expect(entry.appliesToLenses?.length).toBeGreaterThan(0);
        for (const lensId of entry.appliesToLenses ?? []) {
          expect(supportedLensIds).toContain(lensId);
        }
      }
    });
  });
  describe("US-071 multi-model reconciliation [should]", () => {
    it.skip("[US-071][AC1] depth 4–5 + installed CLIs → findings reconciled by confidence; divergence surfaced as a question (integration)", () => {});
    it.skip("[US-071][AC2] a CLI unavailable → degrade to single-model; record which channels participated (integration)", () => {});
  });
});

async function writeKnowledgeFixture(): Promise<string> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "surface-us-070-"));
  tempDirs.push(rootDir);
  const filePath = path.join(rootDir, "accessibility", "contrast.md");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `---
id: kb_wcag_143
title: Contrast minimum
category: accessibility
appliesToAppTypes: [generic]
appliesToLenses: [accessibility]
steps: [evaluate]
tags: [contrast]
citation:
  source: WCAG 2.2 Success Criterion 1.4.3
  url: https://www.w3.org/TR/WCAG22/#contrast-minimum
  retrievedAt: 2026-05-31
freshness:
  volatility: stable
  lastReviewed: 2026-05-31
---

## Summary
Text contrast must keep content readable.

## Deep Guidance
Use WCAG 2.2 AA contrast thresholds for normal and large text.
`,
  );
  return rootDir;
}
