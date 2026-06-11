import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createSurfaceError,
  createSurfaceComposition,
  err,
  ok,
  type Finding,
  type FindingDraft,
  type LensRegistration,
  type SurfaceComposition,
} from "@zigrivers/surface-core";
import type { Capture, ProjectStateSnapshot, StateStore } from "@zigrivers/surface-core/interfaces";

import {
  SURFACE_MCP_SERVER_NAME,
  SURFACE_MCP_SERVER_VERSION,
  assertMcpToolSchemaCompatibility,
  createMcpToolSchemaSnapshot,
  createSurfaceMcpServer,
  createSurfaceMcpToolRegistry,
} from "./index.js";

describe("@zigrivers/surface-mcp bootstrap", () => {
  it("lists versioned Surface tools from the bootstrap registry", () => {
    const registry = createSurfaceMcpToolRegistry();
    const tools = registry.listTools();

    expect(registry.serverInfo).toEqual({
      name: SURFACE_MCP_SERVER_NAME,
      version: SURFACE_MCP_SERVER_VERSION,
    });
    expect(tools).toHaveLength(23);
    expect(tools[0]).toMatchObject({
      name: "surface_capture",
      schemaVersion: "1.0.0",
    });
  });

  it("creates a server facade over the shared core composition", () => {
    const server = createSurfaceMcpServer();

    expect(server.composition.lensRegistry.length).toBeGreaterThan(0);
    expect(server.listTools().map((tool) => tool.name)).toContain("surface_status");
  });

  it("appends browser QA MCP tools after existing analytical tools", () => {
    const tools = createSurfaceMcpToolRegistry()
      .listTools()
      .map((tool) => tool.name);

    expect(tools.slice(0, 14)).toEqual([
      "surface_capture",
      "surface_audit",
      "surface_explain",
      "surface_backlog",
      "surface_gate",
      "surface_validate",
      "surface_baseline",
      "surface_verdict",
      "surface_diff",
      "surface_alternatives",
      "surface_trace",
      "surface_run",
      "surface_next",
      "surface_status",
    ]);
    expect(tools.slice(14)).toEqual([
      "surface_qa",
      "surface_explore",
      "surface_flow_run",
      "surface_flow_list",
      "surface_flow_promote",
      "surface_evidence",
      "surface_replay",
      "surface_report_qa",
      "surface_artifact_read",
    ]);
  });

  it("keeps a stable compact schema snapshot for MCP compatibility checks", () => {
    expect(
      createMcpToolSchemaSnapshot().map((tool) => ({
        name: tool.name,
        required: tool.inputSchema.required ?? [],
        schemaVersion: tool.schemaVersion,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "name": "surface_capture",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_audit",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_explain",
          "required": [
            "findingId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_backlog",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_gate",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_validate",
          "required": [
            "runId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_baseline",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_verdict",
          "required": [
            "decision",
            "findingId",
            "rationale",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_diff",
          "required": [
            "after",
            "before",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_alternatives",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_trace",
          "required": [
            "findingId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_run",
          "required": [
            "step",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_next",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_status",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_qa",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_explore",
          "required": [
            "target",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_flow_run",
          "required": [
            "flowPath",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_flow_list",
          "required": [],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_flow_promote",
          "required": [
            "candidateFlowId",
            "outPath",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_evidence",
          "required": [
            "refId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_replay",
          "required": [
            "refId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_report_qa",
          "required": [
            "runId",
          ],
          "schemaVersion": "1.0.0",
        },
        {
          "name": "surface_artifact_read",
          "required": [
            "artifactId",
            "refId",
          ],
          "schemaVersion": "1.0.0",
        },
      ]
    `);
  });

  it("requires major version bumps for newly required fields", () => {
    const current = {
      name: "surface_capture",
      schemaVersion: "1.0.0",
      inputSchema: { required: ["target"], type: "object" },
    } as const;

    expect(
      assertMcpToolSchemaCompatibility({
        current,
        next: {
          name: "surface_capture",
          schemaVersion: "1.2.0",
          inputSchema: { required: ["target", "authState"], type: "object" },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "mcp_schema_incompatible" } });
    expect(
      assertMcpToolSchemaCompatibility({
        current,
        next: {
          name: "surface_capture",
          schemaVersion: "2.0.0",
          inputSchema: { required: ["target", "authState"], type: "object" },
        },
      }),
    ).toEqual({ ok: true, value: true });
  });

  it("runs surface_capture through the shared capture service", async () => {
    const capture = captureFixture();
    const server = createSurfaceMcpServer({
      composition: compositionFixture({ capture }),
    });

    const result = await server.callTool("surface_capture", {
      authState: "playwright/.auth/user.json",
      target: capture.target,
    });

    expect(result).toEqual({ ok: true, value: capture });
  });

  it("runs surface_audit and stores findings/backlog for follow-up analytical tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-mcp-state-"));
    const capture = captureFixture();
    const findingDraft = findingDraftFixture();

    try {
      const server = createSurfaceMcpServer({
        composition: compositionFixture({
          capture,
          lensRegistry: [lensRegistrationFixture(findingDraft)],
          projectRoot: root,
        }),
      });

      const audit = await server.callTool("surface_audit", {
        depth: 3,
        target: capture.target,
      });

      expect(audit).toMatchObject({
        ok: true,
        value: {
          backlog: { entries: [{ findingId: findingDraft.draftId, rank: 1 }] },
          findings: [{ id: findingDraft.draftId, title: findingDraft.title }],
        },
      });

      if (!audit.ok) {
        throw new Error(audit.error.message);
      }

      const runId = audit.value.runId;
      await expect(server.callTool("surface_backlog", { runId })).resolves.toMatchObject({
        ok: true,
        value: { runId, entries: [{ findingId: findingDraft.draftId }] },
      });
      await expect(
        server.callTool("surface_explain", { findingId: findingDraft.draftId }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          evidence: findingDraft.evidence,
          finding: { id: findingDraft.draftId },
          rationale: findingDraft.rationale,
        },
      });
      await expect(server.callTool("surface_status", {})).resolves.toMatchObject({
        ok: true,
        value: {
          currentStage: "completed",
          progress: { completedRuns: 1, findings: 1 },
          runHistory: [{ runId, status: "completed" }],
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("persists MCP audit state through the shared StateStore across server instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-mcp-state-"));
    const capture = captureFixture();
    const findingDraft = findingDraftFixture();

    try {
      const firstComposition = compositionFixture({
        capture,
        lensRegistry: [lensRegistrationFixture(findingDraft)],
        projectRoot: root,
      });
      const firstServer = createSurfaceMcpServer({ composition: firstComposition });

      const audit = await firstServer.callTool("surface_audit", {
        target: capture.target,
      });

      expect(audit).toMatchObject({
        ok: true,
        value: {
          backlog: { entries: [{ findingId: findingDraft.draftId, rank: 1 }] },
          findings: [{ id: findingDraft.draftId }],
        },
      });

      if (!audit.ok) {
        throw new Error(audit.error.message);
      }

      const state = await firstComposition.stateStore.readState();
      expect(state).toMatchObject({
        ok: true,
        value: {
          backlog: { runId: audit.value.runId },
          currentStage: "completed",
          findings: [{ id: findingDraft.draftId }],
          runRecords: [{ runId: audit.value.runId }],
          trackedFindings: [{ currentFindingId: findingDraft.draftId }],
        },
      });

      const secondServer = createSurfaceMcpServer({
        composition: compositionFixture({ capture, projectRoot: root }),
      });

      await expect(secondServer.callTool("surface_status", {})).resolves.toMatchObject({
        ok: true,
        value: {
          currentStage: "completed",
          progress: { completedRuns: 1, findings: 1 },
          runHistory: [{ runId: audit.value.runId, status: "completed" }],
        },
      });
      await expect(
        secondServer.callTool("surface_backlog", { runId: audit.value.runId }),
      ).resolves.toMatchObject({
        ok: true,
        value: { runId: audit.value.runId, entries: [{ findingId: findingDraft.draftId }] },
      });
      await expect(
        secondServer.callTool("surface_explain", { findingId: findingDraft.draftId }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          finding: { id: findingDraft.draftId },
          rationale: findingDraft.rationale,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not clear persisted audit findings when persisting a pipeline run", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-mcp-pipeline-state-"));
    const capture = captureFixture();
    const findingDraft = findingDraftFixture();

    try {
      const composition = compositionFixture({
        capture,
        lensRegistry: [lensRegistrationFixture(findingDraft)],
        projectRoot: root,
      });
      const server = createSurfaceMcpServer({ composition });
      const audit = await server.callTool("surface_audit", { target: capture.target });

      expect(audit).toMatchObject({ ok: true });

      const run = await server.callTool("surface_run", { step: "all" });

      expect(run).toMatchObject({ ok: true });

      const state = await composition.stateStore.readState();

      expect(state).toMatchObject({
        ok: true,
        value: {
          findings: [{ id: findingDraft.draftId }],
          runRecords: [
            { findings: [{ id: findingDraft.draftId }] },
            { stage: "all", status: "completed" },
          ],
        },
      });
      if (!state.ok) {
        throw new Error(state.error.message);
      }
      expect(state.value.runRecords?.at(-1)).not.toHaveProperty("findings");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves run records written during pipeline execution when persisting history", async () => {
    const capture = captureFixture();
    const stateStore = new MemoryStateStore();
    const base = compositionFixture({ capture });
    const composition: SurfaceComposition = {
      ...base,
      pipelineOrchestrator: {
        run: ({ runId }) => {
          const handlerWrite = stateStore.updateState((state) => ({
            ...state,
            runRecords: [
              ...(state.runRecords ?? []),
              {
                runId: "run_handler_side_effect",
                status: "completed",
                trackedFindings: [],
              },
            ],
          }));

          if (!handlerWrite.ok) {
            throw new Error(handlerWrite.error.message);
          }

          return Promise.resolve(
            ok({
              events: [],
              newlyCompletedStages: ["discovery"],
              runId,
              skippedStages: [],
            }),
          );
        },
      },
      stateStore,
    };
    const server = createSurfaceMcpServer({ composition });
    const run = await server.callTool("surface_run", { step: "all" });

    expect(run).toMatchObject({ ok: true });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const state = stateStore.readState();

    expect(state).toMatchObject({ ok: true });
    if (!state.ok) {
      throw new Error(state.error.message);
    }
    expect(state.value.runRecords?.map((record) => record.runId)).toEqual([
      "run_handler_side_effect",
      run.value.runId,
    ]);
  });

  it("merges pipeline metadata into same-run MCP records written by handlers", async () => {
    const capture = captureFixture();
    const finding = findingFixture();
    const stateStore = new MemoryStateStore();
    const base = compositionFixture({ capture });
    const composition: SurfaceComposition = {
      ...base,
      pipelineOrchestrator: {
        run: ({ runId }) => {
          const handlerWrite = stateStore.updateState((state) => ({
            ...state,
            runRecords: [
              ...(state.runRecords ?? []),
              {
                findings: [finding],
                runId,
                status: "completed",
                trackedFindings: [],
              },
            ],
          }));

          if (!handlerWrite.ok) {
            throw new Error(handlerWrite.error.message);
          }

          return Promise.resolve(
            ok({
              events: [],
              newlyCompletedStages: ["discovery"],
              runId,
              skippedStages: [],
            }),
          );
        },
      },
      stateStore,
    };
    const server = createSurfaceMcpServer({ composition });
    const run = await server.callTool("surface_run", { step: "all" });

    expect(run).toMatchObject({ ok: true });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const state = stateStore.readState();

    expect(state).toMatchObject({ ok: true });
    if (!state.ok) {
      throw new Error(state.error.message);
    }
    expect(state.value.runRecords).toHaveLength(1);
    expect(state.value.runRecords?.[0]).toMatchObject({
      completedStages: ["discovery"],
      findings: [{ id: finding.id }],
      runId: run.value.runId,
      stage: "all",
      status: "completed",
    });
  });

  it("persists failed MCP pipeline runs in status history", async () => {
    const capture = captureFixture();
    const stateStore = new MemoryStateStore();
    const base = compositionFixture({ capture });
    const composition: SurfaceComposition = {
      ...base,
      pipelineOrchestrator: {
        run: ({ runId }) =>
          Promise.resolve(
            err(
              createSurfaceError("step_failed", "MCP pipeline failed in test.", {
                details: { runId },
              }),
            ),
          ),
      },
      stateStore,
    };
    const server = createSurfaceMcpServer({ composition });
    const run = await server.callTool("surface_run", { step: "all" });

    expect(run).toMatchObject({ ok: false, error: { code: "step_failed" } });
    const status = await server.callTool("surface_status", {});

    expect(status).toMatchObject({
      ok: true,
      value: {
        progress: { failedRuns: 1 },
        runHistory: [{ stage: "all", status: "failed" }],
      },
    });
  });

  it("reports MCP progress totals from full history while capping visible run history", async () => {
    const stateStore = new MemoryStateStore({
      runRecords: Array.from({ length: 25 }, (_, index) => ({
        runId: `run_old_${index}`,
        status: "completed" as const,
        trackedFindings: [],
      })),
      version: "1.0",
    });
    const composition = { ...compositionFixture({ capture: captureFixture() }), stateStore };
    const server = createSurfaceMcpServer({ composition });

    const status = await server.callTool("surface_status", {});

    expect(status).toMatchObject({ ok: true });
    if (!status.ok) {
      throw new Error(status.error.message);
    }
    expect(status.value.progress.completedRuns).toBe(25);
    expect(status.value.runHistory).toHaveLength(20);
    expect(status.value.runHistory.slice(0, 3).map((record) => record.runId)).toEqual([
      "run_old_24",
      "run_old_23",
      "run_old_22",
    ]);
  });

  it("merges duplicate persisted run ids during MCP hydration", async () => {
    const capture = captureFixture();
    const finding = findingFixture();
    const stateStore = new MemoryStateStore({
      runRecords: [
        {
          completedStages: ["discovery"],
          findings: [finding],
          runId: "run_duplicate",
          status: "completed" as const,
          trackedFindings: [],
        },
        {
          completedStages: ["capture"],
          runId: "run_duplicate",
          stage: "capture",
          status: "completed" as const,
          trackedFindings: [],
        },
      ],
      version: "1.0",
    });
    const composition = { ...compositionFixture({ capture }), stateStore };
    const server = createSurfaceMcpServer({ composition });

    await expect(server.callTool("surface_status", {})).resolves.toMatchObject({
      ok: true,
      value: {
        progress: { completedRuns: 1, findings: 1 },
        runHistory: [
          {
            completedStages: ["discovery", "capture"],
            findings: 1,
            runId: "run_duplicate",
            stage: "capture",
          },
        ],
      },
    });
  });

  it("hydrates status-omitted audit records with capture artifacts", async () => {
    const capture = captureFixture();
    const stateStore = new MemoryStateStore({
      runRecords: [
        {
          capture,
          runId: "run_capture_only",
          trackedFindings: [],
        },
      ],
      version: "1.0",
    });
    const composition = { ...compositionFixture({ capture }), stateStore };
    const server = createSurfaceMcpServer({ composition });

    await expect(server.callTool("surface_status", {})).resolves.toMatchObject({
      ok: true,
      value: {
        progress: { completedRuns: 1 },
        runHistory: [{ runId: "run_capture_only", status: "completed", target: capture.target }],
      },
    });
  });

  it("uses aggregate same-run stage coverage for MCP completed step-by-step runs", async () => {
    const stateStore = new MemoryStateStore({
      currentStage: "completed",
      pipeline: {
        runId: "run_pipeline",
        stageIds: ["discovery", "capture", "heuristic"],
      },
      runRecords: [
        {
          completedStages: ["discovery", "capture"],
          runId: "run_pipeline",
          stage: "capture",
          status: "completed" as const,
          trackedFindings: [],
        },
        {
          completedStages: ["heuristic"],
          runId: "run_pipeline",
          stage: "heuristic",
          status: "completed" as const,
          trackedFindings: [],
        },
      ],
      version: "1.0",
    });
    const composition = { ...compositionFixture({ capture: captureFixture() }), stateStore };
    const server = createSurfaceMcpServer({ composition });

    await expect(server.callTool("surface_next", {})).resolves.toMatchObject({
      ok: true,
      value: { eligible: [] },
    });
  });

  it("reports MCP currentStage from project state instead of latest partial run status", async () => {
    const stateStore = new MemoryStateStore({
      currentStage: "capture",
      pipeline: {
        lastCompletedStage: "capture",
        runId: "run_pipeline",
        stageIds: ["discovery", "capture", "heuristic"],
      },
      runRecords: [
        {
          completedStages: ["discovery", "capture"],
          runId: "run_pipeline",
          stage: "capture",
          status: "completed" as const,
          trackedFindings: [],
        },
      ],
      version: "1.0",
    });
    const composition = { ...compositionFixture({ capture: captureFixture() }), stateStore };
    const server = createSurfaceMcpServer({ composition });

    await expect(server.callTool("surface_status", {})).resolves.toMatchObject({
      ok: true,
      value: { currentStage: "capture", runHistory: [{ status: "completed" }] },
    });
    const next = await server.callTool("surface_next", {});

    expect(next).toMatchObject({ ok: true });
    if (!next.ok) {
      throw new Error(next.error.message);
    }
    expect(next.value.eligible).toContain("run heuristic");
  });

  it("returns structured domain errors for missing analytical state", async () => {
    const server = createSurfaceMcpServer({
      composition: createSurfaceComposition({
        captureBackends: [captureBackendFixture(captureFixture())],
        staticFallback: captureBackendFixture(captureFixture()),
      }),
    });

    await expect(server.callTool("surface_backlog", { runId: "missing" })).resolves.toMatchObject({
      ok: false,
      error: { code: "run_not_found", kind: "RuntimeError" },
    });
    await expect(
      server.callTool("surface_explain", { findingId: "missing" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "finding_not_found", kind: "StateError" },
    });
  });

  it("runs closed-loop MCP tools over stored audit runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-mcp-state-"));
    const capture = captureFixture();
    let findingDrafts = [findingDraftFixture()];

    try {
      const server = createSurfaceMcpServer({
        composition: compositionFixture({
          capture,
          lensRegistry: [lensRegistrationFixture(() => findingDrafts)],
          projectRoot: root,
        }),
      });

      const before = await server.callTool("surface_audit", { target: capture.target });

      if (!before.ok) {
        throw new Error(before.error.message);
      }

      await expect(
        server.callTool("surface_gate", { runId: before.value.runId }),
      ).resolves.toMatchObject({
        ok: true,
        value: { exitCode: 1, failingFindingIds: [findingDrafts[0]?.draftId] },
      });
      await expect(
        server.callTool("surface_validate", { runId: before.value.runId }),
      ).resolves.toMatchObject({
        ok: true,
        value: { checks: [{ findingId: findingDrafts[0]?.draftId, passed: true }] },
      });
      await expect(
        server.callTool("surface_baseline", { reason: "accepted current debt" }),
      ).resolves.toMatchObject({
        ok: true,
        value: { count: 1 },
      });
      await expect(
        server.callTool("surface_gate", { runId: before.value.runId }),
      ).resolves.toMatchObject({
        ok: true,
        value: { exitCode: 0, failingFindingIds: [] },
      });
      await expect(
        server.callTool("surface_verdict", {
          decision: "accept",
          findingId: findingDrafts[0]?.draftId,
          rationale: "matches measured evidence",
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: { decision: "accept", findingId: findingDrafts[0]?.draftId },
      });
      await expect(
        server.callTool("surface_trace", { findingId: findingDrafts[0]?.draftId }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          baseline: {
            accepted: true,
            baselineId: "baseline_mcp_0001",
            reason: "accepted current debt",
          },
          trackedFinding: { currentFindingId: findingDrafts[0]?.draftId, status: "new" },
          verdict: {
            decision: "accept",
            findingId: findingDrafts[0]?.draftId,
            rationale: "matches measured evidence",
          },
        },
      });

      findingDrafts = [
        findingDraftFixture({
          draftId: "f_accessibility_2",
          selector: ".secondary",
          title: "Secondary control contrast is too low",
        }),
      ];
      const after = await server.callTool("surface_audit", { target: capture.target });

      if (!after.ok) {
        throw new Error(after.error.message);
      }

      await expect(
        server.callTool("surface_diff", {
          after: { runId: after.value.runId },
          before: { runId: before.value.runId },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          introduced: [{ findingId: "f_accessibility_2" }],
          resolved: [{ findingId: "f_accessibility_1" }],
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("runs advertised alternatives and pipeline MCP tools through concrete handlers", async () => {
    const capture = captureFixture();
    const server = createSurfaceMcpServer({
      composition: compositionFixture({ capture }),
    });

    const alternatives = await server.callTool("surface_alternatives", { target: capture.target });

    expect(alternatives).toMatchObject({
      ok: true,
      value: { alternatives: { target: capture.target } },
    });
    if (!alternatives.ok) {
      throw new Error(alternatives.error.message);
    }
    expect(alternatives.value.alternatives.proposals).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "alt_preserve_structure" })]),
    );
    await expect(server.callTool("surface_next", {})).resolves.toMatchObject({
      ok: true,
      value: { eligible: ["run discovery", "run all"] },
    });
    const run = await server.callTool("surface_run", { step: "all" });

    expect(run).toMatchObject({
      ok: true,
      value: {
        stage: "all",
        status: "completed",
      },
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await expect(server.callTool("surface_next", {})).resolves.toMatchObject({
      ok: true,
      value: { eligible: [] },
    });
    await expect(server.callTool("surface_status", {})).resolves.toMatchObject({
      ok: true,
      value: {
        currentStage: "completed",
        progress: { completedRuns: 1, failedRuns: 0, findings: 0 },
        runHistory: [{ runId: run.value.runId, stage: "all", status: "completed" }],
      },
    });
    await expect(
      server.callTool("surface_gate", { runId: run.value.runId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "run_not_found" },
    });
    await expect(
      server.callTool("surface_validate", { runId: run.value.runId }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "run_not_found" },
    });
    await expect(server.callTool("surface_run", { step: "missing" })).resolves.toMatchObject({
      ok: false,
      error: { code: "unknown_step", kind: "UsageError" },
    });
  });

  it("runs matching browser QA flows for surface_gate withFlows", async () => {
    const capture = captureFixture();
    const base = compositionFixture({ capture });
    const flowService = {
      runFlowFile: vi.fn(() =>
        Promise.resolve(
          ok({
            flowRun: {
              degradation: [],
              evidenceBundles: [],
              findingIds: [],
              flowId: "checkout",
              gateEligible: true,
              highestFailedSeverity: "high" as const,
              id: "flowrun_checkout",
              isolation: {
                mode: "isolated" as const,
                mutatesState: false,
                resetSatisfied: false,
              },
              severity: "high" as const,
              source: {
                kind: "file" as const,
                ref: "../../fixtures/browser-qa/flows/checkout.yml",
              },
              status: "failed" as const,
              steps: [],
              target: { kind: "url" as const, ref: "http://localhost:3000" },
            },
            qaRunId: "qa_checkout",
          }),
        ),
      ),
    };
    const server = createSurfaceMcpServer({
      composition: {
        ...base,
        browserQa: {
          ...base.browserQa,
          flowService: {
            ...base.browserQa.flowService,
            ...flowService,
          },
          qaStore: {
            ...base.browserQa.qaStore,
            listFlowRuns: () => Promise.resolve(ok([])),
          },
        },
      },
    });
    const before = await server.callTool("surface_audit", { target: capture.target });

    if (!before.ok) {
      throw new Error(before.error.message);
    }

    const gate = await server.callTool("surface_gate", {
      actionPolicyRef: "fixtures/browser-qa/action-policy.json",
      runId: before.value.runId,
      withFlows: "../../fixtures/browser-qa/flows/checkout.yml",
    });

    expect(flowService.runFlowFile).toHaveBeenCalledWith({
      actionPolicyRef: "fixtures/browser-qa/action-policy.json",
      flowPath: "../../fixtures/browser-qa/flows/checkout.yml",
      writeRun: false,
    });
    expect(gate).toMatchObject({
      ok: true,
      value: { exitCode: 1, failingFlowRunIds: ["flowrun_checkout"] },
    });
  });

  it("reads browser QA artifacts through bounded registered refs", async () => {
    const server = createSurfaceMcpServer({
      composition: compositionFixtureWithBrowserQa({
        evidenceStore: {
          readArtifactByRegisteredRef: () =>
            Promise.resolve(
              ok({
                artifactId: "art_console",
                mediaType: "text/plain",
                sha256: "sha256:abc123",
                sizeBytes: 24,
                text: "redacted console summary",
                truncated: false,
              }),
            ),
        },
      }),
    });

    await expect(
      server.callTool("surface_artifact_read", {
        artifactId: "art_console",
        refId: "ev_checkout",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        artifactId: "art_console",
        text: "redacted console summary",
      },
    });
    await expect(
      server.callTool("surface_artifact_read", {
        artifactId: "art_console",
        refId: "../secret",
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

class MemoryStateStore implements StateStore {
  readonly writes: ProjectStateSnapshot[] = [];

  constructor(private state: ProjectStateSnapshot = { version: "1.0" }) {}

  readState() {
    return ok(this.state);
  }

  writeState(state: ProjectStateSnapshot) {
    this.state = state;
    this.writes.push(state);
    return ok(state);
  }

  updateState(updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot) {
    return this.writeState(updater(this.state));
  }

  writeArtifact() {
    return ok({ path: ".surface/reports/findings.json", sha256: "abc123" });
  }
}

function captureFixture(): Capture {
  return {
    id: "cap_1",
    target: { kind: "dom", ref: '<button class="primary">Buy</button>' },
    backend: "test",
    artifacts: [
      {
        id: "dom_1",
        type: "dom-snapshot",
        path: ".surface/captures/cap_1/dom.html",
        redacted: true,
      },
    ],
    capturedAt: "2026-06-01T00:00:00.000Z",
    status: "completed",
  };
}

function captureBackendFixture(capture: Capture) {
  return {
    id: "test",
    detect: () => true,
    observe: () => ok(capture),
  };
}

function findingFixture(): Finding {
  return {
    citedHeuristics: [],
    confidenceBand: "assert",
    dimensions: {
      a11yLegalRisk: 0.8,
      agentImplementability: 0.9,
      businessImpact: 0.4,
      confidence: 1,
      effort: 0.2,
      evidenceQuality: 1,
      severity: 0.8,
      userImpact: 0.7,
    },
    evidence: [],
    gatedForHuman: false,
    id: "finding_handler_preserved",
    issueType: "handler-finding",
    lens: "test",
    location: { selector: ".primary" },
    method: "measured",
    rationale: "Handler-written finding must survive pipeline metadata persistence.",
    severityBand: "P1",
    title: "Handler finding",
  };
}

function compositionFixture(input: {
  readonly capture: Capture;
  readonly lensRegistry?: readonly LensRegistration[];
  readonly projectRoot?: string;
}): SurfaceComposition {
  const base = createSurfaceComposition({
    captureBackends: [captureBackendFixture(input.capture)],
    lensRegistry: input.lensRegistry ?? [],
    ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
    ...(input.projectRoot === undefined ? { stateStore: new MemoryStateStore() } : {}),
    staticFallback: captureBackendFixture(input.capture),
  });

  return {
    ...base,
    captureService: {
      capture: () => Promise.resolve(ok(input.capture)),
    },
  };
}

function compositionFixtureWithBrowserQa(browserQa: Record<string, unknown>): SurfaceComposition {
  const base = createSurfaceComposition();
  const existingBrowserQa = (base as unknown as { readonly browserQa: Record<string, unknown> })
    .browserQa;

  return {
    ...base,
    browserQa: {
      ...existingBrowserQa,
      ...browserQa,
    },
  } as SurfaceComposition;
}

function findingDraftFixture(
  options: { readonly draftId?: string; readonly selector?: string; readonly title?: string } = {},
): FindingDraft {
  return {
    draftId: options.draftId ?? "f_accessibility_1",
    lens: "accessibility",
    issueType: "contrast-insufficient",
    method: "measured",
    title: options.title ?? "Control contrast is too low",
    rationale: "The primary control foreground does not meet the configured contrast threshold.",
    citedHeuristics: [],
    evidence: [
      {
        kind: "tool-result",
        tool: "axe",
        rule: "color-contrast",
        measuredValue: "3.1:1",
        threshold: "4.5:1",
      },
    ],
    rawDimensions: {
      agentImplementability: 0.9,
      businessImpact: 0.4,
      confidence: 1,
      effort: 0.2,
      evidenceQuality: 1,
      severity: 0.8,
      userImpact: 0.7,
    },
    location: { selector: options.selector ?? ".primary" },
  };
}

function lensRegistrationFixture(
  findingDrafts: FindingDraft | (() => FindingDraft[]),
): LensRegistration {
  return {
    id: "accessibility",
    method: "measured",
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["standard"],
    create: () => ({
      id: "accessibility",
      method: "measured",
      requiresModel: false,
      requiresLiveDom: true,
      evaluate: () => ok(typeof findingDrafts === "function" ? findingDrafts() : [findingDrafts]),
    }),
  } as const;
}
