<!-- scaffold:ai-memory-setup v1 2026-05-31 -->

# surface — AI Memory Stack

Tiered memory so agents stay effective across sessions.

## Tier 1 — Modular path-scoped rules (ENABLED)

`.claude/rules/` holds focused, auto-loading rule files (YAML frontmatter `description` + `globs`),
each extracted from a source doc so CLAUDE.md stays lean (pointer pattern):

| Rule file | Globs | Source of truth |
|---|---|---|
| `typescript-style.md` | `packages/**/*.{ts,tsx}` | `docs/coding-standards.md` |
| `measured-judged.md` | `core`/`grounding`/`reporters` src | `docs/domain-models/findings.md`, ADR-005 |
| `testing.md` | `**/*.test.ts`, `tests/**` | `docs/tdd.md`, ADR-015 |

Rules are pointers + the few invariants worth loading inline; the full detail lives in the cited
docs (no drift — rules summarize, docs own). Total rule content is well under 500 lines.

## Tier 2 — Persistent cross-session memory (OPTIONAL)

Use **Beads** as the persistent memory of record for this project (`bd remember "<insight>"`,
`bd memories <keyword>`) — per CLAUDE.md, do not use scattered `MEMORY.md` files. An MCP memory
server + lifecycle hooks could be added later via `.claude/settings.json`; not enabled now to
avoid duplicating Beads.

## Tier 3 — External context / library docs (PARTIALLY PRESENT)

The **context7** MCP server is already available in this environment for current library docs
(React/Playwright/zod/commander/MCP SDK, etc.) — use it to avoid API hallucination when
implementing against a dependency. No additional setup required.

## Maintenance

When a convention changes, update the **source doc** first, then reconcile the one-line rule
summary. The `cross-doc` eval (`tests/evals/cross-doc.test.ts`) guards terminology drift.
