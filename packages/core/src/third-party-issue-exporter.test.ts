import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RedactionRule } from "./config.js";
import { isOk } from "./errors.js";
import { REDACTED_EXPORT_VALUE } from "./export-redaction.js";
import type { Backlog } from "./findings.js";
import {
  createJiraIssueExporter,
  createLinearIssueExporter,
} from "./third-party-issue-exporter.js";

const backlog = {
  id: "bk_run_123",
  runId: "run_123",
  entries: [
    {
      findingId: "f_a",
      title: "Primary action contrast is below AA",
      rationale: "The button text is difficult to read.",
      severityBand: "P1",
      location: { selector: ".primary-action" },
      suggestedPatch: { kind: "contrast-hex", change: "Set foreground to #111827." },
      priority: 0.7,
      rank: 1,
    },
    { findingId: "f_b", priority: 0.4, rank: 2, demotedAsDuplicateOf: "f_a" },
  ],
} satisfies Backlog;

const exportRedactionRules = [
  { pattern: "secret-[a-z0-9-]+", appliesTo: ["export"] },
] satisfies readonly RedactionRule[];

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("third-party issue exporters", () => {
  it("creates Linear issues with finding context from a local backlog artifact", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const created: unknown[] = [];
    const exporter = createLinearIssueExporter({
      teamId: "team_surface",
      projectRoot,
      labels: ["surface", "finding"],
      client: {
        createIssue: (input) => {
          created.push(input);
          return Promise.resolve({ id: `lin_${created.length}` });
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

    expect(result.value).toEqual({
      id: "linear:bk_run_123",
      target: "linear",
      synced: ["f_a", "f_b"],
      unsynced: [],
      status: "complete",
    });
    expect(created[0]).toMatchObject({
      teamId: "team_surface",
      title: "[Surface] 1. f_a",
      labels: ["surface", "finding"],
    });
    expect(JSON.stringify(created[0])).toContain("Primary action contrast is below AA");
    expect(JSON.stringify(created[0])).toContain("selector=`.primary-action`");
  });

  it("creates Jira issues with finding context from a local backlog artifact", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const created: unknown[] = [];
    const exporter = createJiraIssueExporter({
      projectKey: "SURF",
      projectRoot,
      issueType: "Task",
      labels: ["surface"],
      client: {
        createIssue: (input) => {
          created.push(input);
          return Promise.resolve({ key: `SURF-${created.length}` });
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
      id: "jira:bk_run_123",
      target: "jira",
      synced: ["f_a", "f_b"],
      status: "complete",
    });
    expect(created[0]).toMatchObject({
      fields: {
        project: { key: "SURF" },
        issuetype: { name: "Task" },
        summary: "[Surface] 1. f_a",
        labels: ["surface"],
      },
    });
    expect(JSON.stringify(created[0])).toContain("Local backlog artifact");
  });

  it("retries retryable vendor failures and reports unsynced findings", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const waits: number[] = [];
    let attempts = 0;
    const exporter = createLinearIssueExporter({
      teamId: "team_surface",
      projectRoot,
      initialBackoffMs: 5,
      maxAttempts: 2,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      client: {
        createIssue: () => {
          attempts += 1;
          return Promise.reject(Object.assign(new Error("rate limited"), { status: 429 }));
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
      unsynced: ["f_a", "f_b"],
      status: "failed",
    });
    expect(attempts).toBe(4);
    expect(waits).toEqual([5, 5]);
  });

  it("redacts export-scoped patterns from vendor payloads", async () => {
    const secretBacklog = {
      ...backlog,
      entries: [
        {
          ...backlog.entries[0]!,
          title: "Primary action exposes secret-alpha",
          rationale: "The exported issue includes secret-beta.",
        },
      ],
    } satisfies Backlog;
    const projectRoot = await writeBacklogArtifact(secretBacklog);
    const created: unknown[] = [];
    const exporter = createJiraIssueExporter({
      projectKey: "SURF",
      projectRoot,
      redactionRules: exportRedactionRules,
      client: {
        createIssue: (input) => {
          created.push(input);
          return Promise.resolve({ key: "SURF-1" });
        },
      },
    });

    const result = await exporter.export({
      backlogId: secretBacklog.id,
      path: ".surface/reports/backlog.json",
    });

    expect(isOk(result)).toBe(true);
    expect(JSON.stringify(created[0])).not.toMatch(/secret-[a-z0-9-]+/);
    expect(JSON.stringify(created[0])).toContain(REDACTED_EXPORT_VALUE);
  });
});

async function writeBacklogArtifact(value: Backlog): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-vendor-exporter-"));
  tempDirs.push(projectRoot);
  const filePath = path.join(projectRoot, ".surface", "reports", "backlog.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ backlog: value }));
  return projectRoot;
}
