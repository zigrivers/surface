import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createSurfaceComposition,
  ok,
  type FindingDraft,
  type LensRegistration,
  type SurfaceComposition,
} from "@zigrivers/surface-core";
import type { Capture } from "@zigrivers/surface-core/interfaces";

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
        value: { trackedFinding: { currentFindingId: findingDrafts[0]?.draftId, status: "new" } },
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
    await expect(server.callTool("surface_run", { step: "all" })).resolves.toMatchObject({
      ok: true,
      value: {
        stage: "all",
        status: "completed",
      },
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

function compositionFixture(input: {
  readonly capture: Capture;
  readonly lensRegistry?: readonly LensRegistration[];
  readonly projectRoot?: string;
}): SurfaceComposition {
  const base = createSurfaceComposition({
    captureBackends: [captureBackendFixture(input.capture)],
    lensRegistry: input.lensRegistry ?? [],
    ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
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
