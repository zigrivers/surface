import { describe, expect, it } from "vitest";

import {
  BacklogSchema,
  DimensionsSchema,
  FindingDraftSchema,
  FindingSchema,
  FindingsEnvelopeSchema,
  LocationSchema,
  ToolResultEvidenceSchema,
  scoreFinding,
  synthesizeBacklog,
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

  it("generates deterministic suggested patches for computable measured drafts", () => {
    const contrast = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_generated_contrast_patch",
      suggestedPatch: undefined,
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: ".cta: foreground #9ca3af on background #ffffff has contrast 2.5:1",
          threshold: "4.5:1",
        },
      ],
      location: { selector: ".cta" },
    });
    const aria = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_generated_aria_patch",
      issueType: "accessible-name-missing",
      suggestedPatch: undefined,
      evidence: [
        {
          kind: "tool-result",
          tool: "eslint-jsx-a11y",
          rule: "control-has-associated-label",
          measuredValue: "button.icon missing accessible label",
        },
      ],
      location: { selector: "button.icon" },
    });
    const targetSize = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_generated_target_patch",
      issueType: "target-size",
      suggestedPatch: undefined,
      evidence: [
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "target-size",
          measuredValue: ".tap-target: 18px by 18px",
        },
      ],
      location: { selector: ".tap-target" },
    });
    const defaultThresholdContrast = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_generated_default_threshold_contrast_patch",
      suggestedPatch: undefined,
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: ".cta: foreground #9ca3af on background #ffffff has contrast 2.5:1",
        },
      ],
      location: { selector: ".cta" },
    });

    expect(contrast.ok).toBe(true);
    expect(aria.ok).toBe(true);
    expect(targetSize.ok).toBe(true);
    expect(defaultThresholdContrast.ok).toBe(true);

    if (!contrast.ok) {
      throw new Error(contrast.error.message);
    }

    if (!aria.ok) {
      throw new Error(aria.error.message);
    }

    if (!targetSize.ok) {
      throw new Error(targetSize.error.message);
    }

    if (!defaultThresholdContrast.ok) {
      throw new Error(defaultThresholdContrast.error.message);
    }

    expect(contrast.value.suggestedPatch).toMatchObject({ kind: "contrast-hex" });
    expect(contrast.value.suggestedPatch?.change).toContain("#9ca3af");
    expect(defaultThresholdContrast.value.suggestedPatch?.change).toContain("4.5:1");
    expect(aria.value.suggestedPatch).toEqual({
      kind: "aria-attribute",
      change: 'Add aria-label="<accessible name>" to button.icon.',
    });
    expect(targetSize.value.suggestedPatch).toEqual({
      kind: "target-size",
      change:
        "Set min-width and min-height to at least 44px for .tap-target; preserve spacing between adjacent targets.",
    });
  });

  it("does not generate suggested patches for judged or non-computable findings", () => {
    const judgedResult = scoreFinding({
      draftId: "draft_judged_no_generated_patch",
      lens: "heuristics",
      issueType: "accessible-name-missing",
      method: "judged",
      title: "Icon button label may be unclear",
      rationale: "The icon-only button may not communicate its purpose.",
      citedHeuristics: ["kb_wcag_412"],
      evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_wcag_412" }],
      rawDimensions: { severity: 0.55, confidence: 0.6 },
      location: { selector: "button.icon" },
    });
    const nonComputableResult = scoreFinding({
      ...validMeasuredDraft,
      draftId: "draft_non_computable_contrast_patch",
      suggestedPatch: undefined,
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: ".cta: contrast failed",
          threshold: "4.5:1",
        },
      ],
    });

    expect(judgedResult.ok).toBe(true);
    expect(nonComputableResult.ok).toBe(true);

    if (!judgedResult.ok || !nonComputableResult.ok) {
      throw new Error("expected scoring to succeed");
    }

    expect(judgedResult.value.suggestedPatch).toBeUndefined();
    expect(nonComputableResult.value.suggestedPatch).toBeUndefined();
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

