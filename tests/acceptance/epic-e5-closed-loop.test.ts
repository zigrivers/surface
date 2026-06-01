// Acceptance skeletons — Epic E5: Closed Loop, State & Baselines (US-040..042).
import { describe, expect, it } from "vitest";

import {
  assignFindingIdentities,
  deriveFindingIdentity,
  matchFindingIdentity,
  type Finding,
} from "../../packages/core/src/index.js";

const identityFinding = {
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

function findingWith(overrides: Partial<Finding>): Finding {
  return {
    ...identityFinding,
    ...overrides,
    dimensions: {
      ...identityFinding.dimensions,
      ...overrides.dimensions,
    },
    location: {
      ...identityFinding.location,
      ...overrides.location,
    },
  } as Finding;
}

type StableAssignment = Extract<
  ReturnType<typeof assignFindingIdentities>[number],
  { status: "stable" }
>;

function expectStableAssignment(
  assignment: ReturnType<typeof assignFindingIdentities>[number] | undefined,
): StableAssignment {
  expect(assignment).toMatchObject({ status: "stable" });

  if (assignment?.status === "stable") {
    return assignment;
  }

  throw new Error("Expected stable identity assignment");
}

describe("E5 Closed Loop, State & Baselines", () => {
  describe("US-040 stable finding identity across re-runs [gate]", () => {
    it("[US-040][AC1] identity-drift corpus keeps stable anchors and breaks unmatchable anchors (unit)", () => {
      const previousIdentity = deriveFindingIdentity(identityFinding);
      const movedWithElementRef = findingWith({
        id: "f_a2",
        location: {
          file: "src/Header.tsx",
          component: "Header",
          selector: "header .primary",
          elementRef: "@e12",
        },
      });
      const selectorOnly = findingWith({
        id: "f_selector",
        location: {
          file: "src/Button.tsx",
          component: "Button",
          selector: ".btn-primary",
          elementRef: undefined,
        },
      });
      const previousSelectorIdentity = deriveFindingIdentity(selectorOnly);
      const selectorDrift = findingWith({
        id: "f_selector_drift",
        location: {
          file: "src/Button.tsx",
          component: "Button",
          selector: ".checkout-primary",
          elementRef: undefined,
        },
      });
      const collisionA = findingWith({
        id: "f_collision_a",
        title: "Hero contrast fails",
        location: {
          file: "src/Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      });
      const collisionB = findingWith({
        id: "f_collision_b",
        title: "Hero contrast fails",
        location: {
          file: "src/Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      });
      const fileOnlyStable = findingWith({
        id: "f_file_only_stable",
        title: "Hero contrast fails",
        rationale: "Hero foreground color is too light.",
        location: {
          file: "src/Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      });
      const fileOnlyCosmeticDrift = findingWith({
        id: "f_file_only_stable_rerun",
        title: "Hero CTA contrast still fails",
        rationale: "The updated copy still describes the same anchored defect.",
        location: {
          file: "src/Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      });

      expect(matchFindingIdentity(previousIdentity, movedWithElementRef)).toMatchObject({
        status: "stable",
        identity: {
          identityKey: previousIdentity.identityKey,
        },
      });
      expect(matchFindingIdentity(previousSelectorIdentity, selectorDrift)).toMatchObject({
        status: "identity-broken",
        reason: "anchor-drift",
      });
      expect(assignFindingIdentities([movedWithElementRef]).map((entry) => entry.status)).toEqual([
        "stable",
      ]);
      expect(
        assignFindingIdentities([collisionA, collisionB]).map((entry) => entry.status),
      ).toEqual(["identity-broken", "identity-broken"]);

      const singletonRun = assignFindingIdentities([fileOnlyStable]);
      const singletonIdentity = expectStableAssignment(
        singletonRun.find((entry) => entry.findingId === fileOnlyStable.id),
      );

      expect(matchFindingIdentity(singletonIdentity.identity, fileOnlyCosmeticDrift)).toMatchObject(
        {
          status: "stable",
          identity: {
            identityKey: singletonIdentity.identity.identityKey,
          },
        },
      );
    });

    it.skip("[US-040][AC1] unchanged defect → same id, still-failing; fixed → resolved; reappeared → regressed; unmatchable anchor → identity-broken (never silent resolved) (integration)", () => {});
  });
  describe("US-041 concurrency-safe, resumable state [gate]", () => {
    it.skip("[US-041][AC1] two overlapping runs → state access locked; neither corrupts the store (integration)", () => {});
    it.skip("[US-041][AC2] interrupted run → re-invoke resumes from currentStage, not half-written (integration)", () => {});
  });
  describe("US-042 baseline & waivers [committed]", () => {
    it.skip("[US-042][AC1] `surface baseline` → snapshot; `gate` thereafter fails only on net-new/expired findings (integration)", () => {});
    it.skip("[US-042][AC2] waiver with expiry → on expiry the finding re-activates; gateDisposition returns to active (unit)", () => {});
  });
});
