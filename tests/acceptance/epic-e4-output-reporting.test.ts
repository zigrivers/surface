// Acceptance skeletons — Epic E4: Output & Reporting (US-030..032).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSurfaceComposition,
  createFileStateStore,
  createExplainJsonRenderer,
  createExplainMarkdownRenderer,
  createFindingsJsonRenderer,
  createFindingsMarkdownRenderer,
  FindingsEnvelopeSchema,
  isOk,
  ok,
  renderAndWriteReportArtifacts,
  type Backlog,
  type Finding,
  type KnowledgeSource,
} from "../../packages/core/src/index.js";
import { runSurfaceCli } from "../../packages/cli/src/index.js";

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

const knowledge = {
  query: () => ok([]),
  resolve: (id) =>
    ok({
      id,
      title: "WCAG contrast minimum",
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
      appliesToAppTypes: ["generic"],
      appliesToLenses: ["accessibility"],
      steps: ["evaluate"],
      tags: ["contrast"],
    }),
} satisfies KnowledgeSource;

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
  describe("FR-OUT-1 backlog, agent plan, and validation report artifacts [gate]", () => {
    it("[FR-OUT-1][FR-PIPE-13] audit complete → backlog.md, agent-plan.md, validation-report.md are StateStore-written and byte-stable", async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "surface-reporting-extra-"));

      try {
        const stateStore = createFileStateStore({ projectRoot });
        const written = await renderAndWriteReportArtifacts({
          stateStore,
          findings: [finding],
          backlog,
        });

        expect(isOk(written)).toBe(true);

        if (!isOk(written)) {
          return;
        }

        const backlogArtifact = written.value.find(
          (entry) => entry.report.format === "backlog",
        )?.artifact;
        const agentPlanArtifact = written.value.find(
          (entry) => entry.report.format === "agent-plan",
        )?.artifact;
        const validationArtifact = written.value.find(
          (entry) => entry.report.format === "validation-report",
        )?.artifact;

        expect(backlogArtifact).toBeDefined();
        expect(agentPlanArtifact).toBeDefined();
        expect(validationArtifact).toBeDefined();

        if (
          backlogArtifact === undefined ||
          agentPlanArtifact === undefined ||
          validationArtifact === undefined
        ) {
          return;
        }

        const backlogText = await readFile(path.join(projectRoot, backlogArtifact.path), "utf8");
        const agentPlanText = await readFile(
          path.join(projectRoot, agentPlanArtifact.path),
          "utf8",
        );
        const validationText = await readFile(
          path.join(projectRoot, validationArtifact.path),
          "utf8",
        );

        expect(written.value.map((entry) => entry.report)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ format: "backlog", byteStable: true }),
            expect.objectContaining({ format: "agent-plan", byteStable: true }),
            expect.objectContaining({ format: "validation-report", byteStable: true }),
          ]),
        );
        expect(backlogArtifact.path).toBe(".surface/reports/backlog.md");
        expect(agentPlanArtifact.path).toBe(".surface/reports/agent-plan.md");
        expect(validationArtifact.path).toBe(".surface/reports/validation-report.md");
        expect(backlogText).toContain("Primary button contrast is below AA");
        expect(agentPlanText).toContain("agent-executable");
        expect(validationText).toContain("Status: not run");
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    });
  });
  describe("US-031 explain a finding to a non-designer [gate]", () => {
    it("[US-031][AC1] `explain <id>` → plain-language rationale + cited heuristic + verifiable evidence (integration)", async () => {
      const rendered = await createExplainMarkdownRenderer({
        findingId: finding.id,
        knowledge,
      }).render([finding], backlog);

      expect(isOk(rendered)).toBe(true);

      if (!isOk(rendered)) {
        return;
      }

      const text = new TextDecoder().decode(rendered.value.bytes);

      expect(text).toContain("Why it matters:");
      expect(text).toContain("The primary button text is hard to read");
      expect(text).toContain("WCAG contrast minimum");
      expect(text).toContain("tool `axe`; rule `color-contrast`");
      expect(text).toContain("Location:");
      expect(text).toContain("selector `.btn-primary`");
    });

    it("[US-031][AC2] terminal output: no color-only meaning; ANSI-degradable; --json byte-stable (NFR-OWNOUT-1) (unit)", async () => {
      const markdownFirst = await createExplainMarkdownRenderer({
        findingId: finding.id,
        knowledge,
      }).render([finding], backlog);
      const markdownSecond = await createExplainMarkdownRenderer({
        findingId: finding.id,
        knowledge,
      }).render([finding], backlog);
      const jsonFirst = await createExplainJsonRenderer({
        findingId: finding.id,
        knowledge,
      }).render([finding], backlog);
      const jsonSecond = await createExplainJsonRenderer({
        findingId: finding.id,
        knowledge,
      }).render([finding], backlog);

      expect(isOk(markdownFirst)).toBe(true);
      expect(isOk(markdownSecond)).toBe(true);
      expect(isOk(jsonFirst)).toBe(true);
      expect(isOk(jsonSecond)).toBe(true);

      if (!isOk(markdownFirst) || !isOk(markdownSecond) || !isOk(jsonFirst) || !isOk(jsonSecond)) {
        return;
      }

      const markdown = new TextDecoder().decode(markdownFirst.value.bytes);
      const json = JSON.parse(new TextDecoder().decode(jsonFirst.value.bytes));
      const cliStdout: string[] = [];
      const cliExitCode = await runSurfaceCli({
        argv: ["node", "surface", "explain", finding.id],
        composition: createSurfaceComposition({
          stateStore: {
            readState: () => ok({ findings: [finding], version: "1.0" }),
            writeArtifact: () =>
              Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
            writeState: (state) => ok(state),
          },
        }),
        io: { stdout: (chunk) => cliStdout.push(chunk) },
      });
      const cliText = cliStdout.join("");

      expect(markdownFirst.value.bytes).toEqual(markdownSecond.value.bytes);
      expect(jsonFirst.value.bytes).toEqual(jsonSecond.value.bytes);
      expect(markdown).not.toContain(`${String.fromCharCode(27)}[`);
      expect(markdown).toContain("Severity: P1");
      expect(markdown).toContain("Method: measured");
      expect(json).toMatchObject({
        schemaVersion: "1.0",
        finding: { id: "f_accessibility_contrast" },
        evidence: [{ kind: "tool-result" }],
      });
      expect(cliExitCode).toBe(0);
      expect(cliText).not.toContain(`${String.fromCharCode(27)}[`);
      expect(cliText).toContain("Finding: [P1] Primary button contrast is below AA");
      expect(cliText).toContain("Method: measured");
      expect(cliText).toContain("Why it matters: The primary button text is hard to read");
      expect(cliText).toContain("Evidence: 1 item");
    });
  });
  describe("US-032 CI-native reporters: SARIF + PR annotations [committed]", () => {
    it.skip("[US-032][AC1] `--export sarif` → valid SARIF v2.1.0 (unit)", () => {});
    it.skip("[US-032][AC2] PR context + token → findings post as GitHub Checks/annotations; local artifacts remain source of truth (integration)", () => {});
  });
});
