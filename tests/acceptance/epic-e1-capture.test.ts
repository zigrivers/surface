// Acceptance skeletons - Epic E1: Capture & Inputs (US-001..005).
// One pending test per acceptance criterion, tagged [story][AC]. Implement during TDD.
// Layer hints in comments: unit | integration | e2e (see docs/story-tests-map.md).
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SURFACE_CONFIG,
  createSurfaceError,
  createAgentBrowserCaptureBackend,
  createCaptureService,
  createDefaultCaptureIdFactory,
  createContextIngestor,
  runTaskFlowCapture,
  tagFindingsWithCaptureContext,
  createPlaywrightCaptureBackend,
  createStaticCaptureBackend,
  err,
  isErr,
  isOk,
  ok,
  type Capture,
  type CaptureBackend,
  type CaptureArtifact,
  type CaptureOptions,
  type Finding,
  type Target,
} from "../../packages/core/src/index.js";

const target = { kind: "url", ref: "https://example.com" } satisfies Target;
const allowedCaptureConfig = {
  ...DEFAULT_SURFACE_CONFIG.capture,
  allowlist: ["https://example.com"],
};
const temporaryRoots: string[] = [];
const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2nb4QAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function createTempArtifactRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "surface-capture-"));
  temporaryRoots.push(root);
  return join(root, "captures");
}

async function captureFor(
  backend: "playwright" | "agent-browser",
  target: Target,
  artifactRoot: string,
): Promise<Capture> {
  const captureId = `cap-${backend}`;
  const captureRoot = join(artifactRoot, captureId);
  const artifacts: CaptureArtifact[] = [
    {
      id: "screenshot",
      path: join(captureRoot, "screenshot.png"),
      redacted: false,
      type: "screenshot",
    },
    {
      id: "dom",
      path: join(captureRoot, "dom.html"),
      redacted: false,
      type: "dom-snapshot",
    },
    {
      id: "a11y",
      path: join(captureRoot, "a11y.json"),
      redacted: false,
      type: "accessibility-tree",
    },
    {
      id: "styles",
      path: join(captureRoot, "styles.json"),
      redacted: false,
      type: "computed-styles",
    },
  ];

  await mkdir(captureRoot, { recursive: true });
  await Promise.all(
    artifacts.map((artifact) => writeFile(artifact.path, `${backend}:${artifact.type}`)),
  );

  return {
    artifacts,
    backend,
    capturedAt: "2026-05-31T18:00:00.000Z",
    id: captureId,
    status: "completed",
    target,
  };
}

function agentBrowserResult(data: unknown): { exitCode: number; stderr: string; stdout: string } {
  return {
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ data, error: null, success: true }),
  };
}

function backend(
  id: "playwright" | "agent-browser",
  available: boolean,
  artifactRoot: string,
): CaptureBackend {
  return {
    id,
    detect: () => available,
    observe: async (observedTarget) => ok(await captureFor(id, observedTarget, artifactRoot)),
  };
}

function customBackend(id: string, available: boolean, artifactRoot: string): CaptureBackend {
  return {
    id,
    detect: () => available,
    observe: async (observedTarget) => {
      const captureId = `cap-${id}`;
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");

      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, `${id}:screenshot`);

      return ok({
        artifacts: [
          {
            id: "screenshot",
            path: screenshotPath,
            redacted: false,
            type: "screenshot",
          },
        ],
        backend: id,
        capturedAt: "2026-05-31T18:00:00.000Z",
        id: captureId,
        status: "completed",
        target: observedTarget,
      });
    },
  };
}

function staticFallbackBackend(
  artifactRoot: string,
  idFactory: () => string = () => "cap-static",
): CaptureBackend {
  return {
    id: "static",
    detect: () => true,
    observe: async (observedTarget) => {
      const captureId = idFactory();
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");

      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "static fallback screenshot fixture");

      return ok({
        artifacts: [
          {
            id: "screenshot",
            path: screenshotPath,
            redacted: false,
            type: "screenshot",
          },
        ],
        backend: "static",
        capturedAt: "2026-05-31T18:00:00.000Z",
        degradation: {
          skippedArtifacts: ["dom-snapshot", "accessibility-tree", "computed-styles"],
          skippedReason: "no browser backend installed",
        },
        id: captureId,
        status: "degraded",
        target: observedTarget,
      });
    },
  };
}

function failingBackend(
  id: "playwright" | "agent-browser",
  code: "capture_failed" | "capture_unreachable",
): CaptureBackend {
  return {
    id,
    detect: () => true,
    observe: async () => err(createSurfaceError(code, `${id} could not capture the target.`)),
  };
}

function throwingBackend(id: "static" | "playwright"): CaptureBackend {
  return {
    id,
    detect: () => true,
    observe: async () => {
      throw new Error(`${id} exploded`);
    },
  };
}

function throwingDetectBackend(): CaptureBackend {
  return {
    id: "playwright",
    detect: () => {
      throw new Error("playwright not installed");
    },
    observe: async (observedTarget) =>
      ok({
        artifacts: [
          {
            id: "screenshot",
            path: ".surface/captures/unreachable/screenshot.png",
            redacted: false,
            type: "screenshot",
          },
        ],
        backend: "playwright",
        capturedAt: "2026-05-31T18:00:00.000Z",
        id: "cap-unreachable",
        status: "completed",
        target: observedTarget,
      }),
  };
}

function invalidCompletedBackend(): CaptureBackend {
  return {
    id: "playwright",
    detect: () => true,
    observe: async (observedTarget) =>
      ok({
        artifacts: [],
        backend: "playwright",
        capturedAt: "2026-05-31T18:00:00.000Z",
        id: "cap-invalid",
        status: "completed",
        target: observedTarget,
      }),
  };
}

