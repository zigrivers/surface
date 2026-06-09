import { existsSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok } from "./errors.js";
import {
  buildIsolatedProcessEnvironment,
  createSubscriptionCliProvider,
  defaultProcessRunner,
  pruneStaleSurfaceTempRoots,
  resolvePromptTempParent,
  resolveDirectProviders,
  validateSubscriptionAuthMirrorSource,
  type ProcessRunRequest,
  type ProcessRunResult,
  type ProcessRunner,
  type SubscriptionCliCapability,
} from "./subscription-cli-provider.js";

function fakeRunner(
  responder: (
    request: ProcessRunRequest,
    callIndex: number,
  ) => ProcessRunResult | Promise<ProcessRunResult>,
  enforcedFilesystemIsolation = true,
) {
  const requests: ProcessRunRequest[] = [];
  const runner: ProcessRunner = {
    enforcedFilesystemIsolation,
    run: (request) => {
      requests.push(request);
      return responder(request, requests.length);
    },
  };

  return { requests, runner };
}

function success(stdout: string): ProcessRunResult {
  return { exitCode: 0, stderr: "", stdout };
}

const codexCapability = {
  channelId: "codex",
  command: "codex",
  completionArgs: ["exec", "--json", "--sandbox", "read-only", "--skip-git-repo-check", "-"],
  model: "codex-subscription",
  promptDelivery: "stdin",
  version: "0.20.0",
} as const satisfies SubscriptionCliCapability;
const claudeCapability = {
  channelId: "claude",
  command: "claude",
  completionArgs: [
    "--print",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--disallowedTools",
    "*",
  ],
  model: "claude-subscription",
  promptDelivery: "stdin",
  version: "2.1.0",
} as const satisfies SubscriptionCliCapability;
const geminiCapability = {
  channelId: "gemini",
  command: "gemini",
  completionArgs: [
    "--prompt",
    "Read the JSON request appended on stdin and answer according to that request.",
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
    "--sandbox",
  ],
  model: "gemini-subscription",
  promptDelivery: "stdin",
  version: "1.4.0",
} as const satisfies SubscriptionCliCapability;

