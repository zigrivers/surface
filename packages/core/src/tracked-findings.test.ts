import { describe, expect, it } from "vitest";

import { type Finding } from "./findings.js";
import { deriveFindingIdentity } from "./identity.js";
import {
  applyWaiversToTrackedFindings,
  createBaseline,
  createTrackedFinding,
  isWaiverActive,
  TrackedFindingSchema,
  transitionTrackedFinding,
} from "./tracked-findings.js";

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
} satisfies Finding;

const validation = {
  kind: "measured-rule",
  expectation: "axe color-contrast passes on @e12",
} as const;

function findingWith(overrides: Partial<Finding>): Finding {
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

describe("tracked finding state machine", () => {
  it("creates a tracked finding as new with matching identity and history", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });

    expect(tracked).toMatchObject({
      currentFindingId: "f_a1",
      firstSeenRunId: "run_001",
      gateDisposition: "active",
      history: [{ runId: "run_001", status: "new" }],
      lastSeenRunId: "run_001",
      status: "new",
      validation,
    });
    expect(tracked.identityKey).toBe(tracked.identity.identityKey);
  });

  it("transitions detected findings to still-failing and resolved findings to regressed", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const stillFailing = transitionTrackedFinding(tracked, {
      finding: findingWith({ id: "f_a2" }),
      kind: "detected",
      runId: "run_002",
    });
    const resolved = transitionTrackedFinding(stillFailing, {
      kind: "missing",
      runId: "run_003",
      validationPassed: true,
    });
    const regressed = transitionTrackedFinding(resolved, {
      finding: findingWith({ id: "f_a4" }),
      kind: "detected",
      runId: "run_004",
    });

    expect(stillFailing).toMatchObject({
      currentFindingId: "f_a2",
      lastSeenRunId: "run_002",
      status: "still-failing",
    });
    expect(stillFailing.identityKey).toBe(tracked.identityKey);
    expect(resolved).toMatchObject({
      currentFindingId: undefined,
      lastSeenRunId: "run_002",
      status: "resolved",
    });
    expect(regressed).toMatchObject({
      currentFindingId: "f_a4",
      lastSeenRunId: "run_004",
      status: "regressed",
    });
    expect(regressed.identityKey).toBe(tracked.identityKey);
    expect(regressed.history.map((entry) => entry.status)).toEqual([
      "new",
      "still-failing",
      "resolved",
      "regressed",
    ]);
  });

  it("never silently resolves an unmatchable identity", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const identityBroken = transitionTrackedFinding(tracked, {
      currentFindingId: "f_drifted",
      kind: "identity-broken",
      runId: "run_002",
    });

    expect(identityBroken).toMatchObject({
      currentFindingId: "f_drifted",
      status: "identity-broken",
      history: [
        { runId: "run_001", status: "new" },
        { runId: "run_002", status: "identity-broken" },
      ],
    });
  });

  it("keeps still-failing when missing validation still fails", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const stillFailing = transitionTrackedFinding(tracked, {
      kind: "missing",
      runId: "run_002",
      validationPassed: false,
    });

    expect(stillFailing).toMatchObject({
      currentFindingId: undefined,
      lastSeenRunId: "run_001",
      status: "still-failing",
    });
    expect(stillFailing.identityKey).toBe(tracked.identityKey);
  });

  it("transitions directly from new to resolved when first recheck is missing and validated", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const resolved = transitionTrackedFinding(tracked, {
      kind: "missing",
      runId: "run_002",
      validationPassed: true,
    });

    expect(resolved).toMatchObject({
      lastSeenRunId: "run_001",
      status: "resolved",
    });
    expect(resolved.history.map((entry) => entry.status)).toEqual(["new", "resolved"]);
  });

  it("rejects resolved tracked findings with a current finding id", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const resolved = transitionTrackedFinding(tracked, {
      kind: "missing",
      runId: "run_002",
      validationPassed: true,
    });

    expect(() =>
      TrackedFindingSchema.parse({
        ...resolved,
        currentFindingId: "f_stale",
      }),
    ).toThrow(/resolved tracked findings must not have a currentFindingId/);
  });

  it("marks validation-only failures after resolved as regressed", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const resolved = transitionTrackedFinding(tracked, {
      kind: "missing",
      runId: "run_002",
      validationPassed: true,
    });
    const regressed = transitionTrackedFinding(resolved, {
      kind: "missing",
      runId: "run_003",
      validationPassed: false,
    });

    expect(regressed).toMatchObject({
      lastSeenRunId: "run_001",
      status: "regressed",
    });
    expect(regressed.history.map((entry) => entry.status)).toEqual([
      "new",
      "resolved",
      "regressed",
    ]);
  });

  it("allows identity-broken findings to be detected again with the same identity", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const identityBroken = transitionTrackedFinding(tracked, {
      currentFindingId: "f_drifted",
      kind: "identity-broken",
      runId: "run_002",
    });
    const stillFailing = transitionTrackedFinding(identityBroken, {
      finding: findingWith({ id: "f_a3" }),
      kind: "detected",
      runId: "run_003",
    });

    expect(stillFailing).toMatchObject({
      currentFindingId: "f_a3",
      status: "still-failing",
    });
    expect(stillFailing.history.map((entry) => entry.status)).toEqual([
      "new",
      "identity-broken",
      "still-failing",
    ]);
  });

  it("transitions identity-broken to still-failing, not resolved, when validation fails", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const identityBroken = transitionTrackedFinding(tracked, {
      kind: "identity-broken",
      runId: "run_002",
    });
    const stillFailing = transitionTrackedFinding(identityBroken, {
      kind: "missing",
      runId: "run_003",
      validationPassed: false,
    });

    expect(stillFailing).toMatchObject({
      status: "still-failing",
      lastSeenRunId: "run_001",
    });
    expect(stillFailing.history.map((entry) => entry.status)).toEqual([
      "new",
      "identity-broken",
      "still-failing",
    ]);
  });

  it("keeps identity-broken from silently resolving when missing validation passes", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const identityBroken = transitionTrackedFinding(tracked, {
      kind: "identity-broken",
      runId: "run_002",
    });
    const stillIdentityBroken = transitionTrackedFinding(identityBroken, {
      kind: "missing",
      runId: "run_003",
      validationPassed: true,
    });

    expect(stillIdentityBroken).toMatchObject({
      status: "identity-broken",
      lastSeenRunId: "run_001",
    });
    expect(stillIdentityBroken.history.map((entry) => entry.status)).toEqual([
      "new",
      "identity-broken",
      "identity-broken",
    ]);
  });

  it("regresses after an identity-broken observation when the last stable state was resolved", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const resolved = transitionTrackedFinding(tracked, {
      kind: "missing",
      runId: "run_002",
      validationPassed: true,
    });
    const identityBroken = transitionTrackedFinding(resolved, {
      kind: "identity-broken",
      runId: "run_003",
    });
    const regressed = transitionTrackedFinding(identityBroken, {
      finding: findingWith({ id: "f_a4" }),
      kind: "detected",
      runId: "run_004",
    });

    expect(regressed).toMatchObject({
      currentFindingId: "f_a4",
      status: "regressed",
      lastSeenRunId: "run_004",
    });
    expect(regressed.history.map((entry) => entry.status)).toEqual([
      "new",
      "resolved",
      "identity-broken",
      "regressed",
    ]);
  });

  it("keeps repeated detected observations still-failing with a stable identity", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const first = transitionTrackedFinding(tracked, {
      finding: findingWith({ id: "f_a2" }),
      kind: "detected",
      runId: "run_002",
    });
    const second = transitionTrackedFinding(first, {
      finding: findingWith({ id: "f_a3" }),
      kind: "detected",
      runId: "run_003",
    });

    expect(second.status).toBe("still-failing");
    expect(second.identityKey).toBe(tracked.identityKey);
    expect(second.history.map((entry) => entry.status)).toEqual([
      "new",
      "still-failing",
      "still-failing",
    ]);
  });

  it("rejects duplicate history run ids", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });

    expect(() =>
      transitionTrackedFinding(tracked, {
        finding: findingWith({ id: "f_a2" }),
        kind: "detected",
        runId: "run_001",
      }),
    ).toThrow(/history runId values must be unique/);
  });

  it("rejects detected transitions for a different identity", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });
    const differentFinding = findingWith({
      id: "f_different",
      issueType: "focus-order",
      location: {
        file: "src/Button.tsx",
        component: "Button",
        selector: ".btn-primary",
        elementRef: "@e99",
      },
    });

    expect(() =>
      transitionTrackedFinding(tracked, {
        finding: differentFinding,
        kind: "detected",
        runId: "run_002",
      }),
    ).toThrow(/identityKey must match/);
  });

  it("rejects explicit identities that do not belong to the supplied finding", () => {
    const identity = deriveFindingIdentity(baseFinding);
    const corruptedIdentity = {
      ...identity,
      lens: "performance",
    };
    const differentFinding = findingWith({
      id: "f_different",
      issueType: "focus-order",
      location: {
        file: "src/Button.tsx",
        component: "Button",
        selector: ".btn-primary",
        elementRef: "@e99",
      },
    });

    expect(() =>
      createTrackedFinding({
        finding: differentFinding,
        identity,
        runId: "run_001",
        validation,
      }),
    ).toThrow(/explicit identity must match/);

    expect(() =>
      createTrackedFinding({
        finding: baseFinding,
        identity: corruptedIdentity,
        runId: "run_001",
        validation,
      }),
    ).toThrow(/explicit identity must match/);

    const tracked = createTrackedFinding({
      finding: baseFinding,
      runId: "run_001",
      validation,
    });

    expect(() =>
      transitionTrackedFinding(tracked, {
        finding: differentFinding,
        identity,
        kind: "detected",
        runId: "run_002",
      }),
    ).toThrow(/explicit identity must match/);

    expect(() =>
      transitionTrackedFinding(tracked, {
        finding: findingWith({ id: "f_a2" }),
        identity: corruptedIdentity,
        kind: "detected",
        runId: "run_003",
      }),
    ).toThrow(/explicit identity must match/);
  });

  it("accepts an explicit matching identity for create and detected transitions", () => {
    const identity = deriveFindingIdentity(baseFinding);
    const tracked = createTrackedFinding({
      finding: baseFinding,
      identity,
      runId: "run_001",
      validation,
    });
    const stillFailing = transitionTrackedFinding(tracked, {
      finding: findingWith({ id: "f_a2" }),
      identity,
      kind: "detected",
      runId: "run_002",
    });

    expect(tracked.identity).toEqual(identity);
    expect(stillFailing.identityKey).toBe(identity.identityKey);
    expect(stillFailing.status).toBe("still-failing");
  });

  it("keeps gate disposition orthogonal to detection status", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      gateDisposition: "ignored-by-waiver",
      runId: "run_001",
      validation,
    });
    const stillFailing = transitionTrackedFinding(tracked, {
      finding: findingWith({ id: "f_a2" }),
      kind: "detected",
      runId: "run_002",
    });

    expect(stillFailing).toMatchObject({
      gateDisposition: "ignored-by-waiver",
      status: "still-failing",
    });
  });

  it("snapshots baseline identity keys with waivers defaulted", () => {
    const baseline = createBaseline({
      baselineId: "baseline_001",
      identityKeys: ["identity_a", "identity_b"],
      reason: "accepted current debt",
    });

    expect(baseline).toEqual({
      baselineId: "baseline_001",
      identityKeys: ["identity_a", "identity_b"],
      reason: "accepted current debt",
      waivers: [],
    });
  });

  it("rejects duplicate baseline identity keys", () => {
    expect(() =>
      createBaseline({
        baselineId: "baseline_001",
        identityKeys: ["identity_a", "identity_a"],
      }),
    ).toThrow(/baseline identityKeys must be unique/);
  });

  it("applies active waivers without changing detection status or history", () => {
    const tracked = transitionTrackedFinding(
      createTrackedFinding({
        finding: baseFinding,
        runId: "run_001",
        validation,
      }),
      {
        finding: findingWith({ id: "f_a2" }),
        kind: "detected",
        runId: "run_002",
      },
    );

    const [waived] = applyWaiversToTrackedFindings({
      trackedFindings: [tracked],
      waivers: [
        {
          expiry: "2026-06-03T00:00:00.000Z",
          findingIdentityKey: tracked.identityKey,
          owner: "design-system",
          reason: "accepted temporarily",
        },
      ],
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(waived).toMatchObject({
      gateDisposition: "ignored-by-waiver",
      status: "still-failing",
    });
    expect(waived?.history).toEqual(tracked.history);
  });

  it("reactivates expired waivers while preserving the latest detection status", () => {
    const tracked = createTrackedFinding({
      finding: baseFinding,
      gateDisposition: "ignored-by-waiver",
      runId: "run_001",
      validation,
    });
    const regressed = transitionTrackedFinding(
      transitionTrackedFinding(tracked, {
        kind: "missing",
        runId: "run_002",
        validationPassed: true,
      }),
      {
        finding: findingWith({ id: "f_a3" }),
        kind: "detected",
        runId: "run_003",
      },
    );

    const [reactivated] = applyWaiversToTrackedFindings({
      trackedFindings: [regressed],
      waivers: [
        {
          expiry: "2026-06-01T00:00:00.000Z",
          findingIdentityKey: regressed.identityKey,
          owner: "design-system",
          reason: "accepted temporarily",
        },
      ],
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(reactivated).toMatchObject({
      gateDisposition: "active",
      status: "regressed",
    });
    expect(reactivated?.history.map((entry) => entry.status)).toEqual([
      "new",
      "resolved",
      "regressed",
    ]);
  });

  it("treats waivers as active until their expiry is passed", () => {
    const waiver = {
      expiry: "2026-06-02T00:00:00.000Z",
      findingIdentityKey: "identity_a",
      owner: "design-system",
      reason: "accepted temporarily",
    };

    expect(isWaiverActive(waiver, "2026-06-02T00:00:00.000Z")).toBe(true);
    expect(isWaiverActive(waiver, "2026-06-02T00:00:00.001Z")).toBe(false);
  });
});
