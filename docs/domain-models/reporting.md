<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Reporting & Integrations

> **Role:** supporting. **Responsibility:** render findings/backlog into human + machine
> artifacts, enforce the CI-gate policy, and export the backlog to external trackers —
> always keeping **local artifacts as the source of truth** and **never losing a finding**.
> **Source FRs:** FR-OUT-1..4, FR-INT-2,3, FR-MODE-1,2, FR-RULE-4. **Stories:** US-030, US-032,
> US-050 (output contract), US-060, US-061.

## Ubiquitous language (this context)

`Report`, `Reporter`, `ReportFormat`, `IssueExport`, `ExportTarget`, `GatePolicy`,
`GateResult`. (Canonical in [index.md](./index.md).)

## Entities & value objects

```typescript
type ReportFormat = "findings-md" | "findings-json" | "backlog" | "agent-plan" | "validation-report" | "sarif";

// Value object — a rendered artifact written under .surface/ (FR-OUT-1).
interface Report {
  readonly format: ReportFormat;
  readonly path: string;                // local artifact = source of truth (FR-OUT-1)
  readonly byteStable: boolean;         // findings-json must be byte-stable (NFR-CLI-1)
}

// Domain service — renders findings into a Report. Stateless; one per format.
//   render(findings: Finding[], backlog: Backlog, fmt: ReportFormat): Report

type ExportTarget = "github" | "linear" | "jira";

// Value object — the tunable CI gate policy (FR-RULE-4, config-as-code).
interface GatePolicy {
  readonly failOn: "new-measured-p0-p1";  // default (FR-RULE-4)
  readonly thresholds: Record<string, number>; // tunable per team (P3)
  readonly neverFailOn: ("judged" | "gatedForHuman")[]; // always includes both
}

// Value object — the outcome of evaluating a GatePolicy against a run.
interface GateResult { readonly passed: boolean; readonly failingFindingIds: FindingId[]; readonly exitCode: 0 | 1 | 2; }

// AGGREGATE ROOT — an attempt to push the backlog to an external tracker (FR-INT-2,3).
interface IssueExport {
  readonly id: ExportId;
  readonly target: ExportTarget;
  readonly synced: FindingId[];         // successfully created tracker items
  readonly unsynced: FindingId[];       // failed items — written locally, reported (US-060)
  readonly status: "complete" | "partial" | "failed";
}
```

## Aggregate boundary

`IssueExport` is the only aggregate here — it must track `synced`/`unsynced` consistently so a
partial failure can be reported truthfully and retried without duplicating tracker items. A
`Report` is a value object (a rendered file, no lifecycle). `Reporter` and the gate evaluator
are stateless domain services. Reporting holds **no** authoritative state about findings — it
is strictly downstream/read-only over the Findings and Closed Loop aggregates.

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| RPT-I1 | local artifacts are written **before** any external export | on run | export-first = bug; never risk losing findings (FR-OUT-1, US-060) |
| RPT-I2 | `findings-json` is byte-identical for identical input regardless of terminal | on render | nondeterministic json = bug (NFR-CLI-1, NFR-OWNOUT-1) |
| RPT-I3 | human artifacts never rely on color alone; degrade without ANSI | on render | color-only meaning = bug (NFR-OWNOUT-1, US-031) |
| RPT-I4 | no single headline quality number appears in any `Report` | on render | reject (FR-SCORE-4) |
| RPT-I5 | `GatePolicy.neverFailOn` always contains `judged` and `gatedForHuman` | on gate eval | reject a policy that could fail on them (FR-RULE-4) |
| RPT-I6 | on export failure, `unsynced` is written locally and exit code is non-zero | on export | silent loss = bug (US-060) |
| RPT-I7 | default CLI output shows top finding + count; full backlog behind `--all`/`--verbose` | on render | progressive disclosure (US-021/US-030, R-3) |
| RPT-I8 | SARIF output validates against SARIF v2.1.0 schema | on `--export sarif` | reject invalid SARIF (US-032) |

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `ReportGenerated` | a `Report` is written | `{ format, path }` | Project State (run record) |
| `FindingsExported` | an `IssueExport` completes/partials | `{ exportId, target, syncedCount, unsyncedCount }` | Interfaces (exit code), Project State |
| `GateEvaluated` | `surface gate` runs | `{ result, failingFindingIds }` | Interfaces (CI exit code) |

## Bounded-context interface

- **Consumes:** `Finding`/`Backlog` (Findings), `TrackedFinding` status (Closed Loop),
  `GatePolicy` + tracker credentials from `SurfaceConfig` (Project State), cited entries for
  plain-language explanations (Knowledge Base).
- **Exposes:** rendered `Report` artifacts, `GateResult` (drives the CLI/CI exit code,
  NFR-CLI-1), and `IssueExport` results.
- **Retry/backoff (US-060):** export to GitHub/Linear/Jira retries with backoff; on persistent
  failure it falls back to the local backlog, reports unsynced items, and exits non-zero — the
  finding set is never silently truncated (§7).

## Cross-context flow — export with partial failure (sequence)

```
Closed Loop / Findings   Reporting (IssueExport)         External tracker
   │ Backlog + status      │                                  │
   ├──────────────────────►│ write local artifacts FIRST (RPT-I1)
   │                       ├─ for each entry: create item ───►│
   │                       │     success → synced              │
   │                       │     rate-limit/API down → retry w/ backoff
   │                       │     persistent failure → unsynced │
   │                       ├─ FindingsExported (partial)       │
   │                       └─ exit non-zero, report unsynced (RPT-I6, US-060)
```
