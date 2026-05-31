<!-- scaffold:coding-standards v1 2026-05-30 -->

# surface — Coding Standards

> Tailored to the stack in `docs/tech-stack.md` (TypeScript/Node, ESM, pnpm monorepo,
> ESLint 9 + Prettier, Vitest, zod). Working configs ship alongside: `eslint.config.mjs`,
> `.prettierrc.json`, `tsconfig.base.json`, `.editorconfig`. AI agents are primary
> maintainers — rules optimize for clarity and low-ambiguity over cleverness.

## Language & Module Rules
- **TypeScript strict** everywhere (`strict: true`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). No `any` — use `unknown` + a zod parse at boundaries.
- **ESM only** (`"type": "module"`); use `node:` protocol for builtins (`import { readFile }
  from "node:fs/promises"`).
- **No default exports** in library packages — named exports keep refactors and agent edits
  unambiguous. (CLI bin entry may default-export.)

## Naming
- Files: `kebab-case.ts`. Types/interfaces/classes: `PascalCase`. Functions/vars:
  `camelCase`. Constants: `UPPER_SNAKE`. Zod schemas: `XxxSchema`; inferred type: `Xxx`.
- Domain vocabulary is **canonical** — use the exact terms from `domain-modeling`
  (`Finding`, `Lens`, `method: "measured"|"judged"`, `gatedForHuman`). No synonyms.

## The measured/judged discipline (project-critical)
- Code that emits a finding **must** set `method` explicitly. A function that produces a
  *measured* finding must derive its value from a real tool result — **never** synthesize a
  measurement. Lint/review rejects a `method: "measured"` finding without an attached tool
  `evidence` entry. This is the codebase expression of vision principle #2.

## Error Handling
- **No swallowed errors.** Catch only to add context, then rethrow or convert to a typed
  result. Use a discriminated `Result<T, SurfaceError>` at package boundaries; throw only at
  the CLI/MCP edge where it maps to an exit code (NFR-CLI-1) or MCP error.
- **Actionable messages** (US-050): every user-facing error states what failed, likely cause,
  and the next command. No bare `throw new Error("failed")`.
- External tools (Playwright, agent-browser, model CLIs, octokit) are wrapped in adapters
  that normalize failures to `SurfaceError` with a `cause`.

## Imports & Structure
- Import order (enforced): node builtins → external → workspace `@surface/*` → relative.
- No deep cross-package imports — packages talk through their published entry points.
- One responsibility per module; files target ≤ ~300 lines (soft).

## Validation & I/O
- **All external input is parsed with zod** at the boundary: config, captured DOM/JSON, model
  output, integration payloads. Internal code trusts validated types.
- File writes to `.surface/` use `write-file-atomic`; mutations of shared state acquire a
  `proper-lockfile` lock (US-041).

## Logging & Output
- Use `pino` for run logs; never `console.log` in library code. CLI presentation layer owns
  human output and honors NFR-OWNOUT-1 (no color-only meaning, ANSI-degradable, `--json`
  byte-stable).

## Testing (see `tdd` for the full standard)
- Vitest. Co-locate `*.test.ts`. Measured-finding producers get **determinism tests**
  (same input → identical findings, SC-4). Adapters get per-framework fixture suites
  (NFR-FW-1).

## AI-Specific Rules
- Prefer explicit over clever; small pure functions; exhaustive `switch` on union types with
  a `never` default. These maximize correct agent edits.
- Every public function has a one-line doc comment stating intent + invariants.
- Commit messages: `[surface-<id>] <type>(<scope>): <summary>` (see CLAUDE.md).
