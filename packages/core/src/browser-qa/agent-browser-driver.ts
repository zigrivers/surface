import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { isNodeErrorWithCode, isSameOrChildPath } from "../path-safety.js";
import { SURFACE_STATE_DIR } from "../state-store.js";
import type { BrowserAction, BrowserLocator, QaTarget } from "./schemas.js";

export type BrowserQaAgentBrowserCommandResult = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export type BrowserQaAgentBrowserCommandInvocation = {
  readonly args: readonly string[];
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
  readonly result: BrowserQaAgentBrowserCommandResult;
  readonly stdin?: string;
};

export type BrowserQaAgentBrowserCommandInput = Omit<
  BrowserQaAgentBrowserCommandInvocation,
  "result"
>;

export type BrowserQaAgentBrowserCommandRunner = (
  input: BrowserQaAgentBrowserCommandInput,
) => Promise<BrowserQaAgentBrowserCommandResult>;

export type AgentBrowserCliDriverOptions = {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly binary?: string;
  readonly projectRoot?: string;
  readonly runCommand?: BrowserQaAgentBrowserCommandRunner;
  readonly stateDir?: string;
};

export type AgentBrowserEnvironmentInput = {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly extraAllowlist?: readonly string[];
};

export type BrowserQaSession = {
  readonly createdAt: string;
  readonly executableSignature: string;
  readonly id: string;
  readonly lockfilePath: string;
  readonly manifestPath: string;
  readonly owner: "surface";
  readonly ownerToken: string;
  readonly processGroup: string;
  readonly profileDir: string;
  readonly qaRunId: string;
  readonly startedAt: string;
  readonly target: QaTarget;
};

export type BrowserQaDriverValueRef =
  | {
      readonly kind: "literal";
      readonly value: string;
    }
  | {
      readonly kind: "secret";
      readonly name: string;
      readonly value: string;
    };

export type BrowserQaDriverActionInput = {
  readonly expect?: Readonly<Record<string, unknown>>;
  readonly locator?: BrowserLocator;
  readonly stepId?: string;
  readonly theme?: string;
  readonly timeoutMs?: number;
  readonly url?: string;
  readonly value?: string;
  readonly valueRef?: BrowserQaDriverValueRef;
  readonly viewport?: QaTarget["viewport"];
  readonly wait?: Readonly<Record<string, unknown>>;
};

