<!-- scaffold:review-api-summary v1 2026-05-31 -->

# Multi-Model Review Synthesis — review-api (depth 5)

## Participants

| Reviewer | Mode | Gate | Findings |
|---|---|---|---|
| **Claude** (this agent) | all passes, inline | conditional-pass | 3 (1 P1, 2 P2) |
| **Codex** (gpt-5-codex) | `codex exec`, structured | **fail** | 7 (1 P0, 4 P1, 2 P2) |
| **Gemini** (2.5 Pro) | `gemini -m gemini-2.5-pro -p` | conditional-pass | 4 (1 P1, 2 P2, 1 P3) |

All three ran successfully. All correctly accepted the no-REST framing (ADR-008) and judged the
CLI/MCP/artifact contracts on their own terms.

## Reconciliation by agreement class

- **Consensus (all 3) — payload fidelity (P5):** `diff` omitted `regressed`/`identity-broken`
  (Claude + Codex), and backlog/gate entries lacked tracked-finding state (Codex + Gemini). The
  fix (all-status `diff`, denormalized entries, `TrackedFinding` read model + `trace`) closes the
  whole cluster.
- **Consensus — MCP coverage (P1, the P0):** Codex (P0) and Gemini (P1) both flagged missing
  `surface_diff`/`surface_alternatives`; Claude flagged it P2. Reconciled to **P0** (the §9 parity
  claim was demonstrably false) and fixed by adding the tools + scoping the claim.
- **Codex-unique, accepted:** the `model_unavailable` exit-code contradiction (a genuine §2↔§6
  conflict), auth-state not wired into `surface_audit`, per-verb idempotency + `generatedAt`
  byte-stability, the versioning table, and the storybook-vs-domain mismatch. Codex again
  contributed the deepest contract-precision findings.
- **Gemini-unique, accepted:** the lifecycle-observability gap → `trace`/`surface_trace`, and the
  inline `suggestedPatch` invariant.

## Divergence

Severity divergence on the MCP-coverage finding (Codex P0 vs Gemini P1 vs Claude P2) — reconciled
to P0 because it invalidated a stated contract guarantee (§9 parity), which is the bar for "breaks
downstream work." No directional disagreement otherwise.

## Net effect

The contracts now have full analytical/closed-loop CLI↔MCP parity (with `init` the one explicit
CLI-only exception), a consistent and complete error catalog with the `model_unavailable`
ambiguity resolved, defined idempotency for every mutating verb, a versioning compatibility
table, and domain-faithful payloads that expose the closed-loop lifecycle (`TrackedFinding`,
all-status `diff`, denormalized backlog/gate entries). Gate: pass into implementation-plan.
