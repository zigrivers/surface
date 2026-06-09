import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  type ModelRequest,
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
const STALE_SURFACE_TEMP_ROOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SURFACE_TEMP_ROOT_PREFIXES = ["surface-model-cli-", "surface-model-prompt-"] as const;

const BASE_ENV_ALLOWLIST = new Set(["USER", "LOGNAME", "USERNAME", "LANG", "LC_ALL", "TERM"]);
const WINDOWS_ENV_ALLOWLIST = new Set(["SystemRoot", "windir", "SystemDrive", "PATHEXT"]);
const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
const DEFAULT_RUNNER_ENFORCES_FILESYSTEM_ISOLATION =
  process.platform === "darwin" && existsSync(SANDBOX_EXEC_PATH);

const CHANNEL_COMMAND = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
} as const satisfies Record<DirectSubscriptionChannelId, string>;
type CleanupSignal = "SIGHUP" | "SIGINT" | "SIGQUIT" | "SIGTERM";
const DEFAULT_WINDOWS_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const discoveryCacheByRunner = new WeakMap<ProcessRunner, Map<string, Promise<ChannelDiscovery>>>();
const activeTempRoots = new Set<string>();
let processCleanupHandlersInstalled = false;
let signalCleanupInProgress = false;

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

    await pruneStaleSurfaceTempRoots(os.tmpdir());
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "surface-model-cli-"));
    trackTempRoot(isolatedRoot);
    let processResult: ProcessRunResult;

    try {
      await chmod(isolatedRoot, 0o700);
      const env = buildIsolatedProcessEnvironment({
        baseEnv: process.env,
        isolatedRoot,
        workspaceRoot: process.cwd(),
        ...(request.env === undefined ? {} : { commandEnv: request.env }),
      });
      await createIsolatedWritableDirectories(env);
      const authMirrorRoots = await mirrorSubscriptionAuth({
        baseEnv: process.env,
        channelId: request.channelId,
        env,
      });
      await chmodAuthMirrors(authMirrorRoots, "read-only");
      const authSnapshot = await snapshotAuthMirrors(authMirrorRoots);
      const invocation = await isolatedInvocation(request, isolatedRoot, env);
      const result = await execa(invocation.command, invocation.args, {
        cwd: isolatedRoot,
        env,
        extendEnv: false,
        ...(request.stdin === undefined ? {} : { input: request.stdin }),
        reject: false,
        timeout: request.timeoutMs,
      });

      processResult = {
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
      };
      const authMutation = await authMirrorMutation(authSnapshot);

      if (authMutation !== undefined) {
        processResult = unsupportedCapabilityProcessResult(authMutation);
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        processResult = { exitCode: 127, stdout: "", stderr: "" };
      } else if (isTimedOutError(error)) {
        processResult = { exitCode: 124, stdout: "", stderr: "", timedOut: true };
      } else if (error instanceof AuthMirrorUnsupportedError) {
        processResult = unsupportedCapabilityProcessResult(error.message);
      } else {
        processResult = { exitCode: 1, stdout: "", stderr: "" };
      }
    }

    const cleanup = await cleanupIsolatedRoot(isolatedRoot);

    if (cleanup) {
      untrackTempRoot(isolatedRoot);
    }

    if (!cleanup && processResult.exitCode === 0) {
      return unsupportedCapabilityProcessResult("subscription CLI isolated cleanup failed");
    }

    return processResult;
  },
};

