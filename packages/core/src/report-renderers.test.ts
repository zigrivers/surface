import { describe, expect, it } from "vitest";

import { FindingsEnvelopeSchema, type Backlog, type Finding } from "./findings.js";
import { isErr, isOk } from "./errors.js";
import {
  createFindingsJsonRenderer,
  createFindingsMarkdownRenderer,
  defaultPlanningReportArtifactSpecs,
} from "./report-renderers.js";

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
});
