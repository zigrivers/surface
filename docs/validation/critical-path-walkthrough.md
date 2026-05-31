<!-- scaffold:critical-path-walkthrough v1 2026-05-31 -->

# Validation: Critical-Path Walkthrough

> Reviewer: Claude (enhanced). Walks the implementation-plan critical path step-by-step,
> confirming each task's inputs exist before it and the chain actually closes the release gate.

## Result: **PASS** — the critical path is executable end-to-end; every step's prerequisites are produced upstream.

## Walkthrough

Path: `T-001 → T-002 → T-005 → T-010 → T-018 → T-045 → T-059 → T-060 → T-061a → T-071 → T-072`.

| Step | Needs (input) | Produced by | OK? |
|---|---|---|---|
| T-001 scaffold core | — | — | ✓ |
| T-002 zod schemas | core pkg | T-001 | ✓ |
| T-005 interfaces | schemas | T-002 | ✓ |
| T-010 StateStore | config slices + interfaces | T-003,T-005 | ✓ |
| T-018 orchestrator | state + interfaces | T-010,T-005 | ✓ |
| T-045 lens registry/selection | orchestrator + interfaces | T-018,T-005 | ✓ (lenses themselves feed in via W3b, not on the longest chain) |
| T-059 composition factory | full gate plugin set | W2/W3 gate tasks (capture T-020/21/24, grounding T-026, context T-033, model T-019, a11y lens T-040, discovery/overlay T-048/49, KB T-046/47s, renderers T-050, gate T-054a) | ✓ — all are gate-tier and scheduled before W5 |
| T-060 CLI app | composition factory + Result | T-059,T-004 | ✓ |
| T-061a core-loop verbs | CLI app | T-060 | ✓ |
| T-071 closed-loop e2e | verbs + fixtures | T-061a/b,T-070a | ✓ |
| T-072 SC-6 benchmark + perf gate | e2e + fixtures | T-071 | ✓ |

## Gate closure

The release gate closes when **T-071** (audit→fix→re-audit→resolved on a seeded fixture) and
**T-072** (measured contrast/focus/target driven to 0 + median judged severity −1 level + quick
p95<30s) pass. Both sit at the end of the path and transitively require the entire gate-tier set,
so "critical path green" ⇒ "release gate met." No step on the path waits on a committed/should
task (those are off-path).

## Findings: none at P0/P1. (T-045→T-050 false edge was removed in review-tasks; path recomputed.)

## Disposition: PASS — critical path is coherent and closes the gate; proceed.
