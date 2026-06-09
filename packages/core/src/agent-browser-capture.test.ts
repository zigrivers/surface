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

    await writeFile(authStatePath, "{}");

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
