import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "surface-agent-browser-redaction-"));
  tempRoots.push(root);

  return root;
}
