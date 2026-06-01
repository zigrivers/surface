import { describe, expect, it } from "vitest";

import { createSurfaceComposition, ok } from "@surface/core";

import { runSurfaceCli } from "./index.js";

type ParsedErrorEnvelope = {
  readonly ok: false;
  readonly schemaVersion: "1.0";
  readonly error: {
    readonly code: string;
    readonly exitCode: number;
    readonly kind: string;
    readonly likelyCause: string;
    readonly nextCommand: string;
    readonly whatFailed: string;
  };
};

describe("@surface/cli bootstrap", () => {
  it("emits a machine-readable success envelope for --json commands", async () => {
    const stdout: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "status"],
      composition: createSurfaceComposition({
        stateStore: {
          readState: () => ok({ version: "1.0" }),
          writeArtifact: () =>
            Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
          writeState: (state) => ok(state),
        },
      }),
      io: { stdout: (chunk) => stdout.push(chunk) },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "status",
      data: { currentStage: "new" },
      ok: true,
      schemaVersion: "1.0",
    });
  });

  it("maps unknown subcommands to exit 2 usage errors with actionable JSON", async () => {
    const stderr: string[] = [];
    const exitCode = await runSurfaceCli({
      argv: ["node", "surface", "--json", "bogus"],
      io: { stderr: (chunk) => stderr.push(chunk) },
    });

    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stderr.at(-1) ?? "") as ParsedErrorEnvelope;

    expect(parsed).toMatchObject({
      error: {
        code: "unknown_step",
        exitCode: 2,
        kind: "UsageError",
        nextCommand: "surface --help",
      },
      ok: false,
      schemaVersion: "1.0",
    });
    expect(parsed.error.likelyCause).toContain("command");
    expect(parsed.error.whatFailed).toContain("unknown_step");
  });
});
