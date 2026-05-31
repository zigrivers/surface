<!-- scaffold:implementation-plan-review v1 2026-05-31 -->

# Review Report: Implementation Plan (`docs/implementation-plan.md`)

## Readiness Status

**PASS** (after fixes). No unresolved P0/P1 — the build phase (single-agent/multi-agent start)
can proceed. Coverage matrix: `implementation-plan/task-coverage.json` (all defined stories
mapped). Raw reviews: `implementation-plan/{codex,gemini}-review.json`; synthesis
`implementation-plan/review-summary.md`.

## Executive Summary

Three reviewers — Claude (7 passes), **Codex** (14 findings, gate: *fail* — 4 **P0**), **Gemini**
(5 findings, gate: *conditional-pass*). The plan was directionally sound but **not build-ready**:
gate-critical infrastructure was missing (model-provider, context-ingestion), the gate evaluator
was mis-tiered, several tasks were oversized catch-alls (CLI, MCP, KB, fixtures), and the
parallelism/critical-path claims were inaccurate. **18 findings actioned (4 P0, 11 P1, 3 P2/P3);
task count ~52 → ~68.**

## Findings by Pass (reconciled)

| # | Sev | Pass | Finding | Reviewer(s) | Resolution |
|---|---|---|---|---|---|
| IP-1 | **P0** | Arch coverage | no model-provider/JudgmentRunner task; judged lenses (gate) had no model interface; T-003 omitted model config | Codex | **+T-019** (gate) model-provider abstraction |
| IP-2 | **P0** | Story coverage | US-003 static/context inputs uncovered (ingest component/tokens/scaffold-docs; token-contradiction findings) | Codex | **+T-033** (gate) ContextIngestor |
| IP-3 | **P0** | Story coverage | T-054 GateEvaluator mis-tiered committed; default gate is release-gate scope (FR-RULE-4) | Codex | split **T-054a (gate)** default gate + **T-054b (committed)** baseline-aware |
| IP-4 | **P0** | Task sizing | T-061 bundled 15 CLI verbs into one gate task | Codex + Gemini | split into **T-061a/b/c** verb groups (tiered) |
| IP-5 | P1 | Task sizing / deps | T-062 MCP over-bundled and wrongly depended on the CLI (siblings over core) | Codex | **+T-059** composition factory in core; split MCP **T-062a/b/c**, depend on core |
| IP-6 | P1 | Story coverage | US-022 suggestedPatch (committed) had no task | Codex + Claude | **+T-056** |
| IP-7 | P1 | Story coverage | US-032 AC2 GitHub Checks/PR annotations distinct from SARIF/Issues | Codex | **+T-057** |
| IP-8 | P1 | Story coverage | US-004 / US-014 / US-061 absent | Codex + Gemini + Claude | **+T-034 / +T-041b / +T-058** (should) |
| IP-9 | P1 | DAG / parallelism | "mutually parallel within a wave" false (intra-wave deps in W2/W3/W4/W5) | Codex | added subwave notes; corrected the claim |
| IP-10 | P1 | Critical path | path included false `T-045→T-050`; omitted gate branches converging at T-060 | Codex | recomputed path through T-059/T-060; listed convergent gate branches |
| IP-11 | P1 | Parallelization | W2 not "very high" — backends share registry; redaction spans capture+export | Codex | subwaved W2; split redaction **T-025a** (capture) / **T-025b** (export) |
| IP-12 | P1 | Arch coverage | T-050 only findings.md/json; FR-OUT-1 also backlog/agent-plan/validation-report | Codex | **+T-050b** report renderers |
| IP-13 | P1 | Task sizing | T-070 fixtures = multiple projects | Codex | split **T-070a** (html+react, gate) / **T-070b** (vue+svelte, committed) |
| IP-14 | P2 | Task sizing | T-047 KB authoring unbounded/content | Codex + Gemini | split **T-047s** (scaffold, code-sized) + **T-047c** (per-category content) |
| IP-15 | P2 | Arch alignment | T-013 ReconciliationService in core vs leaf | Gemini | noted candidate `@surface/reconciliation` leaf pkg |
| IP-16 | P3 | DAG | judged lenses implicit dep on KB content | Gemini | lenses now depend on T-046 + T-019; W3a seeds T-047s first |

## Fix Plan (executed) & Fix Log

- **Batch 1 — gate-critical coverage (P0: IP-1,2,3):** +T-019 model-provider, +T-033 context-ingestor, split T-054 (gate default + committed baseline).
- **Batch 2 — sizing splits (P0/P1: IP-4,5,13,14):** CLI verb groups (T-061a/b/c), composition factory T-059 + MCP split (T-062a/b/c, core-dep), fixtures split (T-070a/b), KB scaffold/content split (T-047s/c).
- **Batch 3 — coverage gaps (P1: IP-6,7,8,12):** +T-056 suggestedPatch, +T-057 GitHub Checks, +T-034/T-041b/T-058 (US-004/014/061), +T-050b report renderers.
- **Batch 4 — accuracy (P1/P2/P3: IP-9,10,11,15,16):** subwave notes + corrected parallelism claim, recomputed critical path, split redaction (T-025a/b), reconciliation leaf-pkg note, explicit lens↔KB/model deps.

No new P0/P1 introduced.

## Re-Validation

- `task-coverage.json` `uncovered` is now **empty** — every defined story US-001..071 maps to ≥1 task.
- No task remains an oversized catch-all (CLI/MCP/KB/fixtures/gate all split).
- The default gate (FR-RULE-4) is gate-tier (T-054a); judged lenses have a model interface (T-019)
  and context ingestion exists (T-033) — the three P0 gate gaps are closed.
- Critical path recomputed from explicit deps; parallelism claims corrected to subwave reality.

## Downstream Readiness

- **Gate:** **Pass** — the build phase can proceed. The release gate = all **G** tasks +
  T-070a/071/072 green.
- **Handoff to build:** start at Wave 0 (foundations); the critical path runs
  foundations→schema→interfaces→state→orchestrator→lens-registry→composition→CLI→e2e→benchmark.
  Parallelize within subwaves across packages; serialize `core` + the composition factory + CLI app.
