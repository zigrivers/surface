import { accessSync, constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, open, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { z } from "zod";

import type { DirectSubscriptionChannelId, SurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { isNodeErrorWithCode, parseJson } from "./internal-utils.js";
import { maskModelPlainText } from "./model-egress.js";
import {
  ModelRequestSchema,
  type ModelAvailability,
  type ModelProvider,
  type ModelResponse,
} from "./model-provider.js";

type MaybePromise<T> = T | Promise<T>;

export type ProcessRunRequest = {
  readonly command: string;
  readonly args: readonly string[];
  readonly allowedReadPaths?: readonly string[];
  readonly channelId?: DirectSubscriptionChannelId;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly extendEnv: false;
  readonly requiresFilesystemIsolation: true;
  readonly stdin?: string;
  readonly timeoutMs: number;
};

export type ProcessRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
};

export interface ProcessRunner {
  readonly enforcedFilesystemIsolation?: boolean;
  run(request: ProcessRunRequest): MaybePromise<ProcessRunResult>;
}

export type SubscriptionPromptFile = {
  readonly path: string;
  cleanup(): MaybePromise<Result<void, SurfaceError>>;
};

export interface SubscriptionPromptStore {
  create(prompt: string): MaybePromise<Result<SubscriptionPromptFile, SurfaceError>>;
}

export type SubscriptionCliCapability = {
  readonly channelId: DirectSubscriptionChannelId;
  readonly command: string;
  readonly completionArgs: readonly string[];
  readonly model: string;
  readonly promptDelivery: "stdin" | "prompt-file";
  readonly version: string;
};

export type ResolveDirectProvidersResult = {
  readonly subscriptionProviders: readonly ModelProvider[];
  readonly discoveryUnavailableChannels: readonly Extract<
    ModelAvailability,
    { available: false }
  >[];
};

type SubscriptionCliProviderOptions = {
  readonly capability: SubscriptionCliCapability;
  readonly runner: ProcessRunner;
  readonly promptStore?: SubscriptionPromptStore;
  readonly timeoutMs: number;
};

type ChannelDiscovery =
  | { readonly available: true; readonly capability: SubscriptionCliCapability }
  | {
      readonly available: false;
      readonly availability: Extract<ModelAvailability, { available: false }>;
    };

const SubscriptionCompletionOutputSchema = z
  .object({
    text: z.string(),
  })
  .passthrough();

const SubscriptionProbeOutputSchema = z
  .object({
    surfaceSubscriptionProbe: z.literal("ok"),
  })
  .passthrough();

const SUBSCRIPTION_PROBE_PROMPT =
  'Return only this exact JSON object and no markdown or extra text: {"surfaceSubscriptionProbe":"ok"}';
const GEMINI_STDIN_BRIDGE_PROMPT =
  "Read the JSON request appended on stdin and answer according to that request.";
const CODEX_DIRECT_UNSUPPORTED_MESSAGE =
  "codex direct fallback requires a no-shell CLI mode that is not currently available";
// Prompt files are normally 10-100KB; chunked zero-fill keeps cleanup allocation bounded.
// Prefer a RAM-backed parent when one is available; overwrite plus unlink remains a best-effort
// fallback for disk-backed temporary directories.
const PROMPT_CLEANUP_ZERO_CHUNK_BYTES = 64 * 1024;
const PROMPT_TMPDIR_ENV = "SURFACE_MODEL_PROMPT_TMPDIR";

const BASE_ENV_ALLOWLIST = new Set([
  "USER",
  "LOGNAME",
  "USERNAME",
  "HOME",
  "XDG_CONFIG_HOME",
  "LANG",
  "LC_ALL",
  "TERM",
]);
const WINDOWS_ENV_ALLOWLIST = new Set(["SystemRoot", "windir", "SystemDrive", "PATHEXT"]);
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
const DEFAULT_RUNNER_ENFORCES_FILESYSTEM_ISOLATION =
  process.platform === "darwin" && existsSync(SANDBOX_EXEC_PATH);

const CHANNEL_COMMAND = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
} as const satisfies Record<DirectSubscriptionChannelId, string>;
const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const discoveryCacheByRunner = new WeakMap<ProcessRunner, Map<string, Promise<ChannelDiscovery>>>();

function subscriptionProbeRequest(): string {
  return JSON.stringify({
    input: { surfaceSubscriptionProbe: "ok" },
    instructions: SUBSCRIPTION_PROBE_PROMPT,
    responseFormat: { type: "json" },
  });
}

