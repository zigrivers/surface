<!-- scaffold:traceability-matrix v1 2026-05-31 -->

# Validation: Traceability Matrix (PRD → Story → Task → Test)

> Reviewer: Claude (enhanced). Confirms the full chain has no orphans in either direction.
> Backed by `docs/reviews/implementation-plan/task-coverage.json` (story→task, uncovered=[]) and
> `docs/story-tests-map.md` (story→AC→test).

## Result: **PASS** — every PRD capability traces forward to a test; every task traces back to a story.

## Forward chain (PRD feature → story → task → test) — representative gate-tier rows

| PRD feature | Story | Task(s) | Test |
|---|---|---|---|
| FR-CAP-3 capture/auto-backend | US-001 | T-020/021/022/023 | E1 US-001 |
| FR-CAP-8 auth injection | US-002 | T-024 | E1 US-002 (e2e) |
| FR-CAP-1/2/4 static+context inputs | US-003 | **T-033** (+T-029/030) | E1 US-003 |
| FR-PIPE-6/FR-LENS measured a11y | US-011 | T-026/027/028/040 | E2 US-011 |
| FR-PIPE-5/7/8/9 judged lenses | US-012 | **T-019**+T-041/042/043/044 | E2 US-012 |
| FR-SCORE-1 structured findings | US-020 | T-002 | E3 US-020 |
| FR-SCORE-2/3/RULE-1/2 backlog+trust | US-021 | T-011/012 | E3 US-021 |
| FR-LOOP-2/RULE-5 identity | US-040 | T-014/015 | E5 US-040 |
| §7/US-041 concurrency/resume | US-041 | T-010/018 | E5 US-041 |
| FR-RULE-4 default gate | (P3 gate) | **T-054a** | E5 US-042 (gate) |
| FR-OUT-1/3 artifacts | US-030 | T-050/050b | E4 US-030 |
| FR-MODE-1 explain | US-031 | T-051/064 | E4 US-031 |
| FR-IF-1 CLI | US-050 | T-060/061a/b/c | E6 US-050 |
| FR-IF-2 MCP | US-051 | T-062a/b/c | E6 US-051 |
| FR-IF-3 runner skill | US-052 | T-063 | E6 US-052 |
| FR-INT-2 GitHub export | US-060 | T-053 | E7 US-060 |
| FR-KB-1/2/4 KB | US-070 | T-046/047s/047c | E8 US-070 |

(Committed/should features — Vue/Svelte adapters, 2nd backend, overlays, baseline/SARIF/Checks/
redaction/patches, walkthrough, dual-theme, Linear/Jira, multi-model, verdict — each likewise
traces story→task→test per `task-coverage.json`.)

## Backward chain (no orphan tasks)

Every task T-001..T-072 cites a story or an architecture component (W0/W1 foundations cite the
schema/state/orchestrator components; all others cite a US). No task lacks an upstream driver.

## Orphan checks

- **PRD features with no story:** none (review-user-stories established full coverage; deferred
  §14 items intentionally have no story).
- **Stories with no task:** none (`task-coverage.json` uncovered=[] after review-tasks).
- **Tasks with no test:** none — every code task references a `tests/acceptance/` skeleton or a
  determinism/contract test type (ADR-015).
- **ACs with no test:** none — `[US-xxx][ACn]` tags cover every AC (story-tests-map).

## Disposition: PASS — full bidirectional traceability; proceed.
