<!-- scaffold:review-domain-modeling v1 2026-05-31 -->

# Review Report: Domain Model (`docs/domain-models/`)

## Executive Summary

The domain model (8 files: index + 7 bounded contexts) was reviewed across 7 passes by three
independent reviewers — Claude (this agent, all passes), **Codex** (full structured review,
gate: *fail*), and **Gemini** (gate: *conditional-pass*; required two attempts due to CLI
flakiness). Reviewers converged strongly. **15 findings were actioned (11 P1, 4 P2)** plus 3
P3 items noted-but-deferred. All P0/P1 and the actionable P2s are fixed and re-validated.
**Final gate: CONDITIONAL PASS** — the decisions/ADRs phase can proceed; handoff notes below.

Reviewer raw outputs: `domain-modeling/codex-review.json`, `domain-modeling/gemini-review.json`,
synthesis in `domain-modeling/review-summary.md`. Claude pass notes are folded into the
findings table below.

## Findings by Pass (reconciled across reviewers)

| # | Sev | Pass | Finding | Reviewer(s) | Location |
|---|---|---|---|---|---|
| F1 | P1 | Aggregate / Entity-VO | Waiver's `ignored` overwrote detection `FindingStatus`, so an expired waiver could not deterministically restore the prior status (LOOP-I6 untestable) | Codex | closed-loop |
| F2 | P1 | Invariant testability | FND-I2 referenced a non-existent field `presentedAsMeasured` → not runtime-checkable | Codex | findings |
| F3 | P1 | PRD Coverage | `GatePolicy` fails on "measured P0/P1" but `Dimensions.severity` is a 0..1 scalar with no P-band → FR-RULE-4 unimplementable | Codex | findings/reporting |
| F4 | P1 | Entity-VO / Aggregate | `Finding` and `TrackedFinding` both modeled as lifecycle aggregates → duplicated lifecycle ownership | Codex | findings/closed-loop |
| F5 | P1 | Domain events | `FindingDetected` payload (ids only) insufficient to construct a `Finding` downstream | Codex | evaluation |
| F6 | P1 | Domain events | Missing events: `CaptureUnreachable`, `StageAdvanced`, `AuditRunFailed`, `LensSkipped`, `Validation{Requested,Completed}` | Codex + Claude | capture/evaluation/closed-loop |
| F7 | P1 | Bounded-context integrity | `SurfaceConfig` was a coupling hub importing types from 4 contexts | Codex + Claude | project-state |
| F8 | P1 | PRD Coverage | Coverage claim "every feature maps to a domain" contradicted FR-IF being adapter-only | Codex | index |
| F9 | P1 | Invariant testability | CAP-I3 (auth-before-navigation) unverifiable from a lone `authUsed: boolean` | Codex | capture |
| F10 | P1 | Bounded-context integrity | `DegradationReport.affectedLenses` leaked Evaluation's lens concept into Capture | Gemini | capture |
| F11 | P1 | PRD Coverage | `Persona` / `TaskDefinition` not modeled despite FR-CAP-4 / FR-PIPE-2,10 / US-014 | Claude | evaluation |
| F12 | P2 | Invariant testability | EVAL-I7 "measured-wins" was a policy statement, not a checkable invariant | Codex | evaluation |
| F13 | P2 | Domain concepts | Multi-model reconciliation (FR-SCORE-5) not a first-class domain service | Gemini | findings |
| F14 | P2 | Ubiquitous language | `FindingDraft` used in evaluation but absent from the glossary | Gemini | index |
| F15 | P2 | PRD Coverage / Aggregate | `RouteInventory`/skip-reporting (FR-PIPE-3, NFR-SCALE-1) unmodeled; `runHistory` bloat risk; `DecisionLogEntry` mis-classed; `alternatives` (FR-IF-4) unhomed | Claude | evaluation/project-state/reporting |
| N1 | P3 | — | Storybook capture (FR-CAP-5), Opportunity map (FR-OUT-2), `PipelineOrchestrator` split (Gemini) — noted as intentionally deferred | Gemini + Claude | index |

## Fix Plan (executed)

