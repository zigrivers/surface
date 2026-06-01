// Acceptance skeletons — Epic E4: Output & Reporting (US-030..032).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFileStateStore,
  createFindingsJsonRenderer,
  createFindingsMarkdownRenderer,
  FindingsEnvelopeSchema,
  isOk,
  type Backlog,
  type Finding,
} from "../../packages/core/src/index.js";

const finding = {
  id: "f_accessibility_contrast",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Primary button contrast is below AA",
  rationale: "The primary button text is hard to read against the current background.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [
    {
      kind: "tool-result",
      tool: "axe",
      rule: "color-contrast",
      measuredValue: "3.1:1",
      threshold: "4.5:1",
    },
  ],
  dimensions: {
    severity: 0.8,
    confidence: 1,
    effort: 0.2,
    userImpact: 0.7,
    businessImpact: 0.5,
    a11yLegalRisk: 0.9,
    evidenceQuality: 1,
    agentImplementability: 0.9,
  },
  severityBand: "P1",
  location: {
    file: "src/Button.tsx",
    component: "Button",
    selector: ".btn-primary",
    elementRef: "@e12",
  },
  confidenceBand: "assert",
  gatedForHuman: false,
} satisfies Finding;

const backlog = {
  id: "bk_acceptance",
  runId: "run_acceptance",
  entries: [{ findingId: finding.id, priority: 0.7, rank: 1 }],
} satisfies Backlog;

describe("E4 Output & Reporting", () => {
  describe("US-030 human + machine artifacts [gate]", () => {
    it("[US-030][AC1] audit complete → findings.md (plain-language, evidence) + findings.json (stable IDs, documented schema) both produced (integration)", async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-reporting-"));

      try {
        const markdown = await createFindingsMarkdownRenderer().render([finding], backlog);
        const json = await createFindingsJsonRenderer({
          generatedAt: "2026-05-31T18:00:00.000Z",
        }).render([finding], backlog);

        expect(isOk(markdown)).toBe(true);
        expect(isOk(json)).toBe(true);

        if (!isOk(markdown) || !isOk(json)) {
          return;
        }

        const stateStore = createFileStateStore({ projectRoot });
        const markdownArtifact = await stateStore.writeArtifact({
          kind: "report",
          relativePath: "reports/findings.md",
          bytes: markdown.value.bytes,
        });
        const jsonArtifact = await stateStore.writeArtifact({
          kind: "report",
          relativePath: "reports/findings.json",
          bytes: json.value.bytes,
        });

        expect(isOk(markdownArtifact)).toBe(true);
        expect(isOk(jsonArtifact)).toBe(true);

        if (!isOk(markdownArtifact) || !isOk(jsonArtifact)) {
          return;
        }

        const markdownText = await readFile(
          path.join(projectRoot, markdownArtifact.value.path),
          "utf8",
        );
        const jsonText = await readFile(path.join(projectRoot, jsonArtifact.value.path), "utf8");
        const parsedJson = FindingsEnvelopeSchema.parse(JSON.parse(jsonText));

        expect(markdown.value).toMatchObject({ format: "findings-md", byteStable: true });
        expect(json.value).toMatchObject({ format: "findings-json", byteStable: true });
        expect(markdownArtifact.value.path).toBe(".surface/reports/findings.md");
        expect(jsonArtifact.value.path).toBe(".surface/reports/findings.json");
        expect(markdownText).toContain("Primary button contrast is below AA");
        expect(markdownText).toContain("The primary button text is hard to read");
        expect(markdownText).toContain("tool `axe`; rule `color-contrast`");
        expect(parsedJson.findings.map(({ id }) => id)).toEqual(["f_accessibility_contrast"]);
        expect(jsonText).not.toMatch(/overallScore|vanityScore|score/i);
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    });
  });
  describe("US-031 explain a finding to a non-designer [gate]", () => {
    it.skip("[US-031][AC1] `explain <id>` → plain-language rationale + cited heuristic + verifiable evidence (integration)", () => {});
    it.skip("[US-031][AC2] terminal output: no color-only meaning; ANSI-degradable; --json byte-stable (NFR-OWNOUT-1) (unit)", () => {});
  });
  describe("US-032 CI-native reporters: SARIF + PR annotations [committed]", () => {
    it.skip("[US-032][AC1] `--export sarif` → valid SARIF v2.1.0 (unit)", () => {});
    it.skip("[US-032][AC2] PR context + token → findings post as GitHub Checks/annotations; local artifacts remain source of truth (integration)", () => {});
  });
});
