import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createAccessibilityLens,
  createSurfaceComposition,
  createSurfaceError,
  createUsabilityHeuristicLens,
  deriveFindingIdentity,
  err,
  ok,
  type AuditRunnerInput,
  type AuditRunnerResult,
  type Finding as TestFinding,
  type ModelProvider,
  type SurfaceConfig,
  type TrackedFinding as TestTrackedFinding,
} from "@zigrivers/surface-core";
import type {
  Capture as TestCapture,
  PersistArtifactIntent,
  ProjectStateSnapshot as TestProjectStateSnapshot,
  StateStore,
  Target as TestTarget,
} from "@zigrivers/surface-core/interfaces";

import { runSurfaceCli, type CliEnvelope } from "./index.js";

type ParsedErrorEnvelope = {
  readonly ok: false;
  readonly schemaVersion: "1.0";
  readonly error: {
    readonly code: string;
    readonly details?: Record<string, unknown>;
    readonly exitCode: number;
    readonly kind: string;
    readonly likelyCause: string;
    readonly nextCommand: string;
    readonly whatFailed: string;
  };
};
describe("@zigrivers/surface bootstrap", () => {
  it("prints the package version for --version", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--version"],
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe("0.2.2");
  });

  it("emits a machine-readable success envelope for --json status", async () => {
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
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "bogus"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    const parsed = JSON.parse(stdout.join("")) as ParsedErrorEnvelope;

    expect(parsed).toMatchObject({
      error: {
        code: "unknown_command",
        exitCode: 2,
        kind: "UsageError",
        nextCommand: "surface --help",
      },
      ok: false,
      schemaVersion: "1.0",
    });
    expect(parsed.error.likelyCause).toContain("command");
    expect(parsed.error.whatFailed).toContain("unknown_command");
  });

  it("emits top-level parse errors to stdout when --json appears after the command", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "status", "--bogus", "--json"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "status",
      error: {
        code: "unknown_option",
        exitCode: 2,
        kind: "UsageError",
        nextCommand: "surface status --help",
      },
      ok: false,
    });
  });

  it("emits command-specific recovery guidance for unknown options", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "status", "--bogus"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "status",
      error: {
        code: "unknown_option",
        nextCommand: "surface status --help",
      },
      ok: false,
    });
  });

  it("falls back to top-level help for top-level unknown options", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "--bogus"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "surface",
      error: {
        code: "unknown_option",
        nextCommand: "surface --help",
      },
      ok: false,
    });
  });

  it("does not use a later command for unknown global option recovery guidance", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "--bogus", "status"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "surface",
      error: {
        code: "unknown_option",
        nextCommand: "surface --help",
      },
      ok: false,
    });
  });

  it("does not use a later command after unknown global options with values", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "--bogus=value", "status"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "surface",
      error: {
        code: "unknown_option",
        nextCommand: "surface --help",
      },
      ok: false,
    });
  });

  it("does not treat literal arguments after -- as a JSON mode request", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "status", "--bogus", "--", "--json"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stdout.join("")).toBe("");
    const envelope = stderr.join("").trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(envelope)).toMatchObject({
      command: "status",
      error: {
        code: "unknown_option",
        exitCode: 2,
      },
      ok: false,
    });
  });

  it("does not treat unsupported --json value forms as JSON mode requests", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "status", "--bogus", "--json=true"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stdout.join("")).toBe("");
    const envelope = stderr.join("").trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(envelope)).toMatchObject({
      command: "status",
      error: {
        code: "unknown_option",
        exitCode: 2,
      },
      ok: false,
    });
  });

  it("does not suggest repeating status for corrupt state", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "status"],
      composition: createSurfaceComposition({
        stateStore: {
          readState: () => err(createSurfaceError("state_corrupt", "State file is corrupt.")),
          writeArtifact: () =>
            Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
          writeState: (state) => ok(state),
        },
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: { code: "state_corrupt", nextCommand: "surface init --force --json" },
      ok: false,
    });
  });
});

