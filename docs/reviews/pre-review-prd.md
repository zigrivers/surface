# Review: surface — PRD (docs/plan.md)

**Date:** 2026-05-30
**Methodology:** deep | depth 5/5
**Status:** INITIAL
**Models:** Claude + Codex + Gemini (reconciled)
**Artifact reviewed:** `docs/plan.md` (v1)

## Findings Summary

- **Total findings: 9** — P0: 0 | P1: 4 | P2: 4 | P3: 1
- **Passes run:** 8 of 8 (Problem Statement Rigor, Persona & Stakeholder Coverage, Feature
  Scoping Completeness, Success Criteria Measurability, NFR Quantification, Constraint &
  Dependency Documentation, Error & Edge Case Coverage, Downstream Readiness)
- **Multi-model dispatch:** Codex (9) + Gemini (4), reconciled with Claude's 8-pass review —
  see `docs/reviews/prd/review-summary.md`
- **Downstream gate (user-stories):** **PASS** (after fixes).

## Findings by Pass

### Pass 1 — Problem Statement Rigor
**F7 (P2)** *[Codex]* — Evidence claims (scanner ~30–40% WCAG coverage; EAA penalties/
enforcement) were stated without citations in the PRD; downstream could inherit unverified
assumptions. **Resolution:** §1 evidence bullets now mark sources (vision/innovate research,
2026-05) and explicitly flag the *builder time-loss magnitude* as a first-party assumption
that SC-1/SC-6 validate. **RESOLVED.**
*(Otherwise strong: specific user groups, falsifiable hypothesis, no solution-prescription.)*

### Pass 2 — Persona & Stakeholder Coverage
**F6 (P2)** *[Codex + Claude]* — P3 bundled three secondary beneficiaries into bullets; the
CI/platform maintainer has distinct goals (gate tuning, noise, config, rollout) not captured.
**Resolution:** promoted **CI/platform maintainer to a full P3 persona** (role, need, behavior,
constraints, success); split remaining beneficiaries into P4 with rationale for lighter detail.
**RESOLVED.** *(Personas are goal-driven; agent-first priority rule preserved.)*

### Pass 3 — Feature Scoping Completeness
**F1 (P1) — headline finding** *[Claude + Codex + Gemini consensus]* — Marking all 4 framework
adapters + both capture backends + MCP + 4 overlays as hard v1.0 Must-Have broke MoSCoW's
critical path, and §3/§8/§15 were internally inconsistent about what blocks release.
**Resolution:** escalated to the product owner (it touched explicit create-prd choices);
owner chose **two-tier Must** — §8 now defines a **v1.0 Release Gate** (React/Next + agnostic
HTML + one capture backend + measured a11y + closed loop + CLI + MCP + generic overlay) and
**v1.0 Committed-non-gating** (Vue/Svelte, second backend, 3 extra overlays). §3 and §15
rewritten to match. **RESOLVED.**

**F9 (P3)** *[Codex]* — "TypeScript CLI" and internal-architecture mirroring read as
implementation decisions. **Resolution:** §11 reframed to require only the *externally-observable*
contract (run/next/status idioms, `.surface/` state, MCP, Scaffold composability) and
explicitly defer language/runtime to tech-stack/architecture. **RESOLVED.**

### Pass 4 — Success Criteria Measurability
**F5 (P2)** *[Codex]* — SC-5 ("single digits") and SC-6 ("severity reduced") lacked exact
targets/sample sizes. **Resolution:** SC-5 → **<10% on ≥100 labeled judged findings**; SC-6 →
**≥5 benchmark apps, contrast/focus/target → 0, median judged severity drops ≥1 level**.
**RESOLVED.** *(Other SCs already had targets + methods.)*

### Pass 5 — NFR Quantification
**F2 (P1)** *[Claude + Codex + Gemini consensus]* — Missing categories: scalability,
availability, **data retention + privacy** (captures may hold PII/source), browser/device
matrix, own-output accessibility; i18n/observability lacked targets. **Resolution:** added
**NFR-SCALE-1** (max routes/run + no silent truncation), **NFR-DATA-1** (local-only by
default, ephemeral captures, no third-party transmission without explicit action),
**NFR-BROWSER-1** (capture/viewport matrix), **NFR-OWNOUT-1** (hold our own output to the
standard we audit), and an explicit **N/A-with-rationale** note for availability/RTO/RPO and
multi-user scaling (local tool). **RESOLVED.**

