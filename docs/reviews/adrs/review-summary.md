<!-- scaffold:review-adrs-summary v1 2026-05-31 -->

# Multi-Model Review Synthesis — review-adrs (depth 5)

## Participants

| Reviewer | Mode | Gate | Findings |
|---|---|---|---|
| **Claude** (this agent) | all 5 passes, inline | conditional-pass | 3 (1 P1, 2 P2/P3) |
| **Codex** (GPT-5) | `codex exec`, structured | conditional-pass | 12 (7 P1, 5 P2) |
| **Gemini** (2.5 Pro) | `gemini -m gemini-2.5-pro -p` | **fail** | 4 (2 P1, 2 P2) |

All three reviewers ran successfully this round (Gemini's explicit-model invocation avoided the
router flakiness seen at the domain-modeling step).

## Reconciliation by agreement class

- **Consensus (all 3 agree → highest confidence, fixed):**
  - **Security/data-handling boundary missing** (A1) → ADR-013. All three independently flagged
    that NFR-SEC-1/NFR-DATA-1/FR-CAP-8/11 demand a recorded boundary; Gemini and Codex both
    rejected the "auth N/A" framing.
  - **Testing/verification architecture missing** (A2) → ADR-015.
- **Majority (2 of 3, fixed):**
  - **Error-handling strategy** (A5/A13): Gemini P1 + Codex P2 → extracted to ADR-014.
  - **Observability** (A9): Codex P2 + Claude P3 → ADR-018.
- **Codex-unique, accepted (all real, fixed):** reporting/export ADR (A3→ADR-016), grounding/lens
  ADR (A4→ADR-017), ADR-008 runner-skill contradiction (A6), ADR-003 capture-retention
  contradiction (A7), ADR-010 anchor collision (A8) + drift criteria (A10), and the two
  dependency-graph omissions (A11, A12). Codex's depth on cross-cutting gaps was the standout
  contribution this round.
- **Gemini-unique, accepted:** the BYO-key usability mitigation (A14) — a P2-persona adoption
  concern neither other reviewer raised → ADR-006 `setup-model` wizard.

## Divergence on gate severity

Gemini graded **fail** (driven by the auth contradiction + missing error/testing strategy);
Codex graded **conditional-pass** (gaps recordable without reworking existing decisions). Both
diagnoses pointed the same direction — *under-recording*, not *wrong decisions*. Reconciled
outcome: the existing 12 ADRs needed no supersession; the fix was **additive** (6 new ADRs) plus
small amendments. Post-fix, no P0/P1 remain → **gate: pass** into system-architecture.

## Net effect

The ADR set grew from 12 → 18 and now covers every architecture-significant decision the
domain model and PRD imply: the trust spine (005), persistence (003), interfaces (007/008),
adapters (009), identity (010), orchestration (012), **plus** the previously-implicit
security (013), error handling (014), verification (015), reporting (016), grounding (017), and
observability (018) decisions. system-architecture now has a complete decision base.