describe("@zigrivers/surface core verbs", () => {
  it("initializes Surface state and emits config metadata", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore();
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

  it("applies SURFACE environment config during init", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "init"],
      composition: createSurfaceComposition({ stateStore: new TestMemoryStateStore() }),
      env: {
        SURFACE_MODEL_CHANNELS: "claude,codex",
        SURFACE_MODEL_DEPTH: "4",
        SURFACE_MODEL_FALLBACK: "auto",
      },
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "init",
      data: {
        config: {
          model: {
            fallback: {
              depth: 4,
              mode: "auto",
              providerOrder: ["claude", "codex"],
            },
          },
        },
      },
      ok: true,
    });
  });

  it("runs the full pipeline through the shared orchestrator", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore();
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

  it("purges generated model egress artifacts on request", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-cleanup-model-egress-"));
    const stdout: string[] = [];

    try {
      const artifactPath = join(root, "custom-state", "model-egress", "run_cleanup", "dom.txt");
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, "sanitized text");
      const compositionWithCustomStateDir = {
        ...createSurfaceComposition({
          projectRoot: root,
          stateDir: "custom-state",
          stateStore: new TestMemoryStateStore(),
        }),
        stateDir: "custom-state",
      } as ReturnType<typeof createSurfaceComposition> & { readonly stateDir: string };

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "cleanup", "model-egress"],
        composition: compositionWithCustomStateDir,
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(existsSync(join(root, "custom-state", "model-egress"))).toBe(false);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "cleanup",
        data: {
          area: "model-egress",
          path: "custom-state/model-egress",
        },
        ok: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects model-backed judgement on the legacy run pipeline", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "run", "all"],
      composition: createSurfaceComposition({ stateStore: new TestMemoryStateStore() }),
      env: { SURFACE_MODEL_FALLBACK: "direct" },
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "run",
      error: {
        code: "config_invalid",
        message: "Model-backed judgement is only supported by surface audit.",
      },
      ok: false,
    });
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

  it("loads project capture config for capture runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-capture-project-config-"));
    const seenRedactionRules: SurfaceConfig["capture"]["redactionRules"][] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      await writeFile(
        join(root, ".surface", "config.yml"),
        [
          "capture:",
          "  redactionRules:",
          "    - pattern: pk_live_[A-Za-z0-9]+",
          "      appliesTo: [dom]",
          "",
        ].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
        composition: createSurfaceComposition({
          captureBackends: [
            {
              id: "test",
              detect: () => true,
              observe: (target: TestTarget, options) => {
                seenRedactionRules.push(options.config.redactionRules);

                return ok({
                  artifacts: [],
                  backend: "test",
                  capturedAt: "2026-06-01T00:00:00.000Z",
                  id: `capture_${target.kind}`,
                  status: "requested",
                  target,
                } satisfies TestCapture);
              },
            },
          ],
          lensFactoryOptions: { projectRoot: root },
        }),
        env: { SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(seenRedactionRules[0]).toEqual([
        { appliesTo: ["dom"], pattern: "pk_live_[A-Za-z0-9]+" },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("suggests allowlisted URL recovery for allowlist capture rejections", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-capture-allowlist-recovery-"));
    const stdout: string[] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      await writeFile(
        join(root, ".surface", "config.yml"),
        ["capture:", "  allowlist:", "    - https://allowed.example.com", ""].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "capture",
          "--url",
          "https://example.com/private?token=secret",
        ],
        composition: createSurfaceComposition({
          captureBackends: [
            {
              id: "test",
              detect: () => true,
              observe: () => {
                throw new Error("capture backend should not run for rejected targets");
              },
            },
          ],
          lensFactoryOptions: { projectRoot: root },
        }),
        env: { SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: (chunk) => stdout.push(chunk) },
      });
      const parsed = JSON.parse(stdout.join("")) as ParsedErrorEnvelope;

      expect(exitCode).toBe(1);
      expect(parsed).toMatchObject({
        command: "capture",
        error: {
          code: "target_not_allowed",
          details: {
            reason: "allowlist-mismatch",
            targetOrigin: "https://example.com",
          },
          nextCommand: "surface capture --url <allowlisted-url> --json",
        },
        ok: false,
      });
      expect(JSON.stringify(parsed.error.details)).not.toContain("targetRef");
      expect(JSON.stringify(parsed.error.details)).not.toContain("secret");
      expect(JSON.stringify(parsed.error.details)).not.toContain("allowed.example.com");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("applies project capture redaction rules to inline DOM capture artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-inline-dom-capture-config-"));
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore();

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      await writeFile(
        join(root, ".surface", "config.yml"),
        [
          "capture:",
          "  redactionRules:",
          "    - pattern: pk_live_[A-Za-z0-9]+",
          "      appliesTo: [dom]",
          "",
        ].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "capture",
          "--dom",
          "<main><p>pk_live_secret123</p></main>",
        ],
        composition: createSurfaceComposition({
          lensFactoryOptions: { projectRoot: root },
          stateStore,
        }),
        env: { SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: (chunk) => stdout.push(chunk) },
      });
      const persistedDom = Buffer.from(
        stateStore.artifactWrites.at(-1)?.bytes ?? new Uint8Array(),
      ).toString();

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        data: { artifacts: [{ redacted: true, type: "dom-snapshot" }] },
        ok: true,
      });
      expect(persistedDom).toContain("[Redacted]");
      expect(persistedDom).not.toContain("pk_live_secret123");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects capture without a target as a usage error", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture"],
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: { code: "no_target", exitCode: 2 },
      ok: false,
    });
  });

  it("reports unresolved public capture hosts as unreachable URL targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://surface-unresolved.invalid"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () => {
              throw new Error("capture backend should not run for unresolved hosts");
            },
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "capture_unreachable",
        details: {
          reason: "host-unresolved",
          targetKind: "url",
        },
        nextCommand: "surface capture --url <url> --json",
      },
      ok: false,
    });
  });

  it("suggests localhost auth-state recovery for localhost capture targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--localhost"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError(
                  "auth_injection_failed",
                  "Auth state must be a valid Playwright storage-state JSON file.",
                  {
                    details: { reason: "invalid-storage-state", targetKind: "localhost" },
                  },
                ),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "auth_injection_failed",
        nextCommand: "surface capture --localhost <url> --auth-state <path> --json",
      },
      ok: false,
    });
  });

  it("suggests localhost auth recovery for localhost target verification failures", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--localhost"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError(
                  "auth_injection_failed",
                  "Authenticated capture did not land on the requested target.",
                  {
                    details: { reason: "target-verification-failed", targetKind: "localhost" },
                  },
                ),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "auth_injection_failed",
        nextCommand: "surface capture --localhost <url> --auth-state <path> --json",
      },
      ok: false,
    });
  });

  it("suggests URL capture recovery for unreachable URL targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError("capture_unreachable", "Capture target is unreachable.", {
                  details: { targetKind: "url" },
                }),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "capture_unreachable",
        nextCommand: "surface capture --url <url> --json",
      },
      ok: false,
    });
  });

  it("uses the generic recovery command for non-capture target_not_allowed errors", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () => err(createSurfaceError("target_not_allowed", "Target is not allowed.")),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        nextCommand: "surface status --json",
      },
      ok: false,
    });
  });

  it("does not suggest localhost recovery for unsafe non-loopback URL targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "http://169.254.169.254"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () => {
              throw new Error("capture backend should not run for unsafe hosts");
            },
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        details: { host: "169.254.169.254", reason: "unsafe-host", targetKind: "url" },
        nextCommand: "surface capture --help",
      },
      ok: false,
    });
  });

  it("rejects unsafe metadata hostnames before DNS resolution", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "http://metadata.google.internal"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () => {
              throw new Error("capture backend should not run for unsafe metadata hosts");
            },
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        details: {
          host: "metadata.google.internal",
          reason: "unsafe-host",
          targetKind: "url",
        },
        nextCommand: "surface capture --help",
      },
      ok: false,
    });
  });

  it("does not treat hostnames that start with 127 as loopback recovery targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError("target_not_allowed", "Capture target host is not allowed.", {
                  details: { host: "127.example.com", reason: "unsafe-host", targetKind: "url" },
                }),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        nextCommand: "surface capture --help",
      },
      ok: false,
    });
  });

  it("does not treat nonzero IPv6-compatible hosts as loopback recovery targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "https://example.com"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError("target_not_allowed", "Capture target host is not allowed.", {
                  details: {
                    host: "::1234:5678:7f00:1",
                    reason: "unsafe-host",
                    targetKind: "url",
                  },
                }),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        nextCommand: "surface capture --help",
      },
      ok: false,
    });
  });

  it("suggests localhost recovery for URL targets using local bind hosts", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--url", "http://0.0.0.0:3000"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () => {
              throw new Error("capture backend should not run for local bind hosts");
            },
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "target_not_allowed",
        details: { host: "0.0.0.0", reason: "unsafe-host", targetKind: "url" },
        nextCommand: "surface capture --localhost <url> --json",
      },
      ok: false,
    });
  });

  it("suggests localhost capture recovery for unreachable localhost targets", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "capture", "--localhost"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: () =>
              err(
                createSurfaceError("capture_unreachable", "Capture target is unreachable.", {
                  details: { targetKind: "localhost" },
                }),
              ),
          },
        ],
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "capture",
      error: {
        code: "capture_unreachable",
        nextCommand: "surface capture --localhost <url> --json",
      },
      ok: false,
    });
  });

  it("audits a target and returns an empty backlog when no lenses report findings yet", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<button>Buy</button>"],
      composition: createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        lensRegistry: [],
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

  it("passes grounding tool evidence into measured lenses during CLI audit", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<button>Buy</button>"],
      composition: createSurfaceComposition({
        captureBackends: [
          {
            id: "test",
            detect: () => true,
            observe: async (target: TestTarget) => {
              await Promise.resolve();

              return ok({
                artifacts: [
                  {
                    id: "dom",
                    path: ".surface/captures/dom.html",
                    redacted: false,
                    type: "dom-snapshot",
                  },
                ],
                backend: "test",
                capturedAt: "2026-06-01T00:00:00.000Z",
                id: "capture_dom",
                status: "completed",
                target,
              });
            },
          },
        ],
        groundingTools: [
          {
            id: "axe-test",
            run: async () => {
              await Promise.resolve();

              return ok([
                {
                  evidence: [
                    {
                      kind: "tool-result",
                      measuredValue: "button.buy contrast ratio 3.1:1",
                      rule: "color-contrast",
                      threshold: "4.5:1",
                      tool: "axe",
                    },
                  ],
                  tool: "axe-test",
                },
              ]);
            },
          },
        ],
        lensRegistry: [
          {
            id: "accessibility",
            create: () => createAccessibilityLens(),
            method: "measured",
            presets: ["standard"],
            requiresLiveDom: true,
            requiresModel: false,
          },
        ],
        stateStore: new TestMemoryStateStore(),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });
    const parsed = JSON.parse(stdout.join("")) as CliEnvelope<{
      readonly findingCount: number;
      readonly topFinding?: TestFinding;
    }>;

    expect(exitCode).toBe(0);
    expect(parsed).toMatchObject({
      data: {
        findingCount: 1,
        topFinding: {
          issueType: "contrast-insufficient",
          lens: "accessibility",
        },
      },
      ok: true,
    });
  });

  it("maps model fallback flags to one-run config consent", async () => {
    const stdout: string[] = [];
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const composition = compositionWithAuditSpy(seenConfigs);
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        "<main>Checkout</main>",
        "--model-fallback",
        "direct",
        "--model-channel",
        "codex",
        "--model-depth",
        "5",
        "--model-screenshots",
      ],
      composition,
      env: {},
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model).toMatchObject({
      effectiveEgressPolicy: { mode: "text-and-screenshots", screenshots: "redacted-only" },
      fallback: {
        depth: 5,
        effectiveChannels: ["codex"],
        mode: "direct",
        providerOrder: ["codex"],
      },
    });
  });

  it("keeps screenshot egress blocked when no screenshot flag is supplied", async () => {
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        "<main>Checkout</main>",
        "--model-fallback",
        "direct",
        "--model-channel",
        "codex",
      ],
      composition: compositionWithAuditSpy(seenConfigs),
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model.effectiveEgressPolicy).toMatchObject({
      mode: "text",
      screenshots: "blocked",
    });
  });

  it("normalizes comma-separated and repeatable model channel flags together", async () => {
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        "<main>Checkout</main>",
        "--model-fallback",
        "direct",
        "--model-channels",
        "claude,gemini",
        "--model-channel",
        "codex",
        "--model-channel",
        "claude",
      ],
      composition: compositionWithAuditSpy(seenConfigs),
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model.fallback.effectiveChannels).toEqual(["claude", "gemini", "codex"]);
  });

  it("accepts --no-model-screenshots as an explicit runtime block", async () => {
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        "<main>Checkout</main>",
        "--model-fallback",
        "direct",
        "--model-channel",
        "codex",
        "--no-model-screenshots",
      ],
      composition: compositionWithAuditSpy(seenConfigs),
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model.effectiveEgressPolicy).toMatchObject({
      mode: "text",
      screenshots: "blocked",
    });
  });

  it("lets CLI model fallback off disable fallback without revoking egress consent", async () => {
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        "<main>Checkout</main>",
        "--model-fallback",
        "off",
      ],
      composition: compositionWithAuditSpy(seenConfigs),
      env: {
        SURFACE_MODEL_CHANNELS: "gemini",
        SURFACE_MODEL_FALLBACK: "direct",
      },
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model).toMatchObject({
      effectiveEgressPolicy: {
        mode: "text",
        screenshots: "blocked",
      },
      fallback: {
        effectiveChannels: [],
        mode: "off",
      },
    });
  });

  it("treats BYO provider env as text egress consent without enabling fallback", async () => {
    const seenConfigs: AuditRunnerInput["config"][] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(seenConfigs),
      env: { OPENAI_API_KEY: "sk-test" },
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenConfigs[0]?.model).toMatchObject({
      effectiveEgressPolicy: { mode: "text", screenshots: "blocked" },
      fallback: { effectiveChannels: [], mode: "off" },
    });
  });

  it("passes the requested audit lens through to the audit runner", async () => {
    const seenInputs: AuditRunnerInput[] = [];
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore: new TestMemoryStateStore(),
      }),
      auditRunner: async (input: AuditRunnerInput) => {
        await Promise.resolve();
        seenInputs.push(input);

        return ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        });
      },
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "accessibility",
        "--dom",
        "<main>Checkout</main>",
      ],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(seenInputs[0]?.lensId).toBe("accessibility");
  });

  it("loads project config as a model policy layer for audit runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-project-config-"));
    const seenConfigs: AuditRunnerInput["config"][] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      const configPath = join(root, ".surface", "config.yml");
      await writeFile(
        configPath,
        [
          "model:",
          "  fallback:",
          "    providerOrder: [gemini, codex]",
          "  egressPolicy:",
          "    deniedChannels: [codex]",
          "evaluation:",
          "  depth: 5",
          "  preset: deep",
          "",
        ].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "audit",
          "--dom",
          "<main>Checkout</main>",
          "--model-fallback",
          "direct",
        ],
        composition: compositionWithAuditSpy(seenConfigs),
        env: { SURFACE_PROJECT_CONFIG_PATH: configPath, SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(seenConfigs[0]?.evaluation).toMatchObject({ depth: 5, preset: "deep" });
      expect(seenConfigs[0]?.model.fallback.effectiveChannels).toEqual(["gemini"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads default project config from the composition project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-composition-project-root-"));
    const seenConfigs: AuditRunnerInput["config"][] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      await writeFile(
        join(root, ".surface", "config.yml"),
        [
          "evaluation:",
          "  depth: 5",
          "model:",
          "  fallback:",
          "    providerOrder: [gemini]",
          "",
        ].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "audit",
          "--dom",
          "<main>Checkout</main>",
          "--model-fallback",
          "direct",
        ],
        composition: compositionWithAuditSpy(seenConfigs, { projectRoot: root }),
        env: { SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(seenConfigs[0]?.evaluation.depth).toBe(5);
      expect(seenConfigs[0]?.model.fallback.effectiveChannels).toEqual(["gemini"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports project config model path details for invalid subscription channels", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-invalid-project-config-"));
    const stdout: string[] = [];
    const stderr: string[] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      const configPath = join(root, ".surface", "config.yml");
      await writeFile(
        configPath,
        ["model:", "  fallback:", "    providerOrder: [grok]", ""].join("\n"),
      );

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
        composition: compositionWithAuditSpy([]),
        env: { SURFACE_PROJECT_CONFIG_PATH: configPath, SURFACE_USER_CONFIG_PATH: "off" },
        io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toBe("");
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        error: {
          code: "config_invalid",
          details: {
            issues: [
              expect.objectContaining({
                path: "project.model.fallback.providerOrder.0",
              }),
            ],
          },
        },
        ok: false,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("executes a direct subscription provider through config/env/CLI layering", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-direct-provider-"));
    const stateStore = new TestMemoryStateStore();
    const requests: unknown[] = [];
    const provider = {
      id: "codex",
      availability: () =>
        ok({
          available: true,
          channelId: "codex",
          model: "codex-model",
          provider: "codex",
          sourceKind: "subscription-cli",
        }),
      complete: (request) => {
        requests.push(request);

        return ok({
          channelId: "codex",
          model: "codex-model",
          provider: "codex",
          sourceKind: "subscription-cli",
          text: "[]",
        });
      },
    } satisfies ModelProvider;

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      const configPath = join(root, ".surface", "config.yml");
      await writeFile(
        configPath,
        [
          "model:",
          "  fallback:",
          "    providerOrder: [gemini, codex]",
          "  egressPolicy:",
          "    deniedChannels: [gemini]",
          "",
        ].join("\n"),
      );

      const composition = createSurfaceComposition({
        lensRegistry: [
          {
            id: "usability",
            create: (options) => createUsabilityHeuristicLens(options),
            method: "judged",
            presets: ["standard"],
            requiredArtifacts: ["dom-snapshot"],
            requiresLiveDom: true,
            requiresModel: true,
          },
        ],
        projectRoot: root,
        resolveSubscriptionProviders: (config) => {
          expect(config.model.fallback.effectiveChannels).toEqual(["codex"]);

          return {
            discoveryUnavailableChannels: [],
            subscriptionProviders: [provider],
          };
        },
        stateStore: {
          readState: () => stateStore.readState(),
          writeArtifact: async (input) => {
            const absolutePath = join(root, ".surface", input.relativePath);
            await mkdir(dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, input.bytes);

            return ok({ path: join(".surface", input.relativePath), sha256: "sha256:test" });
          },
          writeState: (state: TestProjectStateSnapshot) => stateStore.writeState(state),
        },
      });
      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "audit",
          "--dom",
          '<main data-token="sk-live-secret">Checkout</main>',
          "--model-fallback",
          "direct",
        ],
        composition,
        env: {
          SURFACE_MODEL_CHANNELS: "codex,gemini",
          SURFACE_PROJECT_CONFIG_PATH: configPath,
          SURFACE_USER_CONFIG_PATH: "off",
        },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests)).not.toContain("sk-live-secret");
      expect(stateStore.state.modelEgress).toMatchObject([
        {
          artifactClassesSent: ["dom-snapshot"],
          attemptedChannels: ["codex", "gemini"],
          blockedReasons: ["channel_denied_by_policy"],
          completedChannels: ["codex"],
          sourceKind: "subscription-cli",
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats empty project config files as empty config layers", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-empty-project-config-"));
    const seenConfigs: AuditRunnerInput["config"][] = [];

    try {
      await mkdir(join(root, ".surface"), { recursive: true });
      const configPath = join(root, ".surface", "config.yml");
      await writeFile(configPath, "# no project overrides yet\n");

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
        composition: compositionWithAuditSpy(seenConfigs),
        env: { SURFACE_PROJECT_CONFIG_PATH: configPath, SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(seenConfigs[0]?.evaluation.preset).toBe("standard");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("treats project config directories as missing optional config files", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-dir-project-config-"));
    const seenConfigs: AuditRunnerInput["config"][] = [];

    try {
      const configPath = join(root, ".surface", "config.yml");
      await mkdir(configPath, { recursive: true });

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
        composition: compositionWithAuditSpy(seenConfigs),
        env: { SURFACE_PROJECT_CONFIG_PATH: configPath, SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(seenConfigs[0]?.evaluation.preset).toBe("standard");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("maps model fallback env from injected env and keeps screenshot-only env from enabling fallback", async () => {
    const envConfigs: AuditRunnerInput["config"][] = [];
    const screenshotOnlyConfigs: AuditRunnerInput["config"][] = [];
    const envExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(envConfigs),
      env: {
        SURFACE_MODEL_CHANNELS: "claude,codex",
        SURFACE_MODEL_DEPTH: "4",
        SURFACE_MODEL_FALLBACK: "auto",
        SURFACE_MODEL_SCREENSHOTS: "redacted-only",
      },
      io: { stdout: () => undefined },
    });
    const screenshotExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(screenshotOnlyConfigs),
      env: {
        SURFACE_MODEL_SCREENSHOTS: "redacted-only",
      },
      io: { stdout: () => undefined },
    });

    expect(envExitCode).toBe(0);
    expect(envConfigs[0]?.model).toMatchObject({
      effectiveEgressPolicy: { mode: "text-and-screenshots", screenshots: "redacted-only" },
      fallback: {
        depth: 4,
        effectiveChannels: ["claude", "codex"],
        mode: "auto",
      },
    });
    expect(screenshotExitCode).toBe(0);
    expect(screenshotOnlyConfigs[0]?.model).toMatchObject({
      effectiveEgressPolicy: { mode: "text-and-screenshots", screenshots: "redacted-only" },
      fallback: { effectiveChannels: [], mode: "off" },
    });
  });

  it("normalizes boolean screenshot env values and ignores nonnumeric model depth", async () => {
    const trueConfigs: AuditRunnerInput["config"][] = [];
    const falseConfigs: AuditRunnerInput["config"][] = [];
    const invalidDepthConfigs: AuditRunnerInput["config"][] = [];
    const partialDepthConfigs: AuditRunnerInput["config"][] = [];
    const trueExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(trueConfigs),
      env: { SURFACE_MODEL_SCREENSHOTS: "true" },
      io: { stdout: () => undefined },
    });
    const falseExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(falseConfigs),
      env: {
        SURFACE_MODEL_FALLBACK: "auto",
        SURFACE_MODEL_SCREENSHOTS: "false",
      },
      io: { stdout: () => undefined },
    });
    const invalidDepthExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(invalidDepthConfigs),
      env: {
        SURFACE_MODEL_DEPTH: "not-a-number",
        SURFACE_MODEL_FALLBACK: "auto",
      },
      io: { stdout: () => undefined },
    });
    const partialDepthExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition: compositionWithAuditSpy(partialDepthConfigs),
      env: {
        SURFACE_MODEL_DEPTH: "5abc",
        SURFACE_MODEL_FALLBACK: "auto",
      },
      io: { stdout: () => undefined },
    });

    expect(trueExitCode).toBe(0);
    expect(falseExitCode).toBe(0);
    expect(invalidDepthExitCode).toBe(0);
    expect(partialDepthExitCode).toBe(0);
    expect(trueConfigs[0]?.model.effectiveEgressPolicy).toMatchObject({
      mode: "text-and-screenshots",
      screenshots: "redacted-only",
    });
    expect(falseConfigs[0]?.model.effectiveEgressPolicy).toMatchObject({
      mode: "text",
      screenshots: "blocked",
    });
    expect(invalidDepthConfigs[0]?.model.fallback.depth).toBe(3);
    expect(partialDepthConfigs[0]?.model.fallback.depth).toBe(3);
  });

  it("rejects invalid model-depth CLI option values", async () => {
    for (const value of ["not-a-number", "5abc"]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "audit",
          "--dom",
          "<main>Checkout</main>",
          "--model-depth",
          value,
        ],
        composition: compositionWithAuditSpy([]),
        io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toBe("");
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Model depth must be an integer from 1 to 5.",
        },
        ok: false,
      });
    }
  });

  it("rejects partially numeric evaluation depth values", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "init", "--depth", "5abc"],
      composition: createSurfaceComposition({ stateStore: new TestMemoryStateStore() }),
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Evaluation depth must be an integer from 1 to 5.",
      },
      ok: false,
    });
  });

  it("rejects invalid model fallback, channel, and screenshot CLI option values", async () => {
    const cases = [
      {
        args: ["--model-fallback", "remote"],
        message: 'Unknown model fallback mode "remote".',
      },
      {
        args: ["--model-channel", "grok"],
        message: 'Unknown model channel "grok".',
      },
      {
        args: ["--model-screenshots", "raw"],
        message: 'Unknown model screenshot policy "raw".',
      },
    ];

    for (const testCase of cases) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: [
          "node",
          "surface",
          "--json",
          "audit",
          "--dom",
          "<main>Checkout</main>",
          ...testCase.args,
        ],
        composition: compositionWithAuditSpy([]),
        io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toBe("");
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        error: {
          code: "config_invalid",
          message: testCase.message,
        },
        ok: false,
      });
    }
  });

  it("uses the audit runner, persists state metadata, and discloses sanitized model coverage", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore({
      modelEgress: [
        {
          artifactClassesSent: ["dom-snapshot"],
          attemptedChannels: ["openai"],
          blockedReasons: [],
          completedChannels: ["openai"],
          redactionStatus: "text-only",
          runId: "run_previous",
          sourceKind: "api",
          unavailableChannels: [],
        },
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: ["channel_denied_by_policy"],
          evaluatedLenses: ["accessibility"],
          findings: [testFinding()],
          modelEgress: [
            {
              artifactClassesSent: ["dom-snapshot"],
              attemptedChannels: ["codex"],
              blockedReasons: ["channel_denied_by_policy"],
              completedChannels: [],
              redactionStatus: "text-only",
              runId: "run_cli",
              sourceKind: "subscription-cli",
              unavailableChannels: [
                {
                  channelId: "codex",
                  message: "codex login unavailable sk-live-secret",
                  reason: "auth-unavailable",
                  sourceKind: "subscription-cli",
                },
              ],
            },
          ],
          reconciliationQuestions: [
            {
              channelIds: ["codex", "gemini"],
              findingIds: ["finding_codex", "finding_gemini"],
              groupKey: "checkout#button",
              kind: "severity-divergence",
              prompt: "Codex and Gemini disagree on severity.",
              severityBands: ["P1", "P3"],
            },
          ],
          skippedLenses: [
            {
              lensId: "usability",
              message: "Model unavailable in test.",
              reason: "model_unavailable",
            },
          ],
          unavailableChannels: [
            {
              id: "codex",
              message: "codex login unavailable sk-live-secret",
              reason: "auth-unavailable",
            },
          ],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--all",
        "--dom",
        '<p class="low-contrast">intentionally fails contrast sk-live-secret</p>',
      ],
      composition,
      env: {},
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    const parsed = JSON.parse(stdout.join("")) as CliEnvelope<{
      readonly findingCount: number;
      readonly findings?: readonly TestFinding[];
      readonly model?: unknown;
      readonly reconciliationQuestions?: readonly unknown[];
    }>;

    expect(exitCode).toBe(0);
    expect(parsed).toMatchObject({
      data: {
        findingCount: 1,
        model: {
          attemptedChannels: ["codex"],
          blockedReasons: ["channel_denied_by_policy"],
          unavailableChannels: [{ id: "codex", reason: "auth-unavailable" }],
        },
        reconciliationQuestions: [
          {
            groupKey: "checkout#button",
            kind: "severity-divergence",
          },
        ],
      },
      ok: true,
    });
    expect(parsed.ok && parsed.data.findings).toEqual([testFinding()]);
    expect(stateStore.state.modelEgress).toMatchObject([
      { runId: "run_previous", attemptedChannels: ["openai"] },
      { runId: "run_cli", attemptedChannels: ["codex"] },
    ]);
    expect(JSON.stringify(stateStore.state.modelEgress)).not.toContain("sk-live-secret");
    expect(stateStore.state.modelEgress?.at(-1)?.unavailableChannels).toEqual([
      expect.objectContaining({ message: "codex login unavailable [masked-token]" }),
    ]);
    expect(stateStore.state.runRecords?.at(-1)).toMatchObject({
      capture: {
        artifacts: [{ redacted: true, type: "dom-snapshot" }],
        target: { kind: "dom", ref: "[redacted-inline-dom]" },
      },
      findings: [testFinding()],
      reconciliationQuestions: [
        {
          groupKey: "checkout#button",
          kind: "severity-divergence",
        },
      ],
      skippedLenses: [{ lensId: "usability", reason: "model_unavailable" }],
      trackedFindings: [{ currentFindingId: "finding_button_contrast", status: "new" }],
    });
    expect(
      Buffer.from(stateStore.artifactWrites.at(-1)?.bytes ?? new Uint8Array()).toString(),
    ).not.toContain("sk-live-secret");
    expect(JSON.stringify(stateStore.state)).not.toContain("seeded_low_contrast");
    expect(stdout.join("")).not.toContain("sk-live-secret");
  });

  it("shows sanitized model coverage in human audit output", async () => {
    const stdout: string[] = [];
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore: new TestMemoryStateStore(),
      }),
      auditRunner: () =>
        ok({
          blockedReasons: ["channel_denied_by_policy"],
          evaluatedLenses: ["accessibility"],
          findings: [testFinding()],
          modelEgress: [
            {
              artifactClassesSent: ["dom-snapshot"],
              attemptedChannels: ["codex"],
              blockedReasons: ["channel_denied_by_policy"],
              completedChannels: [],
              redactionStatus: "text-only",
              runId: "run_cli",
              sourceKind: "subscription-cli",
              unavailableChannels: [
                {
                  channelId: "codex",
                  message: "codex login unavailable sk-live-secret",
                  reason: "auth-unavailable",
                  sourceKind: "subscription-cli",
                },
              ],
            },
          ],
          skippedLenses: [],
          unavailableChannels: [
            {
              id: "codex",
              message: "codex login unavailable sk-live-secret",
              reason: "auth-unavailable",
            },
          ],
        } satisfies AuditRunnerResult),
    };

    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: (chunk) => stdout.push(chunk) },
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Model coverage:");
    expect(output).toContain("- Attempted channels: codex");
    expect(output).toContain("- Completed channels: none");
    expect(output).toContain("- Artifact classes sent: dom-snapshot");
    expect(output).toContain("- Blocked reasons: channel_denied_by_policy");
    expect(output).toContain("- Unavailable channels: codex (auth-unavailable)");
    expect(output).not.toContain("sk-live-secret");
  });

  it("rotates model egress ledger entries when persisting audit state", async () => {
    const previousEntries: NonNullable<TestProjectStateSnapshot["modelEgress"]> = Array.from(
      { length: 100 },
      (_, index) => ({
        artifactClassesSent: [],
        attemptedChannels: ["openai"],
        blockedReasons: [],
        completedChannels: ["openai"],
        redactionStatus: "text-only",
        runId: `run_previous_${index}`,
        sourceKind: "api",
        unavailableChannels: [],
      }),
    );
    const stateStore = new TestMemoryStateStore({
      modelEgress: previousEntries,
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [
            {
              artifactClassesSent: [],
              attemptedChannels: ["codex"],
              blockedReasons: [],
              completedChannels: ["codex"],
              redactionStatus: "text-only",
              runId: "run_cli",
              sourceKind: "subscription-cli",
              unavailableChannels: [],
            },
          ],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.modelEgress).toHaveLength(100);
    expect(stateStore.state.modelEgress?.[0]?.runId).toBe("run_previous_1");
    expect(stateStore.state.modelEgress?.at(-1)?.runId).toBe("run_cli");
  });

  it("persists structurally intact secret-free inline DOM without model flags", async () => {
    const seenCaptures: AuditRunnerInput["capture"][] = [];
    const stateStore = new TestMemoryStateStore();
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: (input: AuditRunnerInput) => {
        seenCaptures.push(input.capture);

        return ok({
          blockedReasons: [],
          evaluatedLenses: ["accessibility"],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult);
      },
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--dom",
        '<main><button data-testid="checkout-submit">Pay</button><p>sk-live-secret</p></main>',
      ],
      composition,
      env: {},
      io: { stdout: () => undefined },
    });
    const persistedDom = Buffer.from(
      stateStore.artifactWrites.at(-1)?.bytes ?? new Uint8Array(),
    ).toString();

    expect(exitCode).toBe(0);
    expect(seenCaptures[0]?.artifacts).toMatchObject([{ redacted: true, type: "dom-snapshot" }]);
    expect(persistedDom).toContain("<main>");
    expect(persistedDom).toContain('data-testid="checkout-submit"');
    expect(persistedDom).not.toContain("sk-live-secret");
  });

  it("redacts sensitive query parameters from persisted target refs", async () => {
    const stateStore = new TestMemoryStateStore();
    const verification = {
      authInjectedBeforeNavigation: true,
      isRequestedTarget: true,
      landedUrl: "https://example.com/app?session_id=secret-session",
      requestedUrl: "https://example.com/app?access_token=secret-token",
    } satisfies TestCapture["verification"];
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: (input: AuditRunnerInput) => {
        Object.assign(input.capture, { verification });

        return ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult);
      },
    };

    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "--url",
        "https://example.com/app/session_abcdef1234567890?access_token=abc&ok=1&session_id=s&password=p",
      ],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    const runRecord = stateStore.state.runRecords?.at(-1);
    if (runRecord === undefined) {
      throw new Error("Expected audit run record.");
    }
    if (runRecord.capture === undefined) {
      throw new Error("Expected audit capture metadata.");
    }
    expect(runRecord.capture.target).toMatchObject({
      kind: "url",
      ref: "https://example.com/app/[masked-secret]?access_token=[masked-secret]&ok=1&session_id=[masked-secret]&password=[masked-secret]",
    });
    expect(runRecord.capture.verification).toMatchObject({
      landedUrl: "https://example.com/app?session_id=[masked-secret]",
      requestedUrl: "https://example.com/app?access_token=[masked-secret]",
    });
  });

  it("does not resolve findings from lenses skipped in the current audit", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding(),
        testTrackedFinding({
          currentFindingId: "finding_usability",
          identity: {
            anchorKind: "selector",
            identityKey: "identity_usability",
            issueType: "usability-issue",
            lens: "usability",
            locationAnchor: "body",
          },
          identityKey: "identity_usability",
          status: "still-failing",
        }),
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [
            { lensId: "usability", message: "No model.", reason: "model_unavailable" },
          ],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      { identityKey: buttonIdentityKey(), status: "resolved" },
      {
        currentFindingId: "finding_usability",
        identityKey: "identity_usability",
        status: "still-failing",
      },
    ]);
  });

  it("does not create duplicate tracked identities for ambiguous same-anchor findings", async () => {
    const stateStore = new TestMemoryStateStore();
    const duplicateFinding = {
      ...testFinding(),
      id: "finding_button_contrast_duplicate",
    };
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: ["accessibility"],
          findings: [testFinding(), duplicateFinding],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });
    const identityKeys =
      stateStore.state.trackedFindings?.map((trackedFinding) => trackedFinding.identityKey) ?? [];

    expect(exitCode).toBe(0);
    expect(stateStore.state.findings?.map((finding) => finding.id)).toEqual([
      "finding_button_contrast",
      "finding_button_contrast_duplicate",
    ]);
    expect(stateStore.state.trackedFindings).toEqual([]);
    expect(new Set(identityKeys).size).toBe(identityKeys.length);
  });

  it("preserves previous findings when a full audit reports no coverage", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [testTrackedFinding()],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      {
        currentFindingId: "finding_button_contrast",
        status: "still-failing",
      },
    ]);
  });

  it("does not resolve findings from lenses omitted by a targeted audit", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding(),
        testTrackedFinding({
          currentFindingId: "finding_usability",
          identity: {
            anchorKind: "selector",
            identityKey: "identity_usability",
            issueType: "usability-issue",
            lens: "usability",
            locationAnchor: "body",
          },
          identityKey: "identity_usability",
          status: "still-failing",
        }),
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: ["accessibility"],
          findings: [testFinding()],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "audit",
        "accessibility",
        "--dom",
        "<main>Checkout</main>",
      ],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      { identityKey: buttonIdentityKey(), status: "still-failing" },
      {
        currentFindingId: "finding_usability",
        identityKey: "identity_usability",
        status: "still-failing",
      },
    ]);
  });

  it("does not resolve requested lens findings when the lens is excluded by the active config", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding({
          currentFindingId: "finding_usability",
          identity: {
            anchorKind: "selector",
            identityKey: "identity_usability",
            issueType: "usability-issue",
            lens: "usability",
            locationAnchor: "body",
          },
          identityKey: "identity_usability",
          status: "still-failing",
        }),
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "usability", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      {
        currentFindingId: "finding_usability",
        identityKey: "identity_usability",
        status: "still-failing",
      },
    ]);
  });

  it("keeps out-of-scope active findings in gate state after targeted audits", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore({
      findings: [testFinding()],
      trackedFindings: [testTrackedFinding()],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: ["usability"],
          findings: [],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const auditExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "usability", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });
    const gateExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--ci"],
      composition,
      io: { stdout: (chunk) => stdout.push(chunk) },
    });
    const backlogStdout: string[] = [];
    const backlogExitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog"],
      composition,
      io: { stdout: (chunk) => backlogStdout.push(chunk) },
    });

    expect(auditExitCode).toBe(0);
    expect(stateStore.state.findings?.map((finding) => finding.id)).toEqual([
      "finding_button_contrast",
    ]);
    expect(stateStore.state.backlog?.entries).toEqual([
      expect.objectContaining({ findingId: "finding_button_contrast" }),
    ]);
    expect(gateExitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      data: { gateResult: { failingFindingIds: ["finding_button_contrast"], passed: false } },
      ok: true,
    });
    expect(backlogExitCode).toBe(0);
    expect(JSON.parse(backlogStdout.join(""))).toMatchObject({
      data: {
        backlog: [
          {
            demotedAsDuplicateOf: null,
            executable: true,
            findingId: "finding_button_contrast",
            gateDisposition: "active",
            gatedForHuman: false,
            identityKey: buttonIdentityKey(),
            method: "measured",
            status: "still-failing",
          },
        ],
      },
      ok: true,
    });
  });

  it("does not resolve out-of-scope findings when a targeted lens is skipped", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding(),
        testTrackedFinding({
          currentFindingId: "finding_usability",
          identity: {
            anchorKind: "selector",
            identityKey: "identity_usability",
            issueType: "usability-issue",
            lens: "usability",
            locationAnchor: "body",
          },
          identityKey: "identity_usability",
          status: "still-failing",
        }),
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: [],
          findings: [],
          modelEgress: [],
          skippedLenses: [
            { lensId: "usability", message: "No model.", reason: "model_unavailable" },
          ],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "usability", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      { identityKey: buttonIdentityKey(), status: "still-failing" },
      {
        currentFindingId: "finding_usability",
        identityKey: "identity_usability",
        status: "still-failing",
      },
    ]);
  });

  it("keeps skipped model lens findings active during a real no-consent audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-real-audit-scope-"));
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding(),
        testTrackedFinding({
          currentFindingId: "finding_usability",
          identity: {
            anchorKind: "selector",
            identityKey: "identity_usability",
            issueType: "usability-issue",
            lens: "usability",
            locationAnchor: "body",
          },
          identityKey: "identity_usability",
          status: "still-failing",
        }),
      ],
      version: "1.0",
    });

    try {
      await mkdir(join(root, ".surface", "captures"), { recursive: true });
      await writeFile(join(root, ".surface", "captures", "dom.html"), "<main>Checkout</main>");
      await writeFile(
        join(root, ".surface", "captures", "computed-styles.json"),
        JSON.stringify([{ fontSize: "16px", selector: "main", tagName: "main" }]),
      );

      const composition = createSurfaceComposition({
        captureBackends: [
          {
            id: "artifact-test",
            detect: () => true,
            observe: (target: TestTarget) =>
              ok({
                artifacts: [
                  {
                    id: "dom",
                    path: ".surface/captures/dom.html",
                    redacted: false,
                    type: "dom-snapshot",
                  },
                  {
                    id: "styles",
                    path: ".surface/captures/computed-styles.json",
                    redacted: false,
                    type: "computed-styles",
                  },
                ],
                backend: "artifact-test",
                capturedAt: "2026-06-01T00:00:00.000Z",
                id: "capture_artifact_test",
                status: "completed",
                target,
              }),
          },
        ],
        projectRoot: root,
        stateStore: {
          readState: () => stateStore.readState(),
          writeArtifact: async (input) => {
            const absolutePath = join(root, input.relativePath);
            await mkdir(dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, input.bytes);

            return ok({ path: input.relativePath, sha256: "sha256:test" });
          },
          writeState: (state: TestProjectStateSnapshot) => stateStore.writeState(state),
        },
      });
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
        composition,
        env: { SURFACE_PROJECT_CONFIG_PATH: "off", SURFACE_USER_CONFIG_PATH: "off" },
        io: { stdout: () => undefined },
      });

      expect(exitCode).toBe(0);
      expect(stateStore.state.runRecords?.at(-1)?.skippedLenses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lensId: "usability", reason: "model_unavailable" }),
        ]),
      );
      expect(stateStore.state.trackedFindings).toMatchObject([
        { identityKey: buttonIdentityKey(), status: "resolved" },
        { identityKey: "identity_usability", status: "still-failing" },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("marks reused finding ids with changed identity as identity-broken", async () => {
    const movedFinding = {
      ...testFinding(),
      location: { selector: ".renamed-button" },
    } satisfies TestFinding;
    const movedIdentityKey = deriveFindingIdentity(movedFinding).identityKey;
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [testTrackedFinding()],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: ["accessibility"],
          findings: [movedFinding],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      {
        currentFindingId: "finding_button_contrast",
        identityKey: buttonIdentityKey(),
        status: "identity-broken",
      },
      {
        currentFindingId: "finding_button_contrast",
        identityKey: movedIdentityKey,
        status: "new",
      },
    ]);
  });

  it("marks resolved findings that reappear as regressed", async () => {
    const stateStore = new TestMemoryStateStore({
      trackedFindings: [
        testTrackedFinding({
          currentFindingId: undefined,
          history: [{ runId: "run_eval", status: "resolved" }],
          status: "resolved",
        }),
      ],
      version: "1.0",
    });
    const composition = {
      ...createSurfaceComposition({
        captureBackends: [createTestCaptureBackend()],
        stateStore,
      }),
      auditRunner: () =>
        ok({
          blockedReasons: [],
          evaluatedLenses: ["accessibility"],
          findings: [testFinding()],
          modelEgress: [],
          skippedLenses: [],
          unavailableChannels: [],
        } satisfies AuditRunnerResult),
    };
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "audit", "--dom", "<main>Checkout</main>"],
      composition,
      io: { stdout: () => undefined },
    });

    expect(exitCode).toBe(0);
    expect(stateStore.state.trackedFindings).toMatchObject([
      { identityKey: buttonIdentityKey(), status: "regressed" },
    ]);
  });
});

