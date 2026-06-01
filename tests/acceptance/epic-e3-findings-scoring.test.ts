// Acceptance skeletons — Epic E3: Findings, Scoring & Trust (US-020..023).
import { describe, expect, it } from "vitest";

import {
  scoreFinding,
  synthesizeBacklog,
  type Finding,
  type FindingDraft,
} from "../../packages/core/src/findings.js";

describe("E3 Findings, Scoring & Trust", () => {
  describe("US-020 structured, evidence-bearing findings [gate]", () => {
    it.skip("[US-020][AC1] each finding validates against the Finding schema; findings.json parses without error (unit)", () => {});
  });
  describe("US-021 prioritized backlog with trust guards [gate]", () => {
    it("[US-021][AC1] backlog ordered by priority score; near-duplicates de-prioritized (MMR); no single headline score (unit)", () => {
      const baseFinding = {
        id: "f_base",
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
        ],
        dimensions: {
          severity: 0.8,
          confidence: 1,
          effort: 0.2,
          userImpact: 0.8,
          businessImpact: 0.7,
          a11yLegalRisk: 0.9,
          evidenceQuality: 1,
          agentImplementability: 0.9,
        },
        severityBand: "P1",
        location: { selector: ".btn-primary" },
        confidenceBand: "assert",
        gatedForHuman: false,
      } satisfies Finding;
      const duplicateFinding = {
        ...baseFinding,
        id: "f_duplicate",
        title: "Primary button contrast fails AA",
        dimensions: { ...baseFinding.dimensions, severity: 0.78 },
      } satisfies Finding;
      const distinctFinding = {
        ...baseFinding,
        id: "f_distinct",
        issueType: "focus-order-broken",
        title: "Checkout focus order blocks keyboard users",
        dimensions: {
          ...baseFinding.dimensions,
          severity: 0.7,
          effort: 0.25,
          a11yLegalRisk: 0.5,
        },
        location: { selector: "#checkout" },
      } satisfies Finding;

      const result = synthesizeBacklog("run_acceptance_1", [
        duplicateFinding,
        distinctFinding,
        baseFinding,
      ]);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.entries).toHaveLength(3);
      expect(result.value.entries[0]?.findingId).toBe(baseFinding.id);
      expect(
        result.value.entries.find((entry) => entry.findingId === duplicateFinding.id),
      ).toMatchObject({
        demotedAsDuplicateOf: baseFinding.id,
      });
      expect(result.value).not.toHaveProperty("overallScore");
    });
    it("[US-021][AC2] judged finding below confidence cutoff → surfaced as a question, not a mandate (unit)", () => {
      const draft = {
        draftId: "draft_empty_state_question",
        lens: "heuristics",
        issueType: "empty-state-guidance",
        method: "judged",
        title: "Empty state lacks recovery guidance",
        rationale: "The empty state does not give users a next step.",
        citedHeuristics: ["kb_empty_state"],
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_empty_state" }],
        rawDimensions: {
          severity: 0.55,
          confidence: 0.6,
        },
        location: { component: "EmptyState" },
      } satisfies FindingDraft;

      const result = scoreFinding(draft);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.confidenceBand).toBe("surface-as-question");
      expect(result.value.gatedForHuman).toBe(false);
    });
    it("[US-021][AC3] finding altering meaning/brand/critical-flow → gatedForHuman:true; never auto-executed (unit)", () => {
      const draft = {
        draftId: "draft_checkout_copy_gate",
        lens: "conversion",
        issueType: "critical-flow-checkout-copy",
        method: "measured",
        title: "Checkout payment copy creates uncertainty",
        rationale: "The proposed change alters checkout payment copy in a conversion flow.",
        citedHeuristics: ["kb_checkout_clarity"],
        evidence: [
          {
            kind: "tool-result",
            tool: "backend",
            rule: "conversion-path",
            measuredValue: "checkout step",
          },
        ],
        rawDimensions: {
          severity: 0.4,
          confidence: 1,
        },
        location: { selector: "[data-testid='checkout-payment']" },
      } satisfies FindingDraft;

      const result = scoreFinding(draft);

      expect(result.ok).toBe(true);

      if (!result.ok) {
        throw new Error(result.error.message);
      }

      expect(result.value.gatedForHuman).toBe(true);
    });
  });
  describe("US-022 deterministic fix snippets for measured findings [committed]", () => {
    it.skip("[US-022][AC1] measured finding with computable fix → suggestedPatch present; judged findings never get an auto patch (unit)", () => {});
  });
  describe("US-023 self-grounding accuracy & verdict loop [should]", () => {
    it.skip("[US-023][AC1] measured ground truth + human verdicts → surface reports its judged false-positive rate (integration)", () => {});
    it.skip("[US-023][AC2] `verdict <id> --reject --reason` → verdict persists and feeds future prioritization (integration)", () => {});
  });
});