export const defaultProcessRunner: ProcessRunner = {
  enforcedFilesystemIsolation: DEFAULT_RUNNER_ENFORCES_FILESYSTEM_ISOLATION,
  async run(request) {
    if (
      request.requiresFilesystemIsolation &&
      DEFAULT_RUNNER_ENFORCES_FILESYSTEM_ISOLATION !== true
    ) {
      return {
        exitCode: 127,
        stdout: "",
        stderr: "filesystem isolation is unavailable for the default process runner",
      };
    }

    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "surface-model-cli-"));

    try {
      await chmod(isolatedRoot, 0o700);
      await mkdir(path.join(isolatedRoot, "tmp"), { mode: 0o700, recursive: true });
      const env = buildIsolatedProcessEnvironment({
        baseEnv: process.env,
        isolatedRoot,
        workspaceRoot: process.cwd(),
        ...(request.env === undefined ? {} : { commandEnv: request.env }),
      });
      const invocation = await isolatedInvocation(request, isolatedRoot, env);
      const result = await execa(invocation.command, invocation.args, {
        cwd: isolatedRoot,
        env,
        extendEnv: false,
        ...(request.stdin === undefined ? {} : { input: request.stdin }),
        reject: false,
        timeout: request.timeoutMs,
      });

      return {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        return { exitCode: 127, stdout: "", stderr: "" };
      }

      if (isTimedOutError(error)) {
        return { exitCode: 124, stdout: "", stderr: "", timedOut: true };
      }

      return { exitCode: 1, stdout: "", stderr: "" };
    } finally {
      await rm(isolatedRoot, { force: true, recursive: true });
    }
  },
};

