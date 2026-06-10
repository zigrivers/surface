import { describe, expect, it } from "vitest";

import type { ProjectRunRecord, ProjectStateSnapshot } from "./interfaces.js";
import {
  projectHasCompletedPipelineRun,
  projectRunRecordHasAuditArtifacts,
  projectStatusRunHistoryEntries,
  upsertProjectRunRecord,
} from "./project-state-projections.js";

describe("project state projections", () => {
  it("detects a completed full pipeline run record", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          runRecords: [
            {
              runId: "run_pipeline",
              stage: "all",
              status: "completed",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("does not use pipeline finalization metadata without stage coverage", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          currentStage: "completed",
          runRecords: [
            {
              completedStages: ["heuristic"],
              runId: "run_pipeline",
              stage: "heuristic",
              status: "completed",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("aggregates completed stages across records for the active pipeline run", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          runRecords: [
            {
              completedStages: ["discovery"],
              runId: "run_pipeline",
              stage: "discovery",
              status: "completed",
              trackedFindings: [],
            },
            {
              completedStages: ["capture", "heuristic"],
              runId: "run_pipeline",
              stage: "heuristic",
              status: "completed",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("counts skipped stages as covered when checking pipeline completion", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          runRecords: [
            {
              completedStages: ["discovery"],
              runId: "run_pipeline",
              skippedStages: [{ reason: "already-complete", stage: "capture" }],
              stage: "heuristic",
              status: "completed",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("treats omitted run status as completed for pipeline projections", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          runRecords: [
            {
              completedStages: ["discovery", "capture", "heuristic"],
              runId: "run_pipeline",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("does not treat audit-completed state as completed pipeline metadata", () => {
    expect(
      projectHasCompletedPipelineRun(
        stateWithPipeline({
          currentStage: "completed",
          lastCompletedStage: "capture",
          runRecords: [
            {
              completedStages: ["discovery"],
              runId: "run_pipeline",
              stage: "discovery",
              status: "completed",
              trackedFindings: [],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("merges pipeline metadata into existing same-run records", () => {
    const finding = { id: "finding_preserved" } as NonNullable<
      ProjectRunRecord["findings"]
    >[number];
    const incomingFinding = { id: "finding_incoming" } as NonNullable<
      ProjectRunRecord["findings"]
    >[number];
    const runRecords = upsertProjectRunRecord(
      [
        {
          completedStages: ["discovery"],
          findings: [finding],
          runId: "run_pipeline",
          status: "completed",
          trackedFindings: [],
        },
      ],
      {
        completedAt: "2026-06-09T00:00:00.000Z",
        completedStages: ["capture"],
        findings: [incomingFinding],
        runId: "run_pipeline",
        stage: "all",
        status: "completed",
        trackedFindings: [],
      },
    );

    expect(runRecords).toHaveLength(1);
    expect(runRecords[0]).toMatchObject({
      completedAt: "2026-06-09T00:00:00.000Z",
      completedStages: ["discovery", "capture"],
      findings: [{ id: "finding_preserved" }, { id: "finding_incoming" }],
      runId: "run_pipeline",
      stage: "all",
    });
  });

  it("returns no visible run history entries when the limit is zero", () => {
    expect(
      projectStatusRunHistoryEntries(
        [
          {
            runId: "run_1",
            status: "completed",
            trackedFindings: [],
          },
        ],
        { limit: 0 },
      ),
    ).toEqual([]);
  });

  it("caps visible run history by completedAt recency instead of insertion order", () => {
    expect(
      projectStatusRunHistoryEntries(
        [
          {
            completedAt: "2026-06-09T00:00:00.000Z",
            runId: "run_recent_update_inserted_first",
            status: "completed",
            trackedFindings: [],
          },
          {
            completedAt: "2026-06-08T00:00:00.000Z",
            runId: "run_older",
            status: "completed",
            trackedFindings: [],
          },
          {
            completedAt: "2026-06-08T12:00:00.000Z",
            runId: "run_newer",
            status: "failed",
            trackedFindings: [],
          },
        ],
        { limit: 2 },
      ).map((entry) => entry.runId),
    ).toEqual(["run_recent_update_inserted_first", "run_newer"]);
  });

  it("recognizes clean audit records with explicit empty artifacts", () => {
    expect(
      projectRunRecordHasAuditArtifacts({
        findings: [],
        runId: "run_clean_audit",
        skippedLenses: [],
        trackedFindings: [],
      }),
    ).toBe(true);
    expect(
      projectRunRecordHasAuditArtifacts({
        runId: "run_pipeline_only",
        stage: "all",
        status: "completed",
        trackedFindings: [],
      }),
    ).toBe(false);
  });
});

function stateWithPipeline(input: {
  readonly currentStage?: string;
  readonly lastCompletedStage?: string;
  readonly runRecords: NonNullable<ProjectStateSnapshot["runRecords"]>;
}): ProjectStateSnapshot {
  return {
    ...(input.currentStage === undefined ? {} : { currentStage: input.currentStage }),
    pipeline: {
      ...(input.lastCompletedStage === undefined
        ? {}
        : { lastCompletedStage: input.lastCompletedStage }),
      runId: "run_pipeline",
      stageIds: ["discovery", "capture", "heuristic"],
    },
    runRecords: input.runRecords,
    version: "1.0",
  };
}