function fakePlaywrightModule(
  options: {
    readonly cdpError?: Error;
    readonly requestUrl?: string;
    readonly webSocketUrl?: string;
    readonly defaultRequestUrl?: string;
    readonly onAbort?: () => void;
    readonly onContinue?: () => void;
    readonly onGoto?: (options: { readonly timeout: number; readonly waitUntil: string }) => void;
    readonly onNewContext?: (options: {
      readonly serviceWorkers?: string;
      readonly storageState?: string;
    }) => void;
    readonly onWebSocketClose?: () => void;
    readonly onWebSocketConnect?: () => void;
    readonly pageContent?: string;
    readonly pageUrl?: string;
    readonly screenshotContents?: string;
  } = {},
): unknown {
  return {
    chromium: {
      launch: async () => ({
        close: async () => {},
        newContext: async (contextOptions: {
          readonly serviceWorkers?: string;
          readonly storageState?: string;
        }) => {
          options.onNewContext?.(contextOptions);

          return {
            close: async () => {},
            newCDPSession: async () => ({
              detach: async () => {},
              send: async () => {
                if (options.cdpError !== undefined) {
                  throw options.cdpError;
                }

                return { nodes: [{ role: { value: "WebArea" } }] };
              },
            }),
            newPage: async () => ({
              close: async () => {},
              content: async () =>
                options.pageContent ?? "<html><body><button>Buy</button></body></html>",
              evaluate: async () => [
                {
                  color: "rgb(0, 0, 0)",
                  display: "block",
                  selector: "body:nth-of-type(1)",
                },
              ],
              goto: async (
                _url: string,
                gotoOptions: { readonly timeout: number; readonly waitUntil: string },
              ) => {
                options.onGoto?.(gotoOptions);

                return null;
              },
              screenshot: async (screenshotOptions: { readonly path: string }) => {
                await writeFile(screenshotOptions.path, options.screenshotContents ?? "png");
              },
              url: () => options.pageUrl ?? "https://example.com",
            }),
            route: async (
              _pattern: string,
              handler: (route: {
                abort(errorCode: "blockedbyclient"): Promise<void>;
                continue(): Promise<void>;
                request(): { url(): string };
              }) => Promise<void>,
            ) => {
              await handler({
                abort: async () => {
                  options.onAbort?.();
                },
                continue: async () => {
                  options.onContinue?.();
                },
                request: () => ({
                  url: () =>
                    options.requestUrl ?? options.defaultRequestUrl ?? "https://example.com",
                }),
              });
            },
            routeWebSocket: async (
              _pattern: string,
              handler: (route: {
                close(): Promise<void>;
                connectToServer(): Promise<void>;
                url(): string;
              }) => Promise<void>,
            ) => {
              const webSocketUrl = options.webSocketUrl;

              if (webSocketUrl === undefined) {
                return;
              }

              await handler({
                close: async () => {
                  options.onWebSocketClose?.();
                },
                connectToServer: async () => {
                  options.onWebSocketConnect?.();
                },
                url: () => webSocketUrl,
              });
            },
          };
        },
      }),
    },
  };
}