export type BrowserQaDriver = {
  startSession(input: {
    readonly qaRunId: string;
    readonly target: QaTarget;
  }): Promise<Result<BrowserQaSession, SurfaceError>>;
  stopSession(sessionId: string): Promise<Result<{ readonly stopped: true }, SurfaceError>>;
  navigate(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  click(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  dblclick(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  focus(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  fill(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  type(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  press(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  hover(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  select(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  upload(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  check(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  uncheck(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  scroll(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  wait(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  pushState(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  setViewport(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  setTheme(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  assertText(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  assertElementState(
    input: BrowserQaDriverActionInput & {
      readonly state: "checked" | "enabled" | "visible";
    },
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>>;
  captureState(): Promise<Result<Record<string, unknown>, SurfaceError>>;
  getConsoleSummary(): Promise<Result<Record<string, unknown>, SurfaceError>>;
  getNetworkSummary(): Promise<Result<Record<string, unknown>, SurfaceError>>;
  getReactDiagnostics(): Promise<Result<Record<string, unknown>, SurfaceError>>;
  getVitals(): Promise<Result<Record<string, unknown>, SurfaceError>>;
  cleanupStaleSessions(input?: { readonly dryRun?: boolean }): Promise<
    Result<
      {
        readonly cleaned: readonly string[];
        readonly skipped: readonly string[];
      },
      SurfaceError
    >
  >;
};

const DEFAULT_ENV_ALLOWLIST = new Set(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "CI"]);
const SENSITIVE_ENV_PATTERN = /(TOKEN|SECRET|PASSWORD|KEY|COOKIE|AUTH)/iu;
const SENSITIVE_OUTPUT_PATTERN =
  /(authorization:\s*bearer\s+)[^\s]+|(cookie:\s*)[^\n\r]+|(password=)[^&\s]+|(token=)[^&\s]+/giu;
const SESSION_MANIFEST_VERSION = 1;
const SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1_000;
const ACTIVE_SESSION_MANIFESTS = new Set<string>();
let processCleanupHooksInstalled = false;

class AgentBrowserCliDriver implements BrowserQaDriver {
  readonly #activeSessionManifests = new Map<string, string>();
  #activeSessionId: string | undefined;
  readonly #binary: string;
  readonly #env: Readonly<Record<string, string>>;
  #preflightResult: Promise<Result<undefined, SurfaceError>> | undefined;
  readonly #projectRoot: string;
  readonly #runCommand: BrowserQaAgentBrowserCommandRunner;
  readonly #stateDir: string;

  constructor(options: AgentBrowserCliDriverOptions = {}) {
    this.#binary = options.binary ?? "agent-browser";
    this.#env = createAgentBrowserEnvironment({
      ...(options.baseEnv === undefined ? {} : { baseEnv: options.baseEnv }),
    });
    this.#projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.#stateDir = path.resolve(this.#projectRoot, options.stateDir ?? SURFACE_STATE_DIR);
    this.#runCommand = options.runCommand ?? createDefaultCommandRunner();
  }

  async startSession(input: {
    readonly qaRunId: string;
    readonly target: QaTarget;
  }): Promise<Result<BrowserQaSession, SurfaceError>> {
    const preflight = await this.#preflightAgentBrowser();
    if (!preflight.ok) {
      return preflight;
    }

    const sessionId = `ab_${randomUUID()}`;
    const sessionDir = path.join(this.#stateDir, "tmp", "qa", input.qaRunId, "sessions", sessionId);
    const session: BrowserQaSession = {
      createdAt: new Date().toISOString(),
      executableSignature: this.#binary,
      id: sessionId,
      lockfilePath: this.#projectRelativePath(path.join(sessionDir, "session.lock")),
      manifestPath: this.#projectRelativePath(path.join(sessionDir, "manifest.json")),
      owner: "surface",
      ownerToken: `surface:${input.qaRunId}:${sessionId}`,
      processGroup: sessionId,
      profileDir: this.#projectRelativePath(path.join(sessionDir, "profile")),
      qaRunId: input.qaRunId,
      startedAt: new Date().toISOString(),
      target: input.target,
    };

    await this.#writeSessionManifest(session);
    this.#activeSessionId = session.id;
    this.#activeSessionManifests.set(
      session.id,
      path.resolve(this.#projectRoot, session.manifestPath),
    );

    const result = await this.#run(["open", input.target.ref], undefined, {
      sessionId: session.id,
    });

    if (!result.ok) {
      await this.#removeSessionManifest(session);
      this.#activeSessionManifests.delete(session.id);
      this.#activeSessionId = undefined;
      return result;
    }

    return ok(session);
  }

  async stopSession(sessionId: string): Promise<Result<{ readonly stopped: true }, SurfaceError>> {
    const result = await this.#run(["close"], undefined, { sessionId });
    const manifestPath = this.#activeSessionManifests.get(sessionId);

    if (manifestPath !== undefined) {
      ACTIVE_SESSION_MANIFESTS.delete(manifestPath);
      this.#activeSessionManifests.delete(sessionId);
      await rm(path.dirname(manifestPath), { force: true, recursive: true });
    }

    if (this.#activeSessionId === sessionId) {
      this.#activeSessionId = undefined;
    }

    return result.ok ? ok({ stopped: true }) : result;
  }

  navigate(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#run(["open", input.url ?? ""], undefined);
  }

  click(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("click", input);
  }

  dblclick(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("dblclick", input);
  }

  focus(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("focus", input);
  }

  fill(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("fill", input);
  }

  type(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("type", input);
  }

  press(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("press", input);
  }

  hover(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("hover", input);
  }

  select(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("select", input);
  }

  upload(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("upload", input);
  }

  check(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("check", input);
  }

  uncheck(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("uncheck", input);
  }

  scroll(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("scroll", input);
  }

  wait(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("wait", input);
  }

  pushState(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("pushstate", input);
  }

  setViewport(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("setViewport", input);
  }

  setTheme(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#runAction("setTheme", input);
  }

  assertText(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    return this.#assertText(input);
  }

  assertElementState(
    input: BrowserQaDriverActionInput & {
      readonly state: "checked" | "enabled" | "visible";
    },
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    const semantic = semanticFindArgs(input.locator, "is", input.state);
    if (semantic !== undefined) {
      return this.#run(semantic, undefined);
    }

    const selector = selectorForLocator(input.locator);

    if (selector === undefined) {
      return Promise.resolve(
        err(
          createSurfaceError(
            "flow_step_failed",
            `Assertion state "${input.state}" requires a stable selector or refHint locator.`,
          ),
        ),
      );
    }

    return this.#run(["is", input.state, selector], undefined);
  }

  async captureState(): Promise<Result<Record<string, unknown>, SurfaceError>> {
    const snapshot = await this.#run(["snapshot", "--compact", "--depth", "8"], undefined);

    if (!snapshot.ok) {
      return snapshot;
    }

    const [title, url] = await Promise.all([
      this.#run(["get", "title"], undefined),
      this.#run(["get", "url"], undefined),
    ]);

    return ok({
      rawSnapshot: parseJsonOrText(snapshot.value.stdout),
      title: title.ok ? parseScalarCommandOutput(title.value.stdout) : undefined,
      url: url.ok ? parseScalarCommandOutput(url.value.stdout) : undefined,
    });
  }

  async getConsoleSummary(): Promise<Result<Record<string, unknown>, SurfaceError>> {
    const [consoleOutput, pageErrors] = await Promise.all([
      this.#run(["console"], undefined),
      this.#run(["errors"], undefined),
    ]);

    if (!consoleOutput.ok) {
      return consoleOutput;
    }

    if (!pageErrors.ok) {
      return pageErrors;
    }

    return ok({
      console: parseJsonOrText(consoleOutput.value.stdout),
      pageErrors: parseJsonOrText(pageErrors.value.stdout),
    });
  }

  async getNetworkSummary(): Promise<Result<Record<string, unknown>, SurfaceError>> {
    return this.#runJson(["network", "requests"]);
  }

  async getReactDiagnostics(): Promise<Result<Record<string, unknown>, SurfaceError>> {
    return this.#runJson(["react", "tree"]);
  }

  async getVitals(): Promise<Result<Record<string, unknown>, SurfaceError>> {
    return this.#runJson(["vitals"]);
  }

  async cleanupStaleSessions(
    input: {
      readonly dryRun?: boolean;
    } = {},
  ): Promise<
    Result<
      { readonly cleaned: readonly string[]; readonly skipped: readonly string[] },
      SurfaceError
    >
  > {
    const sessionsDir = path.join(this.#stateDir, "tmp", "qa");
    const cleaned: string[] = [];
    const skipped: string[] = [];
    let manifestPaths: string[];

    try {
      manifestPaths = await findSessionManifestPaths(sessionsDir);
    } catch {
      return ok({ cleaned, skipped });
    }

    for (const manifestPath of manifestPaths) {
      const manifest = await this.#readSessionManifest(manifestPath);

      if (
        manifest === undefined ||
        !(await this.#isOwnedSessionManifest(manifest, manifestPath, sessionsDir))
      ) {
        skipped.push(this.#projectRelativePath(manifestPath));
        continue;
      }

      if (!isStaleSessionStartedAt(manifest.startedAt)) {
        continue;
      }

      if (input.dryRun === true) {
        skipped.push(`${manifest.id}:dry-run`);
        continue;
      }

      const closed = await this.#run(["close"], undefined, { sessionId: manifest.id });
      cleaned.push(manifest.id);
      ACTIVE_SESSION_MANIFESTS.delete(manifestPath);
      this.#activeSessionManifests.delete(manifest.id);
      await rm(path.dirname(manifestPath), { force: true, recursive: true });

      if (!closed.ok) {
        skipped.push(`${manifest.id}:closed-degraded:${closed.error.code}`);
      }
    }

    return ok({ cleaned, skipped });
  }

  async #runAction(
    action: BrowserAction["action"],
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    const args = actionArgsFor(action, input);
    if (!args.ok) {
      return args;
    }

    if (isFieldValueAction(action) && (input.value !== undefined || input.valueRef !== undefined)) {
      return this.#run(["batch", "--bail"], JSON.stringify([args.value]), {
        sensitiveValues: [input.valueRef?.value ?? input.value ?? ""],
      });
    }

    return this.#run(args.value, undefined);
  }

  async #assertText(
    input: BrowserQaDriverActionInput,
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    const expected = input.value ?? stringValue(input.expect, "text");

    if (expected === undefined) {
      return err(createSurfaceError("flow_step_failed", "Text assertion requires expect.text."));
    }

    const selector = selectorForLocator(input.locator);
    const result =
      selector === undefined
        ? await this.#run(
            [
              "eval",
              `Boolean(document.body && document.body.innerText && document.body.innerText.includes(${JSON.stringify(
                expected,
              )}))`,
            ],
            undefined,
          )
        : await this.#run(["get", "text", selector], undefined);

    if (!result.ok) {
      return result;
    }

    if (!commandOutputContainsExpectedText(result.value.stdout, expected)) {
      return err(
        createSurfaceError("flow_step_failed", "Expected text was not found in the browser state."),
      );
    }

    return result;
  }

  async #runJson(args: readonly string[]): Promise<Result<Record<string, unknown>, SurfaceError>> {
    const result = await this.#run(args, undefined);

    if (!result.ok) {
      return result;
    }

    try {
      return ok(JSON.parse(result.value.stdout || "{}") as Record<string, unknown>);
    } catch (error) {
      return err(
        createSurfaceError("flow_step_failed", "agent-browser returned invalid JSON.", {
          cause: error,
        }),
      );
    }
  }

  async #run(
    args: readonly string[],
    stdin: string | undefined,
    options: { readonly sensitiveValues?: readonly string[]; readonly sessionId?: string } = {},
  ): Promise<Result<BrowserQaAgentBrowserCommandResult, SurfaceError>> {
    try {
      const sessionId = options.sessionId ?? this.#activeSessionId;
      const commandArgs = [
        ...args,
        "--json",
        ...(sessionId === undefined ? [] : ["--session", sessionId]),
      ];
      const result = await this.#runCommand({
        args: commandArgs,
        command: this.#binary,
        env: this.#env,
        ...(stdin === undefined ? {} : { stdin }),
      });

      if (result.exitCode !== 0) {
        return err(
          createSurfaceError("flow_step_failed", "agent-browser command failed.", {
            details: { stderr: sanitizeAgentBrowserText(result.stderr, options.sensitiveValues) },
          }),
        );
      }

      return ok(result);
    } catch (error) {
      return err(
        createSurfaceError(
          isNodeErrorWithCode(error, "ENOENT") ? "qa_unavailable" : "flow_step_failed",
          isNodeErrorWithCode(error, "ENOENT")
            ? "agent-browser is not available. Install agent-browser and rerun Surface QA."
            : "agent-browser command could not be executed.",
          { cause: error },
        ),
      );
    }
  }

  async #preflightAgentBrowser(): Promise<Result<undefined, SurfaceError>> {
    this.#preflightResult ??= this.#runPreflightAgentBrowser();
    return this.#preflightResult;
  }

  async #runPreflightAgentBrowser(): Promise<Result<undefined, SurfaceError>> {
    try {
      const result = await this.#runCommand({
        args: ["--version"],
        command: this.#binary,
        env: this.#env,
      });

      if (result.exitCode !== 0) {
        return err(
          createSurfaceError("qa_unavailable", "agent-browser preflight failed.", {
            details: { stderr: sanitizeAgentBrowserText(result.stderr) },
          }),
        );
      }

      return ok(undefined);
    } catch (error) {
      return err(
        createSurfaceError(
          isNodeErrorWithCode(error, "ENOENT") ? "qa_unavailable" : "flow_step_failed",
          isNodeErrorWithCode(error, "ENOENT")
            ? "agent-browser is not available. Install agent-browser and rerun Surface QA."
            : "agent-browser preflight could not be executed.",
          { cause: error },
        ),
      );
    }
  }

  async #writeSessionManifest(session: BrowserQaSession): Promise<void> {
    const manifestPath = path.resolve(this.#projectRoot, session.manifestPath);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await mkdir(path.resolve(this.#projectRoot, session.profileDir), { recursive: true });
    await writeFile(path.resolve(this.#projectRoot, session.lockfilePath), session.ownerToken, {
      encoding: "utf8",
    });
    const manifest = {
      ...session,
      command: this.#binary,
      version: SESSION_MANIFEST_VERSION,
    };

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
    });
    ACTIVE_SESSION_MANIFESTS.add(manifestPath);
    installProcessCleanupHooks();
  }

  async #removeSessionManifest(session: BrowserQaSession): Promise<void> {
    const manifestPath = path.resolve(this.#projectRoot, session.manifestPath);
    ACTIVE_SESSION_MANIFESTS.delete(manifestPath);
    await rm(path.dirname(manifestPath), { force: true, recursive: true });
  }

  async #readSessionManifest(manifestPath: string): Promise<BrowserQaSession | undefined> {
    try {
      const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as Partial<BrowserQaSession>;

      return typeof parsed.id === "string" &&
        typeof parsed.qaRunId === "string" &&
        parsed.owner === "surface" &&
        typeof parsed.ownerToken === "string" &&
        typeof parsed.lockfilePath === "string" &&
        typeof parsed.profileDir === "string" &&
        typeof parsed.executableSignature === "string" &&
        typeof parsed.startedAt === "string" &&
        typeof parsed.processGroup === "string"
        ? (parsed as BrowserQaSession)
        : undefined;
    } catch {
      return undefined;
    }
  }

  async #isOwnedSessionManifest(
    manifest: BrowserQaSession,
    manifestPath: string,
    sessionsDir: string,
  ): Promise<boolean> {
    const sessionDir = path.dirname(manifestPath);
    const lockfilePath = path.resolve(this.#projectRoot, manifest.lockfilePath);
    const profileDir = path.resolve(this.#projectRoot, manifest.profileDir);
    let lockfileToken: string;

    try {
      lockfileToken = await readFile(lockfilePath, "utf8");
    } catch {
      return false;
    }

    return (
      manifest.owner === "surface" &&
      manifest.ownerToken === `surface:${manifest.qaRunId}:${manifest.id}` &&
      lockfileToken === manifest.ownerToken &&
      manifest.executableSignature === this.#binary &&
      manifest.processGroup === manifest.id &&
      isValidSessionStartedAt(manifest.startedAt) &&
      isSameOrChildPath(manifestPath, sessionsDir) &&
      isSameOrChildPath(lockfilePath, sessionDir) &&
      isSameOrChildPath(profileDir, sessionDir)
    );
  }

  #projectRelativePath(value: string): string {
    return value.split(path.sep).join(path.posix.sep).replace(`${this.#projectRoot}/`, "");
  }
}

export function createAgentBrowserCliDriver(
  options: AgentBrowserCliDriverOptions = {},
): BrowserQaDriver {
  return new AgentBrowserCliDriver(options);
}

export function createAgentBrowserEnvironment(
  input: AgentBrowserEnvironmentInput = {},
): Record<string, string> {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(input.extraAllowlist ?? [])]);
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(input.baseEnv ?? process.env)) {
    if (value === undefined || SENSITIVE_ENV_PATTERN.test(key)) {
      continue;
    }

    if (allowlist.has(key) || key.startsWith("LC_")) {
      env[key] = value;
    }
  }

  return env;
}

