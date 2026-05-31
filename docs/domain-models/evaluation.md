<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Evaluation (pipeline & lenses)

> **Role:** core. **Responsibility:** run the depth-aware pipeline over a set of `Capture`s —
> classify the app type, activate the right `Overlay`/`Preset`, walk the `Lens`es, and emit
> `Finding`s (whose canonical schema is owned by the [Findings](./findings.md) context).
> Evaluation decides *what to check and how thoroughly*; Findings owns *what a finding is*.
> **Source FRs:** FR-PIPE-1..14, FR-LENS-1..5, FR-OVL-1..4, FR-METH-1..4. **Stories:** US-010..014.

## Ubiquitous language (this context)

`AuditRun`, `Lens`, `EvaluationMethod`, `AppType`, `Overlay`, `Preset`, `Depth`,
`LensResult`. (Canonical definitions in [index.md](./index.md).)

## Entities & value objects

```typescript
// Value object — thoroughness scale (FR-METH-1).
type Depth = 1 | 2 | 3 | 4 | 5;

// Value object — who the UI is evaluated as (FR-CAP-4, FR-PIPE-2). Ingested from context
// inputs or established minimally. Drives the cognitive-walkthrough lens (FR-PIPE-10, US-014).
interface Persona { readonly id: string; readonly goals: string[]; readonly priorKnowledge: "first-time" | "returning" | "expert"; }

// Value object — a task the persona is trying to complete (FR-CAP-4, FR-PIPE-2). A TaskDefinition
// with declared steps becomes a task-flow recipe for multi-state capture (FR-CAP-9).
interface TaskDefinition { readonly id: string; readonly persona: Persona; readonly steps: string[]; readonly conversionCritical: boolean; }

// Value object — what the run will evaluate and what it had to skip (FR-PIPE-3, NFR-SCALE-1).
// Capping is explicit and reported — never a silent truncation (§7).
interface RouteInventory {
  readonly evaluated: string[];        // routes/views actually evaluated
  readonly skipped: string[];          // routes beyond the depth/preset cap
  readonly cap: number;                // max routes/views for this run (NFR-SCALE-1)
}

// Value object — how a measured/judged disagreement was resolved (EVAL-I7, §7). Measured wins
// for measured facts; the record makes that decision auditable rather than implicit.
interface SynthesisDecision { readonly factKey: string; readonly sourceOfTruth: "measured" | "judged"; readonly reason: string; }

// Value object — named lens-set + threshold bundle (FR-METH-2,3).
type Preset =
  | "quick" | "mvp" | "standard" | "deep" | "accessibility-first" | "agent-ready"
  | "conversion-focused" | "design-system-focused" | "custom";

// Value object — classified archetype (FR-PIPE-1, FR-OVL-1..3). "generic" is the baseline.
type AppType = "generic" | "saas-dashboard" | "e-commerce" | "marketing" | "admin" | "content-media";

// Value object — the acceptance-criteria set an AppType activates (FR-OVL-1, FR-LENS-4).
interface Overlay {
  readonly appType: AppType;
  readonly lensCriteria: Record<LensId, AcceptanceCriteria>; // what "good" means per lens
}

// Value object — one evaluation perspective. method is intrinsic to the lens (FR-LENS-1,5).
interface Lens {
  readonly id: LensId;                         // e.g. "accessibility", "visual-hierarchy"
  readonly method: EvaluationMethod;           // "measured" | "judged"
  readonly requiresModel: boolean;             // judged lenses require a configured model
  readonly requiresLiveDom: boolean;           // some measured lenses need a DOM snapshot
}

type EvaluationMethod = "measured" | "judged";

// Value object — the outcome of one lens over one capture, before synthesis into a Backlog.
interface LensResult {
  readonly lensId: LensId;
  readonly method: EvaluationMethod;
  readonly findings: FindingDraft[];           // becomes Finding[] in the Findings context
  readonly skipped?: { reason: string };       // e.g. "no model configured" (US-012)
}

// AGGREGATE ROOT — one execution of the pipeline.
interface AuditRun {
  readonly id: AuditRunId;                      // identity; immutable
  readonly captureIds: CaptureId[];             // references by ID across the context boundary
  readonly appType: AppType;                    // assigned in discovery (US-010)
  readonly overlay: Overlay;
  readonly preset: Preset;
  readonly depth: Depth;
  readonly personas: Persona[];                 // FR-PIPE-2 (ingested or minimal)
  readonly tasks: TaskDefinition[];             // FR-PIPE-2; drives walkthrough/conversion lenses
  readonly inventory: RouteInventory;           // FR-PIPE-3, NFR-SCALE-1
  readonly stage: PipelineStage;                // current stage in the sequence
  readonly lensResults: LensResult[];
  readonly synthesisDecisions: SynthesisDecision[]; // measured-wins record (EVAL-I7)
  readonly status: AuditRunStatus;
  readonly startedAt: Timestamp;
}

// The FR-PIPE-1..14 sequence as an ordered state machine.
type PipelineStage =
  | "discovery"          // FR-PIPE-1: app-type classification
  | "persona-task"       // FR-PIPE-2
  | "inventory"          // FR-PIPE-3: route/view inventory
  | "capture"            // FR-PIPE-4: delegates to the Capture context
  | "lens-evaluation"    // FR-PIPE-5..12: heuristic/a11y/design/content/responsive/...
  | "synthesis"          // FR-PIPE-13: → Backlog (Findings context)
  | "validation";        // FR-PIPE-14: → Closed Loop context

type AuditRunStatus = "running" | "completed" | "degraded" | "failed";
```

