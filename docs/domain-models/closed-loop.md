<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Closed Loop (identity, status, baselines, verdicts)

> **Role:** core. **Responsibility:** make surface a *loop*, not a report. Give each finding a
> stable identity across runs, transition its status on re-audit, support baselines/waivers so
> the gate is adoptable on debt-laden apps, and record human verdicts that feed self-grounding.
> **Source FRs:** FR-LOOP-1..3, FR-RULE-3,5,6, FR-SCORE-6,8, FR-MODE-2,3. **Stories:**
> US-023, US-040, US-042, US-015 (diff).

## Ubiquitous language (this context)

`FindingIdentity`, `TrackedFinding`, `FindingStatus`, `Baseline`, `Waiver`, `Verdict`,
`SelfGroundingReport`. (Canonical in [index.md](./index.md).)

## Entities & value objects

```typescript
// Value object — the stable key for a finding across runs (FR-RULE-5).
// Derived ONLY from stable inputs; prefers a deterministic element ref where present.
interface FindingIdentity {
  readonly lens: LensId;
  readonly issueType: IssueType;
  readonly locationAnchor: string;      // elementRef (@e1…) preferred; else selector|component|file
}
// identityKey = hash(lens + ":" + issueType + ":" + locationAnchor) — immutable, never reused.

// Value object — lifecycle status of a tracked finding (FR-RULE-3, FR-RULE-6).
type FindingStatus =
  | "new"             // first seen this run
  | "still-failing"   // detected again, validation check still fails
  | "resolved"        // no longer detected AND its validation check passes
  | "regressed"       // was resolved, now detected again
  | "identity-broken" // prior anchor can't be matched (DOM drift) — NEVER silently resolved
  | "ignored";        // accepted debt via an active Waiver (FR-RULE-6)

// Value object — the runnable check that confirms a fix landed (FR-LOOP-1).
interface ValidationCheck {
  readonly kind: "measured-rule" | "re-evaluate-lens";
  readonly expectation: string;         // e.g. "axe contrast rule passes on @e1"
}

// AGGREGATE ROOT — a Finding followed across runs.
interface TrackedFinding {
  readonly identityKey: string;         // identity; stable across runs (FR-LOOP-2)
  readonly identity: FindingIdentity;
  readonly currentFindingId?: FindingId; // the Finding instance in the latest run (if detected)
  readonly status: FindingStatus;
  readonly validation: ValidationCheck;
  readonly firstSeenRunId: AuditRunId;
  readonly lastSeenRunId: AuditRunId;
  readonly history: { runId: AuditRunId; status: FindingStatus }[];
}

// Entity — accepted-debt record (FR-RULE-6).
interface Waiver {
  readonly findingIdentityKey: string;
  readonly reason: string;
  readonly owner: string;
  readonly expiry?: Timestamp;          // when set and passed, the finding re-activates
}

// AGGREGATE ROOT — snapshot of accepted findings the gate measures net-new against (FR-RULE-6).
interface Baseline {
  readonly id: BaselineId;
  readonly takenAt: Timestamp;
  readonly identityKeys: string[];      // findings accepted at snapshot time
  readonly waivers: Waiver[];
}

// Entity — human adjudication of a finding (FR-SCORE-8, US-023).
interface Verdict {
  readonly findingIdentityKey: string;
  readonly decision: "accept" | "reject" | "correct" | "defer";
  readonly rationale: string;
  readonly recordedAt: Timestamp;
  readonly reusePolicy: "this-run" | "this-identity-always";
}

// Value object — surface's own judged-finding reliability (FR-SCORE-6, SC-5).
interface SelfGroundingReport {
  readonly sampleSize: number;          // ≥100 judged findings for SC-5
  readonly judgedFalsePositiveRate: number; // target < 0.10
}
```

## State machine — `TrackedFinding.status`

```
            first detection
                  │
                  ▼
                [new] ───────────────► [still-failing] ◄─┐ (re-detected, check still fails)
                  │  fixed & check passes                 │
                  ▼                                        │ detected again
            [resolved] ──────────────────────────────► [regressed]
                  │
   anchor unmatchable on re-audit (DOM drift) at ANY point
                  ▼
          [identity-broken]   ← reported explicitly; NEVER auto-set to resolved

   any status + active Waiver ─► presented as [ignored] (gate skips it until expiry)
```

