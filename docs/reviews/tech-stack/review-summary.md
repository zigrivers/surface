# Multi-Model Tech-Stack Research Synthesis

**Date:** 2026-05-30 · **Depth:** 5/5 · **Models:** Claude (synthesis) + Codex (16
categories) + Gemini (13). Fixed constraints going in: TS/Node, MIT, npm+npx+brew, monorepo,
Playwright+agent-browser, Axe+Lighthouse, MCP.

## Consensus (both models agreed → adopted)
- **Monorepo:** pnpm workspaces + Turborepo
- **Build:** tsup (+ tsc typecheck) · **Test:** Vitest
- **Schema:** zod · **Config/KB:** yaml + gray-matter
- **MCP:** `@modelcontextprotocol/sdk`
- **Grounding:** `@axe-core/playwright` + axe-core; Lighthouse programmatic (lazy-load)
- **Content:** unified/retext (readability + equality)

## Divergent (models disagreed → resolved, with rationale)
| Category | Codex | Gemini | Resolution | Why |
|---|---|---|---|---|
| CLI framework | commander@14 | citty | **commander** | many verbs + POSIX NFR + max AI training data |
| Lint/format | eslint9 + prettier | biome | **eslint** | `eslint-plugin-jsx-a11y` doubles as a static a11y grounding input |
| Adapters | per-framework compilers (@babel, @vue/compiler-sfc, svelte/compiler, parse5) | @typescript-eslint/parser + happy-dom | **Codex's set** (+ happy-dom optional) | real Vue/Svelte parsing needs each framework's compiler; Gemini conflated AST parsing with DOM sim |
| **State persistence** | file-based + write-file-atomic + proper-lockfile | SQLite (Drizzle + better-sqlite3) | **file-based** *(owner decision)* | matches `.surface/` idea; inspectable/git-diffable; no native bindings for npx/brew; atomic+lock answers the race concern; SQLite kept as a future option behind an interface |
| **Multi-model (judged)** | execa → installed CLIs | `mmr` | **both, layered + optional** *(owner decision)* | BYO-key SDK core + execa CLIs + optional mmr; keeps surface standalone |

## Unique contributions (single-model, adopted — filled real PRD gaps)
- **Codex:** `@octokit/*` + `node-sarif-builder` (I4 SARIF/PR annotations), `sharp`
  (screenshot evidence + FR-CAP-11 redaction), `pino` (NFR-OBS-1 observability),
  execa for child-process management.
- **Gemini:** flagged the **state-persistence question** explicitly (drove the divergence
  decision) and surfaced biome/happy-dom/citty as the lighter-weight alternatives that
  sharpened the trade-off discussion.

## Owner decisions captured (2026-05-30)
- Runtime **TS/Node**, license **MIT**, distribution **npm+npx+Homebrew**, **monorepo**.
- State: **file-based + atomic/locking**.
- Model access: **layered + optional** (measured-only → BYO-key SDK → execa CLIs / mmr).

## Notes
No active contradictions beyond the two flagged divergences; both resolved by the owner.
Raw findings: `codex-review.json`, `gemini-review.json` (+ `.raw.txt`); input:
`dispatch-prompt.md`.
