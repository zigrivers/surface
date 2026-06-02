import { describe, expect, it } from "vitest";

import { isOk } from "./errors.js";
import {
  createReconciliationService,
  ReconciliationInputSchema,
  type Finding,
} from "./reconciliation.js";

const baseFinding = {
  id: "f_codex_checkout_contrast",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "judged",
  title: "Checkout button contrast is below AA",
  rationale: "The primary checkout button text has insufficient contrast.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_wcag_143" }],
  dimensions: {
    severity: 0.82,
    confidence: 0.92,
    effort: 0.2,
    userImpact: 0.74,
    businessImpact: 0.9,
    a11yLegalRisk: 0.8,
    evidenceQuality: 0.86,
    agentImplementability: 0.72,
  },
  severityBand: "P1",
  location: {
    component: "CheckoutButton",
    selector: ".checkout-button",
  },
  confidenceBand: "assert",
  gatedForHuman: true,
} satisfies Finding;

type FindingOverrides = Omit<Partial<Finding>, "dimensions" | "location"> & {
  readonly dimensions?: Partial<Finding["dimensions"]>;
  readonly location?: Partial<Finding["location"]>;
};

function findingWith(overrides: FindingOverrides): Finding {
  return {
    ...baseFinding,
    ...overrides,
    dimensions: {
      ...baseFinding.dimensions,
      ...overrides.dimensions,
    },
    location: {
      ...baseFinding.location,
      ...overrides.location,
    },
  };
}

describe("ReconciliationService", () => {
  it("reconciles matching multi-model findings by highest confidence and records participants", () => {
    const service = createReconciliationService();
    const codexFinding = findingWith({
      id: "f_codex_checkout_contrast",
      dimensions: { confidence: 0.78 },
      title: "Checkout button contrast is weak",
    });
    const grokFinding = findingWith({
      id: "f_grok_checkout_contrast",
      dimensions: { confidence: 0.94 },
      title: "Checkout button contrast is below AA",
    });

    const result = service.reconcile({
      channels: [
        { id: "codex", status: "available", findings: [codexFinding] },
        { id: "grok", status: "available", findings: [grokFinding] },
      ],
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value.participatedChannels).toEqual(["codex", "grok"]);
    expect(result.value.unavailableChannels).toEqual([]);
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.findings[0]).toMatchObject({
      canonicalFindingId: "f_grok_checkout_contrast",
      confidence: 0.94,
      sourceFindingIds: ["f_codex_checkout_contrast", "f_grok_checkout_contrast"],
      supportingChannels: ["codex", "grok"],
    });
  });

  it("surfaces severity divergence as a question instead of a mandate", () => {
    const service = createReconciliationService();
    const p1Finding = findingWith({
      id: "f_codex_checkout_contrast",
      severityBand: "P1",
      dimensions: { severity: 0.82, confidence: 0.91 },
    });
    const p3Finding = findingWith({
      id: "f_gemini_checkout_contrast",
      severityBand: "P3",
      dimensions: { severity: 0.31, confidence: 0.89 },
    });

    const result = service.reconcile({
      channels: [
        { id: "codex", status: "available", findings: [p1Finding] },
        { id: "gemini", status: "available", findings: [p3Finding] },
      ],
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value.findings).toEqual([]);
    expect(result.value.questions).toHaveLength(1);
    expect(result.value.questions[0]).toMatchObject({
      kind: "severity-divergence",
      findingIds: ["f_codex_checkout_contrast", "f_gemini_checkout_contrast"],
      channelIds: ["codex", "gemini"],
    });
    expect(result.value.questions[0]?.prompt).toContain("CheckoutButton");
  });

  it("degrades to single-model output and records unavailable channels", () => {
    const service = createReconciliationService();

    const result = service.reconcile({
      channels: [
        { id: "codex", status: "available", findings: [baseFinding] },
        {
          id: "gemini",
          status: "unavailable",
          reason: "model_unavailable",
          message: "gemini CLI is not installed",
        },
      ],
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value.participatedChannels).toEqual(["codex"]);
    expect(result.value.unavailableChannels).toEqual([
      { id: "gemini", reason: "model_unavailable", message: "gemini CLI is not installed" },
    ]);
    expect(result.value.findings).toHaveLength(1);
    expect(result.value.questions).toEqual([]);
  });

  it("validates the reconciliation input boundary", () => {
    expect(
      ReconciliationInputSchema.safeParse({
        channels: [{ id: "codex", status: "available", findings: [baseFinding] }],
      }).success,
    ).toBe(true);
    expect(
      ReconciliationInputSchema.safeParse({
        channels: [{ id: "codex", status: "available", findings: [] }],
      }).success,
    ).toBe(false);
  });
});