export function buildIsolatedProcessEnvironment(input: {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly isolatedRoot: string;
  readonly workspaceRoot: string;
  readonly commandEnv?: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const isolatedTmp = path.join(input.isolatedRoot, "tmp");
  const isolatedHome = path.join(input.isolatedRoot, "home");
  const isolatedConfigHome = path.join(isolatedHome, ".config");
  const isolatedCacheHome = path.join(input.isolatedRoot, "cache");
  const isolatedRuntimeDir = path.join(input.isolatedRoot, "run");
  const isolatedStateHome = path.join(input.isolatedRoot, "state");
  const env: Record<string, string> = {
    HOME: isolatedHome,
    TMP: isolatedTmp,
    TEMP: isolatedTmp,
    TMPDIR: isolatedTmp,
    XDG_CACHE_HOME: isolatedCacheHome,
    XDG_CONFIG_HOME: isolatedConfigHome,
    XDG_RUNTIME_DIR: isolatedRuntimeDir,
    XDG_STATE_HOME: isolatedStateHome,
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
    if (
      key === "HOME" ||
      key === "XDG_CACHE_HOME" ||
      key === "XDG_CONFIG_HOME" ||
      key === "XDG_RUNTIME_DIR" ||
      key === "XDG_STATE_HOME"
    ) {
      continue;
    }

    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

async function createIsolatedWritableDirectories(
  env: Readonly<Record<string, string>>,
): Promise<void> {
  for (const directory of isolatedWritableSubpaths(env)) {
    await mkdir(directory, { mode: 0o700, recursive: true });
  }
}

function isolatedWritableSubpaths(env: Readonly<Record<string, string>>): readonly string[] {
  return [
    env.TMPDIR,
    env.XDG_CACHE_HOME,
    env.XDG_RUNTIME_DIR,
    env.XDG_STATE_HOME,
    env.TMP,
    env.TEMP,
  ].filter((value): value is string => value !== undefined && value.length > 0);
}

async function mirrorSubscriptionAuth(input: {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly channelId: DirectSubscriptionChannelId | undefined;
  readonly env: Readonly<Record<string, string>>;
}): Promise<readonly string[]> {
  const isolatedHome = input.env.HOME;
  const isolatedXdgConfigHome = input.env.XDG_CONFIG_HOME;

  if (isolatedHome === undefined || isolatedXdgConfigHome === undefined) {
    return [];
  }

  await mkdir(isolatedHome, { mode: 0o700, recursive: true });
  await mkdir(isolatedXdgConfigHome, { mode: 0o700, recursive: true });
  const copiedMirrors: string[] = [];

  for (const mirror of subscriptionAuthMirrorPaths({
    ...input,
    isolatedHome,
    isolatedXdgConfigHome,
  })) {
    if (!existsSync(mirror.source)) {
      continue;
    }

    if (!(await validateSubscriptionAuthMirrorSource(mirror.source))) {
      throw new AuthMirrorUnsupportedError("subscription CLI auth mirror contains symlinks");
    }

    await mkdir(path.dirname(mirror.destination), { mode: 0o700, recursive: true });
    await cp(mirror.source, mirror.destination, {
      dereference: false,
      errorOnExist: false,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    });
    copiedMirrors.push(mirror.destination);
  }

  return copiedMirrors;
}

class AuthMirrorUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthMirrorUnsupportedError";
  }
}

export async function validateSubscriptionAuthMirrorSource(source: string): Promise<boolean> {
  try {
    return await hasNoSymlinkDescendants(source);
  } catch {
    return false;
  }
}

async function hasNoSymlinkDescendants(source: string): Promise<boolean> {
  const stats = await lstat(source);

  if (stats.isSymbolicLink()) {
    return false;
  }

  if (!stats.isDirectory()) {
    return true;
  }

  for (const entry of await readdir(source)) {
    if (!(await hasNoSymlinkDescendants(path.join(source, entry)))) {
      return false;
    }
  }

  return true;
}

function subscriptionAuthMirrorPaths(input: {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly channelId: DirectSubscriptionChannelId | undefined;
  readonly isolatedHome: string;
  readonly isolatedXdgConfigHome: string;
}): readonly { readonly destination: string; readonly source: string }[] {
  const sourceHome = input.baseEnv.HOME ?? input.baseEnv.USERPROFILE;
  const sourceXdgConfigHome =
    input.baseEnv.XDG_CONFIG_HOME ??
    (sourceHome === undefined ? undefined : path.join(sourceHome, ".config"));

  if (input.channelId === "claude") {
    return [
      ...homeMirrorPaths(sourceHome, input.isolatedHome, [
        ".claude",
        path.join("Library", "Application Support", "Claude"),
      ]),
      ...xdgMirrorPaths(sourceXdgConfigHome, input.isolatedXdgConfigHome, ["claude"]),
    ];
  }

  if (input.channelId === "gemini") {
    return [
      ...homeMirrorPaths(sourceHome, input.isolatedHome, [
        ".gemini",
        path.join("Library", "Application Support", "Gemini"),
      ]),
      ...xdgMirrorPaths(sourceXdgConfigHome, input.isolatedXdgConfigHome, ["gemini", "gcloud"]),
    ];
  }

  return [];
}

function homeMirrorPaths(
  sourceHome: string | undefined,
  destinationHome: string,
  relativePaths: readonly string[],
): readonly { readonly destination: string; readonly source: string }[] {
  if (sourceHome === undefined) {
    return [];
  }

  return relativePaths.map((relativePath) => ({
    destination: path.join(destinationHome, relativePath),
    source: path.join(sourceHome, relativePath),
  }));
}

function xdgMirrorPaths(
  sourceXdgConfigHome: string | undefined,
  destinationXdgConfigHome: string,
  relativePaths: readonly string[],
): readonly { readonly destination: string; readonly source: string }[] {
  if (sourceXdgConfigHome === undefined) {
    return [];
  }

  return relativePaths.map((relativePath) => ({
    destination: path.join(destinationXdgConfigHome, relativePath),
    source: path.join(sourceXdgConfigHome, relativePath),
  }));
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
  const writeClauses = [...new Set(isolatedWritableSubpaths(env))]
    .map((subpath) => `(allow file-write* (subpath "${sandboxString(subpath)}"))`)
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
    writeClauses,
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

        return parseCompletionResult(options.capability, result, parsedRequest.data.responseFormat);
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
  if (isUnsupportedCapabilityResult(result)) {
    return unavailable(
      channelId,
      "unsupported-capability",
      `${channelId} subscription CLI requires filesystem isolation`,
    );
  }

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

function isIsolationUnavailableResult(result: ProcessRunResult): boolean {
  return result.stderr.includes("filesystem isolation is unavailable");
}

function isUnsupportedCapabilityResult(result: ProcessRunResult): boolean {
  return (
    isIsolationUnavailableResult(result) ||
    result.stderr.includes("subscription CLI auth mirror contains symlinks") ||
    result.stderr.includes("subscription CLI auth mirror was mutated") ||
    result.stderr.includes("subscription CLI isolated cleanup failed")
  );
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
      const parent = resolvePromptTempParent();
      await pruneStaleSurfaceTempRoots(parent);
      const root = await mkdtemp(path.join(parent, "surface-model-prompt-"));
      trackTempRoot(root);
      await chmod(root, 0o700);
      const promptPath = path.join(root, "prompt.txt");
      await writeFile(promptPath, prompt, { mode: 0o600 });

      return ok({
        path: promptPath,
        cleanup: async () => cleanupPromptFile(root, promptPath),
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
): Promise<Result<void, SurfaceError>> {
  let cleanupError: unknown;
  const recordCleanupError = (error: unknown) => {
    cleanupError ??= error;
  };

  try {
    const handle = await open(promptPath, "r+");

    try {
      const actualByteLength = (await handle.stat()).size;

      if (actualByteLength > 0) {
        const zeroChunk = Buffer.alloc(Math.min(PROMPT_CLEANUP_ZERO_CHUNK_BYTES, actualByteLength));
        let offset = 0;

        while (offset < actualByteLength) {
          const bytesToWrite = Math.min(zeroChunk.length, actualByteLength - offset);
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
    try {
      await chmodTree(root, "read-only");
    } catch {
      // Keep cleanup errors focused on the original cleanup failure.
    }

    return err(
      createSurfaceError("model_request_failed", "prompt cleanup failed", {
        cause: cleanupError,
        details: { reason: "prompt-cleanup-failed" },
      }),
    );
  }

  untrackTempRoot(root);
  return ok(undefined);
}

function trackTempRoot(root: string): void {
  activeTempRoots.add(root);
}

function untrackTempRoot(root: string): void {
  activeTempRoots.delete(root);
}

async function cleanupIsolatedRoot(root: string): Promise<boolean> {
  try {
    await chmodTree(root, "writable");
    await rm(root, { force: true, recursive: true });
    return true;
  } catch {
    try {
      await chmodTree(root, "read-only");
    } catch {
      // Preserve the cleanup failure result; process cleanup may retry later.
    }

    return false;
  }
}

export async function pruneStaleSurfaceTempRoots(
  parent: string = os.tmpdir(),
  nowMs: number = Date.now(),
): Promise<void> {
  let entries: { isDirectory(): boolean; name: string }[];

  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (
        !entry.isDirectory() ||
        !SURFACE_TEMP_ROOT_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
      ) {
        return;
      }

      const candidate = path.join(parent, entry.name);
      try {
        const stats = await lstat(candidate);

        if (nowMs - stats.mtimeMs <= STALE_SURFACE_TEMP_ROOT_MAX_AGE_MS) {
          return;
        }

        await chmodTree(candidate, "writable");
        await rm(candidate, { force: true, recursive: true });
      } catch {
        // Startup pruning is best-effort; active run cleanup still fails closed.
      }
    }),
  );
}

type AuthMirrorSnapshot = {
  readonly root: string;
  readonly entries: ReadonlyMap<string, string>;
};

async function snapshotAuthMirrors(
  roots: readonly string[],
): Promise<readonly AuthMirrorSnapshot[]> {
  return await Promise.all(
    roots.map(async (root) => ({
      entries: await snapshotDirectory(root),
      root,
    })),
  );
}

async function authMirrorMutation(
  snapshots: readonly AuthMirrorSnapshot[],
): Promise<string | undefined> {
  for (const snapshot of snapshots) {
    try {
      const current = await snapshotDirectory(snapshot.root);

      if (!sameSnapshot(snapshot.entries, current)) {
        return "subscription CLI auth mirror was mutated during execution";
      }
    } catch {
      return "subscription CLI auth mirror was mutated during execution";
    }
  }

  return undefined;
}

async function snapshotDirectory(root: string): Promise<ReadonlyMap<string, string>> {
  const entries = new Map<string, string>();
  await snapshotDirectoryEntry(root, root, entries);
  return entries;
}

async function snapshotDirectoryEntry(
  root: string,
  entryPath: string,
  entries: Map<string, string>,
): Promise<void> {
  const stats = await lstat(entryPath);
  const relativePath = path.relative(root, entryPath) || ".";
  const mode = (stats.mode & 0o777).toString(8);

  if (stats.isDirectory()) {
    entries.set(relativePath, `dir:${mode}`);
    const children = await readdir(entryPath);

    for (const child of children) {
      await snapshotDirectoryEntry(root, path.join(entryPath, child), entries);
    }
    return;
  }

  if (stats.isSymbolicLink()) {
    entries.set(relativePath, `symlink:${mode}:${await readlink(entryPath)}`);
    return;
  }

  if (stats.isFile()) {
    const hash = createHash("sha256")
      .update(await readFile(entryPath))
      .digest("hex");
    entries.set(relativePath, `file:${mode}:${stats.size}:${hash}`);
    return;
  }

  entries.set(relativePath, `other:${mode}:${stats.size}`);
}

function sameSnapshot(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [key, value] of left) {
    if (right.get(key) !== value) {
      return false;
    }
  }

  return true;
}

async function chmodAuthMirrors(roots: readonly string[], mode: "read-only" | "writable") {
  for (const root of roots) {
    await chmodTree(root, mode);
  }
}

async function chmodTree(root: string, mode: "read-only" | "writable"): Promise<void> {
  const stats = await lstat(root);

  if (stats.isSymbolicLink()) {
    return;
  }

  if (stats.isDirectory()) {
    await chmod(root, mode === "read-only" ? 0o500 : 0o700);
    for (const entry of await readdir(root)) {
      await chmodTree(path.join(root, entry), mode);
    }
    return;
  }

  await chmod(root, mode === "read-only" ? 0o400 : 0o600);
}

function unsupportedCapabilityProcessResult(message: string): ProcessRunResult {
  return {
    exitCode: 126,
    stdout: "",
    stderr: message,
  };
}

export async function cleanupActiveSubscriptionTempRootsForProcess(): Promise<void> {
  for (const root of [...activeTempRoots]) {
    try {
      if (await cleanupIsolatedRoot(root)) {
        untrackTempRoot(root);
      }
    } catch {
      // Host-level process cleanup is best-effort; normal runner cleanup fails closed.
    }
  }
}

function cleanupActiveSubscriptionTempRootsSync(): void {
  for (const root of [...activeTempRoots]) {
    try {
      if (cleanupIsolatedRootSync(root)) {
        untrackTempRoot(root);
      }
    } catch {
      // Signal and exit cleanup are best-effort.
    }
  }
}

function cleanupIsolatedRootSync(root: string): boolean {
  try {
    chmodTreeSync(root, "writable");
    rmSync(root, { force: true, recursive: true });
    return true;
  } catch {
    try {
      chmodTreeSync(root, "read-only");
    } catch {
      // Leave the original cleanup failure as the controlling outcome.
    }

    return false;
  }
}

function chmodTreeSync(root: string, mode: "read-only" | "writable"): void {
  const stats = lstatSync(root);

  if (stats.isSymbolicLink()) {
    return;
  }

  if (stats.isDirectory()) {
    chmodSync(root, mode === "read-only" ? 0o500 : 0o700);
    for (const entry of readdirSync(root)) {
      chmodTreeSync(path.join(root, entry), mode);
    }
    return;
  }

  chmodSync(root, mode === "read-only" ? 0o400 : 0o600);
}

export function installSubscriptionTempRootProcessCleanupHandlers(): () => void {
  if (processCleanupHandlersInstalled) {
    return () => undefined;
  }

  processCleanupHandlersInstalled = true;

  let dispose = () => undefined;
  const signalHandlers: { readonly handler: () => void; readonly signal: CleanupSignal }[] = [];
  const handleExit = () => {
    cleanupActiveSubscriptionTempRootsSync();
  };
  const handleSignal = (signal: CleanupSignal) => {
    if (signalCleanupInProgress) {
      return;
    }

    signalCleanupInProgress = true;
    cleanupActiveSubscriptionTempRootsSync();
    dispose();

    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(signalExitCode(signal));
    }
  };
  const registerSignalHandler = (signal: CleanupSignal) => {
    const handler = () => handleSignal(signal);

    try {
      process.on(signal, handler);
      signalHandlers.push({ handler, signal });
    } catch {
      // Some platforms do not expose every POSIX signal; unsupported handlers are skipped.
    }
  };
  dispose = () => {
    process.off("exit", handleExit);
    for (const { handler, signal } of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.length = 0;
    processCleanupHandlersInstalled = false;
  };

  process.on("exit", handleExit);
  registerSignalHandler("SIGHUP");
  registerSignalHandler("SIGINT");
  registerSignalHandler("SIGQUIT");
  registerSignalHandler("SIGTERM");

  return dispose;
}

function signalExitCode(signal: CleanupSignal): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGQUIT":
      return 131;
    case "SIGTERM":
      return 143;
  }
}

function parseCompletionResult(
  capability: SubscriptionCliCapability,
  result: ProcessRunResult,
  responseFormat: ModelRequest["responseFormat"] | undefined,
): Result<ModelResponse, SurfaceError> {
  if (result.timedOut === true || result.exitCode === 124) {
    return modelRequestFailed("subscription CLI timed out", "timeout");
  }

  if (isUnsupportedCapabilityResult(result)) {
    return modelRequestFailed(
      "subscription CLI could not satisfy the filesystem isolation contract",
      "unsupported-capability",
    );
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

    if (!responseTextMatchesFormat(rawText, responseFormat)) {
      return modelRequestFailed("subscription CLI returned malformed JSON output", "parse-failed", {
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

  if (!responseTextMatchesFormat(parsedOutput.data.text, responseFormat)) {
    return modelRequestFailed("subscription CLI returned malformed JSON output", "parse-failed", {
      outputPreview: sanitizedOutputPreview(parsedOutput.data.text),
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

function responseTextMatchesFormat(
  text: string,
  responseFormat: ModelRequest["responseFormat"] | undefined,
): boolean {
  if (responseFormat?.type !== "json") {
    return true;
  }

  return parseJson(text) !== undefined;
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
    | "serialization-failed"
    | "unsupported-capability",
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
      isBroadPathSegment(realSegment, workspaceRealPath, homeRealPath) ||
      !isTrustedExecutableDirectory(resolvedSegment) ||
      !isTrustedExecutableDirectory(realSegment)
    ) {
      continue;
    }

    segments.push(resolvedSegment);
    segments.push(realSegment);
  }

  return [...new Set(segments)].join(path.delimiter);
}

function isTrustedExecutableDirectory(directory: string): boolean {
  if (isWindows()) {
    return true;
  }

  let stats: ReturnType<typeof statSync>;

  try {
    stats = statSync(directory);
  } catch {
    return false;
  }

  if (!stats.isDirectory() || (stats.mode & 0o022) !== 0) {
    return false;
  }

  const uid = process.getuid?.();

  return uid === undefined || stats.uid === uid || stats.uid === 0;
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