export function buildIsolatedProcessEnvironment(input: {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly isolatedRoot: string;
  readonly workspaceRoot: string;
  readonly commandEnv?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const isolatedTmp = path.join(input.isolatedRoot, "tmp");
  const env: Record<string, string> = {
    TMP: isolatedTmp,
    TEMP: isolatedTmp,
    TMPDIR: isolatedTmp,
  };

  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (value === undefined) {
      continue;
    }

    if (BASE_ENV_ALLOWLIST.has(key) || (isWindows() && WINDOWS_ENV_ALLOWLIST.has(key))) {
      env[key] = value;
    }
  }

  const pathValue = pathEnvValue(input.baseEnv);
  const sanitizedPath = sanitizePath(pathValue, input.workspaceRoot, input.baseEnv.HOME);

  if (sanitizedPath.length > 0) {
    env.PATH = sanitizedPath;
  }

  for (const [key, value] of Object.entries(input.commandEnv ?? {})) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

async function isolatedInvocation(
  request: ProcessRunRequest,
  isolatedRoot: string,
  env: Readonly<Record<string, string>>,
): Promise<{ readonly command: string; readonly args: readonly string[] }> {
  if (DEFAULT_RUNNER_ENFORCES_FILESYSTEM_ISOLATION !== true) {
    return { args: [...request.args], command: request.command };
  }

  const commandPath = executablePath(request.command, env.PATH, env.PATHEXT);
  const profilePath = path.join(isolatedRoot, "surface-model-cli.sb");

  await writeFile(
    profilePath,
    sandboxProfile(
      isolatedRoot,
      env,
      commandPath,
      request.allowedReadPaths ?? [],
      request.channelId,
    ),
    {
      mode: 0o600,
    },
  );

  return {
    args: ["-f", profilePath, commandPath ?? request.command, ...request.args],
    command: SANDBOX_EXEC_PATH,
  };
}

function sandboxProfile(
  isolatedRoot: string,
  env: Readonly<Record<string, string>>,
  commandPath: string | undefined,
  allowedReadPaths: readonly string[],
  channelId: DirectSubscriptionChannelId | undefined,
): string {
  const readSubpaths = [
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/lib",
    "/usr/libexec",
    "/usr/local/bin",
    "/usr/local/lib",
    "/opt/homebrew/bin",
    "/opt/homebrew/lib",
    "/opt/homebrew/opt",
    "/opt/homebrew/share",
    "/usr/local/opt",
    "/usr/local/share",
    "/Library/Frameworks",
    "/System/Library",
    "/Library/Apple",
    isolatedRoot,
    ...commandReadSubpaths(commandPath),
    ...subscriptionAuthReadSubpaths(env, channelId),
  ];
  const readClauses = [...new Set(readSubpaths)]
    .map((subpath) => `(allow file-read* (subpath "${sandboxString(subpath)}"))`)
    .join("\n");
  const readLiterals = [
    ...(commandPath === undefined ? [] : [commandPath]),
    ...allowedReadPaths.flatMap((value) => [value, safeRealpath(value) ?? value]),
  ];
  const literalReadClauses = [...new Set(readLiterals)]
    .map((literal) => `(allow file-read* (literal "${sandboxString(literal)}"))`)
    .join("\n");

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow network*)",
    "(allow file-read-metadata)",
    readClauses,
    literalReadClauses,
    `(allow file-write* (subpath "${sandboxString(isolatedRoot)}"))`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function commandReadSubpaths(commandPath: string | undefined): readonly string[] {
  if (commandPath === undefined) {
    return [];
  }

  const commandDir = path.dirname(commandPath);
  const parts = commandPath.split(path.sep).filter((part) => part.length > 0);
  const subpaths = [commandDir];
  const cellarIndex = parts.indexOf("Cellar");
  const nodeModulesIndex = parts.lastIndexOf("node_modules");

  if (cellarIndex >= 0) {
    subpaths.push(path.join(path.sep, ...parts.slice(0, cellarIndex + 1)));

    if (parts[cellarIndex + 1] !== undefined) {
      subpaths.push(path.join(path.sep, ...parts.slice(0, cellarIndex + 2)));
    }
  }

  if (nodeModulesIndex >= 0 && parts[nodeModulesIndex + 1] !== undefined) {
    subpaths.push(path.join(path.sep, ...parts.slice(0, nodeModulesIndex + 2)));
  }

  return subpaths;
}

function subscriptionAuthReadSubpaths(
  env: Readonly<Record<string, string>>,
  channelId: DirectSubscriptionChannelId | undefined,
): readonly string[] {
  const home = env.HOME;
  const xdgConfigHome =
    env.XDG_CONFIG_HOME ?? (home === undefined ? undefined : path.join(home, ".config"));

  if (channelId === "claude") {
    return [
      ...(home === undefined
        ? []
        : [
            path.join(home, ".claude"),
            path.join(home, "Library", "Application Support", "Claude"),
          ]),
      ...(xdgConfigHome === undefined ? [] : [path.join(xdgConfigHome, "claude")]),
    ];
  }

  if (channelId === "gemini") {
    return [
      ...(home === undefined
        ? []
        : [
            path.join(home, ".gemini"),
            path.join(home, "Library", "Application Support", "Gemini"),
          ]),
      ...(xdgConfigHome === undefined
        ? []
        : [path.join(xdgConfigHome, "gemini"), path.join(xdgConfigHome, "gcloud")]),
    ];
  }

  return [];
}

function sandboxString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function resolveDirectProviders(
  config: SurfaceConfig,
  runner: ProcessRunner = defaultProcessRunner,
): Promise<ResolveDirectProvidersResult> {
  const subscriptionProviders: ModelProvider[] = [];
  const discoveryUnavailableChannels: Extract<ModelAvailability, { available: false }>[] = [];
  for (const channelId of config.model.fallback.effectiveChannels) {
    const discovery = await discoverSubscriptionCapabilityCached(
      channelId,
      runner,
      config.model.fallback.timeoutMs,
    );

    if (discovery.available) {
      subscriptionProviders.push(
        createSubscriptionCliProvider({
          capability: discovery.capability,
          runner,
          timeoutMs: config.model.fallback.timeoutMs,
        }),
      );
    } else {
      discoveryUnavailableChannels.push(discovery.availability);
    }
  }

  return {
    subscriptionProviders,
    discoveryUnavailableChannels,
  };
}

function discoverSubscriptionCapabilityCached(
  channelId: DirectSubscriptionChannelId,
  runner: ProcessRunner,
  timeoutMs: number,
): Promise<ChannelDiscovery> {
  let cache = discoveryCacheByRunner.get(runner);

  if (cache === undefined) {
    cache = new Map();
    discoveryCacheByRunner.set(runner, cache);
  }

  const cacheKey = [
    channelId,
    timeoutMs,
    runner.enforcedFilesystemIsolation === true ? "isolated" : "not-isolated",
  ].join("\0");
  const cached = cache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const discovery = discoverSubscriptionCapability(channelId, runner, timeoutMs).catch((error) => {
    cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, discovery);

  return discovery;
}

export function createSubscriptionCliProvider(
  options: SubscriptionCliProviderOptions,
): ModelProvider {
  return {
    id: options.capability.channelId,
    availability: () => {
      if (options.capability.channelId === "codex") {
        return ok({
          available: false,
          channelId: "codex",
          message: CODEX_DIRECT_UNSUPPORTED_MESSAGE,
          reason: "unsupported-capability",
          sourceKind: "subscription-cli",
        });
      }

      if (options.runner.enforcedFilesystemIsolation !== true) {
        return ok({
          available: false,
          channelId: options.capability.channelId,
          message: `${options.capability.channelId} subscription CLI requires filesystem isolation`,
          reason: "unsupported-capability",
          sourceKind: "subscription-cli",
        });
      }

      return ok({
        available: true,
        channelId: options.capability.channelId,
        provider: options.capability.channelId,
        sourceKind: "subscription-cli",
        model: options.capability.model,
      });
    },
    complete: async (request) => {
      if (options.capability.channelId === "codex") {
        return err(
          createSurfaceError("model_unavailable", CODEX_DIRECT_UNSUPPORTED_MESSAGE, {
            details: { reason: "unsupported-capability" },
          }),
        );
      }

      if (options.runner.enforcedFilesystemIsolation !== true) {
        return err(
          createSurfaceError(
            "model_unavailable",
            "subscription CLI requires filesystem isolation",
            {
              details: { reason: "unsupported-capability" },
            },
          ),
        );
      }

      const parsedRequest = ModelRequestSchema.safeParse(request);

      if (!parsedRequest.success) {
        return err(
          createSurfaceError("invalid_model_request", "Model request is invalid.", {
            cause: parsedRequest.error,
          }),
        );
      }

      const prompt = serializeSubscriptionPrompt(parsedRequest.data);

      if (!isOk(prompt)) {
        return prompt;
      }

      const promptDelivery = await preparePromptDelivery(options, prompt.value);

      if (!promptDelivery.ok) {
        return err(promptDelivery.error);
      }

      try {
        const processRequest: ProcessRunRequest = {
          args: promptDelivery.value.args,
          channelId: options.capability.channelId,
          command: options.capability.command,
          env: envForChannel(options.capability.channelId),
          extendEnv: false,
          requiresFilesystemIsolation: true,
          timeoutMs: options.timeoutMs,
          ...(promptDelivery.value.allowedReadPaths.length === 0
            ? {}
            : { allowedReadPaths: promptDelivery.value.allowedReadPaths }),
          ...(promptDelivery.value.stdin === undefined
            ? {}
            : { stdin: promptDelivery.value.stdin }),
        };
        const result = await options.runner.run(processRequest);
        const cleanup = await promptDelivery.value.cleanup();

        if (!isOk(cleanup)) {
          return modelRequestFailed("prompt cleanup failed", "prompt-cleanup-failed", {
            cleanupFailed: true,
          });
        }

        return parseCompletionResult(options.capability, result);
      } catch (error) {
        const cleanup = await promptDelivery.value.cleanup();

        return modelRequestFailed("subscription CLI completion failed", "command-failed", {
          cleanupFailed: !isOk(cleanup),
          ...sanitizedThrownErrorDetails(error),
        });
      }
    },
  };
}

function serializeSubscriptionPrompt(
  request: z.infer<typeof ModelRequestSchema>,
): Result<string, SurfaceError> {
  try {
    return ok(
      JSON.stringify({
        input: request.prompt.input,
        instructions: request.prompt.instructions,
        responseFormat: request.responseFormat,
        system: request.prompt.system,
      }),
    );
  } catch (error) {
    return modelRequestFailed(
      "subscription CLI prompt serialization failed",
      "serialization-failed",
      {
        ...sanitizedThrownErrorDetails(error),
      },
    );
  }
}

async function discoverSubscriptionCapability(
  channelId: DirectSubscriptionChannelId,
  runner: ProcessRunner,
  timeoutMs: number,
): Promise<ChannelDiscovery> {
  if (runner.enforcedFilesystemIsolation !== true) {
    return unsupported(channelId, `${channelId} subscription CLI requires filesystem isolation`);
  }

  switch (channelId) {
    case "claude":
      return discoverClaude(runner, timeoutMs);
    case "codex":
      return discoverCodex();
    case "gemini":
      return discoverGemini(runner, timeoutMs);
  }
}

function discoverCodex(): ChannelDiscovery {
  return unsupported("codex", CODEX_DIRECT_UNSUPPORTED_MESSAGE);
}

async function discoverClaude(runner: ProcessRunner, timeoutMs: number): Promise<ChannelDiscovery> {
  const version = await runDiscoveryRequest(
    runner,
    discoveryRequest("claude", ["--version"], timeoutMs),
  );
  const versionFailure = classifyDiscoveryFailure("claude", version, "unsupported-capability");

  if (versionFailure !== undefined) {
    return versionFailure;
  }

  const parsedVersion = supportedVersion("claude", version.stdout, {
    min: [2, 0, 0],
    max: [3, 0, 0],
  });

  if (parsedVersion === undefined) {
    return unsupported("claude", "claude subscription CLI version is not supported");
  }

  const probeArgs = [
    "--print",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--disallowedTools",
    "*",
  ];
  const probe = await runDiscoveryRequest(runner, {
    ...discoveryRequest("claude", probeArgs, Math.min(timeoutMs, 30_000)),
    stdin: SUBSCRIPTION_PROBE_PROMPT,
  });
  const probeFailure = classifyDiscoveryFailure("claude", probe, "auth-unavailable");

  if (probeFailure !== undefined) {
    return probeFailure;
  }

  if (!parseProbeOutput("claude", probe.stdout)) {
    return unsupported("claude", "claude subscription CLI capability probe failed");
  }

  return {
    available: true,
    capability: {
      channelId: "claude",
      command: "claude",
      completionArgs: probeArgs,
      model: "claude-subscription",
      promptDelivery: "stdin",
      version: parsedVersion,
    },
  };
}

async function discoverGemini(runner: ProcessRunner, timeoutMs: number): Promise<ChannelDiscovery> {
  const version = await runDiscoveryRequest(runner, {
    ...discoveryRequest("gemini", ["--version"], timeoutMs),
    env: envForChannel("gemini"),
  });
  const versionFailure = classifyDiscoveryFailure("gemini", version, "unsupported-capability");

  if (versionFailure !== undefined) {
    return versionFailure;
  }

  const parsedVersion = supportedVersion("gemini", version.stdout, {
    min: [1, 0, 0],
    max: [2, 0, 0],
  });

  if (parsedVersion === undefined) {
    return unsupported("gemini", "gemini subscription CLI version is not supported");
  }

  const probeArgs = [
    "--prompt",
    GEMINI_STDIN_BRIDGE_PROMPT,
    "--output-format",
    "json",
    "--approval-mode",
    "plan",
    "--sandbox",
  ];
  const probe = await runDiscoveryRequest(runner, {
    ...discoveryRequest("gemini", probeArgs, Math.min(timeoutMs, 30_000)),
    env: envForChannel("gemini"),
    stdin: subscriptionProbeRequest(),
  });
  const probeFailure = classifyDiscoveryFailure("gemini", probe, "auth-unavailable");

  if (probeFailure !== undefined) {
    return probeFailure;
  }

  if (!parseProbeOutput("gemini", probe.stdout)) {
    return unsupported("gemini", "gemini subscription CLI capability probe failed");
  }

  return {
    available: true,
    capability: {
      channelId: "gemini",
      command: "gemini",
      completionArgs: probeArgs,
      model: "gemini-subscription",
      promptDelivery: "stdin",
      version: parsedVersion,
    },
  };
}

function discoveryRequest(
  channelId: DirectSubscriptionChannelId,
  args: readonly string[],
  timeoutMs: number,
): ProcessRunRequest {
  return {
    args,
    channelId,
    command: CHANNEL_COMMAND[channelId],
    env: envForChannel(channelId),
    extendEnv: false,
    requiresFilesystemIsolation: true,
    timeoutMs,
  };
}

async function runDiscoveryRequest(
  runner: ProcessRunner,
  request: ProcessRunRequest,
): Promise<ProcessRunResult> {
  try {
    return await runner.run(request);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return { exitCode: 127, stdout: "", stderr: "" };
    }

    if (isTimedOutError(error)) {
      return { exitCode: 124, stdout: "", stderr: "", timedOut: true };
    }

    if (isNodeErrorWithCode(error, "EACCES") || isNodeErrorWithCode(error, "EPERM")) {
      return { exitCode: 126, stdout: "", stderr: "" };
    }

    return { exitCode: 126, stdout: "", stderr: "" };
  }
}

function classifyDiscoveryFailure(
  channelId: DirectSubscriptionChannelId,
  result: ProcessRunResult,
  timeoutReason: "auth-unavailable" | "unsupported-capability",
): ChannelDiscovery | undefined {
  if (result.exitCode === 127) {
    return unavailable(
      channelId,
      "not-installed",
      `${channelId} subscription CLI is not installed`,
    );
  }

  if (result.exitCode === 126) {
    return unavailable(
      channelId,
      "command-failed",
      `${channelId} subscription CLI could not be executed`,
    );
  }

  if (result.timedOut === true || result.exitCode === 124) {
    return unavailable(channelId, timeoutReason, `${channelId} subscription CLI did not respond`);
  }

  if (result.exitCode !== 0) {
    return unavailable(
      channelId,
      "auth-unavailable",
      `${channelId} subscription CLI is unavailable`,
    );
  }

  return undefined;
}

type PromptDelivery = {
  readonly allowedReadPaths: readonly string[];
  readonly args: readonly string[];
  readonly stdin?: string;
  cleanup(): MaybePromise<Result<void, SurfaceError>>;
};

async function preparePromptDelivery(
  options: SubscriptionCliProviderOptions,
  prompt: string,
): Promise<Result<PromptDelivery, SurfaceError>> {
  if (options.capability.promptDelivery === "stdin") {
    return ok({
      allowedReadPaths: [],
      args: options.capability.completionArgs,
      stdin: prompt,
      cleanup: () => ok(undefined),
    });
  }

  const promptStore = options.promptStore ?? defaultPromptStore;
  const promptFile = await promptStore.create(prompt);

  if (!isOk(promptFile)) {
    return err(promptFile.error);
  }

  return ok({
    allowedReadPaths: [promptFile.value.path],
    args: [...options.capability.completionArgs, promptFile.value.path],
    cleanup: () => promptFile.value.cleanup(),
  });
}

const defaultPromptStore: SubscriptionPromptStore = {
  async create(prompt) {
    try {
      const root = await mkdtemp(path.join(resolvePromptTempParent(), "surface-model-prompt-"));
      await chmod(root, 0o700);
      const promptPath = path.join(root, "prompt.txt");
      await writeFile(promptPath, prompt, { mode: 0o600 });

      return ok({
        path: promptPath,
        cleanup: async () => cleanupPromptFile(root, promptPath, Buffer.byteLength(prompt)),
      });
    } catch (error) {
      return err(
        createSurfaceError("model_request_failed", "prompt file creation failed", {
          cause: error,
          details: { reason: "prompt-cleanup-failed" },
        }),
      );
    }
  },
};

export function resolvePromptTempParent(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env[PROMPT_TMPDIR_ENV];

  if (configured !== undefined && path.isAbsolute(configured) && isWritableDirectory(configured)) {
    return configured;
  }

  const tmpdir = os.tmpdir();

  if (isRamBackedPromptParent(tmpdir, platform) && isWritableDirectory(tmpdir)) {
    return tmpdir;
  }

  if (platform === "linux" && isWritableDirectory("/dev/shm")) {
    return "/dev/shm";
  }

  return tmpdir;
}

function isRamBackedPromptParent(directory: string, platform: NodeJS.Platform): boolean {
  if (platform !== "linux") {
    return false;
  }

  return directory === "/dev/shm" || directory.startsWith("/dev/shm/");
}

function isWritableDirectory(directory: string): boolean {
  try {
    accessSync(directory, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPromptFile(
  root: string,
  promptPath: string,
  byteLength: number,
): Promise<Result<void, SurfaceError>> {
  let cleanupError: unknown;
  const recordCleanupError = (error: unknown) => {
    cleanupError ??= error;
  };

  try {
    const handle = await open(promptPath, "r+");

    try {
      if (byteLength > 0) {
        const zeroChunk = Buffer.alloc(Math.min(PROMPT_CLEANUP_ZERO_CHUNK_BYTES, byteLength));
        let offset = 0;

        while (offset < byteLength) {
          const bytesToWrite = Math.min(zeroChunk.length, byteLength - offset);
          const { bytesWritten } = await handle.write(zeroChunk, 0, bytesToWrite, offset);

          if (bytesWritten <= 0) {
            throw new Error("prompt cleanup wrote zero bytes");
          }

          offset += bytesWritten;
        }
      }

      try {
        await handle.sync();
      } catch (error) {
        if (!isNodeErrorWithCode(error, "EINVAL") && !isNodeErrorWithCode(error, "ENOTSUP")) {
          throw error;
        }
      }
    } catch (error) {
      recordCleanupError(error);
    } finally {
      try {
        await handle.close();
      } catch (error) {
        recordCleanupError(error);
      }
    }
  } catch (error) {
    recordCleanupError(error);
  }

  try {
    await unlink(promptPath);
  } catch (error) {
    recordCleanupError(error);
  }

  try {
    await rmdir(root);
  } catch (error) {
    recordCleanupError(error);
  }

  if (cleanupError !== undefined) {
    return err(
      createSurfaceError("model_request_failed", "prompt cleanup failed", {
        cause: cleanupError,
        details: { reason: "prompt-cleanup-failed" },
      }),
    );
  }

  return ok(undefined);
}

function parseCompletionResult(
  capability: SubscriptionCliCapability,
  result: ProcessRunResult,
): Result<ModelResponse, SurfaceError> {
  if (result.timedOut === true || result.exitCode === 124) {
    return modelRequestFailed("subscription CLI timed out", "timeout");
  }

  if (result.exitCode !== 0) {
    return modelRequestFailed("subscription CLI command failed", "command-failed");
  }

  const parsedOutput = SubscriptionCompletionOutputSchema.safeParse(parseJson(result.stdout));

  if (!parsedOutput.success) {
    const rawText = textFromRawCompletionOutput(capability, result.stdout);

    if (rawText === undefined) {
      return modelRequestFailed("subscription CLI returned malformed output", "parse-failed", {
        outputPreview: sanitizedOutputPreview(result.stdout),
      });
    }

    return ok({
      channelId: capability.channelId,
      model: capability.model,
      provider: capability.channelId,
      sourceKind: "subscription-cli",
      text: rawText,
    });
  }

  return ok({
    channelId: capability.channelId,
    model: capability.model,
    provider: capability.channelId,
    sourceKind: "subscription-cli",
    text: parsedOutput.data.text,
  });
}

function textFromRawCompletionOutput(
  capability: SubscriptionCliCapability,
  stdout: string,
): string | undefined {
  if (capability.channelId === "claude") {
    const claudeText = textFromClaudeJsonOutput(stdout);

    if (claudeText !== undefined) {
      return claudeText;
    }
  }

  if (capability.channelId === "codex") {
    return textFromCodexJsonl(stdout);
  }

  const trimmed = stdout.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

function sanitizedOutputPreview(stdout: string): string {
  return maskModelPlainText(stdout.trim().slice(0, 240));
}

function parseProbeOutput(channelId: DirectSubscriptionChannelId, stdout: string): boolean {
  const candidate = channelId === "claude" ? (textFromClaudeJsonOutput(stdout) ?? stdout) : stdout;

  return SubscriptionProbeOutputSchema.safeParse(parseJson(candidate)).success;
}

function textFromClaudeJsonOutput(stdout: string): string | undefined {
  const parsed = parseJson(stdout);

  if (parsed === undefined || parsed === null || typeof parsed !== "object") {
    return undefined;
  }

  return textFromClaudeRecord(parsed as Record<string, unknown>);
}

function textFromClaudeRecord(record: Record<string, unknown>): string | undefined {
  for (const key of ["result", "message", "text", "output"]) {
    const value = record[key];

    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  const content = record.content;

  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content.flatMap(textFromCodexContentEntry).join("");

    return text.length === 0 ? undefined : text;
  }

  return undefined;
}

function sanitizedThrownErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      errorMessage: "subscription CLI runner threw before producing model output",
      errorName: maskModelPlainText(error.name || "Error"),
    };
  }

  return {
    errorMessage: "subscription CLI runner threw a non-Error value",
    errorName: "NonErrorThrown",
  };
}

function modelRequestFailed(
  message: string,
  reason:
    | "timeout"
    | "command-failed"
    | "parse-failed"
    | "prompt-cleanup-failed"
    | "serialization-failed",
  details: Record<string, unknown> = {},
): Result<never, SurfaceError> {
  return err(
    createSurfaceError("model_request_failed", message, {
      details: {
        ...details,
        reason,
      },
    }),
  );
}

function unavailable(
  channelId: DirectSubscriptionChannelId,
  reason: Extract<ModelAvailability, { available: false }>["reason"],
  message: string,
): ChannelDiscovery {
  return {
    available: false,
    availability: {
      available: false,
      channelId,
      message,
      reason,
      sourceKind: "subscription-cli",
    },
  };
}

function textFromCodexJsonl(stdout: string): string | undefined {
  const textEvents = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed = parseJson(line);

      return parsed === undefined ? [] : [textFromCodexEvent(parsed)];
    })
    .filter((value): value is string => value !== undefined && value.length > 0);

  return textEvents.at(-1);
}

