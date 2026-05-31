<!-- scaffold:decision-completeness v1 2026-05-31 -->

# Validation: Decision Completeness

> Reviewer: Claude (enhanced). Confirms every architecture-significant decision is recorded in an
> ADR and no implied-but-unrecorded decisions remain.

## Result: **PASS** — 18 ADRs cover every significant decision; open items are explicitly
> scoped as algorithm/threshold tuning (not unrecorded decisions).

## Coverage

The review-adrs pass already expanded the set 12→18, adding the previously-implicit cross-cutting
decisions (security/data, error-handling, verification, reporting, grounding, observability). The
criteria-mandated categories (DB/ORM/deployment/auth/API-style) are recorded N/A with rationale
in the ADR index. Spot-check of decisions referenced elsewhere:

| Decision surfaced in… | Recorded as |
|---|---|
| file-state, no DB | ADR-003 (+ index N/A for DB/ORM) |
| measured/judged trust spine | ADR-005 |
| BYO-key model access | ADR-006 |
| CLI/MCP/skill, no REST | ADR-007/008 (+ index N/A API-style) |
| per-framework adapters | ADR-009 |
| finding identity algorithm | ADR-010 (contract; thresholds open → specs) |
| security/data boundary | ADR-013 |
| error handling | ADR-014 |
| verification/test gates | ADR-015 |
| reporting/export | ADR-016 |
| grounding/lens execution | ADR-017 |
| observability | ADR-018 |
| pipeline orchestration | ADR-012 |

## Open items (recorded as open, not missing decisions)

PRD §16 + ADR-010 explicitly defer **algorithm/threshold** choices (confidence-band cutoffs,
severity→SeverityBand thresholds, prioritization weights/MMR params, DOM-drift tolerance,
de-dup-across-modalities) to specs/implementation. These are *parameter* decisions with the
*contract* already fixed in the ADRs/api-contracts — not unrecorded architecture decisions.

## Findings: none at P0/P1.

## Disposition: PASS — decision record is complete; proceed.
