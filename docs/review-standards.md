<!-- scaffold:automated-pr-review v1 2026-05-31 -->

# surface — Code Review Standards (agent-driven)

> Every PR gets an **agent-driven multi-model review** before merge (git-workflow §PR step 2).
> Primary path: `mmr review` (Codex + Gemini + Claude when available) + the Superpowers
> code-reviewer as a 4th channel via `scaffold run review-pr` / `review-code`. Fallback when MMR
> is unavailable: `scripts/cli-pr-review.sh` (Codex + Gemini with manual reconciliation — the
> same pattern used for this project's planning-doc reviews). No GitHub Actions review bot is
> required; the agent runs the review-fix loop locally (local-only repo today).

## Severity definitions (P0–P3)

| Sev | Meaning | Action |
|---|---|---|
| **P0** | Breaks correctness/trust/security: a measured finding becomes nondeterministic (NFR-DET-1); judged-as-measured (ADR-005); default-on exfiltration (NFR-DATA-1); CLI/MCP contract break (NFR-CLI-1/MCP-1); state corruption (US-041) | **Block merge.** Fix before proceeding. |
| **P1** | Significant gap that will cause rework: missing test for a measured producer; unhandled sad path (PRD §7); boundary without zod parse | Fix before merge unless explicitly deferred with an issue. |
| **P2** | Known tech debt: unclear naming, missing doc comment, suboptimal but correct code | Fix if quick; else file a Beads issue. |
| **P3** | Polish: formatting, wording | Optional. |

## Review criteria (surface-specific)

Anchored in `coding-standards.md` + `tdd.md` + the ADRs:

1. **Trust spine (ADR-005):** does every finding-emitter set `method`? Does a `method:"measured"`
   finding carry real tool evidence? Is the rendered label derived only from `method`?
2. **Determinism (SC-4):** does a new measured producer have a determinism test?
3. **Errors (ADR-014):** `Result<T, SurfaceError>` at boundaries; no swallowed errors; actionable
   messages (US-050); throw only at the CLI/MCP edge.
4. **Boundaries (ADR-002):** published-entry-point imports only (no `@zigrivers/surface-core/src/*`); `core`
   imports no leaf; `StateStore` is the sole `.surface` writer.
5. **Security (security-review.md):** execa array-args (no `shell:true`); SSRF allow/deny; no
   secrets/captured-content in logs.
6. **Tests (tdd.md/ADR-015):** new feature → failing test first; adapters → fixture suite;
   CLI/MCP → contract test.
7. **No laziness:** no TODO/stub/"good enough" left behind — file a Beads issue instead.

## Review-fix loop

1. `scaffold run review-pr` (or `scripts/cli-pr-review.sh <base>` fallback) → findings as P0–P3.
2. Fix P0/P1; re-run the review on the new diff.
3. Repeat until no P0/P1 remain; then merge (squash, auto-delete branch).
4. Reconcile divergent model opinions: measured/objective concerns win; subjective/style is P2/P3.
