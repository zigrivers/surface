import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import type { Finding } from "../findings.js";
import { createTrackedFinding, type TrackedFinding } from "../tracked-findings.js";
import { createCandidateVerdictPromotion } from "../verdicts.js";
import type {
  BrowserAction,
  CandidateFinding,
  EvidenceBundle,
  PromotedFindingSidecar,
  QaSeverity,
} from "./schemas.js";

export type ReplayCandidateContext = {
  readonly promoteOnRepro?: boolean;
  readonly qaRunId: string;
};

export type VerdictPromotionContext = {
  readonly reason: string;
  readonly verdictId: string;
};

export type ReplayConditionResult = {
  readonly evidenceBundleId?: string;
  readonly reproduced: boolean;
};

export type PromotedCandidateFinding = CandidateFinding & {
  readonly finding?: Finding;
  readonly promotedFinding?: PromotedFindingSidecar;
  readonly trackedFinding?: TrackedFinding;
};

export type ReplayPromoterHarness = {
  readonly now?: () => string;
  readonly readCandidate: (id: string) => Promise<Result<CandidateFinding, SurfaceError>>;
  readonly readEvidenceBundle?: (id: string) => Promise<Result<EvidenceBundle, SurfaceError>>;
  readonly replayCandidateCondition: (
    candidate: CandidateFinding,
    context: ReplayCandidateContext,
  ) => Promise<Result<ReplayConditionResult, SurfaceError>>;
  readonly writeCandidate: (
    candidate: CandidateFinding,
  ) => Promise<Result<CandidateFinding, SurfaceError>>;
  readonly writePromotedFinding: (
    promotion: PromotedFindingSidecar,
  ) => Promise<Result<PromotedFindingSidecar, SurfaceError>>;
  readonly writeTrackedFinding?: (
    trackedFinding: TrackedFinding,
    finding?: Finding,
  ) => Promise<Result<TrackedFinding, SurfaceError>>;
};

export type ReplayPromoter = {
  replayCandidate(
    id: string,
    context: ReplayCandidateContext,
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>>;
  promoteCandidateByVerdict(
    id: string,
    context: VerdictPromotionContext,
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>>;
};

class DefaultReplayPromoter implements ReplayPromoter {
  readonly #harness: ReplayPromoterHarness;

  constructor(harness: ReplayPromoterHarness) {
    this.#harness = harness;
  }

  async replayCandidate(
    id: string,
    context: ReplayCandidateContext,
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>> {
    const candidate = await this.#harness.readCandidate(id);
    if (!candidate.ok) {
      return candidate;
    }

    if (!candidate.value.replayable) {
      return this.#writeCandidate({
        ...candidate.value,
        replayStatus: "not-replayable",
      });
    }

    const replay = await this.#harness.replayCandidateCondition(candidate.value, context);
    if (!replay.ok) {
      return err(
        createSurfaceError("replay_failed", "Browser QA candidate replay failed.", {
          cause: replay.error,
          details: { candidateFindingId: candidate.value.id },
        }),
      );
    }

    if (!replay.value.reproduced) {
      return this.#writeCandidate({
        ...candidate.value,
        replayStatus: "not-reproduced",
      });
    }

    const reproducedCandidate: CandidateFinding = {
      ...candidate.value,
      confidence: "replayed",
      replayStatus: "reproduced",
    };

    if (context.promoteOnRepro !== true) {
      return this.#writeCandidate(reproducedCandidate);
    }

    return this.#promoteCandidate(reproducedCandidate, {
      promotionSource: "replay",
      qaRunId: context.qaRunId,
      reason: "Candidate issue reproduced during deterministic browser QA replay.",
    });
  }

  async promoteCandidateByVerdict(
    id: string,
    context: VerdictPromotionContext,
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>> {
    const candidate = await this.#harness.readCandidate(id);
    if (!candidate.ok) {
      return candidate;
    }

    const verdictPromotion = createCandidateVerdictPromotion({
      candidate: candidate.value,
      reason: context.reason,
      recordedAt: this.#now(),
      verdictId: context.verdictId,
    });

    if (!verdictPromotion.ok) {
      return verdictPromotion;
    }

    return this.#promoteCandidate(candidate.value, {
      promotionSource: "human-verdict",
      qaRunId: candidate.value.qaRunId,
      reason: verdictPromotion.value.reason,
    });
  }

  async #promoteCandidate(
    candidate: CandidateFinding,
    input: {
      readonly promotionSource: "replay" | "measurement" | "human-verdict";
      readonly qaRunId: string;
      readonly reason: string;
    },
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>> {
    const promotedAt = this.#now();
    const finding = findingForCandidate(candidate);
    const artifactChecksums = await this.#artifactChecksumsForCandidate(candidate);

    if (!artifactChecksums.ok) {
      return artifactChecksums;
    }

    const trackedFinding = createTrackedFinding({
      finding,
      runId: input.qaRunId,
      validation: {
        expectation:
          input.promotionSource === "human-verdict"
            ? `Confirmed by manual QA: ${input.reason}`
            : `Reproduce browser QA candidate ${candidate.id}`,
        kind: "re-evaluate-lens",
      },
    });
    const promotion: PromotedFindingSidecar = {
      artifactChecksums: artifactChecksums.value,
      candidateFindingId: candidate.id,
      evidenceBundleId: candidate.evidenceBundleId,
      findingId: finding.id,
      promotedAt,
      promotionSource: input.promotionSource,
      qaRunId: candidate.qaRunId,
      reason: input.reason,
      sourceRunManifestDigest: candidate.sourceRunManifestDigest,
    };
    const writtenPromotion = await this.#harness.writePromotedFinding(promotion);

    if (!writtenPromotion.ok) {
      return writtenPromotion;
    }

    if (this.#harness.writeTrackedFinding !== undefined) {
      const writtenTrackedFinding = await this.#harness.writeTrackedFinding(
        trackedFinding,
        finding,
      );
      if (!writtenTrackedFinding.ok) {
        return writtenTrackedFinding;
      }
    }

    const updatedCandidate: CandidateFinding = {
      ...candidate,
      gateEligible: true,
      promotion: {
        findingId: finding.id,
        promotedAt,
        reason: input.reason,
      },
      promotionSource: input.promotionSource,
      ...(input.promotionSource === "replay" ? { confidence: "replayed" as const } : {}),
    };
    const writtenCandidate = await this.#harness.writeCandidate(updatedCandidate);

    if (!writtenCandidate.ok) {
      return writtenCandidate;
    }

    return ok({
      ...writtenCandidate.value,
      finding,
      promotedFinding: writtenPromotion.value,
      trackedFinding,
    });
  }

  #writeCandidate(
    candidate: CandidateFinding,
  ): Promise<Result<PromotedCandidateFinding, SurfaceError>> {
    return this.#harness.writeCandidate(candidate);
  }

  #now(): string {
    return this.#harness.now?.() ?? new Date().toISOString();
  }

  async #artifactChecksumsForCandidate(
    candidate: CandidateFinding,
  ): Promise<Result<Record<string, string>, SurfaceError>> {
    if (this.#harness.readEvidenceBundle === undefined) {
      return ok({});
    }

    const bundle = await this.#harness.readEvidenceBundle(candidate.evidenceBundleId);
    if (!bundle.ok) {
      return bundle;
    }

    if (
      bundle.value.qaRunId !== candidate.qaRunId ||
      bundle.value.id !== candidate.evidenceBundleId
    ) {
      return err(
        createSurfaceError("promotion_rejected", "Candidate evidence ownership is invalid.", {
          details: {
            candidateFindingId: candidate.id,
            evidenceBundleId: candidate.evidenceBundleId,
          },
        }),
      );
    }

    return ok({ ...bundle.value.checksums });
  }
}

