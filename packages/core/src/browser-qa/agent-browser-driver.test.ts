import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { describe, expect, it, onTestFinished } from "vitest";

import { isNodeErrorWithCode } from "../path-safety.js";
import {
  createAgentBrowserCliDriver,
  createAgentBrowserEnvironment,
  redactAgentBrowserCommand,
  type BrowserQaAgentBrowserCommandInput,
  type BrowserQaAgentBrowserCommandInvocation,
  type BrowserQaAgentBrowserCommandRunner,
} from "./agent-browser-driver.js";

describe("agent-browser driver", () => {
  it("passes secret-backed field input through batch stdin instead of argv", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "{}" }));
    };
    const driver = createAgentBrowserCliDriver({
      projectRoot: await makeTempRoot(),
      runCommand: run,
    });

    const result = await driver.fill({
      locator: { label: "Password" },
      valueRef: { kind: "secret", name: "testPassword", value: "super-secret" },
    });

    expect(result).toMatchObject({ ok: true });
    expect(invocations[0]?.args).toEqual(["batch", "--bail", "--json"]);
    expect(invocations[0]?.args).not.toContain("super-secret");
    expect(JSON.parse(invocations[0]?.stdin ?? "null")).toEqual([
      ["find", "label", "Password", "fill", "super-secret"],
    ]);
  });

  it("redacts secret-backed stdin values from command failure details", async () => {
    const run: BrowserQaAgentBrowserCommandRunner = () =>
      Promise.resolve(
        makeCommandResult({
          exitCode: 1,
          stderr: "failed while typing super-secret",
          stdout: "{}",
        }),
      );
    const driver = createAgentBrowserCliDriver({
      projectRoot: await makeTempRoot(),
      runCommand: run,
    });

    const result = await driver.fill({
      locator: { label: "Password" },
      valueRef: { kind: "secret", name: "testPassword", value: "super-secret" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        details: { stderr: "failed while typing [REDACTED]" },
      },
    });
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain("super-secret");
    }
  });

  it("builds an allowlisted child environment", () => {
    const env = createAgentBrowserEnvironment({
      baseEnv: {
        API_TOKEN: "token",
        CI: "1",
        LANG: "en_US.UTF-8",
        PATH: "/usr/bin",
        SURFACE_QA_TEST_PASSWORD: "secret",
      },
    });

    expect(env).toEqual({ CI: "1", LANG: "en_US.UTF-8", PATH: "/usr/bin" });
  });

  it("redacts commands before logging", () => {
    expect(
      redactAgentBrowserCommand(
        ["agent-browser", "fill", "--value", "super-secret"],
        ["super-secret"],
      ),
    ).toEqual(["agent-browser", "fill", "--value", "[REDACTED]"]);
  });

  it("passes field values through batch stdin instead of argv", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "{}" }));
    };
    const driver = createAgentBrowserCliDriver({
      projectRoot: await makeTempRoot(),
      runCommand: run,
    });

    const result = await driver.fill({
      locator: { label: "Email" },
      value: "person@example.test",
    });

    expect(result).toMatchObject({ ok: true });
    expect(invocations[0]?.args).toEqual(["batch", "--bail", "--json"]);
    expect(invocations[0]?.args).not.toContain("person@example.test");
    expect(JSON.parse(invocations[0]?.stdin ?? "null")).toEqual([
      ["find", "label", "Email", "fill", "person@example.test"],
    ]);
  });

  it("reports qa_unavailable when agent-browser cannot launch", async () => {
    const error = Object.assign(new Error("not found"), { code: "ENOENT" });
    const run: BrowserQaAgentBrowserCommandRunner = () => Promise.reject(error);
    const driver = createAgentBrowserCliDriver({
      runCommand: run,
    });

    const result = await driver.startSession({
      qaRunId: "qa_driver",
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "qa_unavailable" } });
  });

  it("uses the real agent-browser open and positional action contract", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "{}" }));
    };
    const driver = createAgentBrowserCliDriver({ runCommand: run });

    const started = await driver.startSession({
      qaRunId: "qa_driver_contract",
      target: { kind: "url", ref: "http://localhost:3000" },
    });
    expect(started.ok).toBe(true);
    await driver.click({ locator: { refHint: "@e2" } });

    expect(invocations.map((invocation) => invocation.args.slice(0, 2))).toEqual([
      ["--version"],
      ["open", "http://localhost:3000"],
      ["click", "@e2"],
    ]);
    expect(invocations[1]?.args).toContain("--session");
    expect(invocations[2]?.args).toContain("--json");
  });

  it("caches agent-browser preflight across sessions", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "{}" }));
    };
    const driver = createAgentBrowserCliDriver({ runCommand: run });

    await expect(
      driver.startSession({
        qaRunId: "qa_driver_preflight_one",
        target: { kind: "url", ref: "http://localhost:3000" },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      driver.startSession({
        qaRunId: "qa_driver_preflight_two",
        target: { kind: "url", ref: "http://localhost:3001" },
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(invocations.filter((invocation) => invocation.args[0] === "--version")).toHaveLength(1);
    expect(invocations.filter((invocation) => invocation.args[0] === "open")).toHaveLength(2);
  });

  it("prefers semantic locator identity over volatile ref hints", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "{}" }));
    };
    const driver = createAgentBrowserCliDriver({ runCommand: run });

    await driver.click({ locator: { name: "Pay now", refHint: "@e2", role: "button" } });

    expect(invocations[0]?.args.slice(0, 7)).toEqual([
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Pay now",
      "--json",
    ]);
  });

  it("prefers semantic locator identity for element-state assertions", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: "true" }));
    };
    const driver = createAgentBrowserCliDriver({ runCommand: run });

    await driver.assertElementState({
      locator: { name: "Pay now", refHint: "@e2", role: "button" },
      state: "visible",
    });

    expect(invocations[0]?.args.slice(0, 8)).toEqual([
      "find",
      "role",
      "button",
      "is",
      "visible",
      "--name",
      "Pay now",
      "--json",
    ]);
  });

  it("passes locatorless text assertions when agent-browser eval returns true JSON", async () => {
    const invocations: BrowserQaAgentBrowserCommandInput[] = [];
    const run: BrowserQaAgentBrowserCommandRunner = (input) => {
      invocations.push(input);
      return Promise.resolve(makeCommandResult({ stdout: JSON.stringify({ result: true }) }));
    };
    const driver = createAgentBrowserCliDriver({ runCommand: run });

    const result = await driver.assertText({ expect: { text: "Checkout" } });

    expect(result).toMatchObject({ ok: true });
    expect(invocations[0]?.args).toEqual([
      "eval",
      'Boolean(document.body && document.body.innerText && document.body.innerText.includes("Checkout"))',
      "--json",
    ]);
  });

  it("recognizes the real agent-browser command surface when the binary is installed", async () => {
    const binary = process.env.SURFACE_AGENT_BROWSER_BINARY ?? "agent-browser";
    const help = await runHelpIfAvailable(binary, ["--help"]);

    if (help === undefined) {
      return;
    }

    expect(help).toContain("open <url>");
    expect(help).toContain("click <sel>");
    expect(help).toContain("snapshot");
    expect(help).toContain("agent-browser is <what> <selector>");
  });
});

function makeCommandResult(
  overrides: Partial<BrowserQaAgentBrowserCommandInvocation["result"]> = {},
): BrowserQaAgentBrowserCommandInvocation["result"] {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "{}",
    ...overrides,
  };
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-agent-browser-driver-"));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  return root;
}

async function runHelpIfAvailable(
  binary: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const result = await execa(binary, args, { reject: false });
    return result.exitCode === 0 ? result.stdout : undefined;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}
