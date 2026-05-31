<!-- scaffold:tech-stack v1 2026-05-30 -->

# surface — Technology Stack

> The definitive technology reference for `surface`. Every choice here is a **decision**,
> not a menu — with rationale, the alternative rejected, and an AI-compatibility note.
> Researched at depth 5 with multi-model input (Claude + Codex + Gemini); divergences and
> their resolutions are in `docs/reviews/tech-stack/review-summary.md`. Sources: `docs/plan.md`
> (PRD), `docs/vision.md`. Downstream phases depend on this for all framework-specific work.

## 1. Architecture Overview

surface is a **TypeScript monorepo** publishing a Node.js CLI and an MCP server, plus
internal packages for the evaluation engine, capture, grounding, framework adapters,
knowledge base, and reporters. It mirrors Scaffold's idioms (composable meta-prompts +
per-step knowledge injection + a `.surface/` state dir + `run`/`next`/`status` verbs) but
ships independently.

- **Pattern:** modular monorepo (workspaces), not microservices and not a single package.
  *Why:* the PRD's adapter surface (React/Next, Vue, Svelte, agnostic), dual interface
  (CLI + MCP), and pluggable capture/integration layers have clean seams that benefit from
  package boundaries and independent versioning; a single package would blur them early
  (PRD R-1 scope discipline). *Why not microservices:* surface is a locally-run tool, not a
  distributed service — there are no network service boundaries to justify it.
- **Candidate package layout** (finalized in `project-structure`):
  `packages/core` (pipeline engine, findings model, scoring, state), `packages/cli`
  (commander app), `packages/mcp` (MCP server), `packages/capture` (Playwright +
  agent-browser backends), `packages/grounding` (Axe/Lighthouse), `packages/adapters/*`
  (react, vue, svelte, agnostic), `packages/knowledge` (KB entries + loader),
  `packages/reporters` (md/json/SARIF/GitHub).
- **Runtime:** Node.js LTS (≥ 22). ESM-first. **All model access is optional** (see §10).

## 2. Language & Runtime

**Decision: TypeScript on Node.js (LTS ≥ 22), ESM.**
- **Why:** matches Scaffold (npm/Node sibling); the entire required ecosystem — MCP SDK,
  Playwright, Axe-core, Lighthouse, octokit, retext — is JS/Node-native; strongest AI
  training-data coverage of any runtime (PRD values agent-maintainability).
- **Why not Bun:** faster startup and built-in tooling, but Playwright + some native
  modules are less battle-tested, and it diverges from Scaffold parity. *(Bun is still used
  as an optional fast path for building the Homebrew binary — see §15.)*
- **Why not Deno:** weaker fit with the npm-centric MCP/Playwright tooling.
- **AI compatibility:** maximal — TS/Node is the best-represented stack in model training.

## 3. Monorepo Tooling

**Decision: pnpm workspaces (v11.x) + Turborepo (v2.9.x).**
- **Why:** pnpm = fast, disk-efficient, strict dependency isolation (good for clean adapter
  boundaries); Turborepo = task caching across the core/cli/mcp/adapters graph with a
  simple `turbo.json`. **Consensus** across both research models.
- **Why not Nx:** more powerful but heavier and more opinionated than a utility CLI needs.
- **Gotcha:** Turborepo *remote* caching needs care in CI; local caching is zero-config.
- **AI compatibility:** high — both are well-documented and config is small/declarative.

## 4. Build, Test, Lint

| Concern | Decision | Why / Why-not | AI compat |
|---|---|---|---|
| **Build/bundle** | **tsup 8.x** (esbuild) + `tsc --noEmit` for typecheck | Zero-config dual ESM/CJS + `.d.ts`; tsc for sound types. *Not* tsc-alone (no bundling). **Consensus.** | Excellent |
| **Test runner** | **Vitest 4.x** | Fast, native ESM, Jest-compatible API; integrates with Playwright for capture tests. *Not* Jest (ESM/TS friction). **Consensus.** | Perfect (reuses Jest知识) |
| **Lint/format** | **ESLint 9 (flat config) + typescript-eslint 8 + Prettier 3** | **Divergence resolved → ESLint over Biome.** Biome is faster, but ESLint pulls *double duty*: `eslint-plugin-jsx-a11y` becomes a **static a11y grounding input** for React adapters (a measured-source signal), and the a11y-rule ecosystem matters for a UI-quality tool. | High |

