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
  createCaptureService,
  createDefaultCaptureIdFactory,
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
    readonly onNewContext?: (options: { readonly serviceWorkers?: string }) => void;
    readonly onWebSocketClose?: () => void;
    readonly onWebSocketConnect?: () => void;
  } = {},
): unknown {
  return {
    chromium: {
      launch: async () => ({
        close: async () => {},
        newContext: async (contextOptions: { readonly serviceWorkers?: string }) => {
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
              content: async () => "<html><body><button>Buy</button></body></html>",
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
              screenshot: async (options: { readonly path: string }) => {
                await writeFile(options.path, "png");
              },
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
        authStateRef: "state.json",
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
          code: "capture_failed",
          details: {
            targetOrigin: "https://example.com",
          },
        },
      });
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
    it.skip("[US-002][AC1] valid --auth-state → session injected before navigation; authenticated DOM captured (integration)", () => {});
    it.skip("[US-002][AC2] invalid/expired auth-state → auth-injection failure, non-zero exit; never captures login page as target (e2e)", () => {});
  });
  describe("US-003 ingest static & context inputs [gate]", () => {
    it.skip("[US-003][AC1] --component/tokens/--scaffold-docs used as context; recorded which inputs were present (integration)", () => {});
    it.skip("[US-003][AC2] built UI contradicting a design-token → emitted as a finding, not ignored (integration)", () => {});
  });
  describe("US-004 multi-state & dual-theme capture [should]", () => {
    it.skip("[US-004][AC1] task-flow recipe → each reachable state captured; unreachable step reported (integration)", () => {});
    it.skip("[US-004][AC2] prefers-color-scheme toggle → light+dark captured; findings tagged with theme (integration)", () => {});
  });
  describe("US-005 sensitive-data redaction [committed]", () => {
    it.skip("[US-005][AC1] redaction rules → matched content replaced with visible marker; full evidence retained local-only (unit+integration)", () => {});
  });
});
