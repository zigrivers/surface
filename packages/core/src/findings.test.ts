import { describe, expect, it } from "vitest";

import {
  DimensionsSchema,
  FindingDraftSchema,
  FindingSchema,
  FindingsEnvelopeSchema,
  LocationSchema,
  ToolResultEvidenceSchema,
  scoreFinding,
  type Finding,
  type FindingDraft,
} from "./findings.js";

const validFinding = {
  id: "f_a1",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Button contrast is below AA",
  rationale: "Primary button contrast is insufficient against its background.",
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

const validMeasuredDraft = {
  draftId: "draft_contrast_1",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Button contrast is below AA",
  rationale: "Primary button contrast is insufficient against its background.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [validFinding.evidence[0]!],
  rawDimensions: {
    severity: 0.76,
    confidence: 1,
    effort: 0.2,
    userImpact: 0.7,
    businessImpact: 0.5,
    a11yLegalRisk: 0.9,
    evidenceQuality: 1,
    agentImplementability: 0.9,
  },
  location: validFinding.location,
  suggestedPatch: validFinding.suggestedPatch,
} satisfies FindingDraft;

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

describe("scoreFinding", () => {
  it("derives dimensions, severity band, and confidence band from a measured draft", () => {
    const result = scoreFinding(validMeasuredDraft);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toMatchObject({
      id: validMeasuredDraft.draftId,
      dimensions: validMeasuredDraft.rawDimensions,
      severityBand: "P1",
      confidenceBand: "assert",
      gatedForHuman: false,
      suggestedPatch: validMeasuredDraft.suggestedPatch,
    });
  });

  it("surfaces medium-confidence judged findings as questions, not mandates", () => {
    const judgedDraft = {
      draftId: "draft_empty_state_1",
      lens: "heuristics",
      issueType: "empty-state-recovery",
      method: "judged",
      title: "Empty state lacks recovery guidance",
      rationale: "The empty state does not give users a next step.",
      citedHeuristics: ["kb_empty_state"],
      evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
      rawDimensions: {
        severity: 0.55,
        confidence: 0.6,
        userImpact: 0.7,
      },
      location: { component: "EmptyState" },
    } satisfies FindingDraft;

    const result = scoreFinding(judgedDraft);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.confidenceBand).toBe("surface-as-question");
    expect(result.value.gatedForHuman).toBe(false);
    expect(result.value.suggestedPatch).toBeUndefined();
  });

  it("derives P0 severity and suppress-unless-deep confidence bands", () => {
    const result = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_p0_low_confidence_1",
      rawDimensions: {
        ...validMeasuredDraft.rawDimensions,
        severity: 0.96,
        confidence: 0.2,
      },
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.severityBand).toBe("P0");
    expect(result.value.confidenceBand).toBe("suppress-unless-deep");
  });

  it("gates meaning, brand, copy, and critical-flow findings for human review", () => {
    const criticalFlowDraft = {
      ...validMeasuredDraft,
      draftId: "draft_checkout_flow_1",
      issueType: "critical-flow-checkout-friction",
      title: "Checkout payment copy creates uncertainty",
      rationale: "The proposed change alters checkout payment copy in a conversion flow.",
      rawDimensions: {
        ...validMeasuredDraft.rawDimensions,
        severity: 0.4,
      },
    } satisfies FindingDraft;

    const result = scoreFinding(criticalFlowDraft);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.gatedForHuman).toBe(true);
  });

  it("gates high-severity judged findings even when the text is not a gated category", () => {
    const severeJudgedDraft = {
      draftId: "draft_navigation_1",
      lens: "heuristics",
      issueType: "navigation-dead-end",
      method: "judged",
      title: "Primary task has no clear next step",
      rationale: "Users cannot discover the next action after the task completes.",
      citedHeuristics: ["kb_task_clarity"],
      evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_task_clarity" }],
      rawDimensions: {
        severity: 0.78,
        confidence: 0.82,
      },
      location: { component: "TaskSummary" },
    } satisfies FindingDraft;

    const result = scoreFinding(severeJudgedDraft);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.severityBand).toBe("P1");
    expect(result.value.gatedForHuman).toBe(true);
  });

  it("gates structured brand and conversion lenses even without trigger words in copy", () => {
    const result = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_brand_lens_1",
      lens: "brand",
      issueType: "tone-mismatch",
      title: "Tone mismatch in account panel",
      rationale: "The proposed adjustment affects product voice.",
      rawDimensions: {
        ...validMeasuredDraft.rawDimensions,
        severity: 0.3,
      },
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.gatedForHuman).toBe(true);
  });

  it("gates common copy and wording changes for human review", () => {
    const result = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_button_copy_1",
      issueType: "clarity",
      title: "Button copy lacks clarity",
      rationale: "The proposed label wording changes the visible button text.",
      rawDimensions: {
        ...validMeasuredDraft.rawDimensions,
        severity: 0.3,
      },
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.gatedForHuman).toBe(true);
  });

  it("returns a SurfaceError result for drafts that fail finding invariants", () => {
    const result = scoreFinding({
      ...validMeasuredDraft,
      evidence: [{ kind: "dom", selector: ".btn-primary" }],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "finding_draft_invalid",
        kind: "StateError",
      },
    });
  });

  it("returns an error result for invalid scoring policy", () => {
    const result = scoreFinding(validMeasuredDraft, {
      confidenceCutoffs: {
        assert: 0.4,
        question: 0.6,
      },
      severityCutoffs: {
        P0: 0.95,
        P1: 0.75,
        P2: 0.45,
        P3: 0,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "finding_score_failed",
        kind: "StateError",
      },
    });
  });

  it("ignores undefined dimension overrides instead of throwing", () => {
    const result = scoreFinding({
      ...validMeasuredDraft,
      rawDimensions: {
        ...validMeasuredDraft.rawDimensions,
        severity: undefined,
      },
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.dimensions.severity).toBe(0.5);
  });
});
