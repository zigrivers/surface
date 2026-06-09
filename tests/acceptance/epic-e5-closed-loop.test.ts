// Acceptance skeletons — Epic E5: Closed Loop, State & Baselines (US-040..042).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyWaiversToTrackedFindings,
  assignFindingIdentities,
  createFileStateStore,
  createSurfaceComposition,
  createNoopPipelineHandlers,
  createGateEvaluator,
  createPipelineOrchestrator,
  createTrackedFinding,
  deriveFindingIdentity,
  matchFindingIdentity,
  selectPipelineStages,
  transitionTrackedFinding,
  DEFAULT_SURFACE_CONFIG,
  isOk,
  ok,
  type Finding,
  type ProjectStateSnapshot,
  type StateStore,
} from "../../packages/core/src/index.js";
import { runSurfaceCli } from "../../packages/cli/src/index.js";

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

class AcceptanceMemoryStateStore implements StateStore {
  constructor(private state: ProjectStateSnapshot) {}

  readState() {
    return ok(this.state);
  }

  writeState(state: ProjectStateSnapshot) {
    this.state = state;
    return ok(state);
  }

  updateState(updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot) {
    return this.writeState(updater(this.state));
  }

  writeArtifact() {
    return ok({ path: ".surface/reports/findings.json", sha256: "abc123" });
  }
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

    it("[US-040][AC1] tracked finding lifecycle across runs is explicit (unit)", () => {
      const movedWithElementRef = findingWith({
        id: "f_a2",
        location: {
          file: "src/Header.tsx",
          component: "Header",
          selector: "header .primary",
          elementRef: "@e12",
        },
      });
      const tracked = createTrackedFinding({
        finding: identityFinding,
        runId: "run_001",
        validation: {
          kind: "measured-rule",
          expectation: "axe color-contrast passes on @e12",
        },
      });
      const stillFailing = transitionTrackedFinding(tracked, {
        finding: movedWithElementRef,
        kind: "detected",
        runId: "run_002",
      });
      const resolved = transitionTrackedFinding(stillFailing, {
        kind: "missing",
        runId: "run_003",
        validationPassed: true,
      });
      const regressed = transitionTrackedFinding(resolved, {
        finding: movedWithElementRef,
        kind: "detected",
        runId: "run_004",
      });
      const identityBroken = transitionTrackedFinding(tracked, {
        currentFindingId: "f_unmatchable",
        kind: "identity-broken",
        runId: "run_005",
      });

      expect([
        stillFailing.status,
        resolved.status,
        regressed.status,
        identityBroken.status,
      ]).toEqual(["still-failing", "resolved", "regressed", "identity-broken"]);
    });

