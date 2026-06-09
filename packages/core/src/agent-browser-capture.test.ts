import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { isAbsolute } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { createAgentBrowserCaptureBackend, type AgentBrowserCommandRunner } from "./capture.js";

const tempRoots: string[] = [];

describe("agent-browser capture backend", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("redacts command arguments, auth-state paths, stderr secrets, and captured content from command errors", async () => {
    const root = await tempRoot();
    const authStatePath = path.join(root, "auth-state.json");
    const stderrSecret = "token=surface-secret";
    const capturedContent = "<main>Private checkout content</main>";
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: `failed with ${stderrSecret} while reading ${authStatePath}: ${capturedContent}`,
        stdout: "",
      });
    };

    await writeFile(authStatePath, JSON.stringify({ cookies: [], origins: [] }));

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-redaction",
      runCommand,
      sessionName: "session-redaction",
    }).observe(
      { kind: "url", ref: "https://example.com/private-checkout" },
      {
        artifactRoot: path.join(root, "captures"),
        authStateRef: authStatePath,
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "capture_failed",
        details: {
          backendId: "agent-browser",
          exitCode: 1,
          reason: "agent-browser-command-failed",
          stderrPresent: true,
          targetKind: "url",
        },
      });
      expect(result.error.details).not.toHaveProperty("commandArgs");
      expect(result.error.details).not.toHaveProperty("stderr");
      expect(JSON.stringify(result.error.details)).not.toContain(authStatePath);
      expect(JSON.stringify(result.error.details)).not.toContain(stderrSecret);
      expect(JSON.stringify(result.error.details)).not.toContain(capturedContent);
    }
  });

  it("reports invalid agent-browser auth-state content as auth injection failure", async () => {
    const root = await tempRoot();
    const authStatePath = path.join(root, "auth-state.json");
    await writeFile(authStatePath, "{}");

    const result = await createAgentBrowserCaptureBackend({
      runCommand: () => {
        throw new Error("agent-browser should not run for invalid auth state");
      },
    }).observe(
      { kind: "url", ref: "https://example.com/private-checkout" },
      {
        artifactRoot: path.join(root, "captures"),
        authStateRef: authStatePath,
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: { code: "auth_injection_failed", details: { reason: "invalid-storage-state" } },
      ok: false,
    });
  });

  it("reports agent-browser connection failures as unreachable captures", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: "net::ERR_CONNECTION_REFUSED at http://127.0.0.1:59998",
        stdout: "",
      });
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-unreachable",
      runCommand,
      sessionName: "session-unreachable",
    }).observe(
      { kind: "localhost", ref: "http://127.0.0.1:59998" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "capture_unreachable",
        details: { backendId: "agent-browser", reason: "target-unreachable" },
      },
      ok: false,
    });
  });

  it("reports agent-browser network timeout errors as unreachable captures", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: "net::ERR_TIMED_OUT at https://example.invalid",
        stdout: "",
      });
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-network-timeout",
      runCommand,
      sessionName: "session-network-timeout",
    }).observe(
      { kind: "url", ref: "https://example.invalid" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "capture_unreachable",
        details: { backendId: "agent-browser", reason: "target-unreachable" },
      },
      ok: false,
    });
  });

  it("classifies network errors at the tail of long agent-browser stderr", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: `${"x".repeat(20_000)} net::ERR_ADDRESS_UNREACHABLE`,
        stdout: "",
      });
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-long-network-error",
      runCommand,
      sessionName: "session-long-network-error",
    }).observe(
      { kind: "url", ref: "https://example.invalid" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "capture_unreachable",
        details: { backendId: "agent-browser", reason: "target-unreachable" },
      },
      ok: false,
    });
  });

  it("ignores empty agent-browser failure fields when classifying capture errors", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: "",
        stdout: "",
      });
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-empty-fields",
      runCommand,
      sessionName: "session-empty-fields",
    }).observe(
      { kind: "localhost", ref: "http://127.0.0.1:59998" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "capture_failed",
        details: { backendId: "agent-browser", reason: "agent-browser-command-failed" },
      },
      ok: false,
    });
  });

  it("does not classify generic page timeouts as unreachable captures", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      if (args.includes("close")) {
        return Promise.resolve({
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ data: null, success: true }),
        });
      }

      return Promise.resolve({
        exitCode: 1,
        stderr: "Timeout 30000ms exceeded while waiting for selector main",
        stdout: "",
      });
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-selector-timeout",
      runCommand,
      sessionName: "session-selector-timeout",
    }).observe(
      { kind: "localhost", ref: "http://127.0.0.1:59998" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(result).toMatchObject({
      error: {
        code: "capture_failed",
        details: { backendId: "agent-browser", reason: "agent-browser-command-failed" },
      },
      ok: false,
    });
  });

  it("writes computed styles as lens-readable element snapshots", async () => {
    const root = await tempRoot();
    const runCommand: AgentBrowserCommandRunner = (args) => {
      const command = agentBrowserCommand(args);
      const subcommand = command === undefined ? undefined : args[args.indexOf(command) + 1];

      if (command === "open" || command === "wait" || command === "close") {
        return agentBrowserOk(null);
      }

      if (command === "screenshot") {
        const screenshotPath = args[args.indexOf(command) + 2];

        if (screenshotPath !== undefined) {
          return writeFile(screenshotPath, "fake screenshot").then(() => agentBrowserOk(null));
        }
      }

      if (command === "snapshot") {
        return agentBrowserOk({ nodes: [{ ref: "e1", role: "heading", text: "Checkout" }] });
      }

      if (command === "get" && subcommand === "html") {
        return agentBrowserOk({ html: "<main><h1>Checkout</h1></main>" });
      }

      if (command === "get" && subcommand === "url") {
        return agentBrowserOk("http://localhost:3000");
      }

      if (command === "get" && subcommand === "styles") {
        return agentBrowserOk({ styles: { fontSize: "16px" } });
      }

      if (command === "eval") {
        return agentBrowserOk({
          origin: "http://localhost:3000",
          result: [
            {
              clientWidth: 240,
              fontSize: "20px",
              scrollWidth: 240,
              selector: "html > body:nth-of-type(1) > main:nth-of-type(1)",
              tagName: "main",
            },
          ],
        });
      }

      return agentBrowserOk(null);
    };

    const result = await createAgentBrowserCaptureBackend({
      idFactory: () => "cap-styles",
      runCommand,
      sessionName: "session-styles",
    }).observe(
      { kind: "localhost", ref: "http://localhost:3000" },
      {
        artifactRoot: path.join(root, "captures"),
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    if (!result.ok) {
      throw new Error(`${result.error.message}: ${JSON.stringify(result.error.details)}`);
    }
    expect(result.ok).toBe(true);

    const computedStylesArtifact = result.value.artifacts.find(
      (artifact) => artifact.type === "computed-styles",
    );

    expect(computedStylesArtifact).toBeDefined();
    const computedStylesPath = computedStylesArtifact?.path ?? "";
    const computedStyles = JSON.parse(
      await readFile(
        isAbsolute(computedStylesPath) ? computedStylesPath : path.join(root, computedStylesPath),
        "utf8",
      ),
    ) as unknown;

    expect(computedStyles).toEqual([
      {
        clientWidth: 240,
        fontSize: "20px",
        scrollWidth: 240,
        selector: "html > body:nth-of-type(1) > main:nth-of-type(1)",
        tagName: "main",
      },
    ]);
  });
});

function agentBrowserOk(data: unknown): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  return Promise.resolve({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({ data, success: true }),
  });
}

function agentBrowserCommand(args: readonly string[]): string | undefined {
  return args.find((arg) =>
    ["close", "eval", "get", "open", "screenshot", "snapshot", "wait"].includes(arg),
  );
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "surface-agent-browser-redaction-"));
  tempRoots.push(root);

  return root;
}
