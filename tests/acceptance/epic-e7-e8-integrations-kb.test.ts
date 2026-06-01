// Acceptance skeletons — Epic E7: Integrations (US-060..061) + Epic E8: KB/Presets/Multi-model (US-070..071).
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createGitHubIssueExporter, isOk, type Backlog } from "../../packages/core/src/index.js";

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
    it.skip("[US-061][AC1] --export linear|jira → items created per that vendor's API within rate limits (integration)", () => {});
  });
});

async function writeBacklogFixture(value: Backlog): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-us-060-"));
  const filePath = path.join(projectRoot, ".surface", "reports", "backlog.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ backlog: value }));
  return projectRoot;
}

describe("E8 Knowledge Base, Presets & Multi-model", () => {
  describe("US-070 inspectable, cited knowledge base [gate]", () => {
    it.skip("[US-070][AC1] finding cites a heuristic → KB entry has ## Summary/## Deep Guidance, source citation, freshness metadata (unit)", () => {});
  });
  describe("US-071 multi-model reconciliation [should]", () => {
    it.skip("[US-071][AC1] depth 4–5 + installed CLIs → findings reconciled by confidence; divergence surfaced as a question (integration)", () => {});
    it.skip("[US-071][AC2] a CLI unavailable → degrade to single-model; record which channels participated (integration)", () => {});
  });
});
