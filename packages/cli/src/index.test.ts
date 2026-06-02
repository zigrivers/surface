import { describe, expect, it } from "vitest";

import { createSurfaceComposition, ok } from "@surface/core";

import { runSurfaceCli, type CliEnvelope } from "./index.js";

type ParsedErrorEnvelope = {
  readonly ok: false;
  readonly schemaVersion: "1.0";
  readonly error: {
    readonly code: string;
    readonly exitCode: number;
    readonly kind: string;
    readonly likelyCause: string;
    readonly nextCommand: string;
    readonly whatFailed: string;
  };
};
type TestProjectStateSnapshot = {
  readonly version: string;
  readonly baselines?: readonly {
    readonly baselineId: string;
    readonly identityKeys: readonly string[];
    readonly reason?: string | undefined;
    readonly waivers: readonly {
      readonly findingIdentityKey: string;
      readonly reason: string;
      readonly owner: string;
      readonly expiry?: string | undefined;
    }[];
  }[];
  readonly currentStage?: string;
  readonly backlog?: {
    readonly id: string;
    readonly runId: string;
    readonly entries: readonly unknown[];
  };
  readonly findings?: readonly TestFinding[];
  readonly runRecords?: readonly {
    readonly runId: string;
    readonly trackedFindings: readonly TestTrackedFinding[];
  }[];
  readonly trackedFindings?: readonly TestTrackedFinding[];
  readonly verdicts?: readonly {
    readonly decision: string;
    readonly findingId: string;
    readonly rationale: string;
  }[];
};
type TestTarget = {
  readonly kind: "url" | "localhost" | "route" | "screenshot" | "component" | "dom";
  readonly ref: string;
};
type TestCapture = {
  readonly artifacts: readonly unknown[];
  readonly backend: string;
  readonly capturedAt: string;
  readonly id: string;
  readonly status: "requested";
  readonly target: TestTarget;
};
type TestFinding = {
  readonly id: string;
  readonly citedHeuristics: readonly string[];
  readonly evidence: readonly unknown[];
  readonly gatedForHuman: boolean;
  readonly method: "measured" | "judged";
  readonly rationale: string;
  readonly severityBand: "P0" | "P1" | "P2" | "P3";
  readonly title: string;
};
type TestTrackedFinding = {
  readonly identityKey: string;
  readonly currentFindingId?: string | undefined;
  readonly firstSeenRunId: string;
  readonly gateDisposition: "active" | "ignored-by-waiver";
  readonly history: {
    readonly runId: string;
    readonly status: "new" | "still-failing" | "resolved" | "regressed" | "identity-broken";
  }[];
  readonly identity: {
    readonly anchorKind: "component" | "selector" | "file" | "element-ref";
    readonly identityKey: string;
    readonly issueType: string;
    readonly lens: string;
    readonly locationAnchor: string;
  };
  readonly lastSeenRunId: string;
  readonly status: "new" | "still-failing" | "resolved" | "regressed" | "identity-broken";
  readonly validation: {
    readonly expectation: string;
    readonly kind: "measured-rule" | "re-evaluate-lens";
  };
};

describe("@surface/cli bootstrap", () => {
  it("emits a machine-readable success envelope for --json commands", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "status"],
      composition: createSurfaceComposition({
        stateStore: {
          readState: () => ok({ version: "1.0" }),
          writeArtifact: () =>
            Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
          writeState: (state) => ok(state),
        },
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "status",
      data: { currentStage: "new" },
      ok: true,
      schemaVersion: "1.0",
    });
  });

  it("maps unknown subcommands to exit 2 usage errors with actionable JSON", async () => {
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "bogus"],
      io: { stderr: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr.at(-1) ?? "") as ParsedErrorEnvelope;

    expect(parsed).toMatchObject({
      error: {
        code: "unknown_step",
        exitCode: 2,
        kind: "UsageError",
        nextCommand: "surface --help",
      },
      ok: false,
      schemaVersion: "1.0",
    });
    expect(parsed.error.likelyCause).toContain("command");
    expect(parsed.error.whatFailed).toContain("unknown_step");
  });
});