function textFromCodexEvent(event: unknown): string | undefined {
  if (event === null || typeof event !== "object") {
    return undefined;
  }

  const record = event as Record<string, unknown>;

  for (const key of ["text", "message", "last_message", "output"]) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  const item = record.item;

  if (item !== null && typeof item === "object") {
    return textFromCodexEvent(item);
  }

  const content = record.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.flatMap(textFromCodexContentEntry).join("");
  }

  return undefined;
}

function textFromCodexContentEntry(entry: unknown): string[] {
  if (typeof entry === "string") {
    return [entry];
  }

  if (entry === null || typeof entry !== "object") {
    return [];
  }

  const record = entry as Record<string, unknown>;

  if (typeof record.text === "string") {
    return [record.text];
  }

  if (typeof record.content === "string") {
    return [record.content];
  }

  return [];
}

function unsupported(channelId: DirectSubscriptionChannelId, message: string): ChannelDiscovery {
  return unavailable(channelId, "unsupported-capability", message);
}

function envForChannel(
  channelId: DirectSubscriptionChannelId,
): Readonly<Record<string, string | undefined>> {
  if (channelId === "gemini") {
    return { NO_BROWSER: "true" };
  }

  return {};
}

function supportedVersion(
  channelId: DirectSubscriptionChannelId,
  stdout: string,
  range: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  },
): string | undefined {
  const version = extractSemver(stdout);

  if (version === undefined) {
    return undefined;
  }

  if (compareSemver(version.parts, range.min) < 0 || compareSemver(version.parts, range.max) >= 0) {
    return undefined;
  }

  if (!versionOutputMatchesChannel(channelId, stdout)) {
    return undefined;
  }

  return version.text;
}