describe("E1 Capture & Inputs", () => {
  describe("US-001 capture via auto-detected backend [gate]", () => {
    it("[US-001][AC1] reachable target → screenshot+DOM+a11y-tree+computed-styles under .surface/captures/<id> (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [backend("playwright", true, artifactRoot)],
        staticFallback: staticFallbackBackend(artifactRoot),
      });
      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      if (!result.ok) {
        throw new Error("expected capture to succeed");
      }

      expect(result.value).toMatchObject({
        backend: "playwright",
        status: "completed",
      });
      expect(result.value.artifacts.map((artifact) => artifact.type).sort()).toEqual([
        "accessibility-tree",
        "computed-styles",
        "dom-snapshot",
        "screenshot",
      ]);
      expect(
        result.value.artifacts.every((artifact) => artifact.path.startsWith(artifactRoot)),
      ).toBe(true);
      await Promise.all(
        result.value.artifacts.map((artifact) =>
          expect(access(artifact.path)).resolves.toBeUndefined(),
        ),
      );
    });

    it("[US-001][AC1] Playwright backend captures screenshot, DOM, accessibility, and computed styles (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let gotoOptions: { readonly timeout: number; readonly waitUntil: string } | undefined;
      let contextOptions: { readonly serviceWorkers?: string } | undefined;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-fixture",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onGoto: (options) => {
                  gotoOptions = options;
                },
                onNewContext: (options) => {
                  contextOptions = options;
                },
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        config: allowedCaptureConfig,
        navigationTimeoutMs: 1_234,
        navigationWaitUntil: "domcontentloaded",
      });

      expect(isOk(result)).toBe(true);
      if (!result.ok) {
        throw new Error("expected capture to succeed");
      }

      expect(result.value).toMatchObject({
        backend: "playwright",
        id: "cap-playwright-fixture",
        status: "completed",
      });
      expect(result.value.artifacts.map((artifact) => artifact.type).sort()).toEqual([
        "accessibility-tree",
        "computed-styles",
        "dom-snapshot",
        "screenshot",
      ]);
      await Promise.all(
        result.value.artifacts.map((artifact) =>
          expect(access(artifact.path)).resolves.toBeUndefined(),
        ),
      );
      await expect(
        readFile(join(artifactRoot, "cap-playwright-fixture", "dom.html"), "utf8"),
      ).resolves.toContain("<button>Buy</button>");
      await expect(
        readFile(join(artifactRoot, "cap-playwright-fixture", "accessibility-tree.json"), "utf8"),
      ).resolves.toContain("WebArea");
      expect(gotoOptions).toEqual({ timeout: 1_234, waitUntil: "domcontentloaded" });
      expect(contextOptions).toMatchObject({ serviceWorkers: "block" });
    });

    it("[US-001][AC1] agent-browser backend captures via array args and preserves @e refs (contract)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const commandCalls: string[][] = [];
      const service = createCaptureService({
        backends: [
          createAgentBrowserCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:30:00.000Z",
            idFactory: () => "cap-agent-browser-fixture",
            runCommand: async (args) => {
              commandCalls.push([...args]);

              const commandIndex = args.findIndex((arg) =>
                ["open", "wait", "screenshot", "snapshot", "get", "close"].includes(arg),
              );
              const command = commandIndex === -1 ? undefined : args[commandIndex];

              if (command === "screenshot") {
                const screenshotPath = args.at(-2);

                if (screenshotPath === undefined) {
                  throw new Error("expected screenshot path");
                }

                await writeFile(screenshotPath, VALID_PNG_BYTES);

                return agentBrowserResult({ path: screenshotPath });
              }

              if (command === "snapshot") {
                return agentBrowserResult({
                  origin: "https://example.com/",
                  refs: {
                    e1: {
                      name: "Buy",
                      role: "button",
                    },
                  },
                  snapshot: '- button "Buy" [ref=e1]',
                });
              }

              if (command === "get" && args[commandIndex + 1] === "html") {
                return agentBrowserResult({ html: "<button>Buy</button>" });
              }

              if (command === "get" && args[commandIndex + 1] === "styles") {
                return agentBrowserResult({
                  styles: [
                    {
                      ref: "@e1",
                      styles: { color: "rgb(0, 0, 0)" },
                    },
                  ],
                });
              }

              if (command === "get" && args[commandIndex + 1] === "url") {
                return agentBrowserResult({ url: "https://example.com/" });
              }

              if (command === "wait") {
                return agentBrowserResult({ state: "domcontentloaded" });
              }

              if (command === "open") {
                return agentBrowserResult({ title: "Example", url: "https://example.com/" });
              }

              return agentBrowserResult({ closed: true });
            },
            sessionName: "surface-contract",
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        config: allowedCaptureConfig,
        navigationWaitUntil: "domcontentloaded",
      });

      expect(isOk(result)).toBe(true);
      if (!result.ok) {
        throw new Error("expected capture to succeed");
      }

      expect(result.value).toMatchObject({
        backend: "agent-browser",
        id: "cap-agent-browser-fixture",
        status: "completed",
      });
      expect(result.value.artifacts.map((artifact) => artifact.type).sort()).toEqual([
        "accessibility-tree",
        "computed-styles",
        "dom-snapshot",
        "screenshot",
      ]);
      expect(commandCalls.slice(0, 5)).toEqual([
        ["--session", "surface-contract", "open", "https://example.com", "--json"],
        ["--session", "surface-contract", "wait", "--load", "domcontentloaded", "--json"],
        [
          "--session",
          "surface-contract",
          "screenshot",
          "--full",
          join(artifactRoot, "cap-agent-browser-fixture", "screenshot.png"),
          "--json",
        ],
        ["--session", "surface-contract", "snapshot", "-i", "--json"],
        ["--session", "surface-contract", "get", "html", "body", "--json"],
      ]);
      expect(commandCalls[5]?.slice(0, 3)).toEqual(["--session", "surface-contract", "eval"]);
      expect(commandCalls[5]?.at(-1)).toBe("--json");
      expect(commandCalls.slice(6)).toEqual([
        ["--session", "surface-contract", "get", "url", "--json"],
        ["--session", "surface-contract", "close", "--json"],
      ]);
      await expect(
        readFile(
          join(artifactRoot, "cap-agent-browser-fixture", "accessibility-tree.json"),
          "utf8",
        ),
      ).resolves.toContain("@e1");
      await expect(
        readFile(
          join(artifactRoot, "cap-agent-browser-fixture", "accessibility-tree.json"),
          "utf8",
        ),
      ).resolves.toContain("ref=@e1");
    });

    it("[US-001][AC1] Playwright backend allows allowlisted public subresources from localhost captures (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let subresourceContinued = false;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-localhost",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onContinue: () => {
                  subresourceContinued = true;
                },
                requestUrl: "https://example.com/app.css",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(
        { kind: "localhost", ref: "127.0.0.1:3000" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://127.0.0.1:3000", "https://example.com"],
          },
        },
      );

      expect(isOk(result)).toBe(true);
      expect(subresourceContinued).toBe(true);
    });

    it("[US-001][AC1] Playwright backend allows allowlisted websocket subresources (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let webSocketConnected = false;
      let webSocketClosed = false;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-wss",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onWebSocketClose: () => {
                  webSocketClosed = true;
                },
                onWebSocketConnect: () => {
                  webSocketConnected = true;
                },
                webSocketUrl: "wss://example.com/socket",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(webSocketConnected).toBe(true);
      expect(webSocketClosed).toBe(false);
    });

    it("[US-001][AC1] Playwright backend blocks unsupported protocol subresources (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let subresourceAborted = false;
      let subresourceContinued = false;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-blocked-protocol",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onAbort: () => {
                  subresourceAborted = true;
                },
                onContinue: () => {
                  subresourceContinued = true;
                },
                requestUrl: "file:///etc/passwd",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot, () => "cap-static-blocked-protocol"),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "playwright",
          id: "cap-playwright-blocked-protocol",
          status: "completed",
        },
      });
      expect(subresourceAborted).toBe(true);
      expect(subresourceContinued).toBe(false);
    });

    it("[US-001][AC1] Playwright backend blocks default cross-origin subresources with auth state (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const authStateRoot = await mkdtemp(join(tmpdir(), "surface-auth-state-"));
      temporaryRoots.push(authStateRoot);
      const authStatePath = join(authStateRoot, "state.json");
      await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }));
      let subresourceAborted = false;
      let subresourceContinued = false;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-default-egress",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onAbort: () => {
                  subresourceAborted = true;
                },
                onContinue: () => {
                  subresourceContinued = true;
                },
                requestUrl: "https://example.org/exfil",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        authStateRef: authStatePath,
        config: DEFAULT_SURFACE_CONFIG.capture,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "playwright",
          id: "cap-playwright-default-egress",
          status: "completed",
        },
      });
      expect(subresourceAborted).toBe(true);
      expect(subresourceContinued).toBe(false);
    });

    it("[US-001][AC1] Playwright backend blocks default cross-origin websocket subresources (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let webSocketConnected = false;
      let webSocketClosed = false;
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-playwright-default-wss",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onWebSocketClose: () => {
                  webSocketClosed = true;
                },
                onWebSocketConnect: () => {
                  webSocketConnected = true;
                },
                webSocketUrl: "wss://example.org/socket",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        config: DEFAULT_SURFACE_CONFIG.capture,
      });

      expect(isOk(result)).toBe(true);
      expect(webSocketClosed).toBe(true);
      expect(webSocketConnected).toBe(false);
    });

    it("[US-001][AC1] unsupported Playwright target kinds fall back to static capture (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            idFactory: () => "cap-playwright-unsupported",
            loadPlaywright: async () => fakePlaywrightModule(),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot, () => "cap-static-unsupported"),
      });

      const result = await service.capture(
        { kind: "component", ref: "CheckoutButton" },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "static",
          id: "cap-static-unsupported",
          status: "degraded",
        },
      });
    });

    it("[US-001][AC1] Playwright capture failures classify evidence errors and clean partial artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-playwright-a11y-error";
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            idFactory: () => captureId,
            loadPlaywright: async () =>
              fakePlaywrightModule({
                cdpError: new Error("Accessibility.getFullAXTree failed"),
              }),
          }),
        ],
        staticFallback: throwingBackend("static"),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            reason: "accessibility-capture-failed",
          },
        },
      });
      await expect(access(join(artifactRoot, captureId))).rejects.toThrow();
    });

    it("[US-001][AC1] live captures pass an enforcement policy to browser backends (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let receivedOptions: CaptureOptions | undefined;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget, captureOptions) => {
              receivedOptions = captureOptions;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(receivedOptions?.networkPolicy).toMatchObject({
        allowlist: ["https://example.com"],
        blockPrivateNetwork: true,
        enforceOnNavigation: true,
        enforceOnRedirects: true,
        enforceOnSubresources: true,
        targetHost: "example.com",
        targetOrigin: "https://example.com",
      });
      expect(receivedOptions?.networkPolicy?.resolvedAddresses.length).toBeGreaterThan(0);
    });

    it("[US-001][AC1] empty allowlist permits public requested targets by default (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        config: DEFAULT_SURFACE_CONFIG.capture,
      });

      expect(isOk(result)).toBe(true);
      expect(observed).toBe(true);
    });

    it("[US-001][AC1] disallowed live targets are rejected before backend observe (unit)", async () => {
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, ".surface/captures"));
            },
          },
        ],
        staticFallback: staticFallbackBackend(await createTempArtifactRoot()),
      });

      const result = await service.capture(target, {
        config: {
          ...DEFAULT_SURFACE_CONFIG.capture,
          allowlist: ["https://allowed.example.com"],
        },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "target_not_allowed",
          details: {
            reason: "allowlist-mismatch",
            targetOrigin: "https://example.com",
          },
        },
      });
      if (isErr(result)) {
        expect(result.error.details).not.toHaveProperty("targetRef");
      }
      expect(observed).toBe(false);
    });

    it("[US-001][AC1] localhost target kind rejects private-network refs (unit)", async () => {
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, ".surface/captures"));
            },
          },
        ],
        staticFallback: staticFallbackBackend(await createTempArtifactRoot()),
      });

      const result = await service.capture(
        { kind: "localhost", ref: "10.0.0.5:3000" },
        {
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://10.0.0.5:3000"],
          },
        },
      );

      expect(isErr(result)).toBe(true);
      expect(observed).toBe(false);
    });

    it("[US-001][AC1] localhost target kind allows loopback refs (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(
        { kind: "localhost", ref: "127.0.0.1:3000" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://127.0.0.1:3000"],
          },
        },
      );

      expect(isOk(result)).toBe(true);
      expect(observed).toBe(true);
    });

    it("[US-001][AC1] URL target kind allows explicitly allowlisted loopback refs (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const observedTargets: Target[] = [];
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observedTargets.push(observedTarget);
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const loopbackResult = await service.capture(
        { kind: "url", ref: "http://127.0.0.1:3000/checkout" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://127.0.0.1:3000"],
          },
        },
      );
      const localhostResult = await service.capture(
        { kind: "url", ref: "http://localhost:3000/settings" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://localhost:3000"],
          },
        },
      );

      expect(isOk(loopbackResult)).toBe(true);
      expect(isOk(localhostResult)).toBe(true);
      expect(observedTargets.map((observedTarget) => observedTarget.ref)).toEqual([
        "http://127.0.0.1:3000/checkout",
        "http://localhost:3000/settings",
      ]);
    });

    it("[US-001][AC1] URL target kind rejects alternate loopback hosts (unit)", async () => {
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, ".surface/captures"));
            },
          },
        ],
        staticFallback: staticFallbackBackend(await createTempArtifactRoot()),
      });

      const result = await service.capture(
        { kind: "url", ref: "http://127.0.0.2:3000" },
        {
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://127.0.0.2:3000"],
          },
        },
      );

      expect(isErr(result)).toBe(true);
      expect(observed).toBe(false);
    });

    it("[US-001][AC1] URL target kind rejects IPv4-compatible IPv6 loopback hosts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(
        { kind: "url", ref: "http://[::7f00:1]:3000" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["http://[::7f00:1]:3000"],
          },
        },
      );

      expect(isErr(result)).toBe(true);
      expect(observed).toBe(false);
    });

    it("[US-001][AC1] URL target kind allows non-reserved public IPv4 refs (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const publicTarget = { kind: "url", ref: "http://203.0.5.1:3000" } satisfies Target;
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(publicTarget, {
        artifactRoot,
        config: {
          ...DEFAULT_SURFACE_CONFIG.capture,
          allowlist: [publicTarget.ref],
        },
      });

      expect(isOk(result)).toBe(true);
      expect(observed).toBe(true);
    });

    it("[US-001][AC1] route target kind rejects protocol-relative network refs (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(
        { kind: "route", ref: "//169.254.169.254/latest/meta-data" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["*"],
          },
        },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          message: "Route capture target must be a path-only route.",
        },
      });
      expect(observed).toBe(false);
    });

    it("[US-001][AC1] route target kind rejects traversal segments (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let observed = false;
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) => {
              observed = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(
        { kind: "route", ref: "/admin/../metadata" },
        {
          artifactRoot,
          config: {
            ...DEFAULT_SURFACE_CONFIG.capture,
            allowlist: ["*"],
          },
        },
      );

      expect(isErr(result)).toBe(true);
      expect(observed).toBe(false);
    });

    it("[US-001][AC2] neither backend installed → static+screenshot fallback; skipped measured checks reported (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing.png");
      await writeFile(sourceScreenshot, VALID_PNG_BYTES);
      const service = createCaptureService({
        backends: [
          customBackend("playwright", false, artifactRoot),
          customBackend("agent-browser", false, artifactRoot),
        ],
        staticFallback: createStaticCaptureBackend({
          clock: () => "2026-05-31T18:00:00.000Z",
          idFactory: () => "cap-static",
        }),
      });
      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isOk(result)).toBe(true);
      if (!result.ok) {
        throw new Error("expected capture to succeed");
      }

      expect(result.value).toMatchObject({
        backend: "static",
        degradation: {
          skippedArtifacts: ["dom-snapshot", "accessibility-tree", "computed-styles"],
          skippedReason: "static screenshot input; live DOM artifacts unavailable",
        },
        id: "cap-static",
        status: "degraded",
      });
      expect(result.value.artifacts).toEqual([
        {
          id: "screenshot",
          path: join(artifactRoot, "cap-static", "screenshot.png"),
          redacted: false,
          type: "screenshot",
        },
      ]);
      await expect(readFile(join(artifactRoot, "cap-static", "screenshot.png"))).resolves.toEqual(
        VALID_PNG_BYTES,
      );
    });

    it("[US-001][AC2] static backend captures supplied screenshot targets as degraded evidence (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing.png");
      await writeFile(sourceScreenshot, VALID_PNG_BYTES);
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          clock: () => "2026-05-31T18:00:00.000Z",
          idFactory: () => "cap-static-screenshot",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isOk(result)).toBe(true);
      if (!result.ok) {
        throw new Error("expected static screenshot capture to succeed");
      }

      const capturedScreenshot = join(artifactRoot, "cap-static-screenshot", "screenshot.png");
      expect(result.value).toEqual({
        artifacts: [
          {
            id: "screenshot",
            path: capturedScreenshot,
            redacted: false,
            type: "screenshot",
          },
        ],
        backend: "static",
        capturedAt: "2026-05-31T18:00:00.000Z",
        degradation: {
          skippedArtifacts: ["dom-snapshot", "accessibility-tree", "computed-styles"],
          skippedReason: "static screenshot input; live DOM artifacts unavailable",
        },
        id: "cap-static-screenshot",
        status: "degraded",
        target: { kind: "screenshot", ref: sourceScreenshot },
      });
      await expect(readFile(capturedScreenshot)).resolves.toEqual(VALID_PNG_BYTES);
    });

    it("[US-001][AC2] static backend rejects URL targets without fabricating evidence (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-url",
        }),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-url",
            reason: "screenshot-target-required",
            targetKind: "url",
          },
          message: "Static capture requires a screenshot target.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-url"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects non-image screenshot sources without artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing.txt");
      await writeFile(sourceScreenshot, "not image bytes");
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-text-source",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-text-source",
            extension: ".txt",
            reason: "unsupported-screenshot-extension",
            targetKind: "screenshot",
          },
          message: "Static backend screenshot source must be a supported image file.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-text-source"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects extensionless screenshot sources without artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing");
      await writeFile(sourceScreenshot, VALID_PNG_BYTES);
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-extensionless-source",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-extensionless-source",
            reason: "unsupported-screenshot-extension",
            targetKind: "screenshot",
          },
          message: "Static backend screenshot source must be a supported image file.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-extensionless-source"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects mismatched screenshot bytes without artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing.png");
      await writeFile(sourceScreenshot, "not image bytes");
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-bad-png",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-bad-png",
            extension: ".png",
            reason: "unsupported-screenshot-content",
            targetKind: "screenshot",
          },
          message: "Static backend screenshot source must be a supported image file.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-bad-png"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend reports missing screenshot sources without partial artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const missingScreenshot = join(artifactRoot, "missing.png");
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-missing-source",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: missingScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-missing-source",
            reason: "screenshot-source-unavailable",
            targetKind: "screenshot",
          },
          message: "Static backend screenshot source must be a readable file.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-missing-source"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects unsafe capture ids without writing artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "../escape",
        }),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "../escape",
            reason: "invalid-capture-id",
            targetKind: "url",
          },
          message: "Static backend capture id must be filesystem-safe.",
        },
      });
      await expect(access(join(artifactRoot, "..", "escape"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects platform-unsafe capture ids before mkdir (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static.",
        }),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static.",
            reason: "invalid-capture-id",
            targetKind: "url",
          },
          message: "Static backend capture id must be filesystem-safe.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static."))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects Windows-reserved capture ids before mkdir (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "CON",
        }),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "CON",
            reason: "invalid-capture-id",
            targetKind: "url",
          },
          message: "Static backend capture id must be filesystem-safe.",
        },
      });
      await expect(access(join(artifactRoot, "CON"))).rejects.toThrow();
    });

    it("[US-001][AC2] static backend rejects colliding capture ids without deleting artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const sourceRoot = await mkdtemp(join(tmpdir(), "surface-screenshot-source-"));
      temporaryRoots.push(sourceRoot);
      const sourceScreenshot = join(sourceRoot, "landing.png");
      const existingCaptureRoot = join(artifactRoot, "cap-static-existing");
      const existingArtifact = join(existingCaptureRoot, "screenshot.png");
      await writeFile(sourceScreenshot, VALID_PNG_BYTES);
      await mkdir(existingCaptureRoot, { recursive: true });
      await writeFile(existingArtifact, "existing artifact");
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-existing",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-existing",
            reason: "capture-root-exists",
            targetKind: "screenshot",
          },
          message: "Static backend capture id already exists.",
        },
      });
      await expect(readFile(existingArtifact, "utf8")).resolves.toBe("existing artifact");
    });

    it("[US-001][AC2] static backend reports artifact-root creation failures without deleting siblings (unit)", async () => {
      const root = await mkdtemp(join(tmpdir(), "surface-static-artifact-root-failure-"));
      temporaryRoots.push(root);
      const sourceScreenshot = join(root, "landing.png");
      const artifactRoot = join(root, "captures-file");
      const siblingFile = join(root, "sibling.txt");
      await writeFile(sourceScreenshot, VALID_PNG_BYTES);
      await writeFile(artifactRoot, "not a directory");
      await writeFile(siblingFile, "keep me");
      const service = createCaptureService({
        backends: [],
        staticFallback: createStaticCaptureBackend({
          idFactory: () => "cap-static-root-failure",
        }),
      });

      const result = await service.capture(
        { kind: "screenshot", ref: sourceScreenshot },
        { artifactRoot, config: DEFAULT_SURFACE_CONFIG.capture },
      );

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "static",
            captureId: "cap-static-root-failure",
            targetKind: "screenshot",
          },
          message: "Static backend could not capture the screenshot.",
        },
      });
      await expect(access(join(artifactRoot, "cap-static-root-failure"))).rejects.toThrow();
      await expect(readFile(siblingFile, "utf8")).resolves.toBe("keep me");
    });

    it("[US-001][AC2] registered static backend is only used as fallback (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let selectedStaticObserved = false;
      const service = createCaptureService({
        backends: [
          {
            id: "static",
            detect: () => true,
            observe: async (observedTarget) => {
              selectedStaticObserved = true;
              return ok(await captureFor("playwright", observedTarget, artifactRoot));
            },
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot, () => "cap-static-only-fallback"),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "static",
          id: "cap-static-only-fallback",
          status: "degraded",
        },
      });
      expect(selectedStaticObserved).toBe(false);
    });

    it("[US-001][AC2] registered static backend does not shadow live backends (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [createStaticCaptureBackend(), backend("playwright", true, artifactRoot)],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "playwright",
          status: "completed",
        },
      });
    });

    it("[US-001][AC3] both backends installed → deterministic selection recorded in capture metadata (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [
          backend("playwright", true, artifactRoot),
          backend("agent-browser", true, artifactRoot),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });
      const first = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });
      const second = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(first)).toBe(true);
      expect(isOk(second)).toBe(true);
      expect(first).toMatchObject({ value: { backend: "agent-browser" } });
      expect(second).toMatchObject({ value: { backend: "agent-browser" } });
    });

    it("[US-001][AC3] custom capture backends are selected deterministically before built-ins (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [
          backend("agent-browser", true, artifactRoot),
          customBackend("fixture-custom", true, artifactRoot),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });
      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({ value: { backend: "fixture-custom" } });
    });

    it("[US-001][AC3] default capture IDs are slugged, per-service, and collision resistant (unit)", () => {
      const idFactory = createDefaultCaptureIdFactory({
        clock: () => "2026-05-31T18:00:00.000Z",
        randomHex: () => "abc123",
      });

      const first = idFactory(target);
      const second = idFactory(target);

      expect(first).toMatch(/^cap-url-example-com-/);
      expect(first).toContain("-abc123");
      expect(second).toMatch(/^cap-url-example-com-/);
      expect(first).not.toEqual(second);
    });

    it("[US-001][AC3] default URL capture IDs do not expose path, query, fragment, or userinfo (unit)", () => {
      const idFactory = createDefaultCaptureIdFactory({
        clock: () => "2026-05-31T18:00:00.000Z",
        randomHex: () => "abc123",
      });

      const id = idFactory({
        kind: "url",
        ref: "https://user:password@example.com/secret/checkout?token=abc123#billing",
      });

      expect(id).toMatch(/^cap-url-example-com-/);
      expect(id).not.toContain("user");
      expect(id).not.toContain("password");
      expect(id).not.toContain("secret");
      expect(id).not.toContain("checkout");
      expect(id).not.toContain("token");
      expect(id).not.toContain("billing");
    });

    it("[US-001][AC3] localhost capture IDs retain non-sensitive port context (unit)", () => {
      const idFactory = createDefaultCaptureIdFactory({
        clock: () => "2026-05-31T18:00:00.000Z",
        randomHex: () => "abc123",
      });

      const id = idFactory({
        kind: "localhost",
        ref: "localhost:3000/admin?token=abc123",
      });

      expect(id).toMatch(/^cap-localhost-localhost-3000-/);
      expect(id).not.toContain("admin");
      expect(id).not.toContain("token");
    });

    it("[US-001][AC2] browser capture failures degrade to static fallback evidence (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let fallbackObserved = false;
      const service = createCaptureService({
        backends: [failingBackend("playwright", "capture_unreachable")],
        staticFallback: {
          ...staticFallbackBackend(artifactRoot, () => "cap-static-after-failure"),
          observe: async (observedTarget, captureOptions) => {
            fallbackObserved = true;
            return staticFallbackBackend(artifactRoot, () => "cap-static-after-failure").observe(
              observedTarget,
              captureOptions,
            );
          },
        },
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "static",
          degradation: {
            skippedReason:
              "no browser backend installed. browser backend playwright failed with capture_unreachable",
          },
          id: "cap-static-after-failure",
          status: "degraded",
        },
      });
      expect(fallbackObserved).toBe(true);
    });

    it("[US-001][AC2] thrown backend exceptions are returned as capture errors (unit)", async () => {
      const service = createCaptureService({
        backends: [],
        staticFallback: throwingBackend("static"),
      });

      const result = await service.capture(target, { config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: { backendId: "static" },
        },
      });
    });

    it("[US-001][AC2] failed static fallback preserves the primary backend error (unit)", async () => {
      const service = createCaptureService({
        backends: [failingBackend("playwright", "capture_unreachable")],
        staticFallback: throwingBackend("static"),
      });

      const result = await service.capture(target, { config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_unreachable",
        },
      });
    });

    it("[US-001][AC2] public static backend preserves URL browser failures instead of fabricating evidence (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      let fallbackObserved = false;
      const staticFallback = createStaticCaptureBackend({
        idFactory: () => "cap-static-after-url-failure",
      });
      const service = createCaptureService({
        backends: [failingBackend("playwright", "capture_unreachable")],
        staticFallback: {
          ...staticFallback,
          observe: async (observedTarget, captureOptions) => {
            fallbackObserved = true;
            return staticFallback.observe(observedTarget, captureOptions);
          },
        },
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_unreachable",
        },
      });
      expect(fallbackObserved).toBe(true);
      await expect(access(join(artifactRoot, "cap-static-after-url-failure"))).rejects.toThrow();
    });

    it("[US-001][AC2] throwing backend detection falls through to static fallback (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [throwingDetectBackend()],
        staticFallback: staticFallbackBackend(artifactRoot, () => "cap-static-after-detect"),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: {
          backend: "static",
          id: "cap-static-after-detect",
          status: "degraded",
        },
      });
    });

    it("[US-001][AC3] invalid backend capture metadata is returned as capture_failed (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [invalidCompletedBackend()],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId: "cap-invalid",
            reason: "completed and degraded captures need artifacts",
          },
        },
      });
    });

    it("[US-001][AC3] invalid backend capture timestamp is rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-invalid-time";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: screenshotPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "not a timestamp",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId,
            reason: "capturedAt must be a valid ISO timestamp",
          },
        },
      });
    });

    it("[US-001][AC3] calendar-invalid ISO-looking capture timestamps are rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-invalid-calendar";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: screenshotPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-02-30T00:00:00Z",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId,
            reason: "capturedAt must be a valid ISO timestamp",
          },
        },
      });
    });

    it("[US-001][AC3] valid ISO capture timestamps with offsets are accepted (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-offset-time";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: screenshotPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T12:00:00-06:00",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
    });

    it("[US-001][AC3] backend captures for a different target are rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-wrong-target";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async () =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: screenshotPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T18:00:00.000Z",
                id: captureId,
                status: "completed",
                target: { kind: "url", ref: "https://other.example.com" },
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId,
            reason: "capture target must match requested target",
          },
        },
      });
    });

    it("[US-001][AC3] unsafe backend capture IDs are rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap;unsafe";
      const captureRoot = join(artifactRoot, captureId);
      const screenshotPath = join(captureRoot, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(screenshotPath, "screenshot");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: screenshotPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T18:00:00.000Z",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId,
            reason: "capture id must be a path-safe non-empty string",
          },
        },
      });
    });

    it("[US-001][AC3] backend artifacts outside capture root are rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const outsideRoot = await mkdtemp(join(tmpdir(), "surface-capture-outside-"));
      const outsideArtifact = join(outsideRoot, "screenshot.png");
      temporaryRoots.push(outsideRoot);
      await mkdir(join(artifactRoot, "cap-outside"), { recursive: true });
      await writeFile(outsideArtifact, "outside artifact");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: outsideArtifact,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T18:00:00.000Z",
                id: "cap-outside",
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId: "cap-outside",
            reason: "capture artifacts must exist under capture root",
          },
        },
      });
    });

    it("[US-001][AC3] backend artifacts may be relative to artifact root (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const captureId = "cap-relative-artifact";
      const captureRoot = join(artifactRoot, captureId);
      const relativeArtifactPath = join(captureId, "screenshot.png");
      await mkdir(captureRoot, { recursive: true });
      await writeFile(join(captureRoot, "screenshot.png"), "relative artifact");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: relativeArtifactPath,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T18:00:00.000Z",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isOk(result)).toBe(true);
    });

    it("[US-001][AC3] symlinked capture roots outside artifact root are rejected (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const outsideRoot = await mkdtemp(join(tmpdir(), "surface-capture-link-target-"));
      temporaryRoots.push(outsideRoot);
      const captureId = "cap-linked";
      const linkedCaptureRoot = join(artifactRoot, captureId);
      const linkedArtifact = join(linkedCaptureRoot, "screenshot.png");
      await mkdir(artifactRoot, { recursive: true });
      await symlink(outsideRoot, linkedCaptureRoot, "dir");
      await writeFile(join(outsideRoot, "screenshot.png"), "linked artifact");
      const service = createCaptureService({
        backends: [
          {
            id: "playwright",
            detect: () => true,
            observe: async (observedTarget) =>
              ok({
                artifacts: [
                  {
                    id: "screenshot",
                    path: linkedArtifact,
                    redacted: false,
                    type: "screenshot",
                  },
                ],
                backend: "playwright",
                capturedAt: "2026-05-31T18:00:00.000Z",
                id: captureId,
                status: "completed",
                target: observedTarget,
              }),
          },
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, { artifactRoot, config: allowedCaptureConfig });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          details: {
            backendId: "playwright",
            captureId,
            reason: "capture artifacts must exist under capture root",
          },
        },
      });
    });
  });
  describe("US-002 capture behind auth [gate]", () => {
    it("[US-002][AC1] valid --auth-state → session injected before navigation; authenticated DOM captured (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const authStateRoot = await mkdtemp(join(tmpdir(), "surface-auth-state-"));
      temporaryRoots.push(authStateRoot);
      const authStatePath = join(authStateRoot, "state.json");
      const events: string[] = [];
      let contextOptions:
        | { readonly serviceWorkers?: string; readonly storageState?: string }
        | undefined;
      await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }));
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-authenticated",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                onGoto: () => {
                  events.push("goto");
                },
                onNewContext: (options) => {
                  contextOptions = options;
                  events.push("context");
                },
                pageContent: "<html><body><h1>Dashboard</h1></body></html>",
                pageUrl: "https://example.com",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        authStateRef: authStatePath,
        config: allowedCaptureConfig,
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(events).toEqual(["context", "goto"]);
      expect(contextOptions).toMatchObject({ storageState: authStatePath });
      expect(result.value.authUsed).toBe(true);
      expect(result.value.verification).toEqual({
        authInjectedBeforeNavigation: true,
        isRequestedTarget: true,
        landedUrl: "https://example.com",
        requestedUrl: "https://example.com",
      });
      await expect(
        readFile(join(artifactRoot, "cap-authenticated", "dom.html"), "utf8"),
      ).resolves.toContain("Dashboard");
    });

    it("[US-002][AC2] invalid/expired auth-state → auth-injection failure; never captures login page as target (e2e)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const authStateRoot = await mkdtemp(join(tmpdir(), "surface-auth-state-"));
      temporaryRoots.push(authStateRoot);
      const authStatePath = join(authStateRoot, "state.json");
      await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }));
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            idFactory: () => "cap-login-bounce",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                pageContent: "<html><body>Login</body></html>",
                pageUrl: "https://example.com/login",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        authStateRef: authStatePath,
        config: allowedCaptureConfig,
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "auth_injection_failed",
          details: {
            landedUrl: "https://example.com/login",
            reason: "target-verification-failed",
            requestedUrl: "https://example.com",
          },
        },
      });
      await expect(access(join(artifactRoot, "cap-login-bounce"))).rejects.toThrow();
    });
  });
  describe("US-003 ingest static & context inputs [gate]", () => {
    it("[US-003][AC1] --component/tokens/--scaffold-docs used as context; recorded which inputs were present (integration)", async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), "surface-context-ac1-"));
      temporaryRoots.push(projectRoot);
      const ingestor = createContextIngestor({
        clock: () => "2026-05-31T18:00:00.000Z",
        projectRoot,
      });
      const source = {
        contents: '<button data-component="PrimaryButton">Buy now</button>',
        path: "src/PrimaryButton.html",
      };

      const result = await ingestor.ingest({
        component: "PrimaryButton",
        designTokens: [{ name: "color.primary", value: "#0055ff" }],
        scaffoldDocs: [
          { contents: "Primary actions use the primary color token.", path: "docs/design.md" },
        ],
        source,
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.target.kind).toBe("component");
      expect(result.value.target.ref).toMatch(
        /\.surface\/context-inputs\/source-[a-f0-9]{12}\.html$/,
      );
      expect(result.value.componentMap.entries).toEqual([
        {
          component: "PrimaryButton",
          file: "src/PrimaryButton.html",
          selectors: ['[data-component="PrimaryButton"]'],
        },
      ]);
      expect(result.value.provenance.map((entry) => entry.kind)).toEqual([
        "component",
        "source",
        "design-tokens",
        "scaffold-docs",
      ]);
      expect(result.value.context.designTokens).toEqual([
        { name: "color.primary", value: "#0055ff" },
      ]);
      expect(result.value.context.scaffoldDocs).toEqual([
        {
          contents: "Primary actions use the primary color token.",
          path: "docs/design.md",
        },
      ]);

      const capture = await createStaticCaptureBackend({
        clock: () => "2026-05-31T18:00:00.000Z",
        idFactory: () => "cap-static-source-context",
      }).observe(result.value.target, {
        artifactRoot: join(projectRoot, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      });

      expect(isOk(capture)).toBe(true);

      if (!capture.ok) {
        return;
      }

      expect(capture.value).toMatchObject({
        artifacts: [
          {
            id: "dom",
            path: join(projectRoot, "captures", "cap-static-source-context", "dom.html"),
            redacted: false,
            type: "dom-snapshot",
          },
        ],
        degradation: {
          skippedArtifacts: ["screenshot", "accessibility-tree", "computed-styles"],
          skippedReason: "static context input; screenshot and live browser artifacts unavailable",
        },
        status: "degraded",
      });
    });

    it("[US-003][AC2] built UI contradicting a design-token → emitted as a finding, not ignored (integration)", async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), "surface-context-ac2-"));
      temporaryRoots.push(projectRoot);
      const ingestor = createContextIngestor({
        clock: () => "2026-05-31T18:00:00.000Z",
        projectRoot,
      });

      const result = await ingestor.ingest({
        designTokens: [{ name: "color.primary", value: "#0055ff" }],
        dom: {
          contents:
            '<main><style>:root { --color-primary: #ff0000; }</style><button class="primary">Buy now</button></main>',
          path: "capture/dom.html",
        },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.target.kind).toBe("dom");
      expect(result.value.target.ref).toMatch(/\.surface\/context-inputs\/dom-[a-f0-9]{12}\.html$/);
      expect(result.value.findings).toMatchObject([
        {
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "#ff0000",
              rule: "css-custom-property-contradiction",
              threshold: "#0055ff",
              tool: "context-ingestor",
            },
            {
              elementRef: "CSS custom property --color-primary",
              kind: "dom",
              selector: ":root",
            },
          ],
          issueType: "design-token-contradiction",
          lens: "context-ingestor",
          location: {
            elementRef: "CSS custom property --color-primary",
          },
          method: "measured",
          title: "Built UI contradicts color.primary design token",
        },
      ]);

      const capture = await createStaticCaptureBackend({
        clock: () => "2026-05-31T18:00:00.000Z",
        idFactory: () => "cap-static-dom-context",
      }).observe(result.value.target, {
        artifactRoot: join(projectRoot, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      });

      expect(isOk(capture)).toBe(true);

      if (!capture.ok) {
        return;
      }

      await expect(
        readFile(join(projectRoot, "captures", "cap-static-dom-context", "dom.html"), "utf8"),
      ).resolves.toContain("--color-primary: #ff0000");
    });
  });
  describe("US-004 multi-state & dual-theme capture [should]", () => {
    it("[US-004][AC1] task-flow recipe → each reachable state captured; unreachable step reported (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const observedTargets: Target[] = [];
      const service = {
        capture: async (observedTarget: Target) => {
          observedTargets.push(observedTarget);

          if (observedTarget.ref.endsWith("/payment")) {
            return err(createSurfaceError("capture_unreachable", "Payment step is unreachable."));
          }

          return ok(await captureFor("playwright", observedTarget, artifactRoot));
        },
      };

      const result = await runTaskFlowCapture({
        captureOptions: { config: allowedCaptureConfig },
        recipe: {
          id: "checkout-flow",
          steps: [
            { id: "cart", target },
            { id: "payment", target: { kind: "url", ref: "https://example.com/payment" } },
          ],
        },
        service,
      });

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        return;
      }

      expect(observedTargets.map((entry) => entry.ref)).toEqual([
        "https://example.com",
        "https://example.com/payment",
      ]);
      expect(result.value.captures).toEqual([
        expect.objectContaining({
          stateId: "cart",
          capture: expect.objectContaining({ status: "completed" }),
        }),
      ]);
      expect(result.value.unreachable).toEqual([
        expect.objectContaining({
          stateId: "payment",
          reason: "Payment step is unreachable.",
        }),
      ]);
    });

    it("[US-004][AC2] prefers-color-scheme toggle → light+dark captured; findings tagged with theme (integration)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const observedTargets: Target[] = [];
      const service = {
        capture: async (observedTarget: Target) => {
          observedTargets.push(observedTarget);

          return ok(await captureFor("playwright", observedTarget, artifactRoot));
        },
      };

      const result = await runTaskFlowCapture({
        captureOptions: { config: allowedCaptureConfig },
        recipe: {
          id: "home-dual-theme",
          steps: [{ id: "home", target }],
          themes: ["light", "dark"],
        },
        service,
      });

      expect(isOk(result)).toBe(true);

      if (!isOk(result)) {
        return;
      }

      expect(observedTargets.map((entry) => entry.theme)).toEqual(["light", "dark"]);
      expect(result.value.captures.map((entry) => entry.theme)).toEqual(["light", "dark"]);

      const tagged = tagFindingsWithCaptureContext([themeFinding()], {
        stateId: "home",
        theme: "dark",
      });
      expect(tagged[0]).toMatchObject({
        captureContext: { stateId: "home", theme: "dark" },
        tags: ["state:home", "theme:dark"],
      });
    });
  });
  describe("US-005 sensitive-data redaction [committed]", () => {
    it("[US-005][AC1] capture-write redaction replaces matched content and marks changed artifacts (unit)", async () => {
      const artifactRoot = await createTempArtifactRoot();
      const service = createCaptureService({
        backends: [
          createPlaywrightCaptureBackend({
            available: true,
            clock: () => "2026-05-31T18:00:00.000Z",
            idFactory: () => "cap-redacted",
            loadPlaywright: async () =>
              fakePlaywrightModule({
                pageContent:
                  "<html><body><p>customer@example.com</p><p>secret-token</p></body></html>",
                screenshotContents: "visual secret-token",
              }),
          }),
        ],
        staticFallback: staticFallbackBackend(artifactRoot),
      });

      const result = await service.capture(target, {
        artifactRoot,
        config: {
          ...allowedCaptureConfig,
          redactionRules: [
            {
              appliesTo: ["dom", "screenshot"],
              pattern: "customer@example\\.com|secret-token",
            },
          ],
        },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.artifacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ redacted: true, type: "dom-snapshot" }),
          expect.objectContaining({ redacted: true, type: "screenshot" }),
        ]),
      );
      await expect(readFile(join(artifactRoot, "cap-redacted", "dom.html"), "utf8")).resolves.toBe(
        "<html><body><p>[Redacted]</p><p>[Redacted]</p></body></html>",
      );
      await expect(
        readFile(join(artifactRoot, "cap-redacted", "screenshot.png"), "utf8"),
      ).resolves.toBe("visual [Redacted]");
    });
  });
});

function themeFinding(): Finding {
  return {
    id: "f_dark_contrast",
    lens: "accessibility",
    issueType: "contrast-insufficient",
    method: "measured",
    title: "Dark theme button contrast is below AA",
    rationale: "Primary button contrast is insufficient in the dark theme.",
    citedHeuristics: ["kb_wcag_143"],
    evidence: [
      {
        kind: "tool-result",
        tool: "axe",
        rule: "color-contrast",
        measuredValue: "3.1:1",
        threshold: "4.5:1",
      },
    ],
    dimensions: {
      severity: 0.8,
      confidence: 1,
      effort: 0.2,
      userImpact: 0.7,
      businessImpact: 0.5,
      a11yLegalRisk: 0.9,
      evidenceQuality: 1,
      agentImplementability: 0.9,
    },
    severityBand: "P1",
    location: { selector: ".btn-primary" },
    confidenceBand: "assert",
    gatedForHuman: false,
  };
}
