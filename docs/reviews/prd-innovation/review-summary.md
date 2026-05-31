# Multi-Model Innovation Synthesis: docs/plan.md (PRD)

**Date:** 2026-05-30 · **Depth:** 5/5 · feature-level innovation pass with deduplication.

## Models
| Channel | Status | Suggestions |
|---------|--------|-------------|
| Claude | completed | converged + added I9 (monorepo) |
| Codex CLI | completed | 5 |
| Gemini CLI | completed | 5 |

## Deduplicated suggestions: 8 (Codex 5 + Gemini 5 → 1 consensus merge + 1 cluster overlap)

- **Consensus (multi-model agreement):** Baseline & waivers (Codex "Baselines and waivers" =
  Gemini "Debt Baseline & Won't-Fix Registry") → **I1**.
- **Cluster (same theme, complementary):** capture-depth — Gemini "Auth Session Injection"
  (**I2**), Codex "Task-flow capture" + Gemini "Automated Interaction-State Discovery"
  (**I3**), Gemini "Dual-Theme Evaluation" (**I8**). All target "static top-route capture is
  too shallow."
- **Unique–Codex:** PR annotations/SARIF (**I4**), Sensitive-data redaction (**I5**), Human
  verdict loop (**I7**).
- **Unique–Gemini:** Deterministic fix snippets / `suggestedPatch` (**I6**).
- **Unique–Claude:** Monorepo/multi-app target (**I9**).

## Outcome
8 of 9 accepted (I2 elevated to Release Gate by owner; I1/I4/I5/I6 → v1.0 committed;
I3/I7/I8 → Should/v1.x with I3's auto-discovery half deferred; I9 deferred). Scope discipline
held: only I2 touched the gate, by explicit decision. Full dispositions + Q/A timestamps in
`docs/prd-innovation.md`; PRD updated in §6.13/§6.14, §8, §14, §15.

## Disagreements
None substantive. I2 disposition (gate vs v1.x) resolved by owner → gate.
