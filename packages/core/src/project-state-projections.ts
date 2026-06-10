import type { ProjectRunRecord, ProjectStateSnapshot, Target } from "./interfaces.js";

export const PROJECT_STATUS_RUN_HISTORY_LIMIT = 20;

export type ProjectStatusRunHistoryEntry = {
  readonly completedAt?: string;
  readonly completedStages?: readonly string[];
  readonly findings: number;
  readonly runId: string;
  readonly skippedStages?: readonly {
    readonly reason: string;
    readonly stage: string;
  }[];
  readonly stage?: string;
  readonly status: "completed" | "failed";
  readonly target?: Target;
};

export type ProjectRunProgress = {
  readonly completedRuns: number;
  readonly failedRuns: number;
  readonly findings: number;
};

export function projectHasCompletedPipelineRun(state: ProjectStateSnapshot): boolean {
  const pipelineRunId = state.pipeline?.runId;

  return (
    pipelineRunId !== undefined &&
    (state.runRecords ?? []).some(
      (record) =>
        record.runId === pipelineRunId &&
        (record.status ?? "completed") === "completed" &&
        projectPipelineRunCompletesPlan(state, record),
    )
  );
}

export function projectRunRecordHasAuditArtifacts(record: ProjectRunRecord): boolean {
  return (
    record.backlog !== undefined ||
    record.capture !== undefined ||
    record.findings !== undefined ||
    record.skippedLenses !== undefined ||
    record.trackedFindings.length > 0
  );
}

export function projectStatusRunHistoryEntries(
  runRecords: readonly ProjectRunRecord[],
  options: { readonly limit?: number } = {},
): readonly ProjectStatusRunHistoryEntry[] {
  if (options.limit !== undefined && options.limit <= 0) {
    return [];
  }

  const recordsByRecency = runRecords
    .map((record, index) => ({ index, record }))
    .sort(compareIndexedRunRecordRecency);
  const visibleRecords =
    options.limit === undefined ? recordsByRecency : recordsByRecency.slice(0, options.limit);

  return visibleRecords.map(({ record }) => projectStatusRunHistoryEntryForRecord(record));
}

export function projectStatusProgressForRunRecords(
  runRecords: readonly ProjectRunRecord[],
): ProjectRunProgress {
  let completedRuns = 0;
  let failedRuns = 0;
  let findings = 0;

  for (const record of runRecords) {
    const entry = projectStatusRunHistoryEntryForRecord(record);

    if (entry.status === "completed") {
      completedRuns += 1;
    }

    if (entry.status === "failed") {
      failedRuns += 1;
    }

    findings += entry.findings;
  }

  return { completedRuns, failedRuns, findings };
}

export function projectStatusRunHistoryEntryForRecord(
  record: ProjectRunRecord,
): ProjectStatusRunHistoryEntry {
  return {
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    ...(record.completedStages === undefined ? {} : { completedStages: record.completedStages }),
    findings: record.findings?.length ?? 0,
    runId: record.runId,
    ...(record.skippedStages === undefined ? {} : { skippedStages: record.skippedStages }),
    ...(record.stage === undefined ? {} : { stage: record.stage }),
    status: record.status ?? "completed",
    ...(record.capture === undefined ? {} : { target: record.capture.target }),
  };
}

export function stateWithUpsertedProjectRunRecord(
  state: ProjectStateSnapshot,
  record: ProjectRunRecord,
): ProjectStateSnapshot {
  return {
    ...state,
    runRecords: upsertProjectRunRecord(state.runRecords ?? [], record),
  };
}

export function upsertProjectRunRecord(
  runRecords: readonly ProjectRunRecord[],
  record: ProjectRunRecord,
): readonly ProjectRunRecord[] {
  const matchingRecords = runRecords.filter((candidate) => candidate.runId === record.runId);

  if (matchingRecords.length === 0) {
    return [...runRecords, record];
  }

  const mergedRecord = [...matchingRecords, record].reduce(mergeProjectRunRecords);
  let placedMergedRecord = false;

  return runRecords.flatMap((candidate) => {
    if (candidate.runId !== record.runId) {
      return [candidate];
    }

    if (placedMergedRecord) {
      return [];
    }

    placedMergedRecord = true;
    return [mergedRecord];
  });
}

export function mergeProjectRunRecordsByRunId(
  runRecords: readonly ProjectRunRecord[],
): readonly ProjectRunRecord[] {
  return runRecords.reduce(
    (records, record) => upsertProjectRunRecord(records, record),
    [] as readonly ProjectRunRecord[],
  );
}

