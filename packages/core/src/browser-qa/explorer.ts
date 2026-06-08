import { createHash } from "node:crypto";

import { err, ok, type Result, type SurfaceError } from "../errors.js";
import { classifyBrowserAction, effectiveTargetForAction } from "./action-policy.js";
import type {
  ActionPolicy,
  BrowserAction,
  CandidateFinding,
  CandidateFlow,
  EvidenceBundle,
  QaDegradation,
  QaTarget,
} from "./schemas.js";
import type { WriteEvidenceBundleInput } from "./evidence-store.js";

export type BrowserQaExploreInput = {
  readonly actionPolicyRef?: string;
  readonly allowedDomains?: readonly string[];
  readonly evidence?: "minimal" | "failures" | "full";
  readonly maxActions: number;
  readonly maxDepth: number;
  readonly maxStates: number;
  readonly network?: "summary" | "har" | "off";
  readonly qaRunId: string;
  readonly scope?: string;
  readonly sessionMode?: "isolated" | "shared";
  readonly stateLockTimeoutMs?: number;
  readonly target: QaTarget;
  readonly task?: string;
  readonly video?: "off" | "failures" | "all";
};

export type BrowserQaLoadedState = {
  readonly actions: readonly BrowserAction[];
  readonly authStatus: "authenticated" | "anonymous" | "auth-drift" | "reauthenticated";
  readonly depth: number;
  readonly dialogState?: string;
  readonly framePath?: readonly string[];
  readonly snapshotRef?: string;
  readonly theme?: "light" | "dark";
  readonly title?: string;
  readonly url: string;
};

export type BrowserQaExploreResult = {
  readonly attemptedActions: number;
  readonly candidateFindings: readonly CandidateFinding[];
  readonly candidateFlows: readonly CandidateFlow[];
  readonly degradation: readonly QaDegradation[];
  readonly deniedActions: number;
  readonly visitedStates: number;
};

export type BrowserQaExplorerHarness = {
  readonly actionPolicy: ActionPolicy;
  readonly executeAction: (action: BrowserAction) => Promise<Result<undefined, SurfaceError>>;
  readonly loadState: (input: {
    readonly actionPath: readonly BrowserAction[];
    readonly depth: number;
    readonly target: QaTarget;
  }) => Promise<Result<BrowserQaLoadedState, SurfaceError>>;
  readonly now?: () => string;
  readonly shouldCreateCandidateFlow?: (state: BrowserQaLoadedState) => boolean;
  readonly writeCandidate: (
    candidate: CandidateFinding,
  ) => Promise<Result<CandidateFinding, SurfaceError>>;
  readonly writeCandidateFlow: (
    flow: CandidateFlow,
  ) => Promise<Result<CandidateFlow, SurfaceError>>;
  readonly writeEvidenceBundle: (
    input: WriteEvidenceBundleInput,
  ) => Promise<Result<EvidenceBundle, SurfaceError>>;
};

export type BrowserQaExplorer = {
  explore(input: BrowserQaExploreInput): Promise<Result<BrowserQaExploreResult, SurfaceError>>;
};

type QueuedState = {
  readonly actionPath: readonly BrowserAction[];
  readonly depth: number;
};

export function createBrowserQaExplorer(harness: BrowserQaExplorerHarness): BrowserQaExplorer {
  return {
    explore: (input) => explore(input, harness),
  };
}

async function explore(
  input: BrowserQaExploreInput,
  harness: BrowserQaExplorerHarness,
): Promise<Result<BrowserQaExploreResult, SurfaceError>> {
  const queue: QueuedState[] = [{ actionPath: [], depth: 0 }];
  const degradation: QaDegradation[] = [];
  const candidateFindings: CandidateFinding[] = [];
  const candidateFlows: CandidateFlow[] = [];
  const seenStateIds = new Set<string>();
  let candidateCreated = false;
  let attemptedActions = 0;
  let deniedActions = 0;
  let visitedStates = 0;

  if (input.sessionMode === "shared") {
    degradation.push({
      code: "session_mode_shared_degraded",
      message:
        "Shared browser QA session mode is not implemented yet; this run used isolated sessions.",
      scope: "session",
      severity: "warning",
    });
  }

  while (queue.length > 0 && visitedStates < input.maxStates) {
    const queued = queue.shift();
    if (queued === undefined) {
      break;
    }

    const loaded = await harness.loadState({
      actionPath: queued.actionPath,
      depth: queued.depth,
      target: input.target,
    });

    if (!loaded.ok) {
      return err(loaded.error);
    }

    const stateId = deriveExplorationStateId(loaded.value);
    if (seenStateIds.has(stateId)) {
      continue;
    }

    seenStateIds.add(stateId);
    visitedStates += 1;

    if (!candidateCreated && harness.shouldCreateCandidateFlow?.(loaded.value) === true) {
      const generated = await createAndPersistCandidates({
        actionPath:
          queued.actionPath.length > 0
            ? queued.actionPath
            : [{ action: "open", url: loaded.value.url }],
        harness,
        input,
        state: loaded.value,
      });

      if (!generated.ok) {
        return generated;
      }

      candidateFindings.push(generated.value.finding);
      candidateFlows.push(generated.value.flow);
      candidateCreated = true;
    }

    for (const action of orderCandidateActions(loaded.value.actions, input)) {
      if (attemptedActions >= input.maxActions) {
        degradation.push(createBoundDegradation("maxActions", attemptedActions));
        break;
      }

      attemptedActions += 1;
      const decision = classifyBrowserAction({
        action,
        effectiveTarget: effectiveTargetForAction(action, input.target),
        policy: harness.actionPolicy,
        runTarget: input.target,
      });

      if (!decision.allowed) {
        deniedActions += 1;
        continue;
      }

      if (queued.depth >= input.maxDepth) {
        degradation.push(createBoundDegradation("maxDepth", queued.depth));
        continue;
      }

      const executed = await harness.executeAction(action);
      if (!executed.ok) {
        return err(executed.error);
      }

      queue.push({
        actionPath: [...queued.actionPath, action],
        depth: queued.depth + 1,
      });
    }
  }

  if (queue.length > 0 || visitedStates >= input.maxStates) {
    degradation.push(createBoundDegradation("maxStates", visitedStates));
  }

  return ok({
    attemptedActions,
    candidateFindings,
    candidateFlows,
    degradation: dedupeDegradation(degradation),
    deniedActions,
    visitedStates,
  });
}

