<!-- scaffold:review-testing v1 2026-05-31 -->

# Review Report: Testing Strategy (`docs/tdd.md`)

> Reviewer: Claude (enhanced single-model — multi-model dispatch reserved for the
> implementation-plan gate; graceful degradation per the meta-prompt). The testing standard
> (`docs/tdd.md`, the project's `tdd-standards` artifact) was audited against the domain
> invariants (`docs/domain-models/`), the verification architecture (ADR-015), and the
> interface contracts (`docs/api-contracts.md`).

## Readiness Status

**PASS** (after fixes). No unresolved P0/P1 — the `operations` step and `implementation-plan`
can proceed.

## Findings by Pass

| # | Sev | Layer / pass | Finding | Resolution |
|---|---|---|---|---|
| T1 | P1 | Coverage gap (contract layer) | `tdd.md` predated ADR-015/api-contracts and did not enumerate the **CLI contract**, **MCP schema snapshot**, or **SARIF validation** release-gating tests | Added "Contract tests" to Non-Negotiable Test Types |
| T2 | P1 | Domain-invariant coverage | the closed-loop invariants added in review (waiver-expiry restoring status — LOOP-I6; gate never on judged/gated/ignored; no agent auto-resolve of `gatedForHuman`) had no test type | Added "Closed-loop status/gate tests" |
| T3 | P1 | Domain-invariant coverage | the **identity-drift fixture corpus** mandated by ADR-010 (unchanged/reordered/moved/attribute-only/collision) was not specified as a test | Added "Identity-drift fixture corpus" |
| T4 | P2 | Coverage gap | band-derivation (`SeverityBand`/`ConfidenceBand`, FND-I4) and multi-model **reconciliation** (FR-SCORE-5) had no test types | Added band-derivation + reconciliation tests |
| T5 | P2 | Performance NFR coverage | NFR-PERF-1 perf gate (quick preset p95<30s) was in ADR-015 but not in the testing standard | Added "Performance gate" test type |
| T6 | P3 | Consistency | the standard didn't name its architectural authority | Added a pointer: ADR-015 is the release-gating-test authority |

## Pass coverage (what was audited)

- **Coverage by layer:** unit / adapter / grounding / capture / pipeline / CLI-MCP — all present
  and mapped to tooling + mock policy. The **contract** layer (CLI/MCP/SARIF) was the gap (T1).
- **Domain-invariant test cases:** determinism, identity, method-integrity, degradation,
  concurrency were present; the **post-review** invariants (T2/T3 closed-loop + identity drift)
  were missing and are now added.
- **Test-environment assumptions:** verified against `dev-setup.md`/CI — Vitest + Playwright,
  `pnpm run check` mirror, capture matrix on changed packages. Consistent.
- **Performance:** NFR-PERF-1 now has an explicit gate (T5).
- **Integration boundaries:** pipeline integration (capture→lenses→findings→backlog→re-audit in
  a temp `.surface/`) and capture/grounding-with-recorded-tool-JSON are defined.

## Fix Log

| Finding | Change to `docs/tdd.md` | New issues |
|---|---|---|
| T1–T6 | added contract tests, closed-loop status/gate tests, identity-drift corpus, band-derivation + reconciliation tests, perf gate, and an ADR-015 authority pointer to "Non-Negotiable Test Types" | None |

## Re-Validation

- Every release-gating contract in ADR-015 now has a corresponding entry in `tdd.md`.
- Every closed-loop invariant added during domain/ADR/api review (waiver-expiry, gate exclusions,
  no-auto-resolve-gated, identity collision/drift) maps to a test type.
- No P0/P1 remain.

## Downstream Readiness

- **Gate:** Pass — `operations` and `implementation-plan` can proceed.
- **Handoff:** the identity-drift fixture corpus and the SARIF/MCP snapshot fixtures are concrete
  test artifacts to be created during implementation (story-tests/build phase).
