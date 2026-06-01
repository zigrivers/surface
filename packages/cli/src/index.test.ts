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
  readonly currentStage?: string;
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

  it("captures a DOM target through the shared capture service", async () => {
    const stdout: string[] = [];
    const capturedTargets: TestTarget[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--dom", "<main>Hello</main>"],
      composition: createSurfaceComposition({
        captureBackends: [createTestCaptureBackend(capturedTargets)],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(capturedTargets).toEqual([{ kind: "dom", ref: "<main>Hello</main>" }]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      data: {
        artifacts: [],
        backend: "test",
        captureId: "capture_dom",
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
