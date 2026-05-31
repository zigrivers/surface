import { describe, expect, it } from "vitest";

import {
  DimensionsSchema,
  FindingDraftSchema,
  FindingSchema,
  FindingsEnvelopeSchema,
  LocationSchema,
  ToolResultEvidenceSchema,
  type Finding,
} from "./findings.js";

const validFinding = {
  id: "f_a1",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Button contrast is below AA",
  rationale: "Primary button text has insufficient contrast against its background.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [
    {
      kind: "tool-result",
      tool: "axe",
      rule: "color-contrast",
      measuredValue: "3.1:1",
      threshold: "4.5:1",
    },
    {
      kind: "dom",
      selector: ".btn-primary",
      elementRef: "@e12",
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
  suggestedPatch: {
    kind: "contrast-hex",
    change: "#6b7280 -> #4b5563",
  },
} satisfies Finding;

describe("Finding schemas", () => {
  it("validates a structured, evidence-bearing finding and findings.json envelope", () => {
    expect(FindingSchema.parse(validFinding)).toEqual(validFinding);

    const measuredWithoutPatch = Object.fromEntries(
      Object.entries(validFinding).filter(([key]) => key !== "suggestedPatch"),
    );
    expect(FindingSchema.parse(measuredWithoutPatch)).toMatchObject({
      id: validFinding.id,
      method: "measured",
    });

    expect(() =>
      FindingsEnvelopeSchema.parse({
        schemaVersion: "1.0",
        runId: "run_123",
        generatedAt: "2026-05-31T18:00:00.000Z",
        findings: [validFinding],
        degradation: { skippedLenses: [], reason: null },
      }),
    ).not.toThrow();
  });

  it("rejects evidence-free findings and measured findings without tool-result evidence", () => {
    expect(() => FindingSchema.parse({ ...validFinding, evidence: [] })).toThrow();

    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        evidence: [{ kind: "dom", selector: ".btn-primary" }],
      }),
    ).toThrow(/tool-result/);
  });

  it("rejects judged findings with deterministic suggested patches", () => {
    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        method: "judged",
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
      }),
    ).toThrow(/suggestedPatch/);
  });

  it("rejects judged findings with tool-result evidence", () => {
    const judgedFindingWithToolEvidence = Object.fromEntries(
      Object.entries({
        ...validFinding,
        method: "judged",
        evidence: [
          validFinding.evidence[0],
          { kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" },
        ],
      }).filter(([key]) => key !== "suggestedPatch"),
    );

    expect(() => FindingSchema.parse(judgedFindingWithToolEvidence)).toThrow(/tool-result/);
  });

  it("validates judged findings without deterministic suggested patches", () => {
    const judgedFinding = Object.fromEntries(
      Object.entries({
        ...validFinding,
        method: "judged",
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
      }).filter(([key]) => key !== "suggestedPatch"),
    );

    const parsed = FindingSchema.parse(judgedFinding);
    expect(parsed.method).toBe("judged");
    expect(parsed.suggestedPatch).toBeUndefined();
  });

  it("rejects invalid schema boundaries and non-strict payloads", () => {
    expect(() => LocationSchema.parse({})).toThrow(/anchor/);
    expect(() => DimensionsSchema.parse({ ...validFinding.dimensions, severity: 1.5 })).toThrow();
    expect(() =>
      ToolResultEvidenceSchema.parse({
        ...validFinding.evidence[0],
        tool: "unknown",
      }),
    ).toThrow();
    expect(() => FindingSchema.parse({ ...validFinding, extra: true })).toThrow();
    expect(() => FindingSchema.parse({ ...validFinding, title: "   " })).toThrow(/whitespace/);
    expect(() =>
      FindingsEnvelopeSchema.parse({
        schemaVersion: "2.0",
        runId: "run_123",
        generatedAt: "not-a-date",
        findings: [validFinding],
        degradation: { skippedLenses: [], reason: null },
      }),
    ).toThrow();

    expect(() =>
      FindingSchema.parse({
        ...validFinding,
        method: "judged",
        citedHeuristics: [],
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
        suggestedPatch: undefined,
      }),
    ).toThrow(/cited heuristic/);

    expect(FindingSchema.safeParse({ ...validFinding, evidence: undefined }).success).toBe(false);
    expect(FindingSchema.safeParse({ ...validFinding, citedHeuristics: undefined }).success).toBe(
      false,
    );
  });

  it("validates finding drafts with partial dimensions and the same measured evidence invariant", () => {
    expect(
      FindingDraftSchema.parse({
        draftId: "draft_1",
        lens: "accessibility",
        issueType: "contrast-insufficient",
        method: "measured",
        title: "Button contrast is below AA",
        rationale: "Primary button text has insufficient contrast.",
        citedHeuristics: ["kb_wcag_143"],
        evidence: [validFinding.evidence[0]],
        rawDimensions: { severity: 0.8, confidence: 1 },
        location: validFinding.location,
        suggestedPatch: validFinding.suggestedPatch,
      }),
    ).toMatchObject({ draftId: "draft_1" });

    expect(
      FindingDraftSchema.parse({
        draftId: "draft_static_1",
        lens: "static-a11y",
        issueType: "interactive-element-label-missing",
        method: "measured",
        title: "Icon button has no accessible label",
        rationale: "A static a11y rule found a button with no accessible name.",
        citedHeuristics: ["kb_wcag_412"],
        evidence: [
          {
            kind: "tool-result",
            tool: "eslint-jsx-a11y",
            rule: "control-has-associated-label",
            measuredValue: "missing accessible label",
          },
        ],
        rawDimensions: { severity: 0.7 },
        location: { file: "src/IconButton.tsx", component: "IconButton" },
      }),
    ).toMatchObject({ draftId: "draft_static_1" });

    expect(() =>
      FindingDraftSchema.parse({
        draftId: "draft_2",
        lens: "accessibility",
        issueType: "contrast-insufficient",
        method: "measured",
        title: "Button contrast is below AA",
        rationale: "Primary button text has insufficient contrast.",
        citedHeuristics: ["kb_wcag_143"],
        evidence: [{ kind: "dom", selector: ".btn-primary" }],
        rawDimensions: { severity: 0.8 },
        location: validFinding.location,
      }),
    ).toThrow(/tool-result/);

    expect(() =>
      FindingDraftSchema.parse({
        draftId: "draft_3",
        lens: "heuristics",
        issueType: "empty-state-missing",
        method: "judged",
        title: "Empty state lacks recovery guidance",
        rationale: "The empty state does not give users a next step.",
        citedHeuristics: ["kb_empty_state"],
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
        rawDimensions: { severity: 0.6 },
        location: { component: "EmptyState" },
        suggestedPatch: validFinding.suggestedPatch,
      }),
    ).toThrow(/suggestedPatch/);

    expect(() =>
      FindingDraftSchema.parse({
        draftId: "draft_tool_judged",
        lens: "heuristics",
        issueType: "empty-state-missing",
        method: "judged",
        title: "Empty state lacks recovery guidance",
        rationale: "The empty state does not give users a next step.",
        citedHeuristics: ["kb_empty_state"],
        evidence: [
          validFinding.evidence[0],
          { kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" },
        ],
        rawDimensions: { severity: 0.6 },
        location: { component: "EmptyState" },
      }),
    ).toThrow(/tool-result/);

    expect(() =>
      FindingDraftSchema.parse({
        draftId: "draft_4",
        lens: "heuristics",
        issueType: "empty-state-missing",
        method: "judged",
        title: "Empty state lacks recovery guidance",
        rationale: "The empty state does not give users a next step.",
        citedHeuristics: [],
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
        rawDimensions: { severity: 0.6 },
        location: { component: "EmptyState" },
      }),
    ).toThrow(/cited heuristic/);
  });
});
