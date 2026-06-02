// Acceptance skeletons — Epic E3: Findings, Scoring & Trust (US-020..023).
import { describe, expect, it } from "vitest";

import { createSurfaceComposition, ok } from "../../packages/core/src/index.js";
import { runSurfaceCli } from "../../packages/cli/src/index.js";
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
    it("[US-022][AC1] measured finding with computable fix → suggestedPatch present; judged findings never get an auto patch (unit)", () => {
      const contrastDraft = {
        draftId: "draft_contrast_patch",
        lens: "accessibility",
        issueType: "contrast-insufficient",
        method: "measured",
        title: "Button contrast is below AA",
        rationale: "Primary button text has insufficient contrast.",
        citedHeuristics: ["kb_wcag_143"],
        evidence: [
          {
            kind: "tool-result",
            tool: "axe",
            rule: "color-contrast",
            measuredValue: ".cta: foreground #9ca3af on background #ffffff has contrast 2.5:1",
            threshold: "4.5:1",
          },
        ],
        rawDimensions: { severity: 0.76, confidence: 1 },
        location: { selector: ".cta" },
      } satisfies FindingDraft;
      const ariaDraft = {
        draftId: "draft_aria_patch",
        lens: "accessibility",
        issueType: "accessible-name-missing",
        method: "measured",
        title: "Icon button has no accessible name",
        rationale: "A static a11y rule found a button with no accessible name.",
        citedHeuristics: ["kb_wcag_412"],
        evidence: [
          {
            kind: "tool-result",
            tool: "eslint-jsx-a11y",
            rule: "control-has-associated-label",
            measuredValue: "button.icon missing accessible label",
          },
        ],
        rawDimensions: { severity: 0.7 },
        location: { selector: "button.icon" },
      } satisfies FindingDraft;
      const targetSizeDraft = {
        draftId: "draft_target_size_patch",
        lens: "accessibility",
        issueType: "target-size",
        method: "measured",
        title: "Tap target is too small",
        rationale: "The tap target is smaller than the minimum recommended hit area.",
        citedHeuristics: ["kb_wcag_258"],
        evidence: [
          {
            kind: "tool-result",
            tool: "lighthouse",
            rule: "target-size",
            measuredValue: ".tap-target: 18px by 18px",
          },
        ],
        rawDimensions: { severity: 0.62 },
        location: { selector: ".tap-target" },
      } satisfies FindingDraft;
      const judgedDraft = {
        draftId: "draft_judged_no_patch",
        lens: "heuristics",
        issueType: "accessible-name-missing",
        method: "judged",
        title: "Icon button label may be unclear",
        rationale: "The icon-only button may not communicate its purpose.",
        citedHeuristics: ["kb_wcag_412"],
        evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_wcag_412" }],
        rawDimensions: { severity: 0.55, confidence: 0.6 },
        location: { selector: "button.icon" },
      } satisfies FindingDraft;

      const contrast = scoreFinding(contrastDraft);
      const aria = scoreFinding(ariaDraft);
      const targetSize = scoreFinding(targetSizeDraft);
      const judged = scoreFinding(judgedDraft);

      expect(contrast.ok).toBe(true);
      expect(aria.ok).toBe(true);
      expect(targetSize.ok).toBe(true);
      expect(judged.ok).toBe(true);

      if (!contrast.ok) {
        throw new Error(contrast.error.message);
      }

      if (!aria.ok) {
        throw new Error(aria.error.message);
      }

      if (!targetSize.ok) {
        throw new Error(targetSize.error.message);
      }

      if (!judged.ok) {
        throw new Error(judged.error.message);
      }

      expect(contrast.value.suggestedPatch).toMatchObject({
        kind: "contrast-hex",
      });
      expect(contrast.value.suggestedPatch?.change).toContain("#9ca3af");
      expect(contrast.value.suggestedPatch?.change).toContain("#ffffff");
      expect(aria.value.suggestedPatch).toEqual({
        kind: "aria-attribute",
        change: 'Add aria-label="<accessible name>" to button.icon.',
      });
      expect(targetSize.value.suggestedPatch).toEqual({
        kind: "target-size",
        change:
          "Set min-width and min-height to at least 44px for .tap-target; preserve spacing between adjacent targets.",
      });
      expect(judged.value.suggestedPatch).toBeUndefined();
    });
  });
  describe("US-023 self-grounding accuracy & verdict loop [should]", () => {
    it.skip("[US-023][AC1] measured ground truth + human verdicts → surface reports its judged false-positive rate (integration)", () => {});
    it("[US-023][AC2] `verdict <id> --reject --reason` → verdict persists and feeds future prioritization (integration)", async () => {
      const stdout: string[] = [];
      let state = {
        findings: [
          {
            citedHeuristics: ["kb_wcag_143"],
            evidence: [{ kind: "tool-result", rule: "color-contrast", tool: "axe" }],
            gatedForHuman: false,
            id: "finding_false_positive",
            method: "measured",
            rationale: "Reviewer confirmed this measured result is not applicable.",
            severityBand: "P1",
            title: "Button contrast is below AA",
          },
        ],
        version: "1.0",
      };
      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "verdict",
          "finding_false_positive",
          "--reject",
          "--reason",
          "False positive in dark theme override",
        ],
        composition: createSurfaceComposition({
          stateStore: {
            readState: () => ok(state),
            writeArtifact: () =>
              Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
            writeState: (nextState) => {
              state = nextState as typeof state;

              return ok(nextState);
            },
          },
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "verdict",
        data: {
          verdict: {
            decision: "reject",
            findingId: "finding_false_positive",
            rationale: "False positive in dark theme override",
          },
        },
        ok: true,
      });
      expect(state).toMatchObject({
        verdicts: [
          {
            decision: "reject",
            findingId: "finding_false_positive",
            rationale: "False positive in dark theme override",
          },
        ],
      });
    });
  });
});
