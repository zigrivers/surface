# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

> `surface` is an open-source CLI + MCP server that audits the *built, running* UI of web
> apps. Strategic docs: `docs/vision.md` (North Star), `docs/plan.md` (PRD). Build against
> the **v1.0 Release Gate** in `docs/plan.md` §8 first.

## Core Principles

These four tenets govern every change. They override convenience, and they outrank any
instinct to cut corners under time pressure.

1. **Simplicity** — Choose the simplest design that solves the *actual* problem. No
   speculative abstraction, no framework where a function will do. surface's own
   anti-vision applies to its codebase: don't build everything at once.
2. **No Laziness** — No stubs, `TODO`s, swallowed errors, or "good enough" shortcuts left
   behind. If something is out of scope, file a Beads issue; don't fake it. Match the
   surrounding code's style and rigor.
3. **TDD** — Write the failing test first, watch it fail, make it pass, refactor. This is
   non-negotiable for features and bugfixes (see the TDD standard once `tdd` runs).
4. **Prove It** — Never claim something works because "it seems to." Run the tests, show
   the output, verify the behavior. Evidence before assertions — surface holds *itself* to
   the standard it audits (PRD NFR-OWNOUT-1).

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

## Commit Convention

Every commit references its Beads task with the **project issue prefix** (this repo's
prefix is `surface`, so IDs look like `surface-q2p` — *not* the generic `bd-` placeholder):

```
[surface-<id>] <type>(<scope>): <summary>

- bullet describing the change
- bullet describing the test/verification
```

`<type>` follows Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).
The `[surface-<id>]` prefix gives task↔commit traceability and session reconstruction.
Commit/push only when the active agent profile or the user authorizes it (see the Beads
block above).

## Upgrade Remediation

If `bd` was upgraded since the last `bd init`, run `bd doctor --fix` to re-sync git hooks
and project config. This fixes errors like `unknown command "hook" for "bd"` from stale
post-checkout / post-merge hook shims. *(Note: on this machine `bd` is in embedded-Dolt
mode, where `bd doctor` reports it is not yet supported — reinitialize with `bd init
--force` if hooks/config drift.)*

## Autonomous Behavior

- **Session start:** read `tasks/lessons.md`, then `bd ready` to find work; `bd update
  <id> --claim` before starting.
- **Capture lessons immediately** when corrected, when a test fails on a pattern you should
  have known, or when you discover a project convention — append to `tasks/lessons.md`.
- **Don't mark a task done on "it seems to work"** — Prove It (tests pass, output shown).
- **File follow-ups as Beads issues** rather than leaving `TODO`s in code.
- **Respect the human gate:** surface's own principle #5 — risky/subjective/brand changes
  go to a human; the same applies to risky changes in this repo.

## Build & Test

Full getting-started guide: `docs/dev-setup.md`. Stack: pnpm 11 + Turborepo, TypeScript/ESM,
Node ≥ 22. There is **no database** and no web dev server — "dev" is watch-mode compilation.

### Key Commands

| Command | What it does |
|---|---|
| `corepack enable` | activate the pinned pnpm (one-time) |
| `pnpm install` | install all workspace dependencies |
| `pnpm dev` | watch-mode build across packages (`turbo watch build`) |
| `pnpm build` | build every package once |
| `pnpm test` | run the full test suite |
| `pnpm test:watch` | re-run tests on change |
| `pnpm lint` | lint all packages |
| `pnpm typecheck` | type-check all packages |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm run check` | **full local gate, identical to CI** (format-check + lint + typecheck + test) |
| `pnpm clean` | remove caches and build output |

Run one package with a filter, e.g. `pnpm --filter @surface/core test`.

### Dev Environment

- **First-time setup (≤ 5 steps):** clone → `corepack enable` → `pnpm install` →
  `cp .env.example .env` (optional) → `pnpm run check`.
- **Model keys are optional.** With none set, surface runs measured-only and transmits
  nothing (NFR-DATA-1). Add keys in `.env` (gitignored) to enable judged / multi-model
  findings; `.env.example` documents every variable.
- **Run the CLI locally:** build `@surface/cli`, then `pnpm --filter @surface/cli exec npm link`
  to expose the `surface` binary; or run from source via `tsx src/index.ts`.
- **Prove It:** before claiming a change works, run `pnpm run check` and show the output.
  `pnpm run check` is exactly what CI runs.

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
