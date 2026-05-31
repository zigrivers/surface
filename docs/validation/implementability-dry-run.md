<!-- scaffold:implementability-dry-run v1 2026-05-31 -->

# Validation: Implementability Dry-Run

> Reviewer: Claude (enhanced). Simulates an agent picking up representative tasks and checks each
> has everything it needs to execute without architecting — inputs, acceptance, files, tests.

## Result: **PASS** — sampled tasks are agent-executable with no unresolved design decisions.

## Dry-run samples

### T-002 — zod schemas (gate, W0)
- **Inputs present?** ✓ `Finding` shape is fully specified in api-contracts §4 + domain
  findings.md (fields, evidence kinds, bands). The agent transcribes a settled schema.
- **Files ≤3?** ✓ `core/src/schema/{finding,evidence,dimensions}.ts`.
- **Acceptance?** ✓ E3 US-020 red→green; `findings.json` parses.
- **Unresolved decisions?** none — schema is fixed (ADR-005).

### T-024 — auth injection (gate, W2)
- **Inputs?** ✓ FR-CAP-8 + ADR-013 + CAP-I3 (`TargetVerification`) + api-contracts auth-state.
  The agent implements a specified contract (inject before nav; verify landed URL; fail non-zero).
- **Files ≤3?** ✓ within `@surface/capture`.
- **Acceptance?** ✓ E1 US-002 (e2e): never captures login page as target.
- **Unresolved?** none — the SSRF default blocklist is a separate task (T-025a), not a blocker here.

### T-054a — default gate (gate, W4)
- **Inputs?** ✓ FR-RULE-4 fixed: fail on new measured P0/P1 by `SeverityBand`; never judged/gated.
- **Files ≤3?** ✓ `@surface/reporters` GateEvaluator.
- **Acceptance?** ✓ E5 US-042 (gate); baseline-awareness is T-054b (off the gate path).
- **Unresolved?** none — thresholds are config-as-code defaults stated in api-contracts.

### T-061a — core-loop CLI verbs (gate, W5)
- **Inputs?** ✓ api-contracts §2 specifies each verb's args/flags/exit-codes/JSON shape; T-059
  composition factory provides the wired services.
- **Files ≤3?** ✓ now scoped to 6 verbs in one command-group module (after the T-061 split).
- **Acceptance?** ✓ E6 US-050 CLI contract (exit 0/1/2, `--json`).
- **Unresolved?** none.

## Observations

- The **review-tasks splits** (CLI/MCP/KB/fixtures/gate) were what made these dry-runs pass —
  pre-split, T-061/T-062 would have failed "≤3 files / one session."
- Each sampled task references its `tests/acceptance/` skeleton, so TDD has a concrete starting point.

## Findings: none at P0/P1.

## Disposition: PASS — tasks are implementable as written; proceed.
