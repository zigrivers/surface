import { describe, expect, it, vi } from "vitest";

import { ok } from "@zigrivers/surface-core";

import { createBrowserQaMcpHandlers, createBrowserQaMcpTools } from "./browser-qa-tools.js";

describe("browser QA MCP tools", () => {
  it("registers agent-facing QA tools", () => {
    const tools = createBrowserQaMcpTools(makeFakeQaHandlers());

    expect(tools.map((tool) => tool.name)).toEqual([
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

  it("returns bounded redacted artifact summaries", async () => {
    const artifactRead = createBrowserQaMcpTools(makeFakeQaHandlers()).find(
      (tool) => tool.name === "surface_artifact_read",
    );

    if (artifactRead === undefined) {
      throw new Error("surface_artifact_read was not registered.");
    }

    const result = await artifactRead.handler({
      artifactId: "art_console",
      maxBytes: 8192,
      refId: "ev_checkout",
    });

    expect(result.content[0]?.text).toContain("redacted");
    expect(result.content[0]?.type).toBe("text");
  });

  it("rejects caller-supplied paths", async () => {
    const artifactRead = createBrowserQaMcpTools(makeFakeQaHandlers()).find(
      (tool) => tool.name === "surface_artifact_read",
    );

    if (artifactRead === undefined) {
      throw new Error("surface_artifact_read was not registered.");
    }

    await expect(
      artifactRead.handler({ artifactId: "art_console", refId: "/tmp/secret" }),
    ).resolves.toMatchObject({ isError: true });
  });

  it("normalizes localhost false out of flow run target options", async () => {
    const runFlowFile = vi.fn(() =>
      Promise.resolve(ok({ flowRun: { id: "flowrun_checkout" }, qaRunId: "qa_flow" })),
    );
    const handlers = createBrowserQaMcpHandlers({
      browserQa: {
        flowService: {
          runFlowFile,
        },
      },
    });

    await handlers.flowRun({ flowPath: "surface-flows/checkout.yml", localhost: false });

    expect(runFlowFile).toHaveBeenCalledWith(
      expect.objectContaining({
        flowPath: "surface-flows/checkout.yml",
        targetCli: {},
      }),
    );
  });
});

function makeFakeQaHandlers() {
  return {
    artifactRead: vi.fn(() =>
      Promise.resolve(
        ok({
          artifactId: "art_console",
          mediaType: "text/plain",
          sha256: "sha256:abc123",
          sizeBytes: 12,
          text: "redacted console summary",
          truncated: false,
        }),
      ),
    ),
    evidence: vi.fn(() => Promise.resolve(ok({ refId: "ev_checkout", summaries: [] }))),
    explore: vi.fn(() =>
      Promise.resolve(ok({ candidateFindings: [], candidateFlows: [], qaRunId: "qa_explore" })),
    ),
    flowList: vi.fn(() => Promise.resolve(ok({ flows: [] }))),
    flowPromote: vi.fn(() =>
      Promise.resolve(ok({ candidateFlowId: "qflow_checkout", outPath: "surface-flows/out.yml" })),
    ),
    flowRun: vi.fn(() =>
      Promise.resolve(ok({ flowRun: { id: "flowrun_checkout" }, qaRunId: "qa_flow" })),
    ),
    qa: vi.fn(() =>
      Promise.resolve(
        ok({
          candidateFindings: [],
          candidateFlows: [],
          qaRunId: "qa_cli",
        }),
      ),
    ),
    replay: vi.fn(() => Promise.resolve(ok({ replayStatus: "not-reproduced" }))),
    reportQa: vi.fn(() =>
      Promise.resolve(ok({ format: "manifest", report: { qaRunId: "qa_cli" } })),
    ),
  };
}