describe("subscription CLI provider", () => {
  it("advertises filesystem isolation only when the default runner can enforce it", () => {
    expect(defaultProcessRunner.enforcedFilesystemIsolation).toBe(
      process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec"),
    );
  });

  it("reports Codex direct discovery unsupported until a no-shell CLI mode exists", async () => {
    const { requests, runner } = fakeRunner(() => {
      return { exitCode: 99, stdout: "", stderr: "unexpected command" };
    });
    const config = resolveSurfaceConfig({
      cli: {
        model: {
          fallback: {
            depth: 4,
            mode: "direct",
            providerOrder: ["codex"],
          },
          egressPolicy: {
            mode: "text",
          },
        },
      },
    });

    const resolved = await resolveDirectProviders(config, runner);

    expect(resolved.subscriptionProviders).toEqual([]);
    expect(resolved.discoveryUnavailableChannels).toMatchObject([
      {
        channelId: "codex",
        reason: "unsupported-capability",
        sourceKind: "subscription-cli",
      },
    ]);
    expect(requests).toEqual([]);
  });

  it("discovers direct channels with canonical metadata", async () => {
    const { requests, runner } = fakeRunner((request, callIndex) => {
      if (callIndex === 1) {
        return success("Claude Code 2.1.0");
      }

      expect(request.args).toEqual(claudeCapability.completionArgs);
      expect(request.stdin).toContain('{"surfaceSubscriptionProbe":"ok"}');
      return success(
        JSON.stringify({
          result: '{"surfaceSubscriptionProbe":"ok"}',
          subtype: "success",
          type: "result",
        }),
      );
    });
    const config = resolveSurfaceConfig({
      cli: {
        model: {
          fallback: {
            depth: 4,
            mode: "direct",
            providerOrder: ["claude"],
          },
          egressPolicy: {
            mode: "text",
          },
        },
      },
    });

    const resolved = await resolveDirectProviders(config, runner);
    const provider = resolved.subscriptionProviders[0];

    if (provider === undefined) {
      throw new Error("expected claude provider");
    }

    const availability = await provider.availability();

    expect(resolved.subscriptionProviders.map((entry) => entry.id)).toEqual(["claude"]);
    expect(isOk(availability)).toBe(true);
    expect(availability).toMatchObject({
      value: {
        available: true,
        channelId: "claude",
        provider: "claude",
        sourceKind: "subscription-cli",
      },
    });
    expect(resolved.discoveryUnavailableChannels).toEqual([]);
    expect(JSON.stringify(requests)).not.toMatch(/dom-snapshot|accessibility-tree|screenshot/i);
  });

  it("caches direct channel discovery for a runner session", async () => {
    const { requests, runner } = fakeRunner((request, callIndex) => {
      if (callIndex === 1) {
        return success("Claude Code 2.1.0");
      }

      expect(request.args).toEqual(claudeCapability.completionArgs);
      return success(
        JSON.stringify({
          result: '{"surfaceSubscriptionProbe":"ok"}',
          subtype: "success",
          type: "result",
        }),
      );
    });
    const config = resolveSurfaceConfig({
      cli: {
        model: {
          egressPolicy: { mode: "text" },
          fallback: {
            mode: "direct",
            providerOrder: ["claude"],
          },
        },
      },
    });

    const first = await resolveDirectProviders(config, runner);
    const second = await resolveDirectProviders(config, runner);

    expect(first.subscriptionProviders.map((entry) => entry.id)).toEqual(["claude"]);
    expect(second.subscriptionProviders.map((entry) => entry.id)).toEqual(["claude"]);
    expect(requests).toHaveLength(2);
  });

  it("keeps later direct providers available for retry below reconciliation depth", async () => {
    const { requests, runner } = fakeRunner((request) => {
      if (request.command === "gemini" && request.args.join(" ") === "--version") {
        return success("gemini 1.4.0");
      }

      if (request.command === "gemini") {
        expect(request.args).toEqual([
          "--prompt",
          "Read the JSON request appended on stdin and answer according to that request.",
          "--output-format",
          "json",
          "--approval-mode",
          "plan",
          "--sandbox",
        ]);
        expect(request.stdin).toContain('{"surfaceSubscriptionProbe":"ok"}');
        expect(request.stdin).toContain("Return only this exact JSON object");
        return success('{"surfaceSubscriptionProbe":"ok"}');
      }

      return { exitCode: 99, stdout: "", stderr: `unexpected discovery for ${request.command}` };
    });
    const resolved = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["codex", "gemini"] },
          },
        },
      }),
      runner,
    );

    expect(resolved.subscriptionProviders.map((provider) => provider.id)).toEqual(["gemini"]);
    expect(resolved.discoveryUnavailableChannels).toMatchObject([
      { channelId: "codex", reason: "unsupported-capability" },
    ]);
    expect(requests.map((request) => request.command)).toEqual(["gemini", "gemini"]);
  });

  it("uses strict version/probe evidence for Claude and Gemini and ignores help text as safety proof", async () => {
    const claude = fakeRunner((request, callIndex) => {
      if (callIndex === 1) {
        return success("Claude Code 2.1.0-beta.1");
      }

      expect(request.args).toEqual([
        "--print",
        "--output-format",
        "json",
        "--input-format",
        "text",
        "--disallowedTools",
        "*",
      ]);
      expect(request.stdin).toContain('{"surfaceSubscriptionProbe":"ok"}');
      expect(request.stdin).toContain("Return only this exact JSON object");
      return success('{"surfaceSubscriptionProbe":"ok"}');
    });
    const gemini = fakeRunner((request, callIndex) => {
      if (callIndex === 1) {
        return success("gemini 1.4.0-rc.1");
      }

      expect(request.env).toMatchObject({ NO_BROWSER: "true" });
      expect(request.args).toEqual([
        "--prompt",
        "Read the JSON request appended on stdin and answer according to that request.",
        "--output-format",
        "json",
        "--approval-mode",
        "plan",
        "--sandbox",
      ]);
      expect(JSON.parse(request.stdin ?? "")).toEqual({
        input: { surfaceSubscriptionProbe: "ok" },
        instructions:
          'Return only this exact JSON object and no markdown or extra text: {"surfaceSubscriptionProbe":"ok"}',
        responseFormat: { type: "json" },
      });
      return success('{"surfaceSubscriptionProbe":"ok"}');
    });
    const unknownCodex = fakeRunner((request, callIndex) => {
      if (callIndex === 1) {
        return success("Logged in using ChatGPT");
      }

      if (callIndex === 2) {
        return success("codex 99.0.0");
      }

      return success("exec --help says every safety flag exists");
    });

    expect(
      await resolveDirectProviders(
        resolveSurfaceConfig({
          cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
        }),
        claude.runner,
      ),
    ).toMatchObject({ subscriptionProviders: [{ id: "claude" }] });
    expect(
      await resolveDirectProviders(
        resolveSurfaceConfig({
          cli: { model: { fallback: { mode: "direct", providerOrder: ["gemini"] } } },
        }),
        gemini.runner,
      ),
    ).toMatchObject({ subscriptionProviders: [{ id: "gemini" }] });

    const unavailable = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["codex"] } } },
      }),
      unknownCodex.runner,
    );

    expect(unavailable.subscriptionProviders).toEqual([]);
    expect(unavailable.discoveryUnavailableChannels).toMatchObject([
      {
        channelId: "codex",
        reason: "unsupported-capability",
      },
    ]);
    expect(unknownCodex.requests.map((request) => request.args.join(" "))).not.toContain(
      "exec --help",
    );
  });

  it("reports missing binaries, auth failures, timeouts, and missing filesystem isolation as unavailable", async () => {
    const missing = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => ({ exitCode: 127, stderr: "ENOENT /usr/bin/claude", stdout: "" })).runner,
    );
    const sandboxUnavailable = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => ({
        exitCode: 127,
        stderr: "filesystem isolation is unavailable for the default process runner",
        stdout: "",
      })).runner,
    );
    const auth = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => ({
        exitCode: 1,
        stderr: "sk-live-secret browser login required",
        stdout: "",
      })).runner,
    );
    const timeout = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => ({ exitCode: 124, stderr: "browser prompt", stdout: "", timedOut: true }))
        .runner,
    );
    const noSandbox = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => success("{}"), false).runner,
    );
    const thrown = await resolveDirectProviders(
      resolveSurfaceConfig({
        cli: { model: { fallback: { mode: "direct", providerOrder: ["claude"] } } },
      }),
      fakeRunner(() => {
        throw Object.assign(new Error("spawn EACCES /tmp/private-token"), { code: "EACCES" });
      }).runner,
    );

    expect(missing.discoveryUnavailableChannels).toMatchObject([
      { reason: "not-installed", channelId: "claude", sourceKind: "subscription-cli" },
    ]);
    expect(sandboxUnavailable.discoveryUnavailableChannels).toMatchObject([
      { reason: "unsupported-capability", channelId: "claude", sourceKind: "subscription-cli" },
    ]);
    expect(auth.discoveryUnavailableChannels).toMatchObject([
      { reason: "auth-unavailable", channelId: "claude", sourceKind: "subscription-cli" },
    ]);
    expect(JSON.stringify(auth.discoveryUnavailableChannels)).not.toContain("sk-live-secret");
    expect(timeout.discoveryUnavailableChannels).toMatchObject([
      { reason: "unsupported-capability", channelId: "claude" },
    ]);
    expect(noSandbox.discoveryUnavailableChannels).toMatchObject([
      { reason: "unsupported-capability", channelId: "claude" },
    ]);
    expect(thrown.discoveryUnavailableChannels).toMatchObject([
      { reason: "command-failed", channelId: "claude", sourceKind: "subscription-cli" },
    ]);
    expect(JSON.stringify(thrown.discoveryUnavailableChannels)).not.toContain("private-token");
  });

  it("runs completion with no tools, no shell, isolated env, and prompt text outside argv", async () => {
    const { requests, runner } = fakeRunner((request) => {
      expect(request.args).toEqual(claudeCapability.completionArgs);
      expect(request.args.join(" ")).not.toContain("private checkout note");
      expect(request.extendEnv).toBe(false);
      expect(request.requiresFilesystemIsolation).toBe(true);
      expect(request.stdin).toContain("private checkout note");
      expect(request.env).not.toHaveProperty("HOME");
      return success("[]");
    });
    const provider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner,
      timeoutMs: 10_000,
    });

    const completion = await provider.complete({
      prompt: {
        instructions: "Return JSON findings.",
        input: { note: "private checkout note" },
      },
      responseFormat: { type: "json" },
    });

    expect(isOk(completion)).toBe(true);
    expect(completion).toMatchObject({
      value: {
        channelId: "claude",
        model: "claude-subscription",
        provider: "claude",
        sourceKind: "subscription-cli",
        text: "[]",
      },
    });
    expect(requests).toHaveLength(1);
  });

  it("returns a sanitized model error when prompt serialization fails", async () => {
    const { requests, runner } = fakeRunner(() => success("[]"));
    const provider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner,
      timeoutMs: 10_000,
    });
    const completion = await provider.complete({
      prompt: {
        instructions: "Return JSON findings.",
        input: { token: "sk-live-secret", value: 1n },
      },
      responseFormat: { type: "json" },
    });

    expect(completion).toMatchObject({
      error: {
        code: "model_request_failed",
        details: { reason: "serialization-failed" },
      },
    });
    expect(JSON.stringify(completion)).not.toContain("sk-live-secret");
    expect(requests).toEqual([]);
  });

  it("reports Codex direct subscription providers unavailable without a no-shell mode", async () => {
    const provider = createSubscriptionCliProvider({
      capability: codexCapability,
      runner: fakeRunner(() => success("{}"), false).runner,
      timeoutMs: 10_000,
    });

    const availability = await provider.availability();
    const completion = await provider.complete({
      prompt: { instructions: "Return JSON findings.", input: {} },
    });

    expect(availability).toMatchObject({
      value: {
        available: false,
        channelId: "codex",
        reason: "unsupported-capability",
        sourceKind: "subscription-cli",
      },
    });
    expect(completion).toMatchObject({
      error: { code: "model_unavailable", details: { reason: "unsupported-capability" } },
    });
  });

  it("accepts raw Claude and Gemini completion stdout as model text", async () => {
    const request = {
      prompt: {
        instructions: "Return JSON findings.",
        input: { note: "private checkout note" },
      },
      responseFormat: { type: "json" as const },
    };
    const claude = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => success("[]")).runner,
      timeoutMs: 10_000,
    });
    const gemini = createSubscriptionCliProvider({
      capability: geminiCapability,
      runner: fakeRunner(() => success('[{"title":"Issue"}]')).runner,
      timeoutMs: 10_000,
    });

    expect(await claude.complete(request)).toMatchObject({
      value: {
        channelId: "claude",
        text: "[]",
      },
    });
    expect(await gemini.complete(request)).toMatchObject({
      value: {
        channelId: "gemini",
        text: '[{"title":"Issue"}]',
      },
    });
  });

  it("extracts Claude completion text from the JSON CLI envelope", async () => {
    const provider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() =>
        success(
          JSON.stringify({
            result: '[{"title":"Issue from Claude"}]',
            subtype: "success",
            type: "result",
          }),
        ),
      ).runner,
      timeoutMs: 10_000,
    });

    expect(
      await provider.complete({
        prompt: {
          instructions: "Return JSON findings.",
          input: { note: "private checkout note" },
        },
        responseFormat: { type: "json" },
      }),
    ).toMatchObject({
      value: {
        channelId: "claude",
        text: '[{"title":"Issue from Claude"}]',
      },
    });
  });

  it("maps timeout, non-zero, malformed output, and prompt cleanup failures to sanitized model errors", async () => {
    const timeoutProvider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => ({ exitCode: 124, stdout: "", stderr: "", timedOut: true })).runner,
      timeoutMs: 1,
    });
    const failedProvider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => ({
        exitCode: 2,
        stdout: "",
        stderr: "raw auth secret",
        timedOut: false,
      })).runner,
      timeoutMs: 1,
    });
    const parseFailedProvider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => success("")).runner,
      timeoutMs: 1,
    });
    const cleanupFailedProvider = createSubscriptionCliProvider({
      capability: {
        ...claudeCapability,
        completionArgs: ["--print", "--output-format", "json", "--prompt-file"],
        promptDelivery: "prompt-file",
      },
      promptStore: {
        create: () =>
          ok({
            path: "/tmp/surface-prompt/prompt.txt",
            cleanup: () =>
              err(createSurfaceError("model_request_failed", "unlink failed for prompt")),
          }),
      },
      runner: fakeRunner((request) => {
        expect(request.args).toEqual([
          "--print",
          "--output-format",
          "json",
          "--prompt-file",
          "/tmp/surface-prompt/prompt.txt",
        ]);
        expect(request.allowedReadPaths).toEqual(["/tmp/surface-prompt/prompt.txt"]);
        expect(request.args.join(" ")).not.toContain("secret prompt");
        return success('{"type":"agent_message","message":"[]"}\n');
      }).runner,
      timeoutMs: 1,
    });
    const request = {
      prompt: {
        instructions: "secret prompt",
        input: {},
      },
    };

    expect(await timeoutProvider.complete(request)).toMatchObject({
      error: { code: "model_request_failed", details: { reason: "timeout" } },
    });
    expect(await failedProvider.complete(request)).toMatchObject({
      error: { code: "model_request_failed", details: { reason: "command-failed" } },
    });
    expect(await parseFailedProvider.complete(request)).toMatchObject({
      error: {
        code: "model_request_failed",
        details: { outputPreview: "", reason: "parse-failed" },
      },
    });
    expect(await cleanupFailedProvider.complete(request)).toMatchObject({
      error: { code: "model_request_failed", details: { reason: "prompt-cleanup-failed" } },
    });
    expect(JSON.stringify(await failedProvider.complete(request))).not.toContain("raw auth secret");
    expect(JSON.stringify(await parseFailedProvider.complete(request))).not.toContain(
      "sk-live-secret",
    );
  });

  it("rejects non-json subscription output when the request asks for JSON", async () => {
    const provider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => success("plain prose that is not json")).runner,
      timeoutMs: 1,
    });

    const result = await provider.complete({
      prompt: {
        instructions: "Return JSON.",
        input: {},
      },
      responseFormat: { type: "json" },
    });

    expect(result).toMatchObject({
      error: { code: "model_request_failed", details: { reason: "parse-failed" } },
    });
  });

  it("does not serialize raw thrown runner values into model error details", async () => {
    const provider = createSubscriptionCliProvider({
      capability: claudeCapability,
      runner: fakeRunner(() => {
        throw new Error("/tmp/surface-model-prompt/private-checkout-note sk-live-secret");
      }).runner,
      timeoutMs: 1,
    });

    const result = await provider.complete({
      prompt: {
        instructions: "private checkout note",
        input: {},
      },
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      error: {
        code: "model_request_failed",
        details: {
          errorName: "Error",
          reason: "command-failed",
        },
      },
    });
    expect(serialized).not.toContain("private checkout note");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toContain("/tmp/surface-model-prompt");
  });

  it("unlinks prompt files even when zero-fill cleanup fails", async () => {
    let promptPath: string | undefined;
    const provider = createSubscriptionCliProvider({
      capability: {
        ...claudeCapability,
        completionArgs: ["--print", "--output-format", "json", "--prompt-file"],
        promptDelivery: "prompt-file",
      },
      runner: fakeRunner(async (request) => {
        promptPath = request.allowedReadPaths?.[0];
        expect(promptPath).toBeDefined();

        await chmod(promptPath ?? "", 0o400);

        return success('{"type":"agent_message","message":"[]"}\n');
      }).runner,
      timeoutMs: 1,
    });

    const result = await provider.complete({
      prompt: {
        instructions: "secret prompt",
        input: {},
      },
    });

    expect(result).toMatchObject({
      error: { code: "model_request_failed", details: { reason: "prompt-cleanup-failed" } },
    });
    expect(promptPath).toBeDefined();
    expect(existsSync(promptPath ?? "")).toBe(false);
    expect(existsSync(dirname(promptPath ?? ""))).toBe(false);
  });

  it("zero-fills appended prompt file bytes when cleanup cannot unlink the file", async () => {
    let promptPath: string | undefined;
    const appendedSecret = "appended-secret-after-original-prompt";
    const provider = createSubscriptionCliProvider({
      capability: {
        ...claudeCapability,
        completionArgs: ["--print", "--output-format", "json", "--prompt-file"],
        promptDelivery: "prompt-file",
      },
      runner: fakeRunner(async (request) => {
        promptPath = request.allowedReadPaths?.[0];
        expect(promptPath).toBeDefined();

        await appendFile(promptPath ?? "", appendedSecret);
        await chmod(dirname(promptPath ?? ""), 0o500);

        return success('{"type":"agent_message","message":"[]"}\n');
      }).runner,
      timeoutMs: 1,
    });

    try {
      const result = await provider.complete({
        prompt: {
          instructions: "secret prompt",
          input: {},
        },
      });

      expect(result).toMatchObject({
        error: { code: "model_request_failed", details: { reason: "prompt-cleanup-failed" } },
      });
      expect(promptPath).toBeDefined();

      const remaining = await readFile(promptPath ?? "");

      expect(remaining.includes(Buffer.from(appendedSecret))).toBe(false);
      expect(remaining.every((byte) => byte === 0)).toBe(true);
    } finally {
      if (promptPath !== undefined) {
        await chmod(dirname(promptPath), 0o700);
        await rm(dirname(promptPath), { force: true, recursive: true });
      }
    }
  });

  it("prefers an explicit writable prompt temp parent for prompt-file delivery", async () => {
    const promptParent = await mkdtemp(join(tmpdir(), "surface-prompt-parent-"));

    try {
      expect(
        resolvePromptTempParent(
          {
            SURFACE_MODEL_PROMPT_TMPDIR: promptParent,
          },
          "darwin",
        ),
      ).toBe(promptParent);
      expect(
        resolvePromptTempParent(
          {
            SURFACE_MODEL_PROMPT_TMPDIR: "relative-prompt-dir",
          },
          "darwin",
        ),
      ).toBe(tmpdir());
    } finally {
      await rm(promptParent, { force: true, recursive: true });
    }
  });

  it("builds an isolated process environment with constrained auth env and no workspace PATH entries", () => {
    const env = buildIsolatedProcessEnvironment({
      baseEnv: {
        HOME: "/Users/ken",
        LANG: "en_US.UTF-8",
        Path: "relative:/tmp/workspace/bin:/tmp:/usr/bin:/definitely/missing:/Users/ken:/",
        USER: "ken",
        XDG_CONFIG_HOME: "/Users/ken/.config",
      },
      commandEnv: {
        HOME: "/Users/ken",
        XDG_CACHE_HOME: "/Users/ken/.cache",
        XDG_CONFIG_HOME: "/Users/ken/.config",
        XDG_RUNTIME_DIR: "/Users/ken/.run",
        XDG_STATE_HOME: "/Users/ken/.state",
      },
      isolatedRoot: "/tmp/surface-runner-123",
      workspaceRoot: "/tmp/workspace",
    });

    expect(env.HOME).toBe("/tmp/surface-runner-123/home");
    expect(env.XDG_CONFIG_HOME).toBe("/tmp/surface-runner-123/home/.config");
    expect(env.XDG_CACHE_HOME).toBe("/tmp/surface-runner-123/cache");
    expect(env.XDG_RUNTIME_DIR).toBe("/tmp/surface-runner-123/run");
    expect(env.XDG_STATE_HOME).toBe("/tmp/surface-runner-123/state");
    expect(env.USER).toBe("ken");
    expect(env.LANG).toBe("en_US.UTF-8");
    expect(env.TMPDIR).toBe("/tmp/surface-runner-123/tmp");
    expect(env.PATH?.split(":")).not.toEqual(
      expect.arrayContaining([
        "relative",
        "/tmp/workspace/bin",
        "/tmp",
        "/definitely/missing",
        "/Users/ken",
        "/",
      ]),
    );
  });

  it("rejects writable temp PATH entries before resolving subscription CLI commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-path-trust-"));

    try {
      const unsafeBin = join(root, "unsafe-bin");
      const safeBin = join(root, "safe-bin");
      await mkdir(unsafeBin);
      await mkdir(safeBin);
      await chmod(unsafeBin, 0o777);
      await chmod(safeBin, 0o755);

      const env = buildIsolatedProcessEnvironment({
        baseEnv: {
          PATH: `${unsafeBin}${delimiter}${safeBin}`,
        },
        isolatedRoot: join(root, "isolated"),
        workspaceRoot: join(root, "workspace"),
      });

      expect(env.PATH?.split(delimiter)).toContain(safeBin);
      expect(env.PATH?.split(delimiter)).not.toContain(unsafeBin);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects auth mirror sources that contain symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-auth-mirror-"));

    try {
      const authRoot = join(root, ".claude");
      const outsideFile = join(root, "outside-token.json");
      const outsideDir = join(root, "outside-dir");
      await mkdir(authRoot);
      await mkdir(outsideDir);
      await writeFile(outsideFile, "token");

      expect(await validateSubscriptionAuthMirrorSource(authRoot)).toBe(true);

      await symlink(outsideFile, join(authRoot, "token-link.json"));
      expect(await validateSubscriptionAuthMirrorSource(authRoot)).toBe(false);
      await rm(join(authRoot, "token-link.json"), { force: true });

      await symlink(outsideDir, join(authRoot, "dir-link"));
      expect(await validateSubscriptionAuthMirrorSource(authRoot)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps symlinked CLI shim and real node toolchain directories in sanitized PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-path-"));

    try {
      const realBin = join(root, "nvm", "versions", "node", "v22.0.0", "bin");
      const shimBin = join(root, "npm-global", "bin");
      await mkdir(realBin, { recursive: true });
      await mkdir(dirname(shimBin), { recursive: true });
      await symlink(realBin, shimBin);
      await writeFile(join(realBin, "claude"), "#!/usr/bin/env node\n", { mode: 0o755 });
      const realBinPath = await realpath(realBin);

      const env = buildIsolatedProcessEnvironment({
        baseEnv: {
          PATH: `${shimBin}${delimiter}/usr/bin`,
        },
        isolatedRoot: join(root, "isolated"),
        workspaceRoot: join(root, "workspace"),
      });

      expect(env.PATH?.split(delimiter)).toEqual(
        expect.arrayContaining([shimBin, realBinPath, "/usr/bin"]),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("prunes stale Surface-owned temp roots without touching fresh or unrelated dirs", async () => {
    const parent = await mkdtemp(join(tmpdir(), "surface-prune-parent-"));

    try {
      const staleRunner = join(parent, "surface-model-cli-old");
      const freshPrompt = join(parent, "surface-model-prompt-new");
      const unrelated = join(parent, "other-temp-old");
      await mkdir(staleRunner);
      await mkdir(freshPrompt);
      await mkdir(unrelated);
      const now = Date.now();
      const staleDate = new Date(now - 25 * 60 * 60 * 1000);
      await utimes(staleRunner, staleDate, staleDate);
      await utimes(unrelated, staleDate, staleDate);

      await pruneStaleSurfaceTempRoots(parent, now);

      expect(existsSync(staleRunner)).toBe(false);
      expect(existsSync(freshPrompt)).toBe(true);
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  });
});
