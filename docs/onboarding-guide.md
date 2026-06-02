<!-- scaffold:developer-onboarding-guide v1 2026-05-31 -->

# surface — Onboarding Guide (start here)

Welcome — human or agent. This is the **single "read me first"** that points you at everything
else. It covers *understanding the project + getting set up + how to work*. The
**implementation-playbook** (next doc) covers *which task to pick up and how to execute it*.

## 1. What surface is

surface is an open-source **CLI + MCP server that audits the built, running UI of web apps**. It
separates **measured** findings (tool-confirmed: Axe/Lighthouse/computed styles) from **judged**
findings (AI-interpreted, with cited heuristics), and turns them into a **prioritized,
agent-executable, re-verifiable fix backlog** — then **closes the loop** by re-auditing to confirm
fixes landed. Primary adopter is an **AI agent / CI pipeline** (P1); the human non-designer builder
(P2) is the beneficiary and the authority on risky changes. North star: `docs/vision.md`; the WHAT:
`docs/plan.md` (PRD).

The one rule everything protects: **a judged finding is never presented as measured, and a
measured finding must carry real tool evidence** (vision principle #2 → ADR-005 → lint + tests).

## 2. Get set up (≤ 5 steps)

```bash
git clone <repo-url> surface && cd surface   # 1
corepack enable                              # 2  (pinned pnpm)
pnpm install                                 # 3
cp .env.example .env                         # 4  (optional — model keys; surface runs measured-only with none)
pnpm run check                               # 5  (format + lint + typecheck + test = the CI gate)
```

Daily: `pnpm dev` (watch build) · `pnpm test:watch` · `pnpm run check` before every PR. Full
guide + troubleshooting: `docs/dev-setup.md`. (No database, no web dev server — surface is a CLI;
"dev" is watch-mode compilation.)

## 3. Architecture in one screen

Modular pnpm+Turborepo monorepo: a pure **`@zigrivers/surface-core`** (Finding/Backlog schema, scoring,
identity, closed-loop, state, the pipeline orchestrator, and every plugin **interface**) wrapped
by thin **`cli`** + **`mcp`** adapters, with **edge plugins** behind core's interfaces:
`capture` (Playwright/agent-browser/static), `grounding` (axe/Lighthouse/jsx-a11y), `adapters`
(react/vue/svelte/agnostic), `lenses/*`, `knowledge`, `reporters`. Plugins are wired into the
orchestrator at a single **composition root** (the CLI/MCP app) — `core` imports no leaf package.
The only writer of `.surface/` state is `core`'s `StateStore`. Full blueprint:
`docs/system-architecture.md`; component↔package map there §2; domain model:
`docs/domain-models/` (7 bounded contexts).

## 4. Top patterns (with examples)

1. **Typed boundaries: `Result<T, SurfaceError>` + zod (ADR-005/014).** Package APIs return a
   discriminated `Result`; external input (config, captured DOM, model output) is zod-parsed at
   the boundary; throw only at the CLI/MCP edge where it maps to an exit code.
   ```ts
   export function scoreFinding(draft: FindingDraft, cfg: FindingsPolicy): Result<Finding, SurfaceError> { … }
   ```
2. **Measured ⇒ evidence; the label derives from `method` only.** A `method:"measured"` finding
   must carry a `tool-result` Evidence entry; reporters render the label from `finding.method`,
   never a separate flag (FND-I1/I2). Lint + a determinism test enforce it.
3. **Stable finding identity for the closed loop (ADR-010).** `identityKey =
   hash(lens + issueType + locationAnchor)` (prefer agent-browser `@e` refs); an unmatchable
   anchor on re-audit is `identity-broken`, **never** silently `resolved`.

Path-scoped rules auto-load from `.claude/rules/` (typescript-style, measured-judged, testing).

## 5. ADR quick index (the WHY — `docs/adrs/`)

001 TS/Node≥22/ESM · 002 modular monorepo · 003 file-based `.surface/` state (no DB) · 004 dual
capture backends · 005 measured/judged trust invariant · 006 BYO-key layered model access · 007
commander CLI + POSIX · 008 CLI+MCP API (no REST) · 009 per-framework adapters · 010 finding
identity hash · 011 npm+npx+brew / MIT · 012 pipeline orchestrator service · 013 security/data
boundary · 014 error handling (`Result`) · 015 verification/test gates · 016 reporting/export
(local-first) · 017 grounding/lens execution (measured-wins) · 018 observability (privacy-safe).

## 6. Development workflow

```bash
scripts/setup-agent-worktree.sh surface-<id> <desc>   # per-agent worktree (parallel)
# branch: surface-<id>/<desc>   commit: [surface-<id>] <type>(<scope>): <summary>
pnpm run check                                        # before PR (mirrors CI)
gh pr merge --squash --auto --delete-branch           # after green CI + review
bd close surface-<id>
```

Review is mandatory (`scaffold run review-pr` or `scripts/cli-pr-review.sh`); severities in
`docs/review-standards.md`. **Never parallelize tasks touching the same files** — assign agents to
different packages; serialize `core`/CLI. Full workflow: `docs/git-workflow.md`.

## 7. Doc lookup

| Need | Doc |
|---|---|
| Purpose / requirements | `docs/vision.md` · `docs/plan.md` |
| Domain model / vocabulary | `docs/domain-models/` |
| Decisions | `docs/adrs/` |
| Architecture / where code goes | `docs/system-architecture.md` · `docs/project-structure.md` |
| CLI/MCP/output contracts | `docs/api-contracts.md` |
| Standards | `docs/coding-standards.md` · `docs/tdd.md` |
| Security / ops | `docs/security-review.md` · `docs/operations-runbook.md` |
| **What to build next** | `docs/implementation-plan.md` + the **implementation-playbook** |
| Stories ↔ tests | `docs/user-stories.md` · `docs/story-tests-map.md` |

## 8. This guide vs the implementation-playbook

- **This guide** = orientation: *what surface is, how it's built, how to set up and work.* Read
  it once.
- **implementation-playbook** = execution: *the wave order, how to pick a task from
  `implementation-plan.md`, the TDD loop, and the definition of done per task.* Consult it each
  time you start a task.

You're ready: set up (§2), skim the architecture (§3) and patterns (§4), then open the playbook.