## State machine (pipeline)

```
discovery → persona-task → inventory → capture → lens-evaluation → synthesis → validation
```

Stages run in order; each is gated by the previous completing. `lens-evaluation` may mark
the run `degraded` (e.g., judged lenses skipped — no model) without failing it. A capture
that is `unreachable`/`auth-failed` degrades the lenses that needed live DOM but does not
abort measured-on-static lenses (FR-CAP-6, §7).

## Aggregate boundary

`AuditRun` is the root; `LensResult`s are internal. They share a consistency boundary because
the run's `appType`, `overlay`, `preset`, and the set of `LensResult`s must agree: a finding
tagged to a lens that the active overlay didn't activate would be inconsistent. `Capture`s are
referenced by `CaptureId` (separate aggregate, separate lifecycle — captures persist and can
feed multiple runs). `Finding`s produced here cross into the Findings aggregate via the
published `Finding` schema — Evaluation emits `FindingDraft`s; it does not own scored findings.

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| EVAL-I1 | every `FindingDraft` sets `method` ∈ {measured, judged} | on emit | reject the draft (FR-LENS-5) |
| EVAL-I2 | a `measured` `FindingDraft` carries ≥1 tool-result `Evidence` | on emit | reject — never synthesize a measurement (vision #2, coding-standards) |
| EVAL-I3 | a `judged` lens with `requiresModel` runs **only** if a model is configured | before lens runs | skip lens, set `LensResult.skipped`, report "judged coverage unavailable" (US-012) |
| EVAL-I4 | `appType` is always assigned; absence of a match ⟹ `"generic"` | end of discovery | default to `generic` and record it (US-010) |
| EVAL-I5 | the active `Lens` set equals what `overlay` + `preset` prescribe | start of lens-evaluation | reject mismatched lens set (US-013) |
| EVAL-I6 | a `requiresLiveDom` measured lens runs only on a `Capture` that has a live DOM; Evaluation derives the affected lens set from the capture's `skippedArtifacts` | per lens | skip + record; Capture never names lenses (boundary, Gemini P1); never measure from absent DOM |
| EVAL-I7 | a measurement disagreeing with a model judgment resolves **measured-wins**, recorded as a `SynthesisDecision` with `sourceOfTruth==="measured"` | at synthesis | reject a judged override of a measured fact; the decision must be auditable (§7) |
| EVAL-I8 | `inventory.skipped` non-empty ⟹ the run reports it (no silent truncation) | end of inventory | emit `RoutesSkipped`; failing to report skipped routes is a bug (NFR-SCALE-1, §7) |

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `AppTypeClassified` | discovery assigns an `AppType` | `{ runId, appType, overlayId }` | Project State (recorded in state.json, US-010) |
| `RoutesSkipped` | inventory cap exceeded | `{ runId, skipped, cap }` | Reporting (explicit "not evaluated" report, EVAL-I8) |
| `StageAdvanced` | the pipeline enters a new `PipelineStage` | `{ runId, from, to }` | Project State (resumability, US-041) |
| `AuditRan` | a lens completes over a capture | `{ runId, lensId, method, findingCount }` | Findings, Reporting |
| `LensSkipped` | a lens cannot run (no model / no live DOM) | `{ runId, lensId, reason }` | Reporting (states reduced coverage, US-012) |
| `FindingDetected` | a lens emits a `FindingDraft` | `{ runId, draft: FindingDraft }` (the **full** draft — Findings builds a Finding without reaching back into Evaluation; review: Codex P1) | Findings (scoring) |
| `AuditRunCompleted` | all stages done | `{ runId, status, lensResults }` | Findings (synthesis), Closed Loop (validation) |
| `AuditRunDegraded` | a lens/capture forced a reduced run | `{ runId, reason, skippedLensIds }` | Reporting (states reduced coverage) |
| `AuditRunFailed` | a stage failed unrecoverably | `{ runId, stage, error }` | Interfaces (exit code), Project State |

## Bounded-context interface

- **Consumes:** `Capture` read models (from Capture); `SurfaceConfig` (preset/depth/app-type
  hints) and the resolved `Overlay` registry (from Project State); relevant `KnowledgeEntry`s
  by relevance (from Knowledge Base, injected per lens/step — FR-KB-1).
- **Exposes:** `FindingDraft`s and `AuditRun` read model to the Findings context (published
  language: the `Finding` schema). The `validation` stage hands off to Closed Loop (FR-PIPE-14).
- **Anticorruption:** stores only `KnowledgeEntryId` citations on a draft, not the entry body
  (the entry can be revised/refreshed independently — Knowledge Base owns it).

## Cross-context flow — lens evaluation with degradation (sequence)

```
AuditRun                 Knowledge Base        Capture            Findings
   │ for each Lens in overlay∩preset:           │                   │
   ├── relevant entries? ──►│ (cited entries)    │                   │
   │◄───────────────────────┤                    │                   │
   ├── lens.requiresModel && no model? ── skip, LensResult.skipped (US-012)
   ├── lens.requiresLiveDom && capture.degraded? ─ skip, add to degradation (EVAL-I6)
   ├── else run lens over Capture artifacts ◄────┤                   │
   ├── FindingDraft[] (method set, evidence) ─────────────────────►│ (scoring)
   └── AuditRunCompleted ──────────────────────────────────────────► synthesis → Backlog
```