### Pass 6 — Constraint & Dependency Documentation
**F3 (P1)** *[Claude + Codex + Gemini consensus]* — Dependencies listed without operational
constraints. **Resolution:** §12 replaced with a **dependency table** (status, auth, cost/rate
limits, offline behavior, impact-if-absent) covering Axe/Lighthouse/Playwright/agent-browser/
MCP-SDK/adapters/GitHub/Linear/Jira/model-inference/Codex-Gemini/token-parsers, plus a **BYO-key
contract** (user supplies model credentials; no content leaves without explicit config).
**RESOLVED.**

### Pass 7 — Error & Edge Case Coverage
**F8 (P2)** *[Codex + Gemini + Claude]* — Missing sad paths. **Resolution:** §7 expanded with
integration-export failure (retry/local-fallback/non-zero exit), MCP tool/version errors,
malformed Scaffold artifacts, Storybook failure, **oversized route inventory** (prioritized
subset + explicit report), **LLM context-window overflow** (chunk/subset or measured-only
fallback), and **interrupted/concurrent `.surface/` state** (locking + resumability).
**RESOLVED.**

### Pass 8 — Downstream Readiness for User Stories
**F4 (P1)** *[Codex]* — Core business rules (confidence thresholds, human-gate categories,
status transitions, CI policy, identity inputs) were deferred to §16 open questions, leaving
story acceptance criteria to guesswork. **Resolution:** added **§6.13 Product-level decision
rules** (FR-RULE-1..5) fixing the *behavioral contract* (three confidence bands; human-gate
categories; resolved/still-failing/regressed/identity-broken transitions; default CI gate
policy; identity inputs) while leaving exact algorithms/thresholds open in §16 (now
cross-referenced). **RESOLVED.**

## Fix Plan (executed)

| Batch | Theme | Findings | Severity | Status |
|-------|-------|----------|----------|--------|
| 1 | Scope/MoSCoW two-tier (owner-approved) | F1 | P1 | Applied |
| 2 | NFR completeness + privacy | F2 | P1 | Applied |
| 3 | Dependency operational table + BYO-key | F3 | P1 | Applied |
| 4 | Product-level decision rules | F4 | P1 | Applied |
| 5 | Success-criteria precision | F5 | P2 | Applied |
| 6 | Persona detail (CI maintainer) | F6 | P2 | Applied |
| 7 | Problem-statement citations | F7 | P2 | Applied |
| 8 | Error/edge-case coverage | F8 | P2 | Applied |
| 9 | PRD-vs-architecture boundary | F9 | P3 | Applied |

## Re-Validation Results

Re-ran the affected passes against the edited PRD:
- **Pass 3:** §3/§8/§15 now consistent — a single, unambiguous v1.0 Release Gate; MoSCoW
  forces real tradeoffs again. Tech prescriptions confined to externally-observable scope. ✓
- **Pass 5:** all checklist categories now either quantified or marked N/A-with-rationale. ✓
- **Pass 6:** dependency table gives downstream phases auth/cost/limit/offline per dependency. ✓
- **Pass 8:** FR-RULE-1..5 give product-level rules sufficient to write acceptance criteria. ✓
- **Passes 1,2,4,7:** targeted fixes resolved; no regressions. ✓

**No new P0/P1 findings introduced.** No second cycle required.

## Downstream Readiness Assessment
- **Gate result:** **PASS** — `user-stories` can proceed.
- **Handoff notes for `user-stories`:**
  1. Write stories against the **v1.0 Release Gate** first (§8); treat Committed-non-gating
     items as a second story tranche.
  2. Use **FR-RULE-1..5** (§6.13) as the source of acceptance-criteria business rules; the
     exact thresholds remain open (§16) but the behavior is fixed.
  3. Keep **P1 (agent) and P2 (builder) personas distinct** per the priority rule; P3 (CI
     maintainer) owns the gate-tuning stories.
  4. **Team size / timeline is still an assumption** (§11/§16) — confirm to finalize sizing.
- **Remaining items:** none deferred — all 9 findings resolved. §16 retains *algorithm-level*
  open questions (now product-bounded), appropriate for ADRs/architecture/specs.
