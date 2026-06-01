#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import {
  createSurfaceComposition,
  createSurfaceError,
  exitCodeForSurfaceError,
  isOk,
  toCliErrorEnvelope,
  type CliExitCode,
  type Result,
  type SurfaceComposition,
  type SurfaceCompositionOptions,
  type SurfaceError,
} from "@surface/core";
import { Command, CommanderError } from "commander";

export type CliEnvelope<T> =
  | {
      readonly ok: true;
      readonly command: string;
      readonly schemaVersion: "1.0";
      readonly data: T;
    }
  | {
      readonly ok: false;
      readonly command: string;
      readonly schemaVersion: "1.0";
      readonly error: {
        readonly code: SurfaceError["code"];
        readonly kind: SurfaceError["kind"];
        readonly message: string;
        readonly exitCode: CliExitCode;
        readonly whatFailed: string;
        readonly likelyCause: string;
        readonly nextCommand: string;
        readonly details?: Record<string, unknown>;
      };
    };

export type SurfaceCliIo = {
  readonly stdout?: (chunk: string) => void;
  readonly stderr?: (chunk: string) => void;
};

export type RunSurfaceCliOptions = SurfaceCompositionOptions & {
  readonly argv?: readonly string[];
  readonly composition?: SurfaceComposition;
  readonly io?: SurfaceCliIo;
};

type StatusOutput = {
  readonly progress: {
    readonly hasPipeline: boolean;
  };
  readonly currentStage: string;
  readonly runHistory: readonly unknown[];
};

const CLI_SCHEMA_VERSION = "1.0";

export async function runSurfaceCli(options: RunSurfaceCliOptions = {}): Promise<CliExitCode> {
  const composition = options.composition ?? createSurfaceComposition(options);
  const io = options.io ?? {};
  const program = createSurfaceCliProgram({ composition, io });

  try {
    await program.parseAsync([...(options.argv ?? process.argv)], { from: "node" });

    return 0;
  } catch (cause) {
    const error = surfaceErrorForThrown(cause);
    const command = commandNameFor(program, options.argv ?? process.argv);
    const exitCode = exitCodeForSurfaceError(error);

    writeEnvelope(
      io.stderr ?? ((chunk) => process.stderr.write(chunk)),
      errorEnvelope(command, error, exitCode),
    );

    return exitCode;
  }
}

export function createSurfaceCliProgram(input: {
  readonly composition: SurfaceComposition;
  readonly io?: SurfaceCliIo;
}): Command {
  const program = new Command();
  const io = input.io ?? {};

  program
    .name("surface")
    .description("Audit running UIs and produce agent-readable findings.")
    .version("0.0.0")
    .exitOverride()
    .configureOutput({
      writeErr: (chunk) => {
        if (!program.opts<{ json?: boolean }>().json) {
          (io.stderr ?? ((value) => process.stderr.write(value)))(chunk);
        }
      },
      writeOut: (chunk) => (io.stdout ?? ((value) => process.stdout.write(value)))(chunk),
    })
    .option("--json", "emit machine-readable JSON")
    .option("--verbose", "emit verbose human output");

  program
    .command("status")
    .description("Read Surface project status.")
    .action(async () => {
      const result = await readStatus(input.composition);

      emitResult({
        command: "status",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result,
      });
    });

  program
    .command("next")
    .description("List eligible Surface pipeline steps.")
    .action(() => {
      emitResult({
        command: "next",
        io,
        json: program.opts<{ json?: boolean }>().json === true,
        result: {
          ok: true,
          value: { eligible: [] },
        },
      });
    });

  return program;
}

async function readStatus(composition: SurfaceComposition): Promise<Result<StatusOutput>> {
  const state = await composition.stateStore.readState();

  if (!isOk(state)) {
    return state;
  }

  return {
    ok: true,
    value: {
      currentStage: state.value.currentStage ?? state.value.pipeline?.lastCompletedStage ?? "new",
      progress: { hasPipeline: state.value.pipeline !== undefined },
      runHistory: [],
    },
  };
}

function emitResult<T>(input: {
  readonly command: string;
  readonly io: SurfaceCliIo;
  readonly json: boolean;
  readonly result: Result<T>;
}): void {
  const write = input.result.ok ? input.io.stdout : input.io.stderr;
  const fallback = input.result.ok
    ? (chunk: string) => process.stdout.write(chunk)
    : (chunk: string) => process.stderr.write(chunk);
  const sink = write ?? fallback;

  if (input.result.ok) {
    const envelope = successEnvelope(input.command, input.result.value);
    sink(
      input.json ? `${JSON.stringify(envelope)}\n` : humanizeSuccess(input.command, envelope.data),
    );

    return;
  }

  const exitCode = exitCodeForSurfaceError(input.result.error);
  sink(JSON.stringify(errorEnvelope(input.command, input.result.error, exitCode)) + "\n");
  throw new CommanderError(exitCode, input.result.error.code, input.result.error.message);
}

function successEnvelope<T>(command: string, data: T): Extract<CliEnvelope<T>, { ok: true }> {
  return {
    command,
    data,
    ok: true,
    schemaVersion: CLI_SCHEMA_VERSION,
  };
}

function errorEnvelope(
  command: string,
  error: SurfaceError,
  exitCode: CliExitCode,
): CliEnvelope<never> {
  const coreEnvelope = toCliErrorEnvelope(command, error);

  return {
    command,
    error: {
      code: coreEnvelope.error.code,
      exitCode,
      kind: coreEnvelope.error.kind,
      likelyCause: likelyCauseFor(error),
      message: coreEnvelope.error.message,
      nextCommand: nextCommandFor(error),
      whatFailed: whatFailedFor(command, error),
      ...(coreEnvelope.error.details === undefined ? {} : { details: coreEnvelope.error.details }),
    },
    ok: false,
    schemaVersion: CLI_SCHEMA_VERSION,
  };
}

function writeEnvelope(write: (chunk: string) => void, envelope: CliEnvelope<never>): void {
  write(`${JSON.stringify(envelope)}\n`);
}

function humanizeSuccess<T>(command: string, data: T): string {
  return `surface ${command}: ${JSON.stringify(data)}\n`;
}

function surfaceErrorForThrown(cause: unknown): SurfaceError {
  if (cause instanceof CommanderError) {
    return createSurfaceError("unknown_step", "Unknown or invalid surface command.", {
      cause,
      details: { commanderCode: cause.code },
    });
  }

  return createSurfaceError("unknown_step", "Surface command failed before execution.", { cause });
}

function commandNameFor(program: Command, argv: readonly string[]): string {
  return program.args[0] ?? argv.find((arg) => !arg.startsWith("-") && arg !== "node") ?? "surface";
}

function whatFailedFor(command: string, error: SurfaceError): string {
  return `surface ${command} failed with ${error.code}`;
}

function likelyCauseFor(error: SurfaceError): string {
  if (error.kind === "UsageError") {
    return "The command name or arguments do not match the Surface CLI contract.";
  }

  return "Surface could not complete the requested operation with the current project state.";
}

function nextCommandFor(error: SurfaceError): string {
  if (error.kind === "UsageError") {
    return "surface --help";
  }

  return "surface status --json";
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSurfaceCli();
}