## 5. CLI Framework

**Decision: commander@14.x.** *(Divergence resolved → commander over Gemini's citty.)*
- **Why:** surface has many verbs (`init/run/next/status/capture/audit/explain/backlog/
  validate/gate/baseline/verdict`) and a hard POSIX-conformance NFR (NFR-CLI-1: exit codes
  0/1/2, combinable flags, `--json` everywhere). commander has the deepest training-data
  coverage (agent-maintainability), mature subcommand + typed-options support, and minimal
  weight.
- **Why not citty:** modern unjs ergonomics, but smaller ecosystem and less training data.
- **Why not oclif:** plugin/runtime machinery is overkill for v1.
- **AI compatibility:** very strong — the most-represented Node CLI library.

## 6. MCP Server

**Decision: `@modelcontextprotocol/sdk` (1.29.x).** **Consensus.**
- **Why:** the official, standard TS SDK; native agent compatibility — the whole point of
  the agent-first GTM (FR-IF-2). Exposes surface's verbs as MCP tools with versioned schemas
  (NFR-MCP-1).
- **AI compatibility:** excellent — industry-standard patterns, well-represented.

## 7. Capture Backends

**Decision: Playwright + agent-browser, auto-detected (FR-CAP-3), invoked via `execa`.**
- **Playwright** (chromium from Chrome-for-Testing): screenshots, DOM, a11y tree, computed
  styles, traces. **agent-browser** (vercel-labs, Rust CLI, Apache-2.0): deterministic
  element refs (`@e1`) as evidence/identity anchors, computed styles, React component-tree
  inspection — invoked as an external CLI via `execa`.
- **Static/screenshot fallback** when neither browser is present (FR-CAP-6, NFR-PORT-1).
- **Why execa (9.x):** robust child-process management for the agent-browser CLI and other
  external tools (model CLIs, etc.).
- **Gotcha:** Playwright requires a browser install; lazy-install/clear messaging on first run.

## 8. Accessibility & Performance Grounding

**Decision: `@axe-core/playwright` (4.11.x) + `axe-core` (4.11.x); `lighthouse` (12.x)
programmatic Node API.** **Consensus.**
- **Why:** axe via the Playwright page gives deterministic, measured a11y findings;
  Lighthouse's programmatic API (against a launched Chrome) supplies perf-perception + extra
  a11y signals. These produce the **measured** half of findings (never fabricated — vision
  principle #2).
- **Static a11y grounding (React):** `eslint-plugin-jsx-a11y` as a source-level measured
  input (see §4).
- **Gotcha:** Lighthouse has a large dependency footprint — **lazy-load** it so non-perf
  runs stay light.

## 9. Framework Adapters & DOM Parsing

**Decision (per-framework compilers + agnostic HTML):** *(Divergence resolved → Codex's
per-framework set over Gemini's lighter combo, which conflated static parsing with DOM
simulation.)*
- **React/Next + TS/JS:** `@babel/parser` (7.29.x) + `@typescript-eslint/typescript-estree`
  (8.x) for AST/component introspection and file/component mapping.
- **Vue:** `@vue/compiler-sfc` (3.5.x) — the only correct way to parse SFCs.
- **Svelte:** `svelte/compiler` (5.55.x).
- **Framework-agnostic:** `parse5` (8.x) for spec-compliant HTML parsing; **`happy-dom`
  (optional)** for lightweight non-browser DOM when a full browser isn't warranted.
- **Why:** real component introspection (FR-SCORE-7 deterministic fix snippets, file/
  component location in findings) requires each framework's actual compiler — `parse5`
  covers everything else.
- **AI compatibility:** high — all are standard compiler/AST APIs.

## 10. Model Access & Judged Findings (layered, fully OPTIONAL)

surface ships **no model and no credentials**. Judged findings are an opt-in enhancement
layer over the always-on measured layer. Three tiers (PRD §12 BYO-key contract, NFR-DATA-1):

1. **No model → measured-only.** Zero config, zero cost, nothing leaves the machine; judged
   lenses are skipped and reported as skipped (graceful degradation).
2. **BYO-key SDK (opt-in) → judged findings.** The user supplies their **own** provider API
   key (env var, e.g. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) or a local model endpoint;
   surface calls it via that provider's official **SDK**. The user owns cost, rate limits,
   and data exposure — surface never proxies or bills, and sends nothing unless a model is
   configured.
3. **Multi-model reconciliation (opt-in, depth 4–5) → higher trust on judged findings.**
   Via an **`execa` adapter to installed `codex` / `claude` / `gemini` CLIs**, **and/or
   `mmr`** if present (optional integration, not a hard dependency).

- **Decision:** support tiers 1+2 as core (SDK + execa CLI adapter) and `mmr` as an optional
  reconciliation backend — per owner direction. *(Resolves the Codex-vs-Gemini divergence by
  taking both, with mmr optional so surface stands alone as OSS.)*
- **AI compatibility:** high — provider SDKs and CLI invocation are well-trodden.

## 11. State, Persistence & Concurrency

**Decision: file-based `.surface/` state + atomic writes + advisory locking.**
*(Divergence resolved → file-based over Gemini's embedded SQLite.)*
- **Mechanism:** `state.json`, `findings/` (JSON/JSONL), `captures/`, baseline/waiver files
  (FR-RULE-6), written with **`write-file-atomic` (6.x)** and guarded by **`proper-lockfile`
  (4.x)** to satisfy the PRD's concurrency/interrupted-run sad path (§7) and resumability.
- **Why:** matches `idea.md` (`.surface/`) and Scaffold's `.scaffold/` model; **human-
  inspectable and git-diffable** (a surface value — auditability); **no native bindings**,
  so `npx`/Homebrew distribution stays clean. Atomic+lock directly answers Gemini's
  race-condition concern without a DB.
- **Why not SQLite (Drizzle + better-sqlite3):** more robust at very large finding volumes,
  but native bindings complicate npx/brew, and state stops being inspectable/diffable.
  **Revisit if** finding volumes or identity-matching cost outgrow files — the state layer
  is kept behind an interface so SQLite could drop in later.
- **Finding identity (FR-RULE-5):** stable hash of lens + issue-type + location anchor,
  preferring agent-browser's deterministic element ref when available.

## 12. Integrations & Reporters

| Need | Decision | Notes |
|---|---|---|
| GitHub Issues / Checks / PR annotations (FR-INT-2, FR-OUT-4 / I4) | **`@octokit/rest` 22.x + `@octokit/graphql` 9.x** | user-provided token; rate-limit backoff (PRD §7) |
| SARIF output (I4) | **`node-sarif-builder` 3.2.x** (SARIF v2.1.0) | standard interchange for code-scanning/CI |
| Screenshot evidence + crop + **redaction** (FR-CAP-11 / I5) | **`sharp` 0.34.x** | crop finding regions for evidence; redact PII/secrets in captures/exports |
| Structured logging / observability (NFR-OBS-1) | **`pino` 10.x` | run logs + knowledge-gap signals |
| Design tokens / Storybook (Should/Could) | parsers TBD in specs | deferred per PRD §8 |

## 13. Content & Reading-Level Analysis

**Decision: unified/retext stack — `retext` 9.x + `retext-english` 5.x +
`retext-readability` 8.x + `retext-equality` 7.x.** **Consensus.**
- **Why:** modular, community-vetted; Flesch-Kincaid/Gunning-Fog for the content lens
  (FR-LENS-1 content clarity), plus inclusive-language checks (`retext-equality`).
- **AI compatibility:** high.

## 14. Schema, Config & Knowledge-Base Formats

- **Validation:** **zod 4.x** for the `Finding`/`Task` schemas (FR-SCORE-1) and config —
  TS-first, runtime + static types, near-zero agent hallucination. **Consensus.** (*Not*
  valibot — smaller but thinner ecosystem.)
- **Config:** **`yaml` 2.x** for `.surface/config.yml`.
- **Knowledge base:** Markdown entries with YAML frontmatter parsed by **`gray-matter`
  4.x** (`## Summary` / `## Deep Guidance` per PRD/idea). **Consensus.**

## 15. Distribution & License

- **Distribution:** **npm + `npx surface` + Homebrew tap.** npm/npx matches Scaffold and
  Node norms; a **Homebrew formula** fits the toolchain (`bd` and agent-browser are both
  brew-distributed). The brew formula wraps the Node CLI (or an optional Bun/esbuild-built
  single binary for users without Node).
- **License: MIT.** Permissive, ubiquitous for JS/TS OSS, fully compatible with Apache-2.0
  deps (agent-browser); maximizes the community-adoption model. A `NOTICE`/attributions
  file tracks bundled third-party licenses.

## 16. Quick Reference — Direct Dependencies (with versions)

> Versions are current-as-of 2026-05 research; pinned exactly in `package.json` per package.
> ~24 direct deps — justified below; no speculative "might need someday" entries.

| Package | Version | Package | Purpose |
|---|---|---|---|
| typescript | 5.x | runtime/lang | typed source |
| commander | 14.x | cli | arg parsing |
| @modelcontextprotocol/sdk | 1.29.x | mcp | MCP server |
| playwright | 1.x | capture | browser capture |
| execa | 9.x | capture/model | child processes (agent-browser, model CLIs) |
| @axe-core/playwright · axe-core | 4.11.x | grounding | measured a11y |
| lighthouse | 12.x | grounding | perf-perception (lazy) |
| @babel/parser | 7.29.x | adapters | JS/JSX AST |
| @typescript-eslint/typescript-estree | 8.x | adapters | TS AST |
| @vue/compiler-sfc | 3.5.x | adapters | Vue SFC |
| svelte/compiler | 5.55.x | adapters | Svelte |
| parse5 | 8.x | adapters | HTML |
| happy-dom | 15.x (opt) | adapters | lightweight DOM |
| zod | 4.x | core | schemas/validation |
| yaml | 2.x | core | config |
| gray-matter | 4.x | knowledge | KB frontmatter |
| write-file-atomic | 6.x | state | atomic writes |
| proper-lockfile | 4.x | state | locking |
| @octokit/rest · @octokit/graphql | 22.x · 9.x | reporters | GitHub |
| node-sarif-builder | 3.2.x | reporters | SARIF |
| sharp | 0.34.x | reporters/capture | screenshots, redaction |
| pino | 10.x | core | logging |
| retext (+english/readability/equality) | 9/5/8/7 | content lens | reading level |
| **Dev:** pnpm 11 · turborepo 2.9 · tsup 8 · vitest 4 · eslint 9 + typescript-eslint 8 + prettier 3 · eslint-plugin-jsx-a11y | | | tooling |

**Optional / not bundled (BYO):** provider model SDKs + API key (judged findings);
`codex`/`claude`/`gemini` CLIs and/or `mmr` (multi-model reconciliation); agent-browser
(alternate capture backend).

## 17. PRD Capability Cross-Reference (no gaps)

- Capture (FR-CAP-1..11): Playwright/agent-browser/execa, parse5/happy-dom, sharp (redaction). ✓
- Measured findings (FR-PIPE-6, FR-LENS): axe-core, Lighthouse, eslint-plugin-jsx-a11y, computed styles. ✓
- Judged findings + reconciliation (FR-SCORE-5..8): BYO-key SDK + execa CLIs + optional mmr. ✓
- Findings/scoring/identity (FR-SCORE-1..3, FR-RULE-5): zod schema, file-based state. ✓
- Baseline/waivers (FR-RULE-6 / I1): file-based + atomic/lock. ✓
- Closed loop + concurrency (FR-LOOP, §7): write-file-atomic + proper-lockfile. ✓
- CLI + MCP + state (FR-IF-1,2,5): commander, MCP SDK, `.surface/`. ✓
- Reporters (FR-OUT-1..4 / I4): md/json + octokit + node-sarif-builder. ✓
- Content lens: retext. ✓ · Observability (NFR-OBS-1): pino. ✓
- Distribution/license: npm+npx+brew, MIT. ✓

## 18. AI-Compatibility Summary & Upgrade Strategy

- **Overall AI compatibility: high.** Every core choice (TS/Node, commander, zod, vitest,
  Playwright, MCP SDK, eslint, yaml) is among the best-represented in model training data —
  important because agents are a primary maintainer of this codebase.
- **Watch items (younger/edge ecosystems):** agent-browser (young, external Rust CLI —
  isolated behind the capture interface); MCP SDK (1.x, evolving — pin minor, track
  releases); Turborepo remote cache (CI nuance).
- **Upgrade strategy:** exact pins in `package.json`; Renovate/Dependabot for PRs; pin
  Playwright + browser version together; treat MCP SDK and the model SDKs as
  watch-and-test-on-bump; re-run the full vitest + capture matrix on any capture/grounding
  dependency bump.

---

*Decisions here are binding for downstream phases. Divergences and the multi-model research
trail: `docs/reviews/tech-stack/`. `project-structure` will turn §1's candidate layout into
the concrete directory tree.*
