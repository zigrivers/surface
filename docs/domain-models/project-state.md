<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Project State

> **Role:** generic / supporting. **Responsibility:** own `.surface/` — the per-project runtime
> state: pipeline progress, the finding-identity registry, resolved configuration, run history,
> and the decisions log. It is the **only** context that writes `.surface/`, and it guarantees
> those writes are atomic, locked, and resumable.
> **Source FRs:** FR-IF-5, FR-METH-1,2 (resolved config), FR-OVL (active overlay), §7
> (concurrency/resumability), NFR-DATA-1. **Stories:** US-010 (records overlay), US-041.

## Ubiquitous language (this context)

`ProjectState`, `SurfaceConfig`, `DecisionLogEntry`, `RunRecord`, `IdentityRegistry`,
`StateLock`. (Canonical in [index.md](./index.md).)

## Entities & value objects

```typescript
// Resolved configuration (.surface/config.yml), merged by precedence:
// CLI flags > env > project config > user config > defaults (cli-architecture KB).
//
// SurfaceConfig is a COMPOSITION of per-context config slices, each OWNED by the context that
// defines its types. Project State stores the serialized whole and exposes each slice as a
// typed read model through an anticorruption boundary — it does not own these types, so
// contexts never couple to each other through a shared config struct (review: Codex P1).
interface CaptureConfig { readonly redactionRules: RedactionRule[]; readonly viewports: Viewport[]; readonly allowlist: string[]; } // owned by Capture
interface EvaluationConfig { readonly preset: Preset; readonly depth: Depth; readonly stack: ("react"|"next"|"vue"|"svelte"|"agnostic")[]; readonly appType?: AppType; } // owned by Evaluation
interface FindingsPolicy { readonly confidenceCutoffs: { assert: number; question: number }; readonly severityCutoffs: Record<SeverityBand, number>; } // owned by Findings (FR-RULE-1,4)
interface ReportingConfig { readonly integrations: ExportTarget[]; readonly gatePolicy: GatePolicy; } // owned by Reporting

interface SurfaceConfig {
  readonly capture: CaptureConfig;
  readonly evaluation: EvaluationConfig;
  readonly findings: FindingsPolicy;
  readonly reporting: ReportingConfig;
}

// Value object — the registry mapping identity keys to their tracked findings (FR-LOOP-2).
interface IdentityRegistry { readonly entries: Record<string /*identityKey*/, AuditRunId /*lastSeen*/>; }

// Value object — an appended, immutable decision record (FR-IF-5 `decisions` log). Has no
// identity or lifecycle of its own (consistent with RunRecord; review: my P2 classification fix).
interface DecisionLogEntry {
  readonly at: Timestamp;
  readonly kind: "config-change" | "gate-policy" | "overlay-selected" | "waiver" | "verdict";
  readonly summary: string;
}

// Value object — one completed run's summary (for re-audit stickiness, SC-2).
interface RunRecord { readonly runId: AuditRunId; readonly at: Timestamp; readonly findingCount: number; readonly status: AuditRunStatus; }

// AGGREGATE ROOT — .surface/state.json. The single consistency boundary for project state.
interface ProjectState {
  readonly version: string;             // schema version (migration-aware)
  readonly currentStage?: PipelineStage; // resumability (US-041)
  readonly identityRegistry: IdentityRegistry;
  readonly runHistory: RunRecord[];
  readonly decisions: DecisionLogEntry[];
}

// Value object — an advisory lock over .surface/ writes (US-041).
interface StateLock { readonly heldBy: string; readonly acquiredAt: Timestamp; }
```

## Aggregate boundary

`ProjectState` is a single aggregate root because everything under it — stage progress,
identity registry, run history, decisions — must be mutated under **one lock** and written
**atomically**. They change together: advancing a stage, recording a run, and updating the
identity registry are one logical transaction at the end of a run; splitting them across
aggregates would risk a half-written state (the exact failure US-041 forbids). `SurfaceConfig`
is a value object resolved at load time (its file `config.yml` is user-authored, not a mutable
aggregate). `DecisionLogEntry`/`RunRecord` are internal — appended, never mutated in place.

> **Bounded write size (review: my P2):** because the whole aggregate is rewritten atomically
> under one lock on every run, an unbounded `runHistory` would make each write grow without
> limit — the exact `state.json` bloat that degraded the tooling building surface. `runHistory`
> is therefore **capped/rotated** (keep the last N `RunRecord`s; older entries roll to an
> append-only `.surface/history.log` outside the locked aggregate). This keeps per-run write
> size bounded while preserving full history for stickiness metrics (SC-2).

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| PS-I1 | all writes to `.surface/` hold a `StateLock` | on any write | reject unguarded write — concurrent runs must not corrupt state (US-041) |
| PS-I2 | every write is atomic (write-temp + rename); no partial state on crash | on write | a half-written `state.json` is a release blocker (§7, coding-standards) |
| PS-I3 | an interrupted run resumes from `currentStage`, not from scratch | on re-invoke | losing progress = bug (US-041) |
| PS-I4 | `decisions` and `runHistory` are append-only | always | reject in-place mutation (audit trail) |
| PS-I5 | nothing under `.surface/captures/` is transmitted without explicit user action | always | block (NFR-DATA-1) — release blocker if defaulted on |
| PS-I6 | `identityRegistry` keys are never reused or rewritten for a different defect | on registry update | a reused key breaks identity (LOOP-I1) |
| PS-I7 | `version` mismatch triggers a migration, never a silent misread | on load | refuse to misinterpret an older schema (the scaffold-version-skew lesson) |

> **PS-I7 note:** this invariant is the domain-level encoding of a real failure we hit on the
> tooling that *builds* surface (a state file written by one engine version being silently
> mis-resolved by a newer one). surface must detect schema-version skew on its own `.surface/`
> state and migrate explicitly rather than collapse the graph.

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `StateInitialized` | `surface init` creates `.surface/` | `{ version }` | Interfaces |
| `ConfigResolved` | config merged by precedence at load | `{ preset, depth, appType }` | all contexts |
| `RunRecorded` | a run completes and is appended to history | `{ runId, status }` | Reporting (stickiness, SC-2) |
| `OverlaySelected` | discovery records the active overlay | `{ runId, appType }` | (recorded per US-010) |

## Bounded-context interface

- **Exposes:** `SurfaceConfig` (read) to every context; the `IdentityRegistry` + `StateLock` to
  Closed Loop; resumable `currentStage` to Evaluation; append APIs for `DecisionLogEntry`/
  `RunRecord`.
- **Consumes:** events from every context (capture progress, run completion, status transitions,
  exports, baselines/waivers/verdicts) — it is the durable sink that makes the loop resumable.
- **Concurrency model:** a single advisory `StateLock` (proper-lockfile) serializes writers;
  readers use the last committed atomic snapshot. This is the generic-domain backbone that lets
  the core contexts stay free of persistence concerns.