    it.skip("[US-040][AC1] unchanged defect → same id, still-failing; fixed → resolved; reappeared → regressed; unmatchable anchor → identity-broken (never silent resolved) (integration)", () => {});
  });
  describe("US-041 concurrency-safe, resumable state [gate]", () => {
    it("[US-041][AC1] two overlapping runs → state access locked; neither corrupts the store (integration)", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "surface-overlap-"));
      const stateStore = createFileStateStore({ projectRoot: root });
      const captureBarrier = createBarrier(2);
      const orchestrator = createPipelineOrchestrator({
        handlers: createNoopPipelineHandlers({
          capture: async ({ runId }) => {
            const marked = await stateStore.updateState?.((state) => ({
              ...state,
              pipeline: {
                ...state.pipeline,
                [`handlerMarker:${runId}`]: "capture",
              },
            }));

            if (marked !== undefined && !isOk(marked)) {
              return marked;
            }

            await captureBarrier.wait();

            return ok({ captureId: `cap_${runId}` });
          },
        }),
        stateStore,
      });

      try {
        const [first, second] = await Promise.all([
          orchestrator.run({ config: DEFAULT_SURFACE_CONFIG, runId: "run_overlap_first" }),
          orchestrator.run({ config: DEFAULT_SURFACE_CONFIG, runId: "run_overlap_second" }),
        ]);
        const state = await stateStore.readState();

        expect(first).toMatchObject({ value: { runId: "run_overlap_first" } });
        expect(second).toMatchObject({ value: { runId: "run_overlap_second" } });
        expect(isOk(state)).toBe(true);
        if (isOk(state)) {
          expect(state.value.currentStage).toBe("completed");
          expect(state.value.pipeline).toMatchObject({
            "handlerMarker:run_overlap_first": "capture",
            "handlerMarker:run_overlap_second": "capture",
          });
        }
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });

    it("[US-041][AC2] interrupted run → re-invoke resumes from currentStage, not half-written (integration)", async () => {
      const visited: string[] = [];
      const orchestrator = createPipelineOrchestrator({
        handlers: createNoopPipelineHandlers({
          capture: ({ stage }) => {
            visited.push(stage.id);
            return ok({ captureId: "cap_resume" });
          },
          validation: ({ stage }) => {
            visited.push(stage.id);
            return ok({ passed: true });
          },
        }),
        stateStore: new AcceptanceMemoryStateStore({
          currentStage: "capture",
          pipeline: {
            runId: "run_resume_acceptance",
            stageIds: selectPipelineStages(DEFAULT_SURFACE_CONFIG).map((stage) => stage.id),
          },
          version: "1.0",
        }),
      });

      const result = await orchestrator.run({
        config: DEFAULT_SURFACE_CONFIG,
        runId: "run_resume_acceptance",
      });

      expect(result).toMatchObject({
        value: {
          runId: "run_resume_acceptance",
          newlyCompletedStages: expect.arrayContaining(["capture", "validation"]),
        },
      });
      expect(visited).toEqual(["capture", "validation"]);
    });
  });
  describe("US-042 baseline & waivers [committed]", () => {
    it("[US-042][AC0] default gate fails measured findings at or above threshold and never judged/gatedForHuman (unit)", async () => {
      const evaluator = createGateEvaluator();
      const result = await evaluator.evaluate(
        [
          findingWith({ id: "f_measured_p1", severityBand: "P1" }),
          findingWith({ id: "f_measured_p2", severityBand: "P2" }),
          findingWith({
            id: "f_judged_p0",
            method: "judged",
            severityBand: "P0",
            evidence: [{ kind: "cited-heuristic", knowledgeEntryId: "kb_nielsen_visibility" }],
          }),
          findingWith({ id: "f_gated_p0", gatedForHuman: true, severityBand: "P0" }),
        ],
        DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
      );

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          exitCode: 1,
          failingFindingIds: ["f_measured_p1"],
          passed: false,
        },
      });
    });

    it("[US-042][AC1] `surface baseline` → snapshot; `gate` thereafter fails only on net-new/expired findings (integration)", async () => {
      const stdout: string[] = [];
      const currentDebt = findingWith({ id: "f_current_debt", severityBand: "P1" });
      const trackedCurrentDebt = createTrackedFinding({
        finding: currentDebt,
        runId: "run_001",
        validation: { expectation: "contrast passes", kind: "measured-rule" },
      });
      let state = {
        findings: [currentDebt],
        trackedFindings: [trackedCurrentDebt],
        version: "1.0",
      };
      const composition = createSurfaceComposition({
        stateStore: {
          readState: () => ok(state),
          writeArtifact: () =>
            Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
          writeState: (nextState) => {
            state = nextState as typeof state;

            return ok(nextState);
          },
        },
      });

      const baselineExitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "baseline", "--reason", "accepted current debt"],
        composition,
        io: { stdout: (chunk) => stdout.push(chunk) },
      });
      const gateExitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "gate", "--ci"],
        composition,
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(baselineExitCode).toBe(0);
      expect(gateExitCode).toBe(0);
      expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
        command: "baseline",
        data: { count: 1, reason: "accepted current debt" },
        ok: true,
      });
      expect(JSON.parse(stdout[1] ?? "")).toMatchObject({
        command: "gate",
        data: { gateResult: { failingFindingIds: [], passed: true } },
        ok: true,
      });
      expect(state).toMatchObject({
        baselines: [
          {
            identityKeys: [trackedCurrentDebt.identityKey],
            reason: "accepted current debt",
          },
        ],
      });
    });
    it("[US-042][AC2] waiver with expiry → on expiry the finding re-activates; gateDisposition returns to active (unit)", () => {
      const tracked = createTrackedFinding({
        finding: findingWith({ id: "f_current_debt", severityBand: "P1" }),
        gateDisposition: "ignored-by-waiver",
        runId: "run_001",
        validation: { expectation: "contrast passes", kind: "measured-rule" },
      });

      const [beforeExpiry] = applyWaiversToTrackedFindings({
        trackedFindings: [tracked],
        waivers: [
          {
            expiry: "2026-06-03T00:00:00.000Z",
            findingIdentityKey: tracked.identityKey,
            owner: "design-system",
            reason: "accepted current debt",
          },
        ],
        now: "2026-06-02T00:00:00.000Z",
      });
      const [afterExpiry] = applyWaiversToTrackedFindings({
        trackedFindings: [beforeExpiry!],
        waivers: [
          {
            expiry: "2026-06-03T00:00:00.000Z",
            findingIdentityKey: tracked.identityKey,
            owner: "design-system",
            reason: "accepted current debt",
          },
        ],
        now: "2026-06-04T00:00:00.000Z",
      });

      expect(beforeExpiry).toMatchObject({
        gateDisposition: "ignored-by-waiver",
        status: "new",
      });
      expect(afterExpiry).toMatchObject({
        gateDisposition: "active",
        status: "new",
      });
    });
  });
});

function createBarrier(participants: number): { wait(): Promise<void> } {
  let arrived = 0;
  let release: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    async wait() {
      arrived += 1;

      if (arrived >= participants) {
        release?.();
      }

      await released;
    },
  };
}