export function redactAgentBrowserCommand(
  command: readonly string[],
  secrets: readonly string[],
): string[] {
  return command.map((part) => {
    let redacted = part;

    for (const secret of secrets) {
      if (secret.length > 0) {
        redacted = redacted.split(secret).join("[REDACTED]");
      }
    }

    return redacted;
  });
}

function actionArgsFor(
  action: BrowserAction["action"],
  input: BrowserQaDriverActionInput,
): Result<readonly string[], SurfaceError> {
  const value = input.valueRef?.value ?? input.value;

  switch (action) {
    case "click":
    case "dblclick":
    case "hover":
    case "focus":
    case "check":
    case "uncheck":
      return argsForLocatorAction(action, input.locator);
    case "fill":
    case "type":
    case "select":
    case "upload":
      return argsForLocatorAction(action, input.locator, value);
    case "press":
      return ok(["press", value ?? "Enter"]);
    case "scroll":
      return ok(["scroll", scrollDirection(input.wait), scrollPixels(input.wait)]);
    case "wait":
      return ok(waitArgsFor(input));
    case "pushstate":
      return ok(["pushstate", input.url ?? ""]);
    case "setViewport":
      return input.viewport === undefined
        ? err(createSurfaceError("flow_step_failed", "Viewport action requires a viewport."))
        : ok(["set", "viewport", String(input.viewport.width), String(input.viewport.height)]);
    case "setTheme":
      return ok(["set", "media", input.theme ?? "light"]);
    case "assert":
    case "capture":
    case "open":
      return err(createSurfaceError("flow_step_failed", `Unsupported action dispatch: ${action}.`));
  }
}