- **Batch 1 — trust/correctness invariants (P1: F1, F2, F3, F4):** separate detection
  `FindingStatus` from orthogonal `GateDisposition`; rewrite FND-I2 to derive the label from
  `method` only (assert in Reporting RPT-I9); add `SeverityBand` (P0–P3) and gate on it
  (RPT-I10, FR-RULE-4); reclassify `Finding` as an immutable per-run occurrence with
  `TrackedFinding` owning the lifecycle; narrow the shared kernel.
- **Batch 2 — events & payloads (P1: F5, F6):** `FindingDetected` carries the full
  `FindingDraft`; add the missing capture/run/validation events.
- **Batch 3 — boundaries (P1: F7, F10):** split `SurfaceConfig` into per-context slices stored
  by Project State behind an ACL; remove `affectedLenses` from Capture (Evaluation derives it).
- **Batch 4 — coverage & testability (P1: F8, F9, F11; P2: F12, F13, F14, F15):** clarify the
  FR-IF coverage note; add `TargetVerification` for CAP-I3; add `Persona`/`TaskDefinition`,
  `RouteInventory`+`RoutesSkipped`, `SynthesisDecision`, `ReconciliationService`; glossary
  `FindingDraft`; bound `runHistory`; `DecisionLogEntry`→value object; home `alternatives`.

## Fix Log

| Batch | Findings | Changes | New issues |
|---|---|---|---|
| 1 | F1–F4 | closed-loop: `GateDisposition` axis + state machine + LOOP-I5/I6; findings: `SeverityBand`, `Finding` as occurrence, FND-I2/I4 rewrite, narrowed kernel; reporting: RPT-I9/I10, gate on band | None |
| 2 | F5, F6 | evaluation: full-draft `FindingDetected`, +`StageAdvanced`/`LensSkipped`/`AuditRunFailed`/`RoutesSkipped`; capture: +`CaptureUnreachable`; closed-loop: +`Validation*` | None |
| 3 | F7, F10 | project-state: `CaptureConfig`/`EvaluationConfig`/`FindingsPolicy`/`ReportingConfig` slices + ACL note; capture: `DegradationReport` trimmed; evaluation: EVAL-I6 derives lenses | None |
| 4 | F8,F9,F11,F12–F15 | index: FR-IF note, glossary additions, coverage matrix; capture: `TargetVerification`+CAP-I3; evaluation: `Persona`/`TaskDefinition`/`RouteInventory`/`SynthesisDecision`+EVAL-I7,I8; findings: `ReconciliationService`; project-state: bounded `runHistory`, `DecisionLogEntry` VO; reporting: `alternatives` | None |

## Re-Validation Results

Re-ran the consistency, coverage, and bounded-context passes against the edited files:
- `presentedAsMeasured` — **0 occurrences** (phantom field removed).
- `affectedLenses` — **0 occurrences** (boundary leak removed).
- `"ignored"` as a `FindingStatus` value — **0 occurrences** (now a `GateDisposition`).
- `SeverityBand`, `FindingDraft`, `Persona`/`TaskDefinition`/`RouteInventory`, `GateDisposition`
  present in glossary and used consistently across the files that reference them.
- No new P0/P1 findings introduced. Ubiquitous-language pass clean (one term per concept).

## Downstream Readiness Assessment

- **Gate result:** **Conditional Pass** — `adrs` / `system-architecture` may proceed.
- **Handoff notes for the decisions/architecture phase:**
  1. **Interface contracts are owed by `api-contracts`** (CLI verbs+exit codes, versioned MCP
     tool schema, runner-skill mapping). The domain model deliberately does not model them.
  2. **Open algorithm/threshold decisions** (PRD §16) belong to ADRs: confidence-band cutoffs
     (FR-RULE-1), severity→`SeverityBand` thresholds, prioritization weights + MMR params,
     the finding-identity / DOM-drift matching algorithm (FR-RULE-5), and de-duplication
     across modalities. The *contracts* are fixed; the *math* is an ADR.
  3. **`PipelineStage` orchestration** (Gemini P3) is a candidate ADR: keep it on `AuditRun`
     or extract a `PipelineOrchestrator` application service.
  4. **`runHistory` rotation** and the schema-version-migration rule (PS-I7) are
     architecture-relevant persistence decisions.
- **Remaining P2/P3 items:** 0 open P2 (all actioned); 3 P3 deferred-by-design (Storybook
  source, opportunity map, orchestrator split) — logged above, not blocking.
