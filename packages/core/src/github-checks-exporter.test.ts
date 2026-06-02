import { describe, expect, it } from "vitest";

import type { RedactionRule } from "./config.js";
import { isErr, isOk } from "./errors.js";
import { REDACTED_EXPORT_VALUE } from "./export-redaction.js";
import type { Backlog } from "./findings.js";
import { createGitHubChecksExporter } from "./github-checks-exporter.js";
import type { SurfaceSarifLog } from "./report-renderers.js";

const backlog = {
  id: "bk_run_123",
  runId: "run_123",
  entries: [
    {
      findingId: "f_a",
      title: "Primary action contrast is below AA",
      rationale: "The button text is difficult to read.",
      severityBand: "P1",
      location: { file: "src/Button.tsx", selector: ".primary-action" },
      priority: 0.7,
      rank: 1,
    },
    { findingId: "f_b", priority: 0.4, rank: 2 },
  ],
} satisfies Backlog;

const sarif = {
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  version: "2.1.0",
  runs: [
    {
      tool: {
        driver: {
          name: "surface",
          informationUri: "https://github.com/zigrivers/surface",
          rules: [
            {
              id: "contrast-insufficient",
              name: "contrast-insufficient",
              shortDescription: { text: "Primary action contrast is below AA" },
            },
          ],
        },
      },
      results: [
        {
          ruleId: "contrast-insufficient",
          level: "error",
          message: { text: "The button text is difficult to read." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/Button.tsx" },
                region: { startLine: 12, endLine: 12 },
              },
            },
          ],
          properties: {
            confidenceBand: "assert",
            findingId: "f_a",
            severityBand: "P1",
          },
        },
        {
          ruleId: "ambiguous-label",
          level: "note",
          message: { text: "Icon button needs a clearer label." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "surface://f_b" },
              },
            },
          ],
          properties: {
            confidenceBand: "surface-as-question",
            findingId: "f_b",
            severityBand: "P3",
          },
        },
      ],
    },
  ],
} satisfies SurfaceSarifLog;

const exportRedactionRules = [
  { pattern: "secret-[a-z0-9-/.]+", appliesTo: ["export"] },
] satisfies readonly RedactionRule[];

describe("GitHubChecksExporter", () => {
  it("creates a GitHub check run with SARIF-derived annotations and local artifact context", async () => {
    const created: unknown[] = [];
    const exporter = createGitHubChecksExporter({
      owner: "surface",
      repo: "app",
      headSha: "abc123",
      client: {
        checks: {
          create: (input) => {
            created.push(input);
            return Promise.resolve({ data: { id: 123 } });
          },
        },
      },
    });

    const result = await exporter.export({
      backlog,
      localArtifactPath: ".surface/reports/findings.sarif",
      sarif,
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value).toEqual({
      id: "github-checks:bk_run_123",
      target: "github-checks",
      status: "complete",
      synced: ["f_a", "f_b"],
      unsynced: [],
      annotationCount: 1,
      checkName: "Surface findings",
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      owner: "surface",
      repo: "app",
      name: "Surface findings",
      head_sha: "abc123",
      status: "completed",
      conclusion: "failure",
      output: {
        annotations: [
          {
            path: "src/Button.tsx",
            start_line: 12,
            end_line: 12,
            annotation_level: "failure",
            message: "The button text is difficult to read.",
            title: "contrast-insufficient",
          },
        ],
      },
    });
    expect(JSON.stringify(created[0])).toContain(".surface/reports/findings.sarif");
  });

  it("redacts export-scoped patterns from GitHub Checks payloads", async () => {
    const secretSarif = {
      ...sarif,
      runs: [
        {
          ...sarif.runs[0]!,
          results: [
            {
              ...sarif.runs[0]!.results[0]!,
              message: { text: "The annotation includes secret-alpha." },
            },
          ],
        },
      ],
    } satisfies SurfaceSarifLog;
    const created: unknown[] = [];
    const exporter = createGitHubChecksExporter({
      owner: "surface",
      repo: "app",
      headSha: "abc123",
      redactionRules: exportRedactionRules,
      client: {
        checks: {
          create: (input) => {
            created.push(input);
            return Promise.resolve({ data: { id: 123 } });
          },
        },
      },
    });

    const result = await exporter.export({
      backlog,
      localArtifactPath: ".surface/reports/secret-beta.sarif",
      sarif: secretSarif,
    });

    expect(isOk(result)).toBe(true);
    expect(created).toHaveLength(1);
    expect(JSON.stringify(created[0])).not.toMatch(/secret-[a-z0-9-/.]+/);
    expect(JSON.stringify(created[0])).toContain(REDACTED_EXPORT_VALUE);
  });

  it("returns export_failed when GitHub rejects the check run", async () => {
    const exporter = createGitHubChecksExporter({
      owner: "surface",
      repo: "app",
      headSha: "abc123",
      client: {
        checks: {
          create: () =>
            Promise.reject(Object.assign(new Error("bad credentials"), { status: 401 })),
        },
      },
    });

    const result = await exporter.export({ backlog, sarif });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        kind: "IntegrationError",
      },
    });
  });
});
