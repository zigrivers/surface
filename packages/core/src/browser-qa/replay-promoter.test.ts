import { describe, expect, it, vi } from "vitest";

import { ok } from "../errors.js";
import { createReplayPromoter, type ReplayPromoterHarness } from "./replay-promoter.js";
import type { CandidateFinding, PromotedFindingSidecar } from "./schemas.js";

describe("ReplayPromoter", () => {
  it("promotes replayable candidates when the issue reproduces", async () => {
    const harness = makeReplayHarness({ reproduced: true });
    const promoter = createReplayPromoter(harness);

    const result = await promoter.replayCandidate("qfc_checkout", {
      promoteOnRepro: true,
      qaRunId: "qa_replay",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.gateEligible).toBe(true);
    expect(result.value.promotion?.findingId).toMatch(/^f_/);
    expect(result.value.replayStatus).toBe("reproduced");
    expect(harness.writtenPromotions[0]).toMatchObject({
      candidateFindingId: "qfc_checkout",
      evidenceBundleId: "ev_checkout",
      promotionSource: "replay",
      qaRunId: "qa_seed",
    });
    expect(result.value.trackedFinding?.identity.locationAnchor).toContain("/checkout");
    expect(result.value.trackedFinding?.identity.locationAnchor).toContain("Pay now");
    expect(result.value.trackedFinding?.identity.locationAnchor).toContain("@e12");
  });

  it("does not promote when replay passes cleanly", async () => {
    const harness = makeReplayHarness({ reproduced: false });
    const promoter = createReplayPromoter(harness);

    const result = await promoter.replayCandidate("qfc_checkout", {
      promoteOnRepro: true,
      qaRunId: "qa_replay_clean",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.replayStatus).toBe("not-reproduced");
    expect(result.value.promotion).toBeUndefined();
    expect(harness.writtenPromotions).toEqual([]);
  });

  it("records human verdict promotion as non-automated until replay confirms", async () => {
    const harness = makeReplayHarness({});
    const promoter = createReplayPromoter(harness);

    const result = await promoter.promoteCandidateByVerdict("qfc_checkout", {
      reason: "Confirmed during manual QA",
      verdictId: "verdict_manual",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value).toMatchObject({
      gateEligible: true,
      promotionSource: "human-verdict",
      replayStatus: "not-run",
    });
    expect(result.value.trackedFinding?.validation.expectation).toContain("manual QA");
    expect(harness.writtenPromotions[0]).toMatchObject({
      promotionSource: "human-verdict",
      reason: "Confirmed during manual QA",
    });
  });
});

function makeReplayHarness(options: { readonly reproduced?: boolean }): ReplayPromoterHarness & {
  readonly writtenCandidates: CandidateFinding[];
  readonly writtenPromotions: PromotedFindingSidecar[];
} {
  const writtenCandidates: CandidateFinding[] = [];
  const writtenPromotions: PromotedFindingSidecar[] = [];

  return {
    now: () => "2026-06-08T12:00:00.000Z",
    readCandidate: vi.fn<ReplayPromoterHarness["readCandidate"]>(() =>
      Promise.resolve(ok(makeCandidate())),
    ),
    replayCandidateCondition: vi.fn<ReplayPromoterHarness["replayCandidateCondition"]>(() =>
      Promise.resolve(ok({ reproduced: options.reproduced === true })),
    ),
    writeCandidate: vi.fn<ReplayPromoterHarness["writeCandidate"]>((candidate) => {
      writtenCandidates.push(candidate);
      return Promise.resolve(ok(candidate));
    }),
    writePromotedFinding: vi.fn<ReplayPromoterHarness["writePromotedFinding"]>((promotion) => {
      writtenPromotions.push(promotion);
      return Promise.resolve(ok(promotion));
    }),
    writtenCandidates,
    writtenPromotions,
  };
}

function makeCandidate(): CandidateFinding {
  return {
    actionPath: [
      {
        action: "open",
        url: "http://localhost:3000/checkout",
      },
      {
        action: "click",
        locator: { name: "Pay now", refHint: "@e12", role: "button" },
      },
    ],
    category: "functional",
    confidence: "candidate",
    evidenceBundleId: "ev_checkout",
    gateEligible: false,
    id: "qfc_checkout",
    identityConfidence: "medium",
    qaRunId: "qa_seed",
    replayStatus: "not-run",
    replayable: true,
    severity: "high",
    sourceRunManifestDigest: "sha256:abc123",
    title: "Checkout submit lacks payment validation feedback",
  };
}