The forbidden transition is **`* → resolved` without a matched anchor AND a passing
validation check**. An unmatchable anchor is `identity-broken` (FR-RULE-3) — the single most
important rule in this context, because a silent false "resolved" would let a regression ship.

## Aggregate boundaries

- **`TrackedFinding`** is the root keyed by `identityKey`; its `history` entries are internal.
  Consistency boundary: a status transition must be written atomically with the run reference
  that caused it, so the history can never disagree with the current status.
- **`Baseline`** is a separate aggregate owning its `Waiver`s (they cascade with it — deleting
  a baseline deletes its waivers; they have no independent lifecycle). It references findings by
  `identityKey`, never by object.
- **`Verdict`** is its own small entity; it references a finding by `identityKey` and feeds
  prioritization/self-grounding via events, not by mutating the `Finding` aggregate directly.

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| **LOOP-I1** | identity is stable: same defect ⟹ same `identityKey` across runs | every re-audit | a changed key for an unchanged defect = bug (FR-LOOP-2, SC tests) |
| **LOOP-I2** | unmatchable anchor ⟹ `status === "identity-broken"` | re-audit matching | reject any auto-`resolved` for an unmatched anchor (FR-RULE-3) |
| **LOOP-I3** | `resolved` ⟹ not detected this run **and** `validation` passed | on transition | otherwise `still-failing` (FR-LOOP-1) |
| **LOOP-I4** | `regressed` ⟹ previous status was `resolved` and now detected | on transition | reject illegal transition |
| **LOOP-I5** | a finding with an active (non-expired) `Waiver` is `ignored` for the gate | gate evaluation | gate fails on it = bug (FR-RULE-6) |
| **LOOP-I6** | an expired `Waiver` re-activates the finding | when `now > expiry` | finding returns to its detected status (FR-RULE-6) |
| **LOOP-I7** | `surface gate` fails only on net-new/expired vs `Baseline`, never on judged/gated | gate evaluation | failing on judged/gated = bug (FR-RULE-4, lives in Reporting but asserted here) |
| **LOOP-I8** | concurrent re-audits never corrupt identity registry | always | guarded write via Project State lock (US-041) |

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `ReAuditRan` | a new `AuditRun` completes against an existing identity registry | `{ runId, matched, unmatched }` | Project State, Reporting |
| `FindingResolved` | tracked finding transitions to `resolved` | `{ identityKey, runId }` | Reporting (diff, US-015) |
| `FindingRegressed` | transitions to `regressed` | `{ identityKey, runId }` | Reporting, Interfaces (gate signal) |
| `FindingIdentityBroken` | anchor unmatchable | `{ identityKey, runId, priorAnchor }` | Reporting (explicit report, never silent) |
| `BaselineSnapshotted` | `surface baseline` runs | `{ baselineId, count }` | Project State |
| `WaiverExpired` | `now > waiver.expiry` | `{ identityKey }` | Findings (re-activate), Reporting |
| `VerdictRecorded` | `surface verdict <id>` runs | `{ identityKey, decision }` | Findings (prioritization), self-grounding |

## Bounded-context interface

- **Consumes:** `Finding` + `Backlog` (shared kernel on `Finding`/`FindingIdentity` with the
  Findings context); the identity registry + lock from Project State; human input from
  Interfaces (`surface verdict`, `surface baseline`).
- **Exposes:** `TrackedFinding` read models + status transitions to Reporting; `SelfGroundingReport`
  (FR-SCORE-6); `diff <before> <after>` (US-015) as a query over two runs' tracked findings.
- **The human gate (FR-LOOP-3):** a `gatedForHuman` finding (set in Findings) cannot transition
  to `resolved` via agent action alone — it requires a `Verdict` or human-confirmed validation.

## Cross-context flow — re-audit & status transition (sequence)

```
Evaluation         Closed Loop                         Project State        Reporting
  │ AuditRunCompleted │                                    │ (identity registry)│
  ├──────────────────►│ acquire lock (US-041) ────────────►│                    │
  │                   ├─ for each prior TrackedFinding:     │                    │
  │                   │    match anchor in new run?         │                    │
  │                   │      yes + check passes → resolved ─── FindingResolved ─► diff
  │                   │      yes + still fails   → still-failing                  │
  │                   │      was resolved, back  → regressed ── FindingRegressed ─► gate
  │                   │      no match            → identity-broken ── event ─────► explicit report
  │                   ├─ apply Waivers/Baseline (LOOP-I5..7)│                    │
  │                   └─ persist transitions atomically ───►│ release lock       │
```
