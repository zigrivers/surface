import { describe, expect, it } from "vitest";

import { type Evidence, type Finding } from "./findings.js";
import {
  assignFindingIdentities,
  deriveFindingIdentity,
  deriveFindingIdentityCandidate,
  identityInternalsForTesting,
  matchFindingIdentity,
} from "./identity.js";

const baseFinding = {
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

type FindingOverrides = Omit<Partial<Finding>, "dimensions" | "location" | "evidence"> & {
  readonly dimensions?: Partial<Finding["dimensions"]>;
  readonly location?: Partial<Finding["location"]>;
  readonly evidence?: Finding["evidence"];
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
    evidence: overrides.evidence ?? baseFinding.evidence,
  };
}

function stableIdentityKeyFor(
  findingId: string,
  assignments = assignFindingIdentities([baseFinding]),
) {
  return stableAssignmentFor(findingId, assignments).identity.identityKey;
}

function stableAssignmentFor(
  findingId: string,
  assignments = assignFindingIdentities([baseFinding]),
) {
  const assignment = assignments.find((entry) => entry.findingId === findingId);

  if (assignment?.status !== "stable") {
    throw new Error(`Expected stable identity for ${findingId}`);
  }

  return assignment;
}

describe("finding identity", () => {
  it("prefers deterministic element refs over selectors and files", () => {
    const candidate = deriveFindingIdentityCandidate(baseFinding);

    expect(candidate).toMatchObject({
      lens: "accessibility",
      issueType: "contrast-insufficient",
      anchorKind: "element-ref",
      locationAnchor: "@e12",
    });
  });

  it("keeps the same identity when cosmetic or structural details drift but element ref is stable", () => {
    const previousIdentity = deriveFindingIdentity(baseFinding);
    const movedFinding = findingWith({
      id: "f_a2",
      title: "Primary CTA contrast is below AA",
      rationale: "Renested primary CTA still fails contrast.",
      location: {
        file: "src/Header.tsx",
        component: "HeaderCta",
        selector: "header .cta",
        elementRef: "@e12",
      },
    });

    const result = matchFindingIdentity(previousIdentity, movedFinding);

    expect(result).toMatchObject({
      status: "stable",
      currentFindingId: "f_a2",
      identity: {
        identityKey: previousIdentity.identityKey,
      },
    });
    expect(result.status === "stable" ? result.identity : undefined).toEqual(previousIdentity);
  });

  it("marks selector-only drift identity-broken instead of guessing a match", () => {
    const selectorOnly = findingWith({
      location: {
        file: "src/Button.tsx",
        component: "Button",
        selector: ".btn-primary",
        elementRef: undefined,
      },
    });
    const previousIdentity = deriveFindingIdentity(selectorOnly);
    const driftedSelector = findingWith({
      id: "f_a2",
      location: {
        file: "src/Button.tsx",
        component: "Button",
        selector: ".checkout-primary",
        elementRef: undefined,
      },
    });

    expect(matchFindingIdentity(previousIdentity, driftedSelector)).toMatchObject({
      status: "identity-broken",
      currentFindingId: "f_a2",
      reason: "anchor-drift",
      previousIdentity: {
        identityKey: previousIdentity.identityKey,
      },
    });
  });

  it("keeps identity stable across reordered run findings", () => {
    const focusFinding = findingWith({
      id: "f_focus",
      issueType: "focus-order",
      title: "Focus order skips checkout CTA",
      rationale: "Keyboard navigation jumps past checkout.",
      location: {
        file: "src/Checkout.tsx",
        component: "Checkout",
        selector: "#checkout",
        elementRef: "@e44",
      },
    });

    const firstRun = assignFindingIdentities([baseFinding, focusFinding]);
    const secondRun = assignFindingIdentities([focusFinding, baseFinding]);

    expect(stableIdentityKeyFor(baseFinding.id, firstRun)).toBe(
      stableIdentityKeyFor(baseFinding.id, secondRun),
    );
    expect(stableIdentityKeyFor(focusFinding.id, firstRun)).toBe(
      stableIdentityKeyFor(focusFinding.id, secondRun),
    );
  });

  it("marks coarse collisions with duplicate secondary anchors identity-broken", () => {
    const firstCollision = findingWith({
      id: "f_collision_a",
      title: "Hero button contrast fails AA",
      rationale: "Hero button foreground color is too light.",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const secondCollision = findingWith({
      id: "f_collision_b",
      title: "Footer link contrast fails AA",
      rationale: "Footer link foreground color is too light.",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });

    const firstOrder = assignFindingIdentities([secondCollision, firstCollision]);
    const secondOrder = assignFindingIdentities([firstCollision, secondCollision]);
    const firstAssignment = firstOrder.find((entry) => entry.findingId === firstCollision.id);
    const secondAssignment = secondOrder.find((entry) => entry.findingId === secondCollision.id);

    expect(firstAssignment).toMatchObject({
      findingId: "f_collision_a",
      status: "identity-broken",
      reason: "ambiguous-collision",
      candidate: {
        anchorKind: "file",
      },
    });
    expect(secondAssignment).toMatchObject({
      findingId: "f_collision_b",
      status: "identity-broken",
      reason: "ambiguous-collision",
      candidate: {
        anchorKind: "file",
      },
    });
    expect(firstOrder).toEqual(secondOrder);
    expect(stableIdentityKeyFor(firstCollision.id, assignFindingIdentities([firstCollision]))).toBe(
      deriveFindingIdentity(firstCollision).identityKey,
    );
    expect(
      matchFindingIdentity(deriveFindingIdentity(firstCollision), firstCollision),
    ).toMatchObject({
      status: "stable",
      identity: {
        identityKey: deriveFindingIdentity(firstCollision).identityKey,
      },
    });
  });

  it("disambiguates coarse collisions when stable secondary anchors differ", () => {
    const heroCollision = findingWith({
      id: "f_collision_hero",
      title: "Hero button contrast fails AA",
      rationale: "Hero button foreground color is too light.",
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
          selector: ".hero .btn-primary",
          elementRef: "@hero-cta",
        },
      ],
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const footerCollision = findingWith({
      id: "f_collision_footer",
      title: "Footer link contrast fails AA",
      rationale: "Footer link foreground color is too light.",
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: "3.2:1",
          threshold: "4.5:1",
        },
        {
          kind: "dom",
          selector: ".footer a",
          elementRef: "@footer-link",
        },
      ],
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });

    const firstOrder = assignFindingIdentities([footerCollision, heroCollision]);
    const secondOrder = assignFindingIdentities([heroCollision, footerCollision]);
    const heroAssignment = stableAssignmentFor(heroCollision.id, firstOrder);
    const footerAssignment = stableAssignmentFor(footerCollision.id, firstOrder);

    expect(heroAssignment).toMatchObject({
      status: "stable",
      reason: "disambiguated-collision",
      identity: {
        anchorKind: "file",
      },
    });
    expect(footerAssignment).toMatchObject({
      status: "stable",
      reason: "disambiguated-collision",
      identity: {
        anchorKind: "file",
      },
    });
    expect(heroAssignment.identity.discriminator).toMatch(/^sd_[0-9a-f]{64}$/);
    expect(footerAssignment.identity.discriminator).toMatch(/^sd_[0-9a-f]{64}$/);
    expect(stableIdentityKeyFor(heroCollision.id, firstOrder)).toBe(
      stableIdentityKeyFor(heroCollision.id, secondOrder),
    );
    expect(stableIdentityKeyFor(footerCollision.id, firstOrder)).toBe(
      stableIdentityKeyFor(footerCollision.id, secondOrder),
    );
    expect(stableIdentityKeyFor(heroCollision.id, firstOrder)).not.toBe(
      stableIdentityKeyFor(footerCollision.id, firstOrder),
    );
    expect(stableIdentityKeyFor(heroCollision.id, assignFindingIdentities([heroCollision]))).toBe(
      stableIdentityKeyFor(heroCollision.id, firstOrder),
    );
    expect(
      matchFindingIdentity(
        stableAssignmentFor(heroCollision.id, firstOrder).identity,
        findingWith({
          id: "f_collision_hero_changed",
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
              selector: ".hero .secondary",
              elementRef: "@hero-secondary",
            },
          ],
          location: heroCollision.location,
        }),
      ),
    ).toMatchObject({
      status: "identity-broken",
      reason: "anchor-drift",
    });
  });

  it("breaks coarse matches symmetrically when secondary anchors appear or disappear", () => {
    const withoutSecondaryAnchor = findingWith({
      id: "f_no_secondary",
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: "3.1:1",
          threshold: "4.5:1",
        },
      ],
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const withSecondaryAnchor = findingWith({
      id: "f_with_secondary",
      location: withoutSecondaryAnchor.location,
    });

    expect(
      matchFindingIdentity(deriveFindingIdentity(withoutSecondaryAnchor), withSecondaryAnchor),
    ).toMatchObject({
      status: "identity-broken",
      reason: "anchor-drift",
    });
    expect(
      matchFindingIdentity(deriveFindingIdentity(withSecondaryAnchor), withoutSecondaryAnchor),
    ).toMatchObject({
      status: "identity-broken",
      reason: "anchor-drift",
    });
  });

  it("marks precise same-anchor collisions identity-broken instead of minting transient keys", () => {
    const firstCollision = findingWith({
      id: "f_precise_a",
      title: "Hero button contrast fails AA",
      rationale: "Hero button foreground color is too light.",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: ".hero button",
        elementRef: undefined,
      },
    });
    const secondCollision = findingWith({
      id: "f_precise_b",
      title: "Hero button focus outline is missing",
      rationale: "Hero button focus indication is not visible.",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: ".hero button",
        elementRef: undefined,
      },
    });

    expect(assignFindingIdentities([firstCollision, secondCollision])).toEqual([
      expect.objectContaining({
        findingId: "f_precise_a",
        status: "identity-broken",
        reason: "ambiguous-collision",
      }),
      expect.objectContaining({
        findingId: "f_precise_b",
        status: "identity-broken",
        reason: "ambiguous-collision",
      }),
    ]);
  });

  it("keeps coarse-anchor identity stable when evidence order changes", () => {
    const fileOnly = findingWith({
      id: "f_file_order_a",
      title: "Button contrast is below AA 🚀",
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: "3.1:1",
          threshold: undefined,
        },
        {
          kind: "dom",
          selector: ".btn-primary",
          elementRef: "@e12",
        },
      ],
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const reorderedEvidence = findingWith({
      id: "f_file_order_b",
      title: "BUTTON CONTRAST IS BELOW AA 🚀",
      evidence: [
        {
          kind: "dom",
          selector: ".btn-primary",
          elementRef: "@e12",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: "3.1:1",
          threshold: undefined,
        },
      ],
      location: {
        file: "SRC/HOME.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
      suggestedPatch: {
        kind: "contrast-hex",
        change: "#6b7280 -> #111827",
      },
    });

    expect(deriveFindingIdentity(fileOnly).identityKey).toBe(
      deriveFindingIdentity(reorderedEvidence).identityKey,
    );
  });

  it("keeps v1 identity hashes stable for canonical anchor cases", () => {
    const elementRefIdentity = deriveFindingIdentity(baseFinding);
    const selectorIdentity = deriveFindingIdentity(
      findingWith({
        location: {
          file: "src/Button.tsx",
          component: "Button",
          selector: ".btn-primary",
          elementRef: undefined,
        },
      }),
    );
    const componentIdentity = deriveFindingIdentity(
      findingWith({
        location: {
          file: "src/Button.tsx",
          component: "Button",
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );
    const fileIdentity = deriveFindingIdentity(
      findingWith({
        location: {
          file: "src/Button.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );

    expect(elementRefIdentity.identityKey).toBe(
      "ik_edb34c973916c27b8b037d322b715fb008bd3fb3ccc00289e9b95b2db0050724",
    );
    expect(selectorIdentity.identityKey).toBe(
      "ik_eac5f53e9edc67094de8af83017aea0ba02de2617a877e175e48f1c520e50b74",
    );
    expect(componentIdentity.identityKey).toBe(
      "ik_efeb79b2f85b4fad5731d9b56183afb0a23c29c3d938fd0e8065a48e92f0e7df",
    );
    expect(fileIdentity.identityKey).toBe(
      "ik_d3c0b3f2b5138d0c5ffc25fd0c85195310422465df4784308b361dd919a1ee4e",
    );
  });

  it("locks canonical JSON and anchor normalization edge cases used by v1 hashing", () => {
    const objectWithHiddenProperty = { visible: "yes" };
    Object.defineProperty(objectWithHiddenProperty, "hidden", {
      enumerable: false,
      value: "no",
    });

    expect(
      identityInternalsForTesting.canonicalJson({
        z: undefined,
        a: new Date("2026-01-02T03:04:05.000Z"),
        n: Number.NaN,
        nested: {
          b: 2,
          a: {
            toJSON: () => ({
              y: 2,
              x: 1,
            }),
          },
        },
        hidden: objectWithHiddenProperty,
      }),
    ).toBe(
      '{"a":"2026-01-02T03:04:05.000Z","hidden":{"visible":"yes"},"n":null,"nested":{"a":{"x":1,"y":2},"b":2}}',
    );
    expect(identityInternalsForTesting.canonicalJson([undefined, null])).toBe(
      '[{"$undefined":true},null]',
    );
    expect(
      identityInternalsForTesting.canonicalJson(
        Object.assign(["raw"], {
          toJSON: () => ["json"],
        }),
      ),
    ).toBe('["json"]');
    const circularValue: { self?: unknown } = {};
    circularValue.self = circularValue;

    expect(() => identityInternalsForTesting.canonicalJson(circularValue)).toThrow(
      /circular structures/,
    );
    expect(identityInternalsForTesting.normalizeAnchorForKind("file", " SRC\\Button.tsx ")).toBe(
      "src/button.tsx",
    );
    expect(identityInternalsForTesting.normalizeAnchorForKind("file", "src/a  b.tsx")).not.toBe(
      identityInternalsForTesting.normalizeAnchorForKind("file", "src/a b.tsx"),
    );
    expect(identityInternalsForTesting.normalizeAnchorForKind("component", " PrimaryButton ")).toBe(
      "primarybutton",
    );
    expect(identityInternalsForTesting.normalizeAnchorForKind("selector", " .PrimaryButton ")).toBe(
      ".PrimaryButton",
    );
    expect(
      identityInternalsForTesting.stableEvidenceAnchor({
        kind: "dom",
        elementRef: "@e1",
      } as Evidence),
    ).toEqual({
      kind: "dom",
      elementRef: "@e1",
      selector: "",
    });
  });

  it("normalizes lens and issue type while encoding component anchors unambiguously", () => {
    const normalized = deriveFindingIdentityCandidate(
      findingWith({
        lens: " Accessibility ",
        issueType: " Contrast-Insufficient ",
        location: {
          file: "src/Widget#A.tsx",
          component: "Button#Primary",
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );
    const equivalent = deriveFindingIdentityCandidate(
      findingWith({
        lens: "accessibility",
        issueType: "contrast-insufficient",
        location: {
          file: "src/Widget#A.tsx",
          component: "Button#Primary",
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );

    expect(normalized).toMatchObject({
      lens: "accessibility",
      issueType: "contrast-insufficient",
      anchorKind: "component",
      locationAnchor: '["component","src/widget#a.tsx","button#primary"]',
    });
    expect(normalized).toEqual(equivalent);
  });

  it("keeps selector case significant while folding file and component context", () => {
    const upperSelector = deriveFindingIdentityCandidate(
      findingWith({
        id: "f_selector_upper",
        location: {
          file: "src/Widget.tsx",
          component: "Widget",
          selector: ".Button",
          elementRef: undefined,
        },
      }),
    );
    const lowerSelector = deriveFindingIdentityCandidate(
      findingWith({
        id: "f_selector_lower",
        location: {
          file: "src/Widget.tsx",
          component: "Widget",
          selector: ".button",
          elementRef: undefined,
        },
      }),
    );
    const componentOnly = deriveFindingIdentityCandidate(
      findingWith({
        id: "f_component_only",
        location: {
          file: undefined,
          component: "PrimaryButton",
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );
    const componentOnlyCaseVariant = deriveFindingIdentity(
      findingWith({
        id: "f_component_only_case",
        location: {
          file: undefined,
          component: "primarybutton",
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );

    expect(upperSelector.locationAnchor).toBe('["selector","src/widget.tsx","widget",".Button"]');
    expect(lowerSelector.locationAnchor).toBe('["selector","src/widget.tsx","widget",".button"]');
    expect(upperSelector.locationAnchor).not.toBe(lowerSelector.locationAnchor);
    expect(componentOnly).toMatchObject({
      anchorKind: "component",
      locationAnchor: '["component","primarybutton"]',
    });
    expect(
      deriveFindingIdentity(
        findingWith({
          id: "f_component_only",
          location: {
            file: undefined,
            component: "PrimaryButton",
            selector: undefined,
            elementRef: undefined,
          },
        }),
      ).identityKey,
    ).toBe(componentOnlyCaseVariant.identityKey);
  });

  it("normalizes path separators in file-backed anchors", () => {
    const posixFile = deriveFindingIdentity(
      findingWith({
        id: "f_posix_file",
        location: {
          file: "src/Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );
    const windowsFile = deriveFindingIdentity(
      findingWith({
        id: "f_windows_file",
        location: {
          file: "src\\Home.tsx",
          component: undefined,
          selector: undefined,
          elementRef: undefined,
        },
      }),
    );
    const posixSelector = deriveFindingIdentity(
      findingWith({
        id: "f_posix_selector",
        location: {
          file: "src/Home.tsx",
          component: "Home",
          selector: ".cta",
          elementRef: undefined,
        },
      }),
    );
    const windowsSelector = deriveFindingIdentity(
      findingWith({
        id: "f_windows_selector",
        location: {
          file: "src\\Home.tsx",
          component: "Home",
          selector: ".cta",
          elementRef: undefined,
        },
      }),
    );

    expect(posixFile.identityKey).toBe(windowsFile.identityKey);
    expect(posixSelector.identityKey).toBe(windowsSelector.identityKey);
  });

  it("scopes selector anchors by file and component context", () => {
    const firstButton = findingWith({
      id: "f_selector_checkout",
      location: {
        file: "src/Checkout.tsx",
        component: "Checkout",
        selector: ".btn-primary",
        elementRef: undefined,
      },
    });
    const secondButton = findingWith({
      id: "f_selector_header",
      location: {
        file: "src/Header.tsx",
        component: "Header",
        selector: ".btn-primary",
        elementRef: undefined,
      },
    });
    const assignments = assignFindingIdentities([firstButton, secondButton]);
    const firstIdentity = stableIdentityKeyFor(firstButton.id, assignments);
    const secondIdentity = stableIdentityKeyFor(secondButton.id, assignments);

    expect(firstIdentity).not.toBe(secondIdentity);
    expect(matchFindingIdentity(deriveFindingIdentity(firstButton), secondButton)).toMatchObject({
      status: "identity-broken",
      reason: "anchor-drift",
    });
  });

  it("preserves significant whitespace inside selector anchors", () => {
    const doubleSpaceSelector = deriveFindingIdentityCandidate(
      findingWith({
        id: "f_selector_double_space",
        location: {
          file: "src/Widget.tsx",
          component: "Widget",
          selector: '[aria-label="Foo  Bar"]',
          elementRef: undefined,
        },
      }),
    );
    const singleSpaceSelector = deriveFindingIdentityCandidate(
      findingWith({
        id: "f_selector_single_space",
        location: {
          file: "src/Widget.tsx",
          component: "Widget",
          selector: '[aria-label="Foo Bar"]',
          elementRef: undefined,
        },
      }),
    );

    expect(doubleSpaceSelector.locationAnchor).not.toBe(singleSpaceSelector.locationAnchor);
  });

  it("rejects duplicate finding ids in a single assignment run", () => {
    expect(() =>
      assignFindingIdentities([
        findingWith({ id: "f_duplicate" }),
        findingWith({
          id: "f_duplicate",
          issueType: "focus-order",
          location: {
            file: "src/Checkout.tsx",
            component: "Checkout",
            selector: "#checkout",
            elementRef: undefined,
          },
        }),
      ]),
    ).toThrow(/finding ids must be unique/);
  });

  it("rejects public inputs without a valid location anchor", () => {
    expect(() =>
      deriveFindingIdentityCandidate({
        ...baseFinding,
        location: {},
      }),
    ).toThrow();
  });

  it("keeps unique coarse collision members stable while duplicate secondary anchors break", () => {
    const firstDuplicate = findingWith({
      id: "f_mixed_duplicate_a",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const secondDuplicate = findingWith({
      id: "f_mixed_duplicate_b",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const uniqueSecondary = findingWith({
      id: "f_mixed_unique",
      evidence: [
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: "3.2:1",
          threshold: "4.5:1",
        },
        {
          kind: "dom",
          selector: ".footer a",
          elementRef: "@footer-link",
        },
      ],
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });

    expect(assignFindingIdentities([firstDuplicate, secondDuplicate, uniqueSecondary])).toEqual([
      expect.objectContaining({
        findingId: "f_mixed_duplicate_a",
        status: "identity-broken",
      }),
      expect.objectContaining({
        findingId: "f_mixed_duplicate_b",
        status: "identity-broken",
      }),
      expect.objectContaining({
        findingId: "f_mixed_unique",
        status: "stable",
        reason: "disambiguated-collision",
      }),
    ]);
  });

  it("marks same-anchor collisions with duplicate secondary anchors identity-broken", () => {
    const firstCollision = findingWith({
      id: "f_ambiguous_a",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const secondCollision = findingWith({
      id: "f_ambiguous_b",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });
    const distinctCollision = findingWith({
      id: "f_ambiguous_c",
      title: "Footer link contrast fails",
      rationale: "Footer link foreground color is too light.",
      location: {
        file: "src/Home.tsx",
        component: undefined,
        selector: undefined,
        elementRef: undefined,
      },
    });

    expect(assignFindingIdentities([firstCollision, secondCollision, distinctCollision])).toEqual([
      expect.objectContaining({
        findingId: "f_ambiguous_a",
        status: "identity-broken",
        reason: "ambiguous-collision",
      }),
      expect.objectContaining({
        findingId: "f_ambiguous_b",
        status: "identity-broken",
        reason: "ambiguous-collision",
      }),
      expect.objectContaining({
        findingId: "f_ambiguous_c",
        status: "identity-broken",
        reason: "ambiguous-collision",
      }),
    ]);
  });
});
