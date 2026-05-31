<!-- scaffold:tdd v1 2026-05-30 -->

# surface — Testing & TDD Standard

> Runner: **Vitest 4** (tech-stack §4). TDD is the default for features and bugfixes:
> write the failing test first, watch it fail, make it pass, refactor. This standard says
> *what* to test at each layer and what to mock.

## The Cycle
Red → Green → Refactor. No production code without a failing test that demanded it. A bug
fix starts with a test that reproduces the bug. "Prove It" (CLAUDE.md principle #4): a task
is done only when tests pass and output is shown — never "it seems to work."

## Test Layers
| Layer | What | Tooling | Mock? |
|---|---|---|---|
| **Unit** | pure functions: scoring, prioritization/MMR, identity hashing, schema parse, redaction | Vitest | no I/O to mock |
| **Adapter** | per-framework introspection (React/Next, Vue, Svelte, agnostic) | Vitest + **fixture components** | no — run real compilers on fixtures (NFR-FW-1) |
| **Grounding** | Axe/Lighthouse interpretation | Vitest | mock the *tool runner* with recorded tool JSON; never mock the assertion logic |
| **Capture** | Playwright/agent-browser backends | Vitest + Playwright | real headless browser against local fixture HTML; agent-browser behind an interface, contract-tested |
| **Pipeline/integration** | capture→lenses→findings→backlog→re-audit | Vitest | real file-based `.surface/` in a temp dir; model calls mocked |
| **CLI/MCP contract** | exit codes, `--json` shape, MCP tool schema | Vitest (spawn) | real process; assert NFR-CLI-1 / NFR-MCP-1 |

## Non-Negotiable Test Types
- **Determinism tests (SC-4, NFR-DET-1):** every *measured*-finding producer — same captured
  input ⇒ byte-identical findings. A measured producer without a determinism test fails review.
- **Identity tests (FR-RULE-5):** unchanged defect keeps its id across re-audit; DOM-drift →
  `identity-broken`, never silent `resolved`.
- **Method-integrity tests:** a `method:"measured"` finding must carry tool evidence; assert no
  judged finding is emitted as measured (vision principle #2).
- **Degradation tests:** no-model → measured-only; no-backend → static+screenshot; oversized
  input → reported truncation; context-overflow → measured-only fallback (PRD §7).
- **Concurrency tests (US-041):** overlapping runs don't corrupt `.surface/state.json`.

> The architectural authority for the release-gating test set is **ADR-015** (verification &
> test architecture). The types below were added in `review-testing` to align this standard with
> the reviewed ADRs / api-contracts (they were implied but not enumerated here originally).

- **Identity-drift fixture corpus (ADR-010):** the identity matcher must pass a corpus —
  unchanged node (keeps id), reordered siblings (keeps id), moved/renested (keeps id iff a
  deterministic ref exists, else `identity-broken`), attribute-only change (keeps id), and
  coarse-anchor collision (`identity-broken`, never merge two defects).
- **Closed-loop status/gate tests (FR-RULE-3,4,6):** waiver-active ⇒ `gateDisposition`
  `ignored-by-waiver` with detection `status` unchanged; **waiver expiry restores the preserved
  status** (LOOP-I6); the gate fails on new measured ≥ `SeverityBand` threshold and **never** on
  `judged`/`gatedForHuman`/`ignored-by-waiver`; `gatedForHuman` cannot be auto-resolved by an
  agent without a `Verdict`/human-confirmed validation.
- **Band-derivation tests:** `SeverityBand` derives from `dimensions.severity` and
  `confidenceBand` from `dimensions.confidence` per configured cutoffs (FND-I4); never set
  independently.
- **Reconciliation tests (FR-SCORE-5):** multi-model `ReconciliationService` merges drafts for
  one identity, adjusts confidence by agreement, surfaces divergence as a question, and degrades
  to single-model when a CLI is absent (recording which channels ran).
- **Contract tests (release-gating):** CLI exit codes (0/1/2) + `--json` shape per command
  (NFR-CLI-1); **MCP tool schema snapshot** tests with mandatory major-bump on breaking change
  (NFR-MCP-1); **SARIF v2.1.0** schema validation of `--export sarif` (US-032).
- **Performance gate (NFR-PERF-1):** `quick` preset on a single view, tool-grounding + capture
  p95 < 30s — a CI benchmark; >45s fails.

## What to Mock — and What Not
- **Mock:** network/model inference (BYO key), external tracker APIs (octokit), the
  *agent-browser CLI process* (via its adapter), wall-clock/timestamps.
- **Do NOT mock:** the framework compilers, zod schemas, scoring math, the file-based state
  layer (use a temp dir), or Axe/Lighthouse assertion logic. Mocking these would test the
  mock, not surface.

## Coverage Targets
- Core (`core`, scoring, identity, schema, redaction): **≥ 90%** line + branch.
- Adapters & grounding: **≥ 85%**, plus a fixture per supported framework/rule class.
- CLI/MCP/integration: smoke + contract coverage of every command/tool and every exit code.
- Coverage is a floor, not a goal — determinism/identity/method-integrity tests matter more
  than the number.

## Test Data
- Realistic fixture apps (a small React/Next, Vue, Svelte, and plain-HTML page) with seeded
  defects (contrast fail, focus trap, tiny target, missing empty state) used as the SC-6
  before/after benchmark. Recorded Axe/Lighthouse JSON as grounding fixtures.

## CI
`pnpm turbo run test lint typecheck` on every PR; the capture+grounding matrix runs on
changes to those packages. surface dogfoods itself on its own report output where applicable
(NFR-OWNOUT-1).
