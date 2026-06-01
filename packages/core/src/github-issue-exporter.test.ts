import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isErr, isOk } from "./errors.js";
import { createGitHubIssueExporter } from "./github-issue-exporter.js";
import type { Backlog } from "./findings.js";

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

describe("GitHubIssueExporter", () => {
  it("creates GitHub issues with finding context from a local backlog artifact", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const created: unknown[] = [];
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      labels: ["surface", "finding"],
      client: {
        issues: {
          create: (input) => {
            created.push(input);
            return Promise.resolve({ data: { number: created.length } });
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

    expect(result.value).toEqual({
      id: "github:bk_run_123",
      target: "github",
      synced: ["f_a", "f_b"],
      unsynced: [],
      status: "complete",
    });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      owner: "surface",
      repo: "app",
      title: "[Surface] 1. f_a",
      labels: ["surface", "finding"],
    });
    expect(JSON.stringify(created[1])).toContain("Demoted duplicate of");
    expect(JSON.stringify(created[0])).toContain("Primary action contrast is below AA");
    expect(JSON.stringify(created[0])).toContain("selector=`.primary-action`");
    expect(JSON.stringify(created[0])).toContain("Set foreground to #111827.");
  });

  it("retries retryable failures and reports persistent unsynced findings", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const waits: number[] = [];
    let attempts = 0;
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      initialBackoffMs: 10,
      maxAttempts: 2,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      client: {
        issues: {
          create: () => {
            attempts += 1;
            if (attempts % 2 === 1) {
              return Promise.reject(
                Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
              );
            }

            return Promise.reject(Object.assign(new Error("rate limited"), { status: 429 }));
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
      synced: [],
      unsynced: ["f_a", "f_b"],
      status: "failed",
    });
    expect(attempts).toBe(4);
    expect(waits).toEqual([10, 10]);
  });

  it("retries GitHub secondary rate limits reported as 403 with retry-after", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    const waits: number[] = [];
    let attempts = 0;
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      initialBackoffMs: 10,
      maxAttempts: 2,
      wait: (milliseconds) => {
        waits.push(milliseconds);
        return Promise.resolve();
      },
      client: {
        issues: {
          create: () => {
            attempts += 1;

            if (attempts % 2 === 1) {
              return Promise.reject(
                Object.assign(new Error("secondary rate limit"), {
                  response: { headers: { "retry-after": "1" } },
                  status: 403,
                }),
              );
            }

            return Promise.resolve({ data: {} });
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

    expect(result.value.status).toBe("complete");
    expect(attempts).toBe(4);
    expect(waits).toEqual([10, 10]);
  });

  it("stops exporting remaining entries after a non-retryable GitHub auth failure", async () => {
    const projectRoot = await writeBacklogArtifact(backlog);
    let attempts = 0;
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      maxAttempts: 3,
      client: {
        issues: {
          create: () => {
            attempts += 1;
            return Promise.reject(Object.assign(new Error("bad credentials"), { status: 401 }));
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
      synced: [],
      unsynced: ["f_a", "f_b"],
      status: "failed",
    });
    expect(attempts).toBe(1);
  });

  it("accepts backlog paths inside project root whose directory name starts with dots", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-"));
    await writeFileRecursive(
      path.join(projectRoot, "..foo", "backlog.json"),
      JSON.stringify(backlog),
    );
    const created: unknown[] = [];
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      client: {
        issues: {
          create: (input) => {
            created.push(input);
            return Promise.resolve({ data: {} });
          },
        },
      },
    });

    const result = await exporter.export({ backlogId: backlog.id, path: "..foo/backlog.json" });

    expect(isOk(result)).toBe(true);
    expect(created).toHaveLength(2);
  });

  it("rejects backlog artifacts reached through symlinks that escape the project root", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-outside-"));
    const outsideBacklog = path.join(outsideRoot, "backlog.json");
    await writeFile(outsideBacklog, JSON.stringify(backlog));
    await symlink(outsideBacklog, path.join(projectRoot, "linked-backlog.json"));
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      client: {
        issues: {
          create: () => Promise.resolve({ data: {} }),
        },
      },
    });

    const result = await exporter.export({ backlogId: backlog.id, path: "linked-backlog.json" });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        kind: "IntegrationError",
      },
    });
  });

  it("rejects local backlog artifacts whose id does not match the requested ref", async () => {
    const projectRoot = await writeBacklogArtifact({ ...backlog, id: "bk_other" });
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      client: {
        issues: {
          create: () => Promise.resolve({ data: {} }),
        },
      },
    });

    const result = await exporter.export({
      backlogId: backlog.id,
      path: ".surface/reports/backlog.json",
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        details: {
          actual: "bk_other",
          expected: backlog.id,
        },
      },
    });
  });

  it("returns an export_failed error for invalid local backlog artifacts", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-"));
    await writeFile(path.join(projectRoot, "broken.json"), JSON.stringify({ backlog: [] }));
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      client: {
        issues: {
          create: () => Promise.resolve({ data: {} }),
        },
      },
    });

    const result = await exporter.export({ backlogId: "bk_broken", path: "broken.json" });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        kind: "IntegrationError",
      },
    });
  });

  it("returns an export_failed error when the local backlog artifact is missing", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-"));
    const exporter = createGitHubIssueExporter({
      owner: "surface",
      repo: "app",
      projectRoot,
      client: {
        issues: {
          create: () => Promise.resolve({ data: {} }),
        },
      },
    });

    const result = await exporter.export({ backlogId: backlog.id, path: "missing.json" });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        kind: "IntegrationError",
      },
    });
  });
});

async function writeBacklogArtifact(value: Backlog): Promise<string> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-github-exporter-"));
  const artifactPath = path.join(projectRoot, ".surface", "reports");
  await writeFileRecursive(
    path.join(artifactPath, "backlog.json"),
    JSON.stringify({ backlog: value }),
  );
  return projectRoot;
}

async function writeFileRecursive(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