export function createReplayPromoter(harness: ReplayPromoterHarness): ReplayPromoter {
  return new DefaultReplayPromoter(harness);
}

function findingForCandidate(candidate: CandidateFinding): Finding {
  const identityAnchor = browserQaIdentityAnchor(candidate);

  return {
    citedHeuristics: ["kb_browser_qa_candidate_promotion"],
    confidenceBand: "assert",
    dimensions: dimensionsForSeverity(candidate.severity),
    evidence: [
      {
        kind: "dom",
        selector: identityAnchor,
        ...(latestElementRef(candidate.actionPath) === undefined
          ? {}
          : { elementRef: latestElementRef(candidate.actionPath) }),
      },
    ],
    gatedForHuman: candidate.promotionSource === "human-verdict",
    id: findingIdForCandidate(candidate.id),
    issueType: `browser-qa-${candidate.category}`,
    lens: "browser-qa",
    location: {
      selector: identityAnchor,
    },
    method: "judged",
    rationale: `Browser QA candidate promoted from ${candidate.id}. Evidence bundle: ${candidate.evidenceBundleId}.`,
    severityBand: severityBandFor(candidate.severity),
    tags: ["browser-qa", candidate.id, candidate.qaRunId],
    title: candidate.title,
  };
}

function browserQaIdentityAnchor(candidate: CandidateFinding): string {
  const route = firstRoute(candidate.actionPath);
  const semanticActionPath = candidate.actionPath.map((action) => ({
    action: action.action,
    locator: {
      name: action.locator?.name,
      refHint: action.locator?.refHint,
      role: action.locator?.role,
      selector: action.locator?.selector,
      testId: action.locator?.testId,
      text: action.locator?.text,
    },
    url: action.url,
  }));

  return JSON.stringify({
    actionPath: semanticActionPath,
    route,
    version: 1,
  });
}

function firstRoute(actions: readonly BrowserAction[]): string {
  const url = actions.find((action) => action.url !== undefined)?.url;

  if (url === undefined) {
    return "unknown-route";
  }

  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function latestElementRef(actions: readonly BrowserAction[]): string | undefined {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const refHint = actions[index]?.locator?.refHint;

    if (refHint !== undefined) {
      return refHint;
    }
  }

  return undefined;
}

function findingIdForCandidate(candidateId: string): string {
  return `f_${candidateId.replace(/^qfc_/u, "")}`;
}

function dimensionsForSeverity(severity: QaSeverity): Finding["dimensions"] {
  const severityScore = {
    critical: 0.95,
    high: 0.82,
    medium: 0.62,
    low: 0.35,
  }[severity];

  return {
    a11yLegalRisk: 0.1,
    agentImplementability: 0.85,
    businessImpact: severityScore,
    confidence: 0.82,
    effort: 0.35,
    evidenceQuality: 0.78,
    severity: severityScore,
    userImpact: severityScore,
  };
}

function severityBandFor(severity: QaSeverity): Finding["severityBand"] {
  switch (severity) {
    case "critical":
      return "P0";
    case "high":
      return "P1";
    case "medium":
      return "P2";
    case "low":
      return "P3";
  }
}