describe("@surface/cli core verbs", () => {
  it("initializes Surface state and emits config metadata", async () => {
    const stdout: string[] = [];
    const stateStore = new MemoryStateStore();
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "init", "--preset", "agent-ready", "--depth", "4"],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state).toMatchObject({
      currentStage: "initialized",
      version: "1.0",
    });
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "init",
      data: {
        config: { evaluation: { depth: 4, preset: "agent-ready" } },
        stateDir: ".surface",
      },
      ok: true,
    });
  });

  it("runs the full pipeline through the shared orchestrator", async () => {
    const stdout: string[] = [];
    const stateStore = new MemoryStateStore();
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "run", "all"],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("")) as CliEnvelope<{
      readonly runId: string;
      readonly stage: string;
      readonly status: string;
    }>;

    expect(parsed).toMatchObject({
      command: "run",
      data: {
        stage: "all",
        status: "completed",
      },
      ok: true,
    });
    if (!parsed.ok) {
      throw new Error("Expected run to emit a success envelope.");
    }
    expect(parsed.data.runId).toMatch(/^run_/u);
    expect(stateStore.state.currentStage).toBe("completed");
  });

  it("captures a URL target through the shared capture service", async () => {
    const stdout: string[] = [];
    const capturedTargets: TestTarget[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
      composition: createSurfaceComposition({
        captureBackends: [createTestCaptureBackend(capturedTargets)],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(capturedTargets).toEqual([{ kind: "url", ref: "https://example.com" }]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      data: {
        artifacts: [],
        backend: "test",
        captureId: "capture_url",
      },
      ok: true,
    });
  });

  it("rejects capture without a target as a usage error", async () => {
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture"],
      io: { stderr: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      command: "capture",
      error: { code: "no_target", exitCode: 2 },
      ok: false,
    });
  });

  it("audits a target and returns an empty backlog when no lenses report findings yet", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<button>Buy</button>"],
      composition: createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("")) as CliEnvelope<{
      readonly backlogId: string;
      readonly findingCount: number;
      readonly runId: string;
    }>;

    expect(parsed).toMatchObject({
      command: "audit",
      data: {
        findingCount: 0,
      },
      ok: true,
    });
    if (!parsed.ok) {
      throw new Error("Expected audit to emit a success envelope.");
    }
    expect(parsed.data.runId).toMatch(/^run_/u);
    expect(parsed.data.backlogId).toMatch(/^backlog_/u);
  });
});

describe("@surface/cli findings and loop verbs", () => {
  it("explains a stored finding with rationale and evidence", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "explain", "finding_button_contrast"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          findings: [testFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "explain",
      data: {
        citedHeuristics: ["wcag-1.4.3"],
        finding: { id: "finding_button_contrast" },
        rationale: "Button text fails AA contrast.",
      },
      ok: true,
    });
  });

  it("returns the stored backlog entries", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          backlog: {
            entries: [{ findingId: "finding_button_contrast", rank: 1 }],
            id: "backlog_run_eval",
            runId: "run_eval",
          },
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "backlog",
      data: {
        backlog: [{ findingId: "finding_button_contrast", rank: 1 }],
        backlogId: "backlog_run_eval",
        runId: "run_eval",
      },
      ok: true,
    });
  });

  it("summarizes backlog human output by default and reveals details with --all", async () => {
    const createStateStore = () =>
      new MemoryStateStore({
        backlog: {
          entries: [
            {
              findingId: "finding_button_contrast",
              rank: 1,
              severityBand: "P1",
              title: "Fix button contrast",
            },
            {
              findingId: "finding_focus_state",
              rank: 2,
              severityBand: "P2",
              title: "Restore focus state",
            },
          ],
          id: "backlog_run_eval",
          runId: "run_eval",
        },
        version: "1.0",
      });
    const summarizedStdout: string[] = [];
    const allStdout: string[] = [];

    const summarizedExitCode = await runSurfaceCli({
      argv: ["node", "surface", "backlog"],
      composition: createSurfaceComposition({ stateStore: createStateStore() }),
      io: { stdout: (chunk) => summarizedStdout.push(chunk) },
    });
    const allExitCode = await runSurfaceCli({
      argv: ["node", "surface", "backlog", "--all"],
      composition: createSurfaceComposition({ stateStore: createStateStore() }),
      io: { stdout: (chunk) => allStdout.push(chunk) },
    });

    const summarized = summarizedStdout.join("");
    const all = allStdout.join("");

    expect(summarizedExitCode).toBe(0);
    expect(allExitCode).toBe(0);
    expect(summarized).toContain("surface backlog: 2 entries");
    expect(summarized).toContain("Top backlog item:");
    expect(summarized).toContain("[P1] Fix button contrast");
    expect(summarized).toContain("Hidden backlog items: 1. Use --all to show every item.");
    expect(summarized).not.toContain("Restore focus state");
    expect(summarized).not.toContain(`${String.fromCharCode(27)}[`);
    expect(all).toContain("All backlog items:");
    expect(all).toContain("[P1] Fix button contrast");
    expect(all).toContain("[P2] Restore focus state");
    expect(all).not.toContain(`${String.fromCharCode(27)}[`);
  });

  it("validates tracked findings for a run", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "validate", "--run", "run_eval"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          trackedFindings: [testTrackedFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "validate",
      data: {
        checks: [
          {
            findingId: "finding_button_contrast",
            id: "identity_button_contrast",
            passed: true,
          },
        ],
      },
      ok: true,
    });
  });

  it("exits 1 when gate finds measured findings above policy threshold", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--ci"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          findings: [testFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "gate",
      data: {
        gateResult: {
          exitCode: 1,
          failingFindingIds: ["finding_button_contrast"],
          passed: false,
        },
      },
      ok: true,
    });
  });

  it("traces a tracked finding by current finding id", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "trace", "finding_button_contrast"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          trackedFindings: [testTrackedFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "trace",
      data: {
        trackedFinding: {
          currentFindingId: "finding_button_contrast",
          identityKey: "identity_button_contrast",
        },
      },
      ok: true,
    });
  });

  it("baselines current findings and makes gate fail only on net-new findings", async () => {
    const stdout: string[] = [];
    const stateStore = new MemoryStateStore({
      findings: [testFinding()],
      trackedFindings: [testTrackedFinding()],
      version: "1.0",
    });
    const baselineExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "baseline", "--reason", "accepted current debt"],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });
    const gateExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--ci"],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(baselineExitCode).toBe(0);
    expect(gateExitCode).toBe(0);
    expect(stateStore.state.baselines?.[0]).toMatchObject({
      identityKeys: ["identity_button_contrast"],
      reason: "accepted current debt",
    });
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
  });

  it("records verdicts for stored findings", async () => {
    const stdout: string[] = [];
    const stateStore = new MemoryStateStore({
      findings: [testFinding()],
      version: "1.0",
    });
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "verdict",
        "finding_button_contrast",
        "--reject",
        "--reason",
        "False positive in reviewed theme",
      ],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.verdicts).toEqual([
      {
        decision: "reject",
        findingId: "finding_button_contrast",
        rationale: "False positive in reviewed theme",
      },
    ]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "verdict",
      data: {
        verdict: {
          decision: "reject",
          findingId: "finding_button_contrast",
          rationale: "False positive in reviewed theme",
        },
      },
      ok: true,
    });
  });

  it("diffs tracked findings between two stored runs", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "diff", "run_before", "run_after"],
      composition: createSurfaceComposition({
        stateStore: new MemoryStateStore({
          runRecords: [
            { runId: "run_before", trackedFindings: [testTrackedFinding()] },
            {
              runId: "run_after",
              trackedFindings: [
                testTrackedFinding({
                  currentFindingId: "finding_focus_state",
                  identityKey: "identity_focus_state",
                }),
              ],
            },
          ],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "diff",
      data: {
        introduced: [{ findingId: "finding_focus_state", identityKey: "identity_focus_state" }],
        resolved: [
          { findingId: "finding_button_contrast", identityKey: "identity_button_contrast" },
        ],
      },
      ok: true,
    });
  });

  it("returns bounded alternatives for a target", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "alternatives", "--dom", "<main>Checkout</main>"],
      composition: createSurfaceComposition(),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("")) as CliEnvelope<{
      readonly alternatives: {
        readonly proposals: readonly {
          readonly id: string;
          readonly rationale: string;
          readonly title: string;
        }[];
        readonly target: TestTarget;
      };
    }>;

    expect(parsed).toMatchObject({
      command: "alternatives",
      data: {
        alternatives: {
          target: { kind: "dom", ref: "<main>Checkout</main>" },
        },
      },
      ok: true,
    });
    if (!parsed.ok) {
      throw new Error("Expected alternatives to emit a success envelope.");
    }
    const proposal = parsed.data.alternatives.proposals.find(
      (candidate) => candidate.id === "alt_preserve_structure",
    );

    expect(proposal?.rationale).toContain("Bounded to the captured view");
  });
});