function versionOutputMatchesChannel(
  channelId: DirectSubscriptionChannelId,
  stdout: string,
): boolean {
  const trimmed = stdout.trim();

  switch (channelId) {
    case "claude":
      return /^(?:claude(?:\s+code)?)/i.test(trimmed);
    case "codex":
      return /^codex\b/i.test(trimmed);
    case "gemini":
      return /^gemini\b/i.test(trimmed);
  }
}

function extractSemver(
  stdout: string,
): { readonly text: string; readonly parts: readonly [number, number, number] } | undefined {
  const match = stdout.match(/\b(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\b/);

  if (match === null) {
    return undefined;
  }

  return {
    text: match[0],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

function compareSemver(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (const index of [0, 1, 2] as const) {
    const delta = left[index] - right[index];

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function executablePath(
  command: string,
  pathValue: string | undefined,
  pathextValue: string | undefined,
): string | undefined {
  if (path.isAbsolute(command) || hasPathSeparator(command)) {
    for (const candidate of executablePathCandidates(command, pathextValue)) {
      const realPath = safeExecutableRealpath(candidate);

      if (realPath !== undefined) {
        return realPath;
      }
    }

    return undefined;
  }

  for (const directory of (pathValue ?? "").split(path.delimiter)) {
    if (directory.length === 0) {
      continue;
    }

    for (const executableName of executablePathCandidates(command, pathextValue)) {
      const candidate = path.join(directory, executableName);
      const realPath = safeExecutableRealpath(candidate);

      if (realPath !== undefined) {
        return realPath;
      }
    }
  }

  return undefined;
}

function executablePathCandidates(
  command: string,
  pathextValue: string | undefined,
): readonly string[] {
  if (!isWindows()) {
    return [command];
  }

  const extensions = windowsExecutableExtensions(pathextValue);
  const extension = path.extname(command).toLowerCase();

  if (extension.length > 0 && extensions.includes(extension)) {
    return [command];
  }

  return [command, ...extensions.map((candidateExtension) => `${command}${candidateExtension}`)];
}

function windowsExecutableExtensions(pathextValue: string | undefined): readonly string[] {
  const rawValue =
    pathextValue === undefined || pathextValue.trim().length === 0
      ? DEFAULT_WINDOWS_PATHEXT
      : pathextValue;

  return [
    ...new Set(
      rawValue
        .split(";")
        .map((extension) => extension.trim())
        .filter((extension) => extension.length > 0)
        .map((extension) =>
          extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`,
        ),
    ),
  ];
}

function hasPathSeparator(value: string): boolean {
  return value.includes(path.sep) || value.includes("/") || value.includes("\\");
}

function sanitizePath(
  pathValue: string | undefined,
  workspaceRoot: string,
  homeRoot: string | undefined,
): string {
  if (pathValue === undefined || pathValue.length === 0) {
    return "";
  }

  const workspaceRealPath = safeRealpath(workspaceRoot) ?? path.resolve(workspaceRoot);
  const homeRealPath =
    homeRoot === undefined ? undefined : (safeRealpath(homeRoot) ?? path.resolve(homeRoot));
  const segments: string[] = [];

  for (const segment of pathValue.split(path.delimiter)) {
    if (!path.isAbsolute(segment) || !existsSync(segment)) {
      continue;
    }

    const realSegment = safeRealpath(segment);

    const resolvedSegment = path.resolve(segment);

    if (
      realSegment === undefined ||
      isBroadPathSegment(resolvedSegment, workspaceRealPath, homeRealPath) ||
      isBroadPathSegment(realSegment, workspaceRealPath, homeRealPath)
    ) {
      continue;
    }

    segments.push(resolvedSegment);
    segments.push(realSegment);
  }

  return [...new Set(segments)].join(path.delimiter);
}

function pathEnvValue(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.PATH ?? env.Path ?? env.path;
}

function isBroadPathSegment(
  candidate: string,
  workspaceRoot: string,
  homeRoot: string | undefined,
): boolean {
  return (
    path.parse(candidate).root === candidate ||
    pathOverlaps(candidate, workspaceRoot) ||
    pathIsSameOrAncestor(candidate, workspaceRoot) ||
    (homeRoot !== undefined && pathIsSameOrAncestor(candidate, homeRoot))
  );
}

function pathOverlaps(candidate: string, workspaceRoot: string): boolean {
  const relative = path.relative(workspaceRoot, candidate);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pathIsSameOrAncestor(candidate: string, target: string): boolean {
  const relative = path.relative(candidate, target);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRealpath(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}

function safeExecutableRealpath(value: string): string | undefined {
  const realPath = safeRealpath(value);

  if (realPath === undefined) {
    return undefined;
  }

  try {
    accessSync(realPath, fsConstants.X_OK);
    return realPath;
  } catch {
    return undefined;
  }
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function isTimedOutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "timedOut" in error &&
    (error as { readonly timedOut?: unknown }).timedOut === true
  );
}