describe("synthesizeBacklog", () => {
  const baseFinding = validFinding;

  type FindingOverrides = Omit<Partial<Finding>, "dimensions" | "location"> & {
    readonly dimensions?: Partial<Finding["dimensions"]>;
    readonly location?: Partial<Finding["location"]>;
  };

  function findingWith(overrides: FindingOverrides): Finding {
    return FindingSchema.parse({
      ...baseFinding,
      ...overrides,
      dimensions: {
        ...baseFinding.dimensions,
        ...overrides.dimensions,
      },
      location: overrides.location ?? baseFinding.location,
    });
  }

  it("orders backlog entries by internal priority without emitting a headline score", () => {
    const highPriority = findingWith({
      id: "f_high",
      issueType: "focus-order-broken",
      title: "Focus order blocks checkout",
      dimensions: {
        severity: 0.9,
        confidence: 0.95,
        effort: 0.2,
        userImpact: 0.9,
        businessImpact: 0.9,
        a11yLegalRisk: 0.7,
      },
      location: { selector: "#checkout" },
    });
    const lowPriority = findingWith({
      id: "f_low",
      issueType: "spacing-minor",
      title: "Card spacing is slightly uneven",
      dimensions: {
        severity: 0.3,
        confidence: 0.9,
        effort: 0.6,
        userImpact: 0.2,
        businessImpact: 0.2,
        a11yLegalRisk: 0,
      },
      location: { selector: ".card" },
    });

    const result = synthesizeBacklog("run_1", [lowPriority, highPriority]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.entries.map((entry) => entry.findingId)).toEqual(["f_high", "f_low"]);
    expect(result.value.entries.map((entry) => entry.rank)).toEqual([1, 2]);
    expect(result.value).not.toHaveProperty("overallScore");
    expect(result.value).not.toHaveProperty("score");
  });

  it("handles empty, single-finding, and priority-tie backlogs deterministically", () => {
    const emptyResult = synthesizeBacklog("run_empty", []);

    expect(emptyResult).toMatchObject({
      ok: true,
      value: {
        entries: [],
      },
    });

    const singleFinding = findingWith({ id: "f_single" });
    const singleResult = synthesizeBacklog("run_single", [singleFinding]);

    expect(singleResult.ok).toBe(true);

    if (!singleResult.ok) {
      throw new Error(singleResult.error.message);
    }

    expect(singleResult.value.entries).toHaveLength(1);
    expect(singleResult.value.entries[0]).toMatchObject({
      findingId: "f_single",
      priority: singleResult.value.entries[0]?.priority,
      rank: 1,
      title: singleFinding.title,
      rationale: singleFinding.rationale,
      location: singleFinding.location,
    });

    const tieA = findingWith({ id: "f_a", issueType: "layout-a", title: "Layout issue A" });
    const tieB = findingWith({ id: "f_b", issueType: "layout-b", title: "Layout issue B" });
    const tieResult = synthesizeBacklog("run_tie", [tieB, tieA]);

    expect(tieResult.ok).toBe(true);

    if (!tieResult.ok) {
      throw new Error(tieResult.error.message);
    }

    expect(tieResult.value.entries.map((entry) => entry.findingId)).toEqual(["f_a", "f_b"]);
  });

  it("demotes near-duplicate findings without dropping their evidence trail", () => {
    const firstDuplicate = findingWith({
      id: "f_primary_contrast",
      issueType: "contrast-insufficient",
      title: "Primary button contrast is below AA",
      dimensions: {
        severity: 0.9,
        confidence: 1,
        effort: 0.1,
        userImpact: 0.9,
        businessImpact: 0.9,
      },
      location: { selector: ".btn-primary" },
    });
    const nearDuplicate = findingWith({
      id: "f_primary_contrast_duplicate",
      issueType: "contrast-insufficient",
      title: "Primary button contrast fails AA",
      dimensions: {
        severity: 0.88,
        confidence: 1,
        effort: 0.1,
        userImpact: 0.9,
        businessImpact: 0.9,
      },
      location: { selector: ".btn-primary" },
    });
    const distinctFinding = findingWith({
      id: "f_focus_trap",
      issueType: "focus-trap",
      title: "Modal traps keyboard focus",
      dimensions: {
        severity: 0.7,
        confidence: 0.95,
        effort: 0.2,
        userImpact: 0.8,
        businessImpact: 0.6,
      },
      location: { selector: "#modal" },
    });

    const result = synthesizeBacklog("run_1", [nearDuplicate, distinctFinding, firstDuplicate]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.entries).toHaveLength(3);
    const canonicalEntry = result.value.entries.find(
      (entry) => entry.findingId === firstDuplicate.id,
    );
    const duplicateEntry = result.value.entries.find(
      (entry) => entry.findingId === nearDuplicate.id,
    );

    expect(duplicateEntry).toMatchObject({
      demotedAsDuplicateOf: firstDuplicate.id,
    });
    expect(duplicateEntry?.priority).toBeLessThan(canonicalEntry?.priority ?? 0);
    expect((duplicateEntry?.rank ?? 0) > (canonicalEntry?.rank ?? 0)).toBe(true);
  });

  it("demotes title-similar duplicates even when anchors differ", () => {
    const firstDuplicate = findingWith({
      id: "f_button_copy",
      issueType: "copy-clarity",
      title: "Primary button copy lacks clarity",
      location: { selector: ".hero button" },
    });
    const titleDuplicate = findingWith({
      id: "f_button_copy_other_anchor",
      issueType: "copy-clarity",
      title: "Primary button copy lacks clarity",
      location: { selector: ".checkout button" },
    });

    const result = synthesizeBacklog("run_1", [firstDuplicate, titleDuplicate]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(
      result.value.entries.find((entry) => entry.findingId === titleDuplicate.id),
    ).toMatchObject({
      demotedAsDuplicateOf: firstDuplicate.id,
    });
  });

  it("does not treat file-only anchors as precise duplicate locations", () => {
    const firstFinding = findingWith({
      id: "f_file_only_1",
      issueType: "contrast-insufficient",
      title: "Primary button contrast fails",
      location: { file: "src/App.tsx" },
    });
    const secondFinding = findingWith({
      id: "f_file_only_2",
      issueType: "contrast-insufficient",
      title: "Footer link contrast fails",
      location: { file: "src/App.tsx" },
    });

    const result = synthesizeBacklog("run_1", [firstFinding, secondFinding]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.entries).not.toContainEqual(
      expect.objectContaining({ demotedAsDuplicateOf: firstFinding.id }),
    );
    expect(result.value.entries).not.toContainEqual(
      expect.objectContaining({ demotedAsDuplicateOf: secondFinding.id }),
    );
  });

  it("does not demote title-similar findings without precise anchors", () => {
    const firstFinding = findingWith({
      id: "f_no_anchor_1",
      issueType: "contrast-insufficient",
      title: "Primary button contrast fails AA",
      location: { file: "src/App.tsx" },
    });
    const secondFinding = findingWith({
      id: "f_no_anchor_2",
      issueType: "contrast-insufficient",
      title: "Primary button contrast fails AA",
      location: { file: "src/App.tsx" },
    });

    const result = synthesizeBacklog("run_1", [firstFinding, secondFinding]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.entries).not.toContainEqual(
      expect.objectContaining({ demotedAsDuplicateOf: firstFinding.id }),
    );
    expect(result.value.entries).not.toContainEqual(
      expect.objectContaining({ demotedAsDuplicateOf: secondFinding.id }),
    );
  });

  it("points transitive duplicate chains at the canonical highest-priority root", () => {
    const canonical = findingWith({
      id: "f_chain_a",
      issueType: "copy-clarity",
      title: "Primary button copy lacks clarity",
      location: { selector: ".hero button" },
    });
    const firstDuplicate = findingWith({
      id: "f_chain_b",
      issueType: "copy-clarity",
      title: "Primary button copy lacks clarity",
      location: { selector: ".checkout button" },
    });
    const secondDuplicate = findingWith({
      id: "f_chain_c",
      issueType: "copy-clarity",
      title: "Primary button copy lacks clarity",
      location: { selector: ".settings button" },
    });

    const result = synthesizeBacklog("run_1", [canonical, firstDuplicate, secondDuplicate]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(
      result.value.entries.find((entry) => entry.findingId === firstDuplicate.id),
    ).toMatchObject({
      demotedAsDuplicateOf: canonical.id,
    });
    expect(
      result.value.entries.find((entry) => entry.findingId === secondDuplicate.id),
    ).toMatchObject({
      demotedAsDuplicateOf: canonical.id,
    });
  });

  it("validates backlog shape and rejects unordered or scalar-score payloads", () => {
    expect(() =>
      BacklogSchema.parse({
        id: "backlog_run_1",
        runId: "run_1",
        entries: [
          { findingId: "f_low", priority: 0.1, rank: 1 },
          { findingId: "f_high", priority: 0.9, rank: 2 },
        ],
      }),
    ).toThrow(/ordered/);

    expect(() =>
      BacklogSchema.parse({
        id: "backlog_run_1",
        runId: "run_1",
        entries: [],
        overallScore: 0.8,
      }),
    ).toThrow();

    expect(() =>
      BacklogSchema.parse({
        id: "backlog_run_1",
        runId: "run_1",
        entries: [
          { findingId: "f_duplicate", priority: 0.9, rank: 1 },
          { findingId: "f_duplicate", priority: 0.8, rank: 2 },
        ],
      }),
    ).toThrow(/unique/);
  });

  it("returns backlog-specific errors for invalid inputs", () => {
    expect(synthesizeBacklog("   ", [])).toMatchObject({
      ok: false,
      error: {
        code: "backlog_synthesis_failed",
        kind: "StateError",
      },
    });

    expect(
      synthesizeBacklog("run_1", [{ id: "not-a-finding" } as unknown as Finding]),
    ).toMatchObject({
      ok: false,
      error: {
        code: "backlog_synthesis_failed",
        kind: "StateError",
      },
    });

    expect(synthesizeBacklog("run_1", [baseFinding, baseFinding])).toMatchObject({
      ok: false,
      error: {
        code: "backlog_synthesis_failed",
        message: "Backlog findings contain duplicate IDs.",
        details: {
          duplicateIds: [baseFinding.id],
        },
      },
    });
  });

  it("sorts backlog rows with rounded priorities before validating order", () => {
    const firstFinding = findingWith({
      id: "f_close_a",
      issueType: "close-priority-a",
      title: "Close priority A",
      dimensions: {
        severity: 0.5000004,
        confidence: 1,
        effort: 1,
        userImpact: 1,
        businessImpact: 1,
        a11yLegalRisk: 0,
      },
      location: { selector: "#a" },
    });
    const secondFinding = findingWith({
      id: "f_close_b",
      issueType: "close-priority-b",
      title: "Close priority B",
      dimensions: {
        severity: 0.5000003,
        confidence: 1,
        effort: 1,
        userImpact: 1,
        businessImpact: 1,
        a11yLegalRisk: 0,
      },
      location: { selector: "#b" },
    });

    const result = synthesizeBacklog("run_close", [secondFinding, firstFinding]);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.entries.map((entry) => entry.priority)).toEqual([0.5, 0.5]);
    expect(result.value.entries.map((entry) => entry.findingId)).toEqual([
      "f_close_a",
      "f_close_b",
    ]);
  });
});
