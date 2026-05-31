<!-- scaffold:review-adrs v1 2026-05-31 -->

# Review Report: ADRs (`docs/adrs/`)

## Executive Summary

The 12-ADR set was reviewed across 5 ADR-specific failure modes by three independent reviewers
— Claude (all passes), **Codex** (12 findings, gate: *conditional-pass*), **Gemini** (4
findings, gate: *fail*). The recorded decisions were sound and the dependency graph acyclic,
but reviewers strongly converged that the set **under-recorded several architecture-significant
cross-cutting decisions** (security/data, error-handling, testing, reporting, grounding,
observability) that the PRD/domain/tech-stack already treat as mandatory. **15 findings actioned
(8 P1, 7 P2):** 6 new ADRs added (ADR-013..018) and 5 existing ADRs amended.
**Final gate: PASS** — system-architecture can proceed.

Raw reviews: `adrs/codex-review.json`, `adrs/gemini-review.json`; synthesis in
`adrs/review-summary.md`.

## Findings by Pass (reconciled)

| # | Sev | Pass | Finding | Reviewer(s) | Resolution |
|---|---|---|---|---|---|
| A1 | P1 | Missing decision | No security/data-handling boundary ADR (NFR-SEC-1/DATA-1, FR-CAP-8/11) | Codex+Gemini+Claude | **ADR-013** added |
| A2 | P1 | Missing decision | No verification/test architecture ADR (determinism, contract, matrix, perf gates) | Codex+Gemini+Claude | **ADR-015** added |
| A3 | P1 | Missing decision | No reporting/export ADR (local-first, SARIF, octokit, retry/backoff, CI gate) | Codex | **ADR-016** added |
| A4 | P1 | Missing decision | No grounding/lens-execution ADR (measured producers, measured-wins, lazy load) | Codex | **ADR-017** added |
| A5 | P1 | Missing decision / Contradiction | No unified error-handling ADR; subsystem→interface error flow unspecified | Gemini(P1)+Codex(P2) | **ADR-014** added |
| A6 | P1 | Contradiction | ADR-008 said "exactly two contracts" but FR-IF-3 runner skill is a third interface | Codex | ADR-008 amended (skill as conversational adapter) |
| A7 | P1 | Contradiction | ADR-003 treated captures as durable/committable; NFR-DATA-1 makes them ephemeral | Codex | ADR-003 amended (retention classes) |
| A8 | P1 | Unresolved trade-off | ADR-010 coarse anchors can collide for same lens+issueType+location | Codex | ADR-010 amended (collision/disambiguation) |
| A9 | P2 | Missing decision | No observability ADR (pino, knowledge-gap signal, privacy-safe logs) | Codex+Claude | **ADR-018** added |
| A10 | P2 | Unresolved trade-off | ADR-010 drift tolerance deferred with no acceptance criteria/revisit trigger | Codex | ADR-010 amended (fixture corpus + criteria) |
| A11 | P2 | Dependency integrity | ADR-010 uses ADR-004's element refs but doesn't depend on it | Codex | ADR-010 + graph fixed |
| A12 | P2 | Dependency integrity | ADR-012 needs ADR-003 (state) for resumability but doesn't depend on it | Codex | ADR-012 + graph fixed |
| A13 | P2 | Missing rationale | Error-handling buried in ADR-005 lacks sad-path taxonomy/mappings | Codex | extracted to ADR-014 |
| A14 | P2 | Unresolved trade-off | ADR-006 BYO-key usability mitigation was only "documentation" | Gemini | ADR-006 amended (`setup-model` wizard) |
| A15 | P1 | Contradiction | Index recorded auth as N/A while MCP/auth-state need a security design | Gemini | index N/A section → points to ADR-013 |

## Fix Plan (executed)

- **Batch 1 — add the 6 missing cross-cutting ADRs (A1–A5, A9):** ADR-013 security/data
  boundary, ADR-014 error handling, ADR-015 verification/test architecture, ADR-016
  reporting/export, ADR-017 grounding/lens execution, ADR-018 observability.
- **Batch 2 — amend existing ADRs (A6, A7, A8, A10, A14):** ADR-008 (runner skill), ADR-003
  (retention classes), ADR-010 (collision + drift criteria), ADR-006 (usability wizard).
- **Batch 3 — dependency/graph integrity (A11, A12, A15):** ADR-010 +ADR-004, ADR-012 +ADR-003,
  index decision-log + dependency graph + N/A section updated.

## Fix Log

| Batch | Findings | Changes | New issues |
|---|---|---|---|
| 1 | A1–A5, A9 | added ADR-013/014/015/016/017/018 (each: context, 3 options, consequences, deps) | None |
| 2 | A6,A7,A8,A10,A14 | amended ADR-008/003/010/006 in place (no supersession needed — none were Accepted-and-binding contradictions, they were gaps) | None |
| 3 | A11,A12,A15 | ADR-010/012 Depends-on; index log+graph+N/A | None |

## Re-Validation Results

- ADR count: **18 ADRs + index** (was 12). All `Depends on` references resolve to existing
  files (checked ADR-001..018). Dependency graph re-checked — acyclic (every edge points to a
  recorded ADR).
- ADR-008 now records the runner skill (no longer contradicts FR-IF-3). ADR-003 distinguishes
  durable vs ephemeral capture data (no longer contradicts NFR-DATA-1). Index N/A section points
  to ADR-013 for the security boundary.
- No new P0/P1 introduced; no ADR contradicts another or tech-stack.md.

## Downstream Readiness Assessment

- **Gate result:** **Pass** — `system-architecture` can proceed; it now has ADRs for security,
  error handling, verification, reporting, grounding, and observability to build components from.
- **Handoff notes:**
  1. The exact `SurfaceError` taxonomy↔exit-code/MCP-error mapping (ADR-014), the SARIF/PR
     annotation shapes (ADR-016), and the lens plugin interface (ADR-017) are detailed in
     `api-contracts`/specs.
  2. ADR-010's drift-tolerance parameters and the identity fixture corpus are an
     implementation-plan/specs task (contract fixed; thresholds open).
  3. The `surface config setup-model` UX (ADR-006) is a specs item.
- **Remaining P2/P3:** 0 open (all actioned).
