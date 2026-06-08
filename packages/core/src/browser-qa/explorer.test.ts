import { describe, expect, it } from "vitest";

import { createBuiltInSafeActionPolicy } from "./action-policy.js";
import { createBrowserQaExplorer, type BrowserQaExplorerHarness } from "./explorer.js";
import type { BrowserAction, CandidateFinding, CandidateFlow, EvidenceBundle } from "./schemas.js";

describe("BrowserQaExplorer", () => {
  it("stops at configured exploration bounds and records degradation", async () => {
    const explorer = createBrowserQaExplorer(makeExplorerHarness({ states: 5 }));

    const result = await explorer.explore({
      maxActions: 3,
      maxDepth: 1,
      maxStates: 2,
      qaRunId: "qa_explore",
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        visitedStates: 2,
      },
    });
    if (result.ok) {
      expect(result.value.degradation).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "exploration_degraded" })]),
      );
    }
  });

  it("records policy-denied actions as coverage without executing them", async () => {
    const harness = makeExplorerHarness({ deniedActionName: "Delete account" });
    const explorer = createBrowserQaExplorer(harness);

    const result = await explorer.explore(makeExploreInput());

    expect(harness.executedActions).toEqual([]);
    expect(result).toMatchObject({
      ok: true,
      value: { deniedActions: 1 },
    });
  });

  it("persists candidate flows as non-gate-eligible working memory", async () => {
    const harness = makeExplorerHarness({ candidateFlow: true });
    const explorer = createBrowserQaExplorer(harness);

    const result = await explorer.explore(makeExploreInput());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.candidateFlows[0]?.id).toMatch(/^qflow_/);
    expect(result.value.candidateFindings[0]).toMatchObject({
      gateEligible: false,
      replayStatus: "not-run",
    });
    expect(harness.writtenFlows).toHaveLength(1);
    expect(harness.writtenFindings).toHaveLength(1);
    expect(harness.writtenEvidenceBundles).toHaveLength(1);
  });
});

function makeExploreInput() {
  return {
    maxActions: 10,
    maxDepth: 2,
    maxStates: 5,
    qaRunId: "qa_explore",
    target: { kind: "url" as const, ref: "http://localhost:3000" },
  };
}

function makeExplorerHarness(
  options: {
    readonly candidateFlow?: boolean;
    readonly deniedActionName?: string;
    readonly states?: number;
  } = {},
): BrowserQaExplorerHarness & {
  readonly executedActions: BrowserAction[];
  readonly writtenEvidenceBundles: EvidenceBundle[];
  readonly writtenFindings: CandidateFinding[];
  readonly writtenFlows: CandidateFlow[];
} {
  const executedActions: BrowserAction[] = [];
  const writtenEvidenceBundles: EvidenceBundle[] = [];
  const writtenFindings: CandidateFinding[] = [];
  const writtenFlows: CandidateFlow[] = [];
  const totalStates = options.states ?? 1;
  let stateIndex = 0;

  return {
    actionPolicy: createBuiltInSafeActionPolicy(),
    executedActions,
    executeAction: (action) => {
      executedActions.push(action);
      return Promise.resolve({ ok: true, value: undefined });
    },
    loadState: ({ depth }) => {
      const actionName = options.deniedActionName ?? "More options";
      const action: BrowserAction = {
        action: options.deniedActionName === undefined ? "hover" : "click",
        locator: { name: actionName, role: "button" },
      };
      const state = {
        actions: stateIndex < totalStates ? [action] : [],
        authStatus: "anonymous" as const,
        depth,
        title: `State ${stateIndex}`,
        url: `http://localhost:3000/state-${stateIndex}`,
      };
      stateIndex += 1;
      return Promise.resolve({ ok: true, value: state });
    },
    now: () => "2026-06-08T12:00:00.000Z",
    shouldCreateCandidateFlow: () => options.candidateFlow === true,
    writeCandidate: (candidate) => {
      writtenFindings.push(candidate);
      return Promise.resolve({ ok: true, value: candidate });
    },
    writeCandidateFlow: (flow) => {
      writtenFlows.push(flow);
      return Promise.resolve({ ok: true, value: flow });
    },
    writeEvidenceBundle: (input) => {
      writtenEvidenceBundles.push(input.bundle);
      return Promise.resolve({ ok: true, value: input.bundle });
    },
    writtenEvidenceBundles,
    writtenFindings,
    writtenFlows,
  };
}