function isFieldValueAction(action: BrowserAction["action"]): boolean {
  return action === "fill" || action === "type" || action === "select" || action === "upload";
}

function argsForLocatorAction(
  action: BrowserAction["action"],
  locator: BrowserLocator | undefined,
  value?: string,
): Result<readonly string[], SurfaceError> {
  const semantic = semanticFindArgs(locator, action, value);
  if (semantic !== undefined) {
    return ok(semantic);
  }

  const selector = selectorForLocator(locator);
  if (selector !== undefined) {
    return ok(value === undefined ? [action, selector] : [action, selector, value]);
  }

  return err(
    createSurfaceError(
      "flow_step_failed",
      `Action "${action}" requires a selector, refHint, or supported semantic locator.`,
    ),
  );
}

function semanticFindArgs(
  locator: BrowserLocator | undefined,
  action: BrowserAction["action"] | "is",
  value?: string,
): readonly string[] | undefined {
  const supportedAction =
    action === "click" ||
    action === "is" ||
    action === "fill" ||
    action === "type" ||
    action === "hover" ||
    action === "focus" ||
    action === "check" ||
    action === "uncheck" ||
    action === "select" ||
    action === "upload";

  if (!supportedAction || locator === undefined) {
    return undefined;
  }

  const actionAndValue = value === undefined ? [action] : [action, value];

  if (locator.role !== undefined) {
    return [
      "find",
      "role",
      locator.role,
      ...actionAndValue,
      ...(locator.name === undefined ? [] : ["--name", locator.name]),
    ];
  }

  if (locator.label !== undefined) {
    return ["find", "label", locator.label, ...actionAndValue];
  }

  if (locator.placeholder !== undefined) {
    return ["find", "placeholder", locator.placeholder, ...actionAndValue];
  }

  if (locator.testId !== undefined) {
    return ["find", "testid", locator.testId, ...actionAndValue];
  }

  if (locator.text !== undefined) {
    return ["find", "text", locator.text, ...actionAndValue];
  }

  return undefined;
}