class MemoryStateStore {
  state: TestProjectStateSnapshot;

  constructor(state: TestProjectStateSnapshot = { version: "1.0" }) {
    this.state = state;
  }

  readState() {
    return ok(this.state);
  }

  writeState(state: TestProjectStateSnapshot) {
    this.state = state;

    return ok(state);
  }

  writeArtifact() {
    return ok({ path: ".surface/test", sha256: "sha256:test" });
  }
}

function createTestCaptureBackend(capturedTargets: TestTarget[] = []) {
  return {
    id: "test",
    detect: () => true,
    observe: (target: TestTarget) => {
      capturedTargets.push(target);

      return ok({
        artifacts: [],
        backend: "test",
        capturedAt: "2026-06-01T00:00:00.000Z",
        id: `capture_${target.kind}`,
        status: "requested",
        target,
      } satisfies TestCapture);
    },
  };
}

function testFinding(): TestFinding {
  return {
    citedHeuristics: ["wcag-1.4.3"],
    evidence: [
      {
        kind: "tool-result",
        measuredValue: "3.1:1",
        threshold: "4.5:1",
        tool: "axe",
      },
    ],
    gatedForHuman: false,
    id: "finding_button_contrast",
    method: "measured",
    rationale: "Button text fails AA contrast.",
    severityBand: "P1",
    title: "Button text fails AA contrast",
  };
}

function testTrackedFinding(overrides: Partial<TestTrackedFinding> = {}): TestTrackedFinding {
  return {
    currentFindingId: "finding_button_contrast",
    firstSeenRunId: "run_eval",
    gateDisposition: "active",
    history: [{ runId: "run_eval", status: "still-failing" }],
    identity: {
      anchorKind: "selector",
      identityKey: "identity_button_contrast",
      issueType: "contrast-insufficient",
      lens: "accessibility",
      locationAnchor: ".button",
    },
    identityKey: "identity_button_contrast",
    lastSeenRunId: "run_eval",
    status: "still-failing",
    validation: {
      expectation: "axe color-contrast passes",
      kind: "measured-rule",
    },
    ...overrides,
  };
}
