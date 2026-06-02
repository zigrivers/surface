import { describe, expect, it } from "vitest";

import { createSurfaceError, err, isErr, isOk, ok } from "./errors.js";
import { FindingsEnvelopeSchema, type Backlog, type Finding } from "./findings.js";
import {
  createExplainJsonRenderer,
  createExplainMarkdownRenderer,
  createFindingsJsonRenderer,
  createFindingsMarkdownRenderer,
  createSarifRenderer,
  defaultPlanningReportArtifactSpecs,
  SurfaceSarifLogSchema,
} from "./report-renderers.js";
import type { KnowledgeSource } from "./interfaces.js";

const textDecoder = new TextDecoder();

const findingA = {
  id: "f_a",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Primary button contrast is below AA",
  rationale: "The primary button text is difficult to read against its background.",
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

const findingB = {
  ...findingA,
  id: "f_b",
  issueType: "ambiguous-label",
  method: "judged",
  title: "<script>alert(1)</script> Icon-only action lacks a clear label",
  rationale: "The control purpose is not obvious\nfrom the visible affordance.",
  citedHeuristics: ["kb_nielsen_match"],
  evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_nielsen_match" }],
  severityBand: "P2",
  location: { file: "src/IconButton.tsx", selector: ".icon`button" },
} satisfies Finding;

const findingC = {
  ...findingA,
  id: "f_c",
  issueType: "secondary-spacing",
  title: "Secondary spacing issue is informational",
  rationale: "This finding is not part of the prioritized backlog.",
  severityBand: "P3",
  location: { file: "src/Card.tsx", selector: ".card" },
} satisfies Finding;

const backlog = {
  id: "bk_run_123",
  runId: "run_123",
  entries: [
    { findingId: "f_b", priority: 0.6, rank: 1 },
    { findingId: "f_a", priority: 0.5, rank: 2 },
  ],
} satisfies Backlog;

const knowledge = {
  query: () => ok([]),
  resolve: (id) =>
    ok({
      id,
      title: "WCAG contrast minimum",
      category: "accessibility",
      summary: "Text contrast needs to meet AA thresholds.",
      deepGuidance: "Compare foreground and background colors against WCAG thresholds.",
      citation: {
        source: "WCAG 2.2 Success Criterion 1.4.3",
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

describe("report renderers", () => {
  it("renders byte-stable findings.json ordered by backlog rank", async () => {
    const renderer = createFindingsJsonRenderer({
      generatedAt: "2026-05-31T18:00:00.000Z",
      degradation: { skippedLenses: ["performance"], reason: "lighthouse unavailable" },
    });

    const first = await renderer.render([findingA, findingB], backlog);
    const second = await renderer.render([findingA, findingB], backlog);

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);

    if (!isOk(first) || !isOk(second)) {
      return;
    }

    expect(first.value).toMatchObject({
      format: "findings-json",
      byteStable: true,
    });
    expect(first.value.bytes).toEqual(second.value.bytes);

    const parsed = FindingsEnvelopeSchema.parse(JSON.parse(textDecoder.decode(first.value.bytes)));
    expect(parsed).toMatchObject({
      schemaVersion: "1.0",
      runId: "run_123",
      generatedAt: "2026-05-31T18:00:00.000Z",
      degradation: { skippedLenses: ["performance"], reason: "lighthouse unavailable" },
    });
    expect(parsed.findings.map((finding) => finding.id)).toEqual(["f_b", "f_a"]);
    expect(textDecoder.decode(first.value.bytes)).not.toMatch(/overallScore|vanityScore|score/i);
  });

  it("renders findings.md with plain-language rationale and evidence", async () => {
    const renderer = createFindingsMarkdownRenderer();
    const result = await renderer.render([findingA, findingB], backlog);

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const markdown = textDecoder.decode(result.value.bytes);
    expect(result.value).toMatchObject({
      format: "findings-md",
      byteStable: true,
    });
    expect(markdown).toContain("# Surface Findings");
    expect(markdown).toContain(
      "## 1. [P2] &lt;script&gt;alert\\(1\\)&lt;/script&gt; Icon\\-only action lacks a clear label",
    );
    expect(markdown).toContain("Rationale:");
    expect(markdown).toContain("The control purpose is not obvious\nfrom the visible affordance.");
    expect(markdown).toContain("Evidence:");
    expect(markdown).toContain("selector `` .icon`button ``");
    expect(markdown).toContain("heuristic `kb_nielsen_match`");
    expect(markdown).toContain("tool `axe`; rule `color-contrast`");
    expect(markdown).not.toMatch(/overall score|vanity score/i);
  });

  it("renders valid SARIF v2.1.0 with stable rules and results", async () => {
    const renderer = createSarifRenderer();
    const first = await renderer.render([findingA, findingB], backlog);
    const second = await renderer.render([findingA, findingB], backlog);

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);

    if (!isOk(first) || !isOk(second)) {
      return;
    }

    expect(first.value).toMatchObject({ byteStable: true, format: "sarif" });
    expect(first.value.bytes).toEqual(second.value.bytes);

    const sarif = SurfaceSarifLogSchema.parse(JSON.parse(textDecoder.decode(first.value.bytes)));
    expect(sarif).toMatchObject({
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "surface" } },
          automationDetails: { id: "run_123" },
        },
      ],
    });
    expect(sarif.runs[0]?.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "ambiguous-label",
      "contrast-insufficient",
    ]);
    expect(sarif.runs[0]?.results.map((result) => result.ruleId)).toEqual([
      "ambiguous-label",
      "contrast-insufficient",
    ]);
    expect(sarif.runs[0]?.results[0]).toMatchObject({
      level: "warning",
      locations: [
        {
          physicalLocation: { artifactLocation: { uri: "src/IconButton.tsx" } },
        },
      ],
      partialFingerprints: { "surface.findingId": "f_b" },
    });
  });

  it("renders byte-stable backlog, agent-plan, and validation-report artifacts", async () => {
    const renderers = defaultPlanningReportArtifactSpecs().map((spec) => spec.renderer);

    for (const renderer of renderers) {
      const first = await renderer.render([findingA, findingB], backlog);
      const second = await renderer.render([findingA, findingB], backlog);

      expect(isOk(first)).toBe(true);
      expect(isOk(second)).toBe(true);

      if (!isOk(first) || !isOk(second)) {
        return;
      }

      const text = textDecoder.decode(first.value.bytes);
      expect(first.value).toMatchObject({ format: renderer.format, byteStable: true });
      expect(first.value.bytes).toEqual(second.value.bytes);
      expect(text).toContain("Run: `run_123`");
      expect(text).toContain("Primary button contrast is below AA");
      expect(text).toContain("Icon\\-only action lacks a clear label");
      expect(text).not.toMatch(/overall score|vanity score/i);
    }
  });

  it("limits planning artifacts to findings referenced by the backlog", async () => {
    const renderers = defaultPlanningReportArtifactSpecs().map((spec) => spec.renderer);

    for (const renderer of renderers) {
      const result = await renderer.render([findingA, findingB, findingC], backlog);

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        return;
      }

      const text = textDecoder.decode(result.value.bytes);
      expect(text).toContain("Primary button contrast is below AA");
      expect(text).toContain("Icon\\-only action lacks a clear label");
      expect(text).not.toContain("Secondary spacing issue is informational");
    }
  });

  it("returns an error when backlog entries reference missing findings", async () => {
    const renderer = createFindingsJsonRenderer({
      generatedAt: "2026-05-31T18:00:00.000Z",
    });
    const result = await renderer.render([findingA], backlog);

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "export_failed",
        kind: "IntegrationError",
      },
    });
  });

  it("renders byte-stable explain markdown and json with cited guidance and evidence", async () => {
    const markdownRenderer = createExplainMarkdownRenderer({
      findingId: findingA.id,
      knowledge,
    });
    const jsonRenderer = createExplainJsonRenderer({
      findingId: findingA.id,
      knowledge,
    });

    const firstMarkdown = await markdownRenderer.render([findingA], backlog);
    const secondMarkdown = await markdownRenderer.render([findingA], backlog);
    const firstJson = await jsonRenderer.render([findingA], backlog);
    const secondJson = await jsonRenderer.render([findingA], backlog);

    expect(isOk(firstMarkdown)).toBe(true);
    expect(isOk(secondMarkdown)).toBe(true);
    expect(isOk(firstJson)).toBe(true);
    expect(isOk(secondJson)).toBe(true);

    if (!isOk(firstMarkdown) || !isOk(secondMarkdown) || !isOk(firstJson) || !isOk(secondJson)) {
      return;
    }

    const markdown = textDecoder.decode(firstMarkdown.value.bytes);
    const json: unknown = JSON.parse(textDecoder.decode(firstJson.value.bytes));

    expect(firstMarkdown.value).toMatchObject({ format: "explain-md", byteStable: true });
    expect(firstJson.value).toMatchObject({ format: "explain-json", byteStable: true });
    expect(firstMarkdown.value.bytes).toEqual(secondMarkdown.value.bytes);
    expect(firstJson.value.bytes).toEqual(secondJson.value.bytes);
    expect(markdown).toContain("Why it matters:");
    expect(markdown).toContain("Evidence you can verify:");
    expect(markdown).toContain("tool `axe`; rule `color-contrast`");
    expect(markdown).toContain("WCAG contrast minimum");
    expect(markdown).not.toContain(`${String.fromCharCode(27)}[`);
    expect(json).toMatchObject({
      schemaVersion: "1.0",
      finding: { id: findingA.id },
      rationale: findingA.rationale,
      resolvedCitedHeuristics: [{ id: "kb_wcag_143" }],
      evidence: [{ kind: "tool-result" }],
    });
  });

  it("strips terminal control sequences from explain markdown", async () => {
    const escape = String.fromCharCode(27);
    const c1Csi = String.fromCharCode(0x9b);
    const c1Osc = String.fromCharCode(0x9d);
    const c1StringTerminator = String.fromCharCode(0x9c);
    const bell = String.fromCharCode(7);
    const ansiFinding = {
      ...findingA,
      title: `${c1Csi}31mPrimary button contrast is below AA`,
      rationale: `${escape}]8;;https://example.com${bell}The primary button text is difficult to read.${escape}]8;;${bell}`,
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: `${escape}[33m3.1:1`,
          threshold: "4.5:1",
        },
      ],
    } satisfies Finding;
    const ansiKnowledge = {
      query: () => ok([]),
      resolve: (id) =>
        ok({
          id,
          title: `${c1Osc}2;ignored${c1StringTerminator}WCAG contrast minimum`,
          summary: `${escape}[36mText contrast needs to meet AA thresholds.`,
          citation: {
            source: `${escape}[37mWCAG 2.2 Success Criterion 1.4.3`,
            retrievedAt: "2026-05-31T00:00:00.000Z",
          },
        }),
    } satisfies KnowledgeSource;

    const result = await createExplainMarkdownRenderer({
      findingId: ansiFinding.id,
      knowledge: ansiKnowledge,
    }).render([ansiFinding], backlog);

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const markdown = textDecoder.decode(result.value.bytes);

    expect(markdown).not.toContain(`${escape}[`);
    expect(markdown).not.toContain(`${escape}]`);
    expect(markdown).not.toContain(c1Csi);
    expect(markdown).not.toContain(c1Osc);
    expect(markdown).toContain("WCAG contrast minimum");
    expect(markdown).toContain("3.1:1");
  });

  it("strips terminal control sequences from explain json", async () => {
    const escape = String.fromCharCode(27);
    const c1Csi = String.fromCharCode(0x9b);
    const c1Osc = String.fromCharCode(0x9d);
    const c1StringTerminator = String.fromCharCode(0x9c);
    const controlledFinding = {
      ...findingA,
      title: `${c1Csi}31mPrimary button contrast is below AA`,
      rationale: `${escape}[32mThe primary button text is difficult to read.`,
    } satisfies Finding;
    const controlledKnowledge = {
      query: () => ok([]),
      resolve: (id) =>
        ok({
          id,
          title: `${c1Osc}2;ignored${c1StringTerminator}WCAG contrast minimum`,
          summary: `${escape}]8;;https://example.com${String.fromCharCode(7)}Text contrast needs to meet AA thresholds.${escape}]8;;${String.fromCharCode(7)}`,
          citation: {
            source: `${escape}[37mWCAG 2.2 Success Criterion 1.4.3`,
            retrievedAt: "2026-05-31T00:00:00.000Z",
          },
        }),
    } satisfies KnowledgeSource;

    const result = await createExplainJsonRenderer({
      findingId: controlledFinding.id,
      knowledge: controlledKnowledge,
    }).render([controlledFinding], backlog);

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    const jsonText = textDecoder.decode(result.value.bytes);
    const json: unknown = JSON.parse(jsonText);

    expect(jsonText).not.toContain(escape);
    expect(jsonText).not.toContain(c1Csi);
    expect(jsonText).not.toContain(c1Osc);
    expect(jsonText).toContain("Primary button contrast is below AA");
    expect(jsonText).toContain("WCAG contrast minimum");
    expect(json).toMatchObject({
      finding: { title: "Primary button contrast is below AA" },
      rationale: "The primary button text is difficult to read.",
      resolvedCitedHeuristics: [{ title: "WCAG contrast minimum" }],
    });
  });

  it("returns domain errors when explain cannot find a finding or cited heuristic", async () => {
    const missingFinding = await createExplainMarkdownRenderer({
      findingId: "missing",
      knowledge,
    }).render([findingA], backlog);
    const missingEvidenceFinding = {
      ...findingA,
      evidence: [],
    } as unknown as Finding;
    const missingEvidence = await createExplainMarkdownRenderer({
      findingId: missingEvidenceFinding.id,
      knowledge,
    }).render([missingEvidenceFinding], backlog);
    const missingHeuristic = await createExplainMarkdownRenderer({
      findingId: findingA.id,
      knowledge: {
        query: () => ok([]),
        resolve: () => err(createSurfaceError("finding_not_found", "not found")),
      },
    }).render([findingA], backlog);

    expect(isErr(missingFinding)).toBe(true);
    expect(isErr(missingEvidence)).toBe(true);
    expect(isErr(missingHeuristic)).toBe(true);
    expect(missingFinding).toMatchObject({ error: { code: "finding_not_found" } });
    expect(missingEvidence).toMatchObject({ error: { code: "evidence_missing" } });
    expect(missingHeuristic).toMatchObject({ error: { code: "config_invalid" } });
  });
});