function selectorForLocator(locator: BrowserLocator | undefined): string | undefined {
  if (locator?.refHint !== undefined) {
    return locator.refHint;
  }

  if (locator?.selector !== undefined) {
    return locator.selector;
  }

  if (locator?.testId !== undefined) {
    return `[data-testid="${cssString(locator.testId)}"]`;
  }

  return undefined;
}

function waitArgsFor(input: BrowserQaDriverActionInput): readonly string[] {
  const wait = input.wait;
  const url = stringValue(wait, "url");
  if (url !== undefined) {
    return ["wait", "--url", url];
  }

  const text = stringValue(wait, "text");
  if (text !== undefined) {
    return ["wait", "--text", text];
  }

  const load = stringValue(wait, "load") ?? stringValue(wait, "loadState");
  if (load !== undefined) {
    return ["wait", "--load", load];
  }

  const fn = stringValue(wait, "fn");
  if (fn !== undefined) {
    return ["wait", "--fn", fn];
  }

  const selector = selectorForLocator(input.locator);
  if (selector !== undefined) {
    const state = stringValue(wait, "state");
    const hidden = wait?.hidden === true || state === "hidden" || state === "detached";
    return hidden ? ["wait", selector, "--state", state ?? "hidden"] : ["wait", selector];
  }

  return ["wait", String(input.timeoutMs ?? 1_000)];
}