describe("@zigrivers/surface findings and loop verbs", () => {
  it("explains a stored finding with rationale and evidence", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "explain", "finding_button_contrast"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
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
        stateStore: new TestMemoryStateStore({
          backlog: {
            entries: [{ findingId: "finding_button_contrast", priority: 1, rank: 1 }],
            id: "backlog_run_eval",
            runId: "run_eval",
          },
          findings: [{ ...testFinding(), gatedForHuman: true }],
          trackedFindings: [testTrackedFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "backlog",
      data: {
        backlog: [
          {
            demotedAsDuplicateOf: null,
            executable: false,
            findingId: "finding_button_contrast",
            gateDisposition: "active",
            gatedForHuman: true,
            identityKey: buttonIdentityKey(),
            method: "measured",
            rank: 1,
            severityBand: "P1",
            status: "still-failing",
          },
        ],
        backlogId: "backlog_run_eval",
        runId: "run_eval",
      },
      ok: true,
    });
  });

  it("applies active baseline waivers to backlog JSON gate disposition", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
          backlog: {
            entries: [{ findingId: "finding_button_contrast", priority: 1, rank: 1 }],
            id: "backlog_run_eval",
            runId: "run_eval",
          },
          baselines: [
            {
              baselineId: "baseline_eval",
              identityKeys: [buttonIdentityKey()],
              waivers: [
                {
                  expiry: "2999-01-01T00:00:00.000Z",
                  findingIdentityKey: buttonIdentityKey(),
                  owner: "QA",
                  reason: "Temporarily accepted.",
                },
              ],
            },
          ],
          findings: [testFinding()],
          trackedFindings: [testTrackedFinding()],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      data: {
        backlog: [
          {
            gateDisposition: "ignored-by-waiver",
            identityKey: buttonIdentityKey(),
          },
        ],
      },
      ok: true,
    });
  });

  it("expires baseline waivers before emitting backlog JSON gate disposition", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
          backlog: {
            entries: [{ findingId: "finding_button_contrast", priority: 1, rank: 1 }],
            id: "backlog_run_eval",
            runId: "run_eval",
          },
          baselines: [
            {
              baselineId: "baseline_eval",
              identityKeys: [buttonIdentityKey()],
              waivers: [
                {
                  expiry: "2000-01-01T00:00:00.000Z",
                  findingIdentityKey: buttonIdentityKey(),
                  owner: "QA",
                  reason: "Expired.",
                },
              ],
            },
          ],
          findings: [testFinding()],
          trackedFindings: [testTrackedFinding({ gateDisposition: "ignored-by-waiver" })],
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      data: {
        backlog: [
          {
            gateDisposition: "active",
            identityKey: buttonIdentityKey(),
          },
        ],
      },
      ok: true,
    });
  });

  it("handles legacy backlog baselines that omit waivers", async () => {
    const stdout: string[] = [];
    const legacyState = {
      backlog: {
        entries: [{ findingId: "finding_button_contrast", priority: 1, rank: 1 }],
        id: "backlog_run_eval",
        runId: "run_eval",
      },
      baselines: [
        {
          baselineId: "baseline_eval",
          identityKeys: [buttonIdentityKey()],
        },
      ],
      findings: [testFinding()],
      trackedFindings: [testTrackedFinding({ gateDisposition: "ignored-by-waiver" })],
      version: "1.0",
    } as unknown as TestProjectStateSnapshot;
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore(legacyState),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      data: {
        backlog: [
          {
            gateDisposition: "active",
            identityKey: buttonIdentityKey(),
          },
        ],
      },
      ok: true,
    });
  });

  it("exports stored backlog entries through registered issue exporters", async () => {
    const stdout: string[] = [];
    const exportedRefs: unknown[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "backlog", "--export", "linear"],
      composition: createSurfaceComposition({
        issueExporters: [
          {
            target: "linear",
            export: (backlogRef) => {
              exportedRefs.push(backlogRef);

              return ok({
                id: "linear:backlog_run_eval",
                target: "linear",
                synced: ["finding_button_contrast"],
                unsynced: [],
                status: "complete",
              });
            },
          },
        ],
        stateStore: new TestMemoryStateStore({
          backlog: {
            entries: [{ findingId: "finding_button_contrast", priority: 1, rank: 1 }],
            id: "backlog_run_eval",
            runId: "run_eval",
          },
          version: "1.0",
        }),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(exportedRefs).toEqual([{ backlogId: "backlog_run_eval", path: ".surface/test" }]);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "backlog",
      data: {
        export: {
          id: "linear:backlog_run_eval",
          target: "linear",
          synced: ["finding_button_contrast"],
          status: "complete",
        },
      },
      ok: true,
    });
  });

  it("summarizes backlog human output by default and reveals details with --all", async () => {
    const createStateStore = () =>
      new TestMemoryStateStore({
        backlog: {
          entries: [
            {
              findingId: "finding_button_contrast",
              priority: 2,
              rank: 1,
              severityBand: "P1",
              title: "Fix button contrast",
            },
            {
              findingId: "finding_focus_state",
              priority: 1,
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
        stateStore: new TestMemoryStateStore({
          runRecords: [{ runId: "run_eval", trackedFindings: [testTrackedFinding()] }],
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
            id: buttonIdentityKey(),
            passed: true,
          },
        ],
      },
      ok: true,
    });
  });

  it("uses validate --run to select tracked findings from the requested run", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "validate", "--run", "run_selected"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
          runRecords: [
            {
              runId: "run_other",
              trackedFindings: [
                testTrackedFinding({
                  currentFindingId: "finding_other",
                  identityKey: "identity_other",
                }),
              ],
            },
            {
              runId: "run_selected",
              trackedFindings: [testTrackedFinding()],
            },
          ],
          trackedFindings: [
            testTrackedFinding({
              currentFindingId: "finding_top_level",
              identityKey: "identity_top_level",
            }),
          ],
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
            id: buttonIdentityKey(),
          },
        ],
      },
      ok: true,
    });
  });

  it("returns run_not_found when validate --run references a missing run", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "validate", "--run", "missing"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
          runRecords: [{ runId: "run_eval", trackedFindings: [testTrackedFinding()] }],
          version: "1.0",
        }),
      }),
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "validate",
      error: { code: "run_not_found", kind: "RuntimeError" },
      ok: false,
    });
  });

  it("exits 1 when gate finds measured findings above policy threshold", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--ci"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
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

  it("uses gate --policy to load a gate policy file", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-cli-gate-policy-"));
    const policyPath = join(root, "gate-policy.json");
    const stdout: string[] = [];

    try {
      await writeFile(
        policyPath,
        JSON.stringify({
          failOnNewMeasuredAtOrAbove: "P0",
          thresholds: {},
          neverFailOn: ["judged", "gatedForHuman"],
        }),
      );

      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "gate", "--policy", policyPath],
        composition: createSurfaceComposition({
          stateStore: new TestMemoryStateStore({
            findings: [testFinding()],
            version: "1.0",
          }),
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "gate",
        data: {
          gateResult: {
            exitCode: 0,
            failingFindingIds: [],
            passed: true,
          },
        },
        ok: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails gate --with-flows on eligible reviewed QA flow failures", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--with-flows"],
      composition: createCompositionWithQaStore({
        listFlowRuns: () =>
          Promise.resolve(
            ok([
              {
                evidenceBundles: [],
                findingIds: [],
                flowId: "checkout",
                gateEligible: true,
                highestFailedSeverity: "high",
                id: "flowrun_checkout",
                isolation: { mode: "isolated", mutatesState: false, resetSatisfied: true },
                severity: "high",
                source: { kind: "file", ref: "surface-flows/checkout.yml" },
                status: "failed",
                steps: [],
                target: { kind: "url", ref: "http://localhost:3000" },
              },
            ]),
          ),
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "gate",
      data: {
        gateResult: {
          exitCode: 1,
          failingFindingIds: [],
          failingFlowRunIds: ["flowrun_checkout"],
          passed: false,
        },
      },
      ok: true,
    });
  });

  it("passes action policy to discovered gate flows without writing QA run manifests", async () => {
    const stdout: string[] = [];
    const flowService = {
      runFlowFile: vi.fn(() =>
        Promise.resolve(
          ok({
            flowRun: {
              evidenceBundles: [],
              findingIds: [],
              flowId: "checkout",
              gateEligible: true,
              highestFailedSeverity: "high" as const,
              id: "flowrun_checkout",
              isolation: { mode: "isolated" as const, mutatesState: false, resetSatisfied: true },
              severity: "high" as const,
              source: {
                kind: "file" as const,
                ref: "../../fixtures/browser-qa/flows/checkout.yml",
              },
              status: "failed" as const,
              steps: [],
              target: { kind: "url" as const, ref: "http://localhost:3000" },
            },
          }),
        ),
      ),
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "gate",
        "--with-flows",
        "../../fixtures/browser-qa/flows/checkout.yml",
        "--action-policy",
        "fixtures/browser-qa/action-policy.json",
      ],
      composition: createCompositionWithQaStore(
        { listFlowRuns: () => Promise.resolve(ok([])) },
        { flowService },
      ),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(flowService.runFlowFile).toHaveBeenCalledWith({
      actionPolicyRef: "fixtures/browser-qa/action-policy.json",
      flowPath: "../../fixtures/browser-qa/flows/checkout.yml",
      writeRun: false,
    });
  });

  it("rejects invalid gate flow target flag combinations", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const flowService = { runFlowFile: vi.fn() };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "gate",
        "--with-flows",
        "--target",
        "http://localhost:3000",
        "--url",
        "http://localhost:3001",
      ],
      composition: createCompositionWithQaStore(
        { listFlowRuns: () => Promise.resolve(ok([])) },
        { flowService },
      ),
      io: { stderr: (chunk) => stderr.push(chunk), stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(2);
    expect(flowService.runFlowFile).not.toHaveBeenCalled();
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      error: { code: "no_target" },
      ok: false,
    });
  });

  it("traces a tracked finding by current finding id", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "trace", "finding_button_contrast"],
      composition: createSurfaceComposition({
        stateStore: new TestMemoryStateStore({
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
          identityKey: buttonIdentityKey(),
        },
      },
      ok: true,
    });
  });

  it("baselines current findings and makes gate fail only on net-new findings", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore({
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
      identityKeys: [buttonIdentityKey()],
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

  it("fails gate for baseline findings with expired waivers", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore({
      baselines: [
        {
          baselineId: "baseline_001",
          identityKeys: [buttonIdentityKey()],
          waivers: [
            {
              expiry: "2000-01-01T00:00:00.000Z",
              findingIdentityKey: buttonIdentityKey(),
              owner: "design-system",
              reason: "temporary acceptance",
            },
          ],
        },
      ],
      findings: [testFinding()],
      trackedFindings: [testTrackedFinding({ gateDisposition: "ignored-by-waiver" })],
      version: "1.0",
    });
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "gate", "--ci"],
      composition: createSurfaceComposition({ stateStore }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({
      command: "gate",
      data: {
        gateResult: {
          baselineId: "baseline_001",
          failingFindingIds: ["finding_button_contrast"],
          passed: false,
        },
      },
      ok: true,
    });
  });

  it("records verdicts for stored findings", async () => {
    const stdout: string[] = [];
    const stateStore = new TestMemoryStateStore({
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
    const [storedVerdict] = stateStore.state.verdicts ?? [];

    expect(storedVerdict).toMatchObject({
      decision: "reject",
      findingId: "finding_button_contrast",
      findingIdentityKey: buttonIdentityKey(),
      rationale: "False positive in reviewed theme",
      reusePolicy: "this-run",
    });
    expect(typeof storedVerdict?.recordedAt).toBe("string");
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

  it("promotes browser QA candidates from human verdicts without requiring replay", async () => {
    const stdout: string[] = [];
    const orchestrator = {
      promoteCandidateByVerdict: vi.fn(() =>
        Promise.resolve(ok({ promotion: { findingId: "f_checkout" }, replayStatus: "not-run" })),
      ),
    };
    const exitCode = await runSurfaceCli({
      argv: [
        "node",
        "surface",
        "--json",
        "verdict",
        "qfc_checkout",
        "--promote",
        "--reason",
        "Confirmed during manual QA",
      ],
      composition: createSurfaceComposition({
        browserQa: { orchestrator } as never,
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(orchestrator.promoteCandidateByVerdict).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Confirmed during manual QA",
        refId: "qfc_checkout",
      }),
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "verdict",
      data: {
        verdict: {
          decision: "accept",
          findingId: "qfc_checkout",
          rationale: "Confirmed during manual QA",
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
        stateStore: new TestMemoryStateStore({
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
        resolved: [{ findingId: "finding_button_contrast", identityKey: buttonIdentityKey() }],
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

class TestMemoryStateStore implements StateStore {
  artifactWrites: PersistArtifactIntent[] = [];
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

  writeArtifact(input: PersistArtifactIntent) {
    this.artifactWrites.push(input);

    return ok({ path: ".surface/test", sha256: "sha256:test" });
  }
}

function createTestCaptureBackend(
  capturedTargets: TestTarget[] = [],
  captureOverrides: Partial<TestCapture> = {},
) {
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
        ...captureOverrides,
      } satisfies TestCapture);
    },
  };
}

function compositionWithAuditSpy(
  seenConfigs: AuditRunnerInput["config"][],
  options: NonNullable<Parameters<typeof createSurfaceComposition>[0]> = {},
) {
  return {
    ...createSurfaceComposition({
      ...options,
      captureBackends: [createTestCaptureBackend()],
      stateStore: options.stateStore ?? new TestMemoryStateStore(),
    }),
    auditRunner: async (input: AuditRunnerInput) => {
      await Promise.resolve();
      seenConfigs.push(input.config);

      return ok({
        blockedReasons: [],
        evaluatedLenses: [],
        findings: [],
        modelEgress: [],
        skippedLenses: [],
        unavailableChannels: [],
      });
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
        rule: "color-contrast",
        threshold: "4.5:1",
        tool: "axe",
      },
    ],
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
    gatedForHuman: false,
    id: "finding_button_contrast",
    issueType: "contrast-insufficient",
    lens: "accessibility",
    location: { selector: ".button" },
    method: "measured",
    rationale: "Button text fails AA contrast.",
    severityBand: "P1",
    title: "Button text fails AA contrast",
  };
}

function testTrackedFinding(overrides: Partial<TestTrackedFinding> = {}): TestTrackedFinding {
  const defaultIdentity = buttonIdentity();
  const identity = overrides.identity ?? {
    ...defaultIdentity,
    ...(overrides.identityKey === undefined ? {} : { identityKey: overrides.identityKey }),
  };
  const identityKey = overrides.identityKey ?? identity.identityKey;

  return {
    currentFindingId: "finding_button_contrast",
    firstSeenRunId: "run_eval",
    gateDisposition: "active",
    history: [{ runId: "run_eval", status: "still-failing" }],
    identity,
    identityKey,
    lastSeenRunId: "run_eval",
    status: "still-failing",
    validation: {
      expectation: "axe color-contrast passes",
      kind: "measured-rule",
    },
    ...overrides,
  };
}

function createCompositionWithQaStore(
  qaStore: { readonly listFlowRuns: () => Promise<unknown> },
  options: { readonly flowService?: Record<string, unknown> } = {},
) {
  const base = createSurfaceComposition({
    stateStore: new TestMemoryStateStore({ version: "1.0" }),
  });
  const browserQa = (base as unknown as { readonly browserQa: Record<string, unknown> }).browserQa;

  return {
    ...base,
    browserQa: {
      ...browserQa,
      ...(options.flowService === undefined
        ? {}
        : {
            flowService: {
              ...(browserQa.flowService as Record<string, unknown>),
              ...options.flowService,
            },
          }),
      qaStore,
    },
  } as ReturnType<typeof createSurfaceComposition>;
}

function buttonIdentity(): TestTrackedFinding["identity"] {
  return deriveFindingIdentity(testFinding());
}

function buttonIdentityKey(): string {
  return buttonIdentity().identityKey;
}