export function deriveExplorationStateId(state: BrowserQaLoadedState): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        authStatus: state.authStatus,
        dialogState: state.dialogState,
        framePath: state.framePath,
        snapshotRef: state.snapshotRef,
        theme: state.theme,
        title: state.title,
        url: state.url,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  return `qstate_${hash}`;
}

function orderCandidateActions(
  actions: readonly BrowserAction[],
  input: BrowserQaExploreInput,
): BrowserAction[] {
  const scopeText = `${input.task ?? ""} ${input.scope ?? ""}`.toLowerCase();

  return actions
    .map((action, index) => ({ action, index, score: actionScore(action, scopeText) }))
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((scored) => scored.action);
}

function actionScore(action: BrowserAction, scopeText: string): number {
  const actionText = JSON.stringify(action).toLowerCase();
  const scopeBoost =
    scopeText.length > 0 && scopeText.split(/\s+/u).some((term) => actionText.includes(term))
      ? 1
      : 0;

  if (action.action === "open" || action.action === "hover" || action.action === "focus") {
    return 10 + scopeBoost;
  }

  return scopeBoost;
}

async function createAndPersistCandidates({
  actionPath,
  harness,
  input,
  state,
}: {
  readonly actionPath: readonly BrowserAction[];
  readonly harness: BrowserQaExplorerHarness;
  readonly input: BrowserQaExploreInput;
  readonly state: BrowserQaLoadedState;
}): Promise<
  Result<
    {
      readonly finding: CandidateFinding;
      readonly flow: CandidateFlow;
    },
    SurfaceError
  >
> {
  const idSeed = createHash("sha256")
    .update(`${input.qaRunId}:${state.url}:${JSON.stringify(actionPath)}`)
    .digest("hex")
    .slice(0, 12);
  const evidenceBundleId = `ev_${idSeed}`;
  const sourceRunManifestDigest = digestJson({
    actionPath,
    qaRunId: input.qaRunId,
    stateId: deriveExplorationStateId(state),
    url: state.url,
  });
  const evidenceBundle = await harness.writeEvidenceBundle({
    artifacts: [
      {
        bytes: new TextEncoder().encode(
          JSON.stringify(
            {
              actionPath,
              authStatus: state.authStatus,
              snapshotRef: state.snapshotRef,
              title: state.title,
              url: state.url,
            },
            null,
            2,
          ),
        ),
        id: `${evidenceBundleId}_state`,
        mcpReadable: true,
        mediaType: "application/json",
        qaKind: "browser-snapshot",
      },
    ],
    bundle: {
      artifacts: [],
      checksums: {},
      containsSensitiveRaw: false,
      id: evidenceBundleId,
      manifestPath: `.surface/qa/evidence/${evidenceBundleId}.json`,
      qaRunId: input.qaRunId,
      redacted: true,
      reproSteps: actionPath.map((action, index) => ({
        action,
        index: index + 1,
        label: `explore-${index + 1}`,
      })),
      sanitizedAtCapture: true,
      sourceCaptureArtifactIds: [`${evidenceBundleId}_state`],
      sourceRunManifestDigest,
    },
  });
  if (!evidenceBundle.ok) {
    return err(evidenceBundle.error);
  }

  const flow: CandidateFlow = {
    evidenceBundleId,
    id: `qflow_${idSeed}`,
    qaRunId: input.qaRunId,
    sourceRunManifestDigest,
    steps: [...actionPath],
    title: state.title ?? state.url,
  };
  const finding: CandidateFinding = {
    actionPath: [...actionPath],
    category: "functional",
    confidence: "candidate",
    evidenceBundleId,
    gateEligible: false,
    id: `qfc_${idSeed}`,
    identityConfidence: "medium",
    qaRunId: input.qaRunId,
    replayStatus: "not-run",
    replayable: actionPath.length > 0,
    severity: "medium",
    sourceRunManifestDigest,
    title: `Candidate issue in ${state.title ?? state.url}`,
  };
  const writtenFlow = await harness.writeCandidateFlow(flow);
  if (!writtenFlow.ok) {
    return err(writtenFlow.error);
  }

  const writtenFinding = await harness.writeCandidate(finding);
  if (!writtenFinding.ok) {
    return err(writtenFinding.error);
  }

  return ok({ finding: writtenFinding.value, flow: writtenFlow.value });
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function createBoundDegradation(bound: string, count: number): QaDegradation {
  return {
    code: "exploration_degraded",
    details: { bound, count },
    message: `Exploration stopped at ${bound}.`,
    scope: "explore",
    severity: "warning",
  };
}

function dedupeDegradation(degradation: readonly QaDegradation[]): QaDegradation[] {
  const seen = new Set<string>();
  const deduped: QaDegradation[] = [];

  for (const entry of degradation) {
    const bound = typeof entry.details?.bound === "string" ? entry.details.bound : entry.scope;
    const key = `${entry.code}:${bound}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}