function isValidSessionStartedAt(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isStaleSessionStartedAt(value: string): boolean {
  const startedAt = Date.parse(value);

  return Number.isFinite(startedAt) && Date.now() - startedAt >= SESSION_STALE_AFTER_MS;
}

function scrollDirection(wait: Readonly<Record<string, unknown>> | undefined): string {
  const direction = wait?.direction;
  return direction === "up" || direction === "left" || direction === "right" ? direction : "down";
}

function scrollPixels(wait: Readonly<Record<string, unknown>> | undefined): string {
  const pixels = wait?.pixels;
  return typeof pixels === "number" && Number.isFinite(pixels) ? String(pixels) : "600";
}

function stringValue(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function commandOutputContainsExpectedText(stdout: string, expected: string): boolean {
  const parsed = parseJsonOrText(stdout);
  if (typeof parsed === "string") {
    return parsed.includes(expected) || parsed.trim() === "true";
  }

  return JSON.stringify(parsed).includes(expected) || JSON.stringify(parsed) === "true";
}

function parseJsonOrText(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseScalarCommandOutput(value: string): string {
  const parsed = parseJsonOrText(value);

  if (typeof parsed === "string") {
    return parsed;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "value" in parsed &&
    typeof parsed.value === "string"
  ) {
    return parsed.value;
  }

  return JSON.stringify(parsed);
}

function sanitizeAgentBrowserText(value: string, exactValues: readonly string[] = []): string {
  let redacted = value;

  for (const exactValue of exactValues) {
    if (exactValue.length > 0) {
      redacted = redacted.split(exactValue).join("[REDACTED]");
    }
  }

  return redacted.replace(SENSITIVE_OUTPUT_PATTERN, (...match: readonly string[]) => {
    const prefix = match.find((part, index) => index > 0 && typeof part === "string");
    return `${prefix ?? ""}[REDACTED]`;
  });
}

async function findSessionManifestPaths(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const manifests: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      manifests.push(...(await findSessionManifestPaths(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      manifests.push(entryPath);
    }
  }

  return manifests;
}

function installProcessCleanupHooks(): void {
  if (processCleanupHooksInstalled) {
    return;
  }

  processCleanupHooksInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      cleanupActiveSessionManifests();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  process.once("exit", () => {
    cleanupActiveSessionManifests();
  });
}

function cleanupActiveSessionManifests(): void {
  for (const manifestPath of ACTIVE_SESSION_MANIFESTS) {
    rmSync(path.dirname(manifestPath), { force: true, recursive: true });
  }

  ACTIVE_SESSION_MANIFESTS.clear();
}

function cssString(value: string): string {
  return value.replace(/["\\]/gu, "\\$&");
}

function createDefaultCommandRunner(): BrowserQaAgentBrowserCommandRunner {
  return async (input) => {
    const result = await execa(input.command, input.args, {
      env: input.env,
      reject: false,
      ...(input.stdin === undefined ? {} : { input: input.stdin }),
    });

    return {
      exitCode: result.exitCode ?? 0,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  };
}