export function mergeProjectRunRecords(
  existing: ProjectRunRecord,
  incoming: ProjectRunRecord,
): ProjectRunRecord {
  const completedStages = uniqueStrings([
    ...(existing.completedStages ?? []),
    ...(incoming.completedStages ?? []),
  ]);
  const skippedStages = uniqueSkippedStages([
    ...(existing.skippedStages ?? []),
    ...(incoming.skippedStages ?? []),
  ]);
  const findings = uniqueByKeyKeepLast(
    [...(existing.findings ?? []), ...(incoming.findings ?? [])],
    (finding) => finding.id,
  );
  const reconciliationQuestions = uniqueByKeyKeepLast(
    [...(existing.reconciliationQuestions ?? []), ...(incoming.reconciliationQuestions ?? [])],
    (question) => question.groupKey,
  );
  const skippedLenses = uniqueByKeyKeepLast(
    [...(existing.skippedLenses ?? []), ...(incoming.skippedLenses ?? [])],
    (skippedLens) => `${skippedLens.lensId}\0${skippedLens.reason}\0${skippedLens.message}`,
  );
  const trackedFindings = uniqueByKeyKeepLast(
    [...existing.trackedFindings, ...incoming.trackedFindings],
    (trackedFinding) => trackedFinding.identityKey,
  );

  return {
    ...existing,
    ...incoming,
    ...(existing.backlog === undefined && incoming.backlog === undefined
      ? {}
      : { backlog: incoming.backlog ?? existing.backlog }),
    ...(existing.completedAt === undefined && incoming.completedAt === undefined
      ? {}
      : { completedAt: incoming.completedAt ?? existing.completedAt }),
    ...(completedStages.length === 0 ? {} : { completedStages }),
    ...(existing.capture === undefined && incoming.capture === undefined
      ? {}
      : { capture: incoming.capture ?? existing.capture }),
    ...(existing.findings === undefined && incoming.findings === undefined ? {} : { findings }),
    ...(existing.reconciliationQuestions === undefined &&
    incoming.reconciliationQuestions === undefined
      ? {}
      : { reconciliationQuestions }),
    ...(existing.skippedLenses === undefined && incoming.skippedLenses === undefined
      ? {}
      : { skippedLenses }),
    ...(skippedStages.length === 0 ? {} : { skippedStages }),
    ...(existing.stage === undefined && incoming.stage === undefined
      ? {}
      : { stage: incoming.stage ?? existing.stage }),
    ...(existing.status === undefined && incoming.status === undefined
      ? {}
      : { status: incoming.status ?? existing.status }),
    trackedFindings,
  };
}

export function projectPipelineRunCompletesPlan(
  state: ProjectStateSnapshot,
  record: ProjectRunRecord,
): boolean {
  if (record.stage === "all") {
    return true;
  }

  const stageIds = state.pipeline?.stageIds ?? [];
  const completedStages = projectCompletedStagesForRun(state, record.runId);

  return stageIds.length > 0 && stageIds.every((stageId) => completedStages.has(stageId));
}

function projectCompletedStagesForRun(state: ProjectStateSnapshot, runId: string): Set<string> {
  const completedStages = new Set<string>();

  for (const record of state.runRecords ?? []) {
    if (record.runId !== runId || (record.status ?? "completed") !== "completed") {
      continue;
    }

    for (const stage of record.completedStages ?? []) {
      completedStages.add(stage);
    }

    for (const skippedStage of record.skippedStages ?? []) {
      completedStages.add(skippedStage.stage);
    }

    if (record.stage !== undefined && record.stage !== "all") {
      completedStages.add(record.stage);
    }
  }

  return completedStages;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function compareIndexedRunRecordRecency(
  left: { readonly index: number; readonly record: ProjectRunRecord },
  right: { readonly index: number; readonly record: ProjectRunRecord },
): number {
  if (
    left.record.completedAt !== undefined &&
    right.record.completedAt !== undefined &&
    left.record.completedAt !== right.record.completedAt
  ) {
    return left.record.completedAt < right.record.completedAt ? 1 : -1;
  }

  if (left.record.completedAt !== undefined && right.record.completedAt === undefined) {
    return -1;
  }

  if (left.record.completedAt === undefined && right.record.completedAt !== undefined) {
    return 1;
  }

  return right.index - left.index;
}

function uniqueSkippedStages(
  values: NonNullable<ProjectRunRecord["skippedStages"]>,
): NonNullable<ProjectRunRecord["skippedStages"]> {
  const seen = new Set<string>();
  const unique: { readonly reason: string; readonly stage: string }[] = [];

  for (const value of values) {
    const key = `${value.stage}\0${value.reason}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}

function uniqueByKeyKeepLast<TValue>(
  values: readonly TValue[],
  keyFor: (value: TValue) => string,
): readonly TValue[] {
  const valueByKey = new Map<string, TValue>();

  for (const value of values) {
    valueByKey.set(keyFor(value), value);
  }

  return [...valueByKey.values()];
}
