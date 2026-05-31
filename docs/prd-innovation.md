<!-- scaffold:prd-innovation v1 2026-05-30 -->

# surface — PRD Innovation Log (innovate-prd)

**Date:** 2026-05-30 · **Depth:** 5/5 · **Models:** Claude + Codex + Gemini (multi-model,
deduplicated). Feature-level innovation pass on `docs/plan.md`. UX-polish and
implementation choices were explicitly out of scope. Constraint enforced: **protect the
v1.0 Release Gate** — suggestions default to v1.x-committed or deferred.

## Suggestions & Dispositions

Each disposition is the product owner's decision, captured as a Q/A pair (AskUserQuestion,
2026-05-30T00:00Z — session "innovate-prd").

| # | Suggestion | Category | Cost / Impact | Source | **Disposition** |
|---|-----------|----------|---------------|--------|-----------------|
| I1 | **Baseline & waiver/ignore registry** — snapshot debt; gate fails only on net-new/expired | defensive-gap | mod / high | Codex + Gemini (consensus) | **Accepted — v1.0 committed** → FR-RULE-6 |
| I2 | **Auth/session injection** (`--auth-state`) — capture routes behind login | table-stakes | mod / high | Gemini | **Accepted — ELEVATED to Release Gate** → FR-CAP-8 |
| I3 | **Multi-state capture** — task-flow recipes (committed) + interactive-state discovery (deferred) | missing/ai-native | sig / high | Codex + Gemini | **Accepted — split:** recipes Should (v1.x), auto-discovery deferred → FR-CAP-9 |
| I4 | **SARIF / GitHub Checks / PR annotations** | table-stakes | mod / high | Codex | **Accepted — v1.0 committed** → FR-OUT-4 |
| I5 | **Sensitive-data redaction** in captures + exports | defensive-gap | mod / high | Codex | **Accepted — v1.0 committed** → FR-CAP-11 |
| I6 | **Deterministic fix snippets** (`suggestedPatch` for measured findings) | differentiator | mod / high | Gemini | **Accepted — v1.0 committed** → FR-SCORE-7 |
| I7 | **Human verdict / adjudication loop** (feeds self-grounding) | ai-native | mod / med | Codex | **Accepted — Should (v1.x)** → FR-SCORE-8 |
| I8 | **Dual-theme (light/dark) evaluation** | missing-expected | trivial / med | Gemini | **Accepted — Should (v1.x)** → FR-CAP-10 |
| I9 | **Monorepo / multi-app target resolution** | defensive-gap | mod / med | Claude | **Deferred (v2)** — noted in §14 |

**Q/A record (2026-05-30):**
- Q: Accept I1, I4, I5, I6 as v1.x-committed? **A: Yes (all four).**
- Q: Accept I3, I7, I8 (I9 deferred)? **A: Yes — I3, I7, I8 accepted; I9 deferred.**
- Q: Where does I2 (auth injection) land — gate / v1.x / deferred? **A: Elevate to Release Gate.**

## Reconciliation Notes

- **Strong convergence on a single theme:** both Codex and Gemini independently flagged that
  surface capturing only the static, top-level, unauthenticated route is too shallow — real
  defects hide behind auth, in modals/dropdowns, in post-action states, and in the non-default
  theme. This produced the auth-injection (I2), multi-state-capture (I3), and dual-theme (I8)
  cluster. The owner elevated **I2 to the gate** precisely because the committed SaaS-dashboard
  overlay is unauditable without it.
- **Consensus on baselines (I1):** both models independently raised the same defensive gap —
  without baseline/waiver, a strict gate on a real app fails permanently and gets disabled.
- **Each model's unique value:** Codex — SARIF/PR-annotations (I4), redaction (I5), verdict
  loop (I7); Gemini — auth injection (I2), `suggestedPatch` (I6), dual-theme (I8).
- **Scope discipline held:** only I2 touched the gate (by explicit owner decision); everything
  else is committed/should/deferred, so the v1.0 Release Gate stayed minimal-plus-auth.

## Disagreements
None — suggestions were complementary. The only severity-style divergence was I2's
disposition (Gemini proposed gate; the pass defaulted to v1.x to protect the gate); resolved
by the owner choosing gate.

## Raw Output
`docs/reviews/prd-innovation/{codex,gemini}-review.json` (parsed) and `*.raw.txt`
(originals); `dispatch-prompt.md` (exact input). Synthesis: `review-summary.md`.
