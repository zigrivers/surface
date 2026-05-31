<!-- scaffold:review-api v1 2026-05-31 -->

# Review Report: Interface Contracts (`docs/api-contracts.md`)

## Readiness Status

**PASS** (after fixes). The contracts now expose full CLI/MCP parity for analytical/closed-loop
operations, complete error contracts (≥2 domain codes per command/tool), resolved versioning and
idempotency semantics, and domain-faithful payloads. No unresolved P0/P1 remain — downstream
(implementation-plan) can proceed.

## Executive Summary

Reviewed across the API-specific failure modes by three reviewers — Claude (all passes),
**Codex** (7 findings, gate: *fail* — one **P0**), **Gemini** (4 findings, gate:
*conditional-pass*). Reviewers converged on real gaps despite the unusual CLI/MCP/artifact
contract shape. **13 findings actioned (1 P0, 5 P1, 6 P2, 1 P3).** Raw reviews:
`api/codex-review.json`, `api/gemini-review.json`; synthesis `api/review-summary.md`.

## Findings by Pass (reconciled)

| # | Sev | Pass | Finding | Reviewer(s) | Resolution |
|---|---|---|---|---|---|
| P1 | **P0** | Operation coverage | MCP surface missing `surface_diff`/`surface_alternatives`; §9 overclaimed CLI/MCP parity (incl. run/next/init) | Codex(P0)+Gemini(P1)+Claude(P2) | added `surface_diff/_alternatives/_run/_next/_trace`; `init` marked CLI-only; §9 claim scoped |
| P2 | P1 | Error completeness / conflict | several commands had <2 domain codes; `audit` `model_unavailable` was exit-1 in §2 but exit-0 in §6 | Codex+Gemini | ≥2 codes per command/tool; `model_unavailable` = exit-0 degradation (exit-1 only on judged-required `alternatives`) |
| P3 | P1 | Auth/data | auth-state only on `surface_capture`, not `surface_audit`/CLI `audit` | Codex | `authState` added to `surface_audit`/`surface_alternatives`; `--auth-state` on CLI `audit`/`alternatives` |
| P4 | P1 | Idempotency | mutating verbs (`init`/`baseline`/`verdict`/export) unspecified; `findings.json` byte-stable but carries `generatedAt` | Codex+Claude | per-verb idempotency defined; `generatedAt` excluded from byte-stability/determinism corpus |
| P5 | P1 | Payload fidelity | `diff` omitted `regressed`/`identity-broken`; `GateResult`/`Backlog` lacked tracked-finding state | Codex+Claude+Gemini | `diff` covers all 5 statuses; `Backlog`/`GateResult` entries denormalize method/severityBand/status/gateDisposition/executable; `TrackedFinding` read model + `trace` added |
| P6 | P2 | Versioning | bump rules underspecified across CLI/envelope/SARIF/MCP | Codex | added a compatibility table |
| P7 | P2 | Payload fidelity | `storybook` in contract but excluded from domain `Target.kind` / deferred | Codex | marked deferred/experimental, removed from stable v1 `Target.kind` |
| P8 | P2 | Observability | no direct query of a finding's lifecycle state | Gemini | `trace`/`surface_trace` → `TrackedFinding` |
| P9 | P3 | Fidelity | `suggestedPatch` measured-only invariant only in prose | Gemini | inline `// measured-only (FND-I3)` retained at point of reference |

## Fix Plan (executed) & Fix Log

- **Batch 1 — coverage/parity (P0):** added the 5 missing MCP tools; `init` CLI-only; §9 scoped.
- **Batch 2 — errors & conflict (P1):** ≥2 domain codes everywhere; `model_unavailable` resolved
  to exit-0 degradation; expanded §6 catalog.
- **Batch 3 — auth & idempotency (P1):** auth-state on audit/alternatives (CLI+MCP); per-verb
  idempotency; `generatedAt` byte-stability note.
- **Batch 4 — payload fidelity (P1/P2/P3):** `diff` all-statuses; expanded `Backlog`/`GateResult`;
  `TrackedFinding` read model + `trace`; versioning table; storybook deferred; SARIF properties.

No new P0/P1 introduced.

## Re-Validation Results

- `surface_diff`/`surface_alternatives`/`surface_trace`/`surface_run`/`surface_next` present in §3.
- `diff` output now lists `resolved/regressed/introduced/stillFailing/identityBroken` (all 5).
- `Backlog`/`GateResult` entries carry `method`/`severityBand`/`status`/`gateDisposition`;
  `TrackedFinding` read model present (3 refs).
- `model_unavailable` reconciled (exit-0 degradation on audit); versioning compatibility table present.

## Downstream Readiness

- **Gate:** Pass — implementation-plan can proceed with stable CLI/MCP/output contracts.
- **Handoff:** the zod schemas in `core/src/schema` are the authoritative source; this doc is the
  wire contract. The `TrackedFinding`/`Backlog` denormalized read models and the `StateStore`
  write-intent API are implementation-plan/specs items.
- **Remaining P2/P3:** 0 open.
