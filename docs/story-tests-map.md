<!-- scaffold:story-tests v1 2026-05-31 -->

# surface — Story → Test Traceability Map

> Every user story (`docs/user-stories.md`) and every acceptance criterion maps to a tagged,
> pending test case. **Consolidation note:** skeletons are grouped **one file per epic** (not
> one file per story) for maintainability; per-story/per-AC traceability is preserved by the
> `[US-xxx][ACn]` tags on each `it.skip`, which the `traceability-matrix` step verifies. Tests
> are `it.skip` (pending) — implemented during TDD (`docs/tdd.md`, ADR-015).

## Story → file → AC → layer

| Story | Tier | Test file | ACs (tag) | Layer |
|---|---|---|---|---|
| US-001 capture/auto-backend | gate | `epic-e1-capture.test.ts` | AC1–3 | integration |
| US-002 capture behind auth | gate | `epic-e1-capture.test.ts` | AC1 (int), AC2 (e2e) | integration/e2e |
| US-003 static & context inputs | gate | `epic-e1-capture.test.ts` | AC1–2 | integration |
| US-004 multi-state/dual-theme | should | `epic-e1-capture.test.ts` | AC1–2 | integration |
| US-005 redaction | committed | `epic-e1-capture.test.ts` | AC1 | unit+integration |
| US-010 classify app type | gate | `epic-e2-pipeline-lenses.test.ts` | AC1 | integration |
| US-011 measured a11y | gate | `epic-e2-pipeline-lenses.test.ts` | AC1 (int), AC2 (unit) | integration/unit |
| US-012 judged lenses | gate | `epic-e2-pipeline-lenses.test.ts` | AC1–2 | integration |
| US-013 lenses flex | gate | `epic-e2-pipeline-lenses.test.ts` | AC1 | integration |
| US-014 walkthrough/conversion | should | `epic-e2-pipeline-lenses.test.ts` | AC1–2 | integration |
| US-015 alternatives/diff | should | `epic-e2-pipeline-lenses.test.ts` | AC1–2 | integration |
| US-020 structured findings | gate | `epic-e3-findings-scoring.test.ts` | AC1 | unit |
| US-021 backlog + trust guards | gate | `epic-e3-findings-scoring.test.ts` | AC1–3 | unit |
| US-022 deterministic patches | committed | `epic-e3-findings-scoring.test.ts` | AC1 | unit |
| US-023 self-grounding/verdict | should | `epic-e3-findings-scoring.test.ts` | AC1–2 | integration |
| US-030 human+machine artifacts | gate | `epic-e4-output-reporting.test.ts` | AC1 | integration |
| US-031 explain | gate | `epic-e4-output-reporting.test.ts` | AC1 (int), AC2 (unit) | integration/unit |
| US-032 SARIF + PR annotations | committed | `epic-e4-output-reporting.test.ts` | AC1 (unit), AC2 (int) | unit/integration |
| US-040 stable identity | gate | `epic-e5-closed-loop.test.ts` | AC1 | integration |
| US-041 concurrency/resumable | gate | `epic-e5-closed-loop.test.ts` | AC1–2 | integration |
| US-042 baseline & waivers | committed | `epic-e5-closed-loop.test.ts` | AC1 (int), AC2 (unit) | integration/unit |
| US-050 POSIX CLI | gate | `epic-e6-interfaces.test.ts` | AC1–2 (e2e), AC3 (unit) | e2e/unit |
| US-051 MCP server | gate | `epic-e6-interfaces.test.ts` | AC1 (int), AC2 (unit) | integration/unit |
| US-052 runner skill | gate | `epic-e6-interfaces.test.ts` | AC1 | integration |
| US-060 GitHub export | gate | `epic-e7-e8-integrations-kb.test.ts` | AC1–2 | integration |
| US-061 Linear/Jira export | should | `epic-e7-e8-integrations-kb.test.ts` | AC1 | integration |
| US-070 cited KB | gate | `epic-e7-e8-integrations-kb.test.ts` | AC1 | unit |
| US-071 multi-model reconciliation | should | `epic-e7-e8-integrations-kb.test.ts` | AC1–2 | integration |

## Coverage summary

- **Stories:** 28 defined (US-001..005, 010..015, 020..023, 030..032, 040..042, 050..052,
  060..061, 070..071) — **all** have a skeleton file + tagged pending tests.
- **Must-have (gate+committed):** 22 stories — every AC has ≥1 tagged pending test (criterion met).
- **Layer assignment:** single-function ACs → unit; cross-component → integration; binary
  contract / full journey → e2e (per ADR-015 + tdd.md). CLI e2e lives in
  `tests/e2e/cli-smoke.e2e.test.ts`.
- **Downstream:** `traceability-matrix` validates the `[US-xxx][ACn]` tags against
  `docs/user-stories.md`; `story-tests` are implemented (red→green) during the build phase.
