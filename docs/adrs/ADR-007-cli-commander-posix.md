<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-007: Build the CLI on commander; treat POSIX conformance as a hard contract

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** ADR-008; `tech-stack.md` §5; FR-IF-1, NFR-CLI-1; Interfaces (adapter)

## Context

The CLI is surface's primary human and script interface, with many verbs
(`init/run/next/status/capture/audit/explain/backlog/validate/gate/baseline/verdict`) and a
hard agent-facing contract: exit codes 0/1/2, combinable short flags, `--` terminator, and
`--json` on every command (NFR-CLI-1). The CLI is the agent's scriptable surface (P1 persona).

## Decision

Use **commander@14** for argument parsing and subcommands, in `packages/cli` as a thin
presentation/adapter layer over `core`. Encode **NFR-CLI-1 as a contract** verified by CLI
contract tests: 0=success, 1=error, 2=usage; `--json` machine-readable mode on every command;
output owns NFR-OWNOUT-1 (no color-only meaning, ANSI-degradable, byte-stable `--json`).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **commander (chosen)** | deepest Node-CLI training-data coverage (agent-maintainability); mature subcommands + typed options; minimal weight | less "modern" ergonomics than unjs |
| **citty (unjs)** | modern ergonomics | smaller ecosystem, less training data |
| **oclif** | plugin framework, large-CLI features | plugin/runtime machinery overkill for v1 |
| **yargs** | batteries-included | heavier; commander's subcommand model fits better |

## Consequences

- **Positive:** the most agent-legible CLI library; lazy `import()` per command keeps
  `--help`/`--version` startup fast (NFR-PERF-1); contract tests pin the exit-code/JSON
  behavior agents depend on.
- **Negative / accepted:** manual `--json` plumbing per command (enforced by contract tests).
- **Risk / mitigation:** CLI logic creeping into the presentation layer → the CLI calls `core`
  services and only formats output; business logic stays in `core` (ADR-002 boundary rule).

## Team / maintenance

commander is the most-represented Node CLI lib in model training — the decisive agent-
maintainability factor. The exit-code/JSON contract is the stable surface other tools build on.
