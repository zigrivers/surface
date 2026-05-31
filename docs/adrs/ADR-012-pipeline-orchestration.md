<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-012: Model pipeline orchestration as an application service, not aggregate behavior

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-002, ADR-005
- **Related:** Evaluation domain (`PipelineStage`); FR-PIPE-1..14; review-domain-modeling (Gemini P3)

## Context

The domain review flagged that `AuditRun.PipelineStage` mixes a core domain concept (applying
lenses to a capture to produce findings) with process orchestration (the step-by-step
`discovery → … → validation` flow). Embedding the workflow in the aggregate risks coupling the
domain to one execution shape and complicates depth/preset-driven stage skipping and
resumability (US-041).

## Decision

Keep the **domain** concern — `Lens` over `Capture` → `FindingDraft` — pure inside the
Evaluation context, and place the **orchestration** (stage sequencing, skip rules by
depth/preset, capture delegation, validation hand-off, emitting `StageAdvanced`/`AuditRunFailed`,
driving resumability via Project State) in a stateless **`PipelineOrchestrator` application
service** in `core`. `AuditRun` records the current stage as state for resumability; the
orchestrator owns the transition logic.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Orchestrator application service (chosen)** | domain stays pure & testable; flow is swappable (depth/preset variants); resumability + stage events live in one place | one more layer to learn |
| **Stages as `AuditRun` aggregate behavior** | fewer moving parts | embeds one workflow in the domain; harder to vary by depth/preset; aggregate grows process logic |
| **Event-choreography (no central orchestrator)** | decoupled | flow becomes implicit/hard to trace and resume — bad fit for a deterministic, resumable CLI run |

## Consequences

- **Positive:** lenses are unit-testable without driving a whole run; depth/preset stage
  variation and resumability are localized; `AuditRun` stays a clean state record.
- **Negative / accepted:** an explicit orchestration layer in `core`.
- **Risk / mitigation:** orchestrator absorbing domain logic → it may sequence and skip stages
  but must not compute findings or scoring (that stays in Evaluation/Findings, ADR-005).

## Team / maintenance

A stateless orchestrator reading `AuditRun.currentStage` and emitting transition events is
straightforward to reason about and resume after interruption (US-041).
