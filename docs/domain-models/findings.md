<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Findings & Backlog (core / heart)

> **Role:** core — this is surface's heart. **Responsibility:** own the canonical `Finding`,
> score it, enforce the measured/judged discipline and trust guards, and synthesize a
> prioritized, MMR-diversified `Backlog`. Every other context speaks the `Finding` schema
> defined here.
> **Source FRs:** FR-SCORE-1..8, FR-LENS-5, FR-RULE-1,2, FR-MODE-1, FR-OUT-3. **Stories:**
> US-020..023, US-031.

## Ubiquitous language (this context)

`Finding`, `Evidence`, `Dimensions`, `Location`, `EvaluationMethod`, `ConfidenceBand`,
`SuggestedPatch`, `gatedForHuman`, `Backlog`, `BacklogEntry`, `IssueType`.
(Canonical in [index.md](./index.md).)

## Entities & value objects

```typescript
type EvaluationMethod = "measured" | "judged";

// Value object — what kind of issue this is (stable input to FindingIdentity, FR-RULE-5).
type IssueType = string; // e.g. "contrast-insufficient", "focus-order-broken", "empty-state-missing"

// Value object — canonical severity band (FR-RULE-4). Derived from Dimensions.severity via
// SurfaceConfig thresholds; the SAME term appears in findings.json, reports, and the CI gate.
// This is what GatePolicy evaluates — the 0..1 `severity` scalar is never gated directly.
type SeverityBand = "P0" | "P1" | "P2" | "P3";

// Value object — a lens's pre-scored output, BEFORE the Findings context assigns identity,
// derives the band, and scores it. Transient; carries everything needed to build a Finding
// (it is the published-language payload of FindingDetected — Findings never reaches back into
// Evaluation internals). Reconciliation (FR-SCORE-5) operates over FindingDrafts.
interface FindingDraft {
  readonly draftId: string;             // run-scoped, transient
  readonly lens: LensId;
  readonly issueType: IssueType;
  readonly method: EvaluationMethod;
  readonly title: string;
  readonly rationale: string;
  readonly citedHeuristics: KnowledgeEntryId[];
  readonly evidence: Evidence[];
  readonly rawDimensions: Partial<Dimensions>; // model/tool-provided; finalized at scoring
  readonly location: Location;
}

// Value object — proof. A finding is only as trustworthy as its evidence.
// Discriminated so a "measured" finding can be required to carry a tool-result variant.
type Evidence =
  | { readonly kind: "tool-result"; readonly tool: "axe" | "lighthouse" | "backend"; readonly rule: string; readonly measuredValue: string; readonly threshold?: string }
  | { readonly kind: "dom"; readonly selector: string; readonly elementRef?: string }
  | { readonly kind: "screenshot-region"; readonly artifactId: string; readonly rect: Rect }
  | { readonly kind: "cited-heuristic"; readonly knowledgeEntryId: KnowledgeEntryId };

// Value object — the scoring axes (FR-SCORE-1). All normalized 0..1 unless noted.
interface Dimensions {
  readonly severity: number;            // 0..1
  readonly confidence: number;          // 0..1 — drives ConfidenceBand (FR-RULE-1)
  readonly effort: number;              // 0..1 (higher = more effort)
  readonly userImpact: number;          // 0..1
  readonly businessImpact: number;      // 0..1
  readonly a11yLegalRisk: number;       // 0..1 — boosts priority (EAA, FR-SCORE-2)
  readonly evidenceQuality: number;     // 0..1
  readonly agentImplementability: number; // 0..1
}

// Value object — where the issue lives (feeds Location anchor for identity, FR-RULE-5).
interface Location {
  readonly file?: string;
  readonly component?: string;
  readonly selector?: string;
  readonly elementRef?: string;         // deterministic backend ref (@e1…), preferred anchor
}

// Value object — confidence band (FR-RULE-1). Behavior fixed; numeric cutoffs tunable (§16).
type ConfidenceBand = "assert" | "surface-as-question" | "suppress-unless-deep";

// Value object — a computed deterministic fix. MEASURED findings only (FR-SCORE-7).
interface SuggestedPatch {
  readonly kind: "contrast-hex" | "aria-attribute" | "target-size";
  readonly change: string;              // the concrete edit
}

// IMMUTABLE OCCURRENCE — one evaluated issue produced by one run. A Finding is created once
// (at scoring) and never mutated; its `id` is run-scoped, used only for reference within that
// run's Backlog and Report. It is NOT a lifecycle aggregate — the cross-run lifecycle
// (status transitions, baselines, waivers) belongs to TrackedFinding (see closed-loop.md).
// Treating Finding as immutable keeps the two contexts from owning the same lifecycle twice
// (review: Codex P1 — Entity-vs-VO / aggregate redundancy).
interface Finding {
  readonly id: FindingId;               // run-scoped reference id; never reused
  readonly lens: LensId;
  readonly issueType: IssueType;
  readonly method: EvaluationMethod;    // MUST be set explicitly (FR-LENS-5); SOLE source of the measured/judged label
  readonly title: string;
  readonly rationale: string;           // plain-language (FR-OUT-3, FR-MODE-1)
  readonly citedHeuristics: KnowledgeEntryId[];
  readonly evidence: Evidence[];        // ≥1; constrained by method (see invariants)
  readonly dimensions: Dimensions;
  readonly severityBand: SeverityBand;  // derived from dimensions.severity (FR-RULE-4)
  readonly location: Location;
  readonly confidenceBand: ConfidenceBand;
  readonly gatedForHuman: boolean;      // FR-RULE-2; never auto-executed when true
  readonly suggestedPatch?: SuggestedPatch; // present only when method === "measured"
}

// Internal entity — a Finding reference + its computed rank within one Backlog.
interface BacklogEntry {
  readonly findingId: FindingId;
  readonly priority: number;            // internal ordering only — NOT a headline score
  readonly rank: number;                // 1-based position after MMR selection
  readonly demotedAsDuplicateOf?: FindingId; // MMR near-duplicate demotion (US-021)
}

// AGGREGATE ROOT — the prioritized ordering of one run's findings.
interface Backlog {
  readonly id: BacklogId;
  readonly runId: AuditRunId;
  readonly entries: BacklogEntry[];     // ordered; entries[0] is "the one thing to fix next"
}
```

## Aggregate boundaries

- **`Finding`** is an **immutable occurrence**, not a lifecycle aggregate. It is validated and
  created once at scoring (its invariants are pure functions of its own fields) and never
  mutated thereafter; many findings score in parallel with no locking. Cross-run lifecycle is
  owned by `TrackedFinding` (closed-loop.md) — Findings does not also own a status lifecycle,
  which avoids two contexts owning the same lifecycle (review: Codex P1).
- **`Backlog`** is the aggregate whose root enforces ordering/diversity invariants over
  `BacklogEntry`s (internal entities). It references `Finding`s by ID — it does not own them.
  A `Backlog` and its findings have independent lifecycles: findings exist the moment scoring
  emits them; the backlog is a derived synthesis (FR-PIPE-13) recomputable from the finding set.

## Domain services

- **`ReconciliationService` (FR-SCORE-5, depth 4–5):** stateless. Takes the set of
  `FindingDraft`s that multiple models produced for the *same* underlying issue (matched by a
  candidate `FindingIdentity`) and produces one reconciled `Finding` — confidence adjusted by
  inter-model agreement, evidence merged, and divergence surfaced as a question (FR-RULE-1)
  rather than silently picked. Makes multi-model logic a first-class domain concept
  (review: Gemini P2), not an implementation detail buried in a lens.
- **`scoreFinding(draft, config): Finding`:** pure — derives `dimensions`, `severityBand`,
  `confidenceBand`, and `gatedForHuman` from a `FindingDraft` and the active `SurfaceConfig`.

## Invariants (runtime-checkable) — the project-critical ones

| # | Invariant | Expressed as | On violation |
|---|---|---|---|
| **FND-I1** | a `measured` finding carries ≥1 `tool-result` evidence | `method==="measured" ⟹ evidence.some(e=>e.kind==="tool-result")` | reject — lint/review fails the build (coding-standards, vision #2) |
| **FND-I2** | `method` is the **sole** source of the measured/judged label; the rendered label is derived from `method`, never from a separate flag | `report.methodLabel === finding.method` (asserted in Reporting, RPT-I9) | reject — a judged finding can never be labeled measured (zero-tolerance, NFR-TRUST-1) |
| **FND-I3** | a `suggestedPatch` exists only on measured findings | `suggestedPatch!==undefined ⟹ method==="measured"` | reject — judged findings stay proposed/gated (FR-SCORE-7) |
| **FND-I4** | `confidenceBand` is derived from `dimensions.confidence`, and `severityBand` from `dimensions.severity`, per the configured cutoffs | `confidenceBand === bandFor(confidence) && severityBand === severityBandFor(severity)` | recompute; bands cannot be set independently (FR-RULE-1, FR-RULE-4) |
| **FND-I5** | `gatedForHuman === true` when the change alters meaning/brand/copy/critical-flow OR is a judged finding above the severity threshold | `gatedForHuman === gateRule(finding)` | recompute; a gated finding is **never auto-executed** (FR-RULE-2, FR-LOOP-3) |
| **FND-I6** | every finding has ≥1 `Evidence` | `evidence.length >= 1` | reject — no evidence-free findings (FR-OUT-3) |
| **FND-I7** | a low-confidence (`suppress-unless-deep`) finding is surfaced only at `depth>=4` | rendering rule | hide below depth 4 (FR-RULE-1) |
| **BKL-I1** | no single headline quality number is emitted | `Backlog` exposes ordering only, no scalar score | reject any "overall score" output (FR-SCORE-4, anti-vision) |
| **BKL-I2** | near-duplicate findings are demoted, not dropped | `MMR(entries)` sets `demotedAsDuplicateOf`, keeps the entry | a dropped finding loses evidence — bug (US-021) |
| **BKL-I3** | `entries` is totally ordered by `priority` then MMR diversity | sort invariant | reject unordered backlog |

### Scoring rule (FR-SCORE-2 — candidate; exact weights deferred to specs §16)

```
priority = severity × userImpact × businessImpact × confidence / effortWeight,  boosted by a11yLegalRisk
```

This is **internal ordering only** (BKL-I1). The band/gate decisions (FND-I4, FND-I5) are
independent of the priority number — a high-priority judged finding can still be gated.

### Trust guards (FR-SCORE-3, FR-RULE-1) — the three-band behavior (fixed)

| Band | Condition | Presentation |
|---|---|---|
| `assert` | high confidence | stated as a finding |
| `surface-as-question` | medium confidence | presented as a **question**, not a mandate (US-021) |
| `suppress-unless-deep` | low confidence | shown only at depth 4–5 |

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `FindingScored` | dimensions + band + gate computed | `{ findingId, band, gatedForHuman }` | Backlog synthesis, Closed Loop |
| `FindingGated` | a finding is marked `gatedForHuman` | `{ findingId, reason }` | Reporting, Closed Loop (human gate, FR-LOOP-3) |
| `BacklogProduced` | synthesis completes (FR-PIPE-13) | `{ backlogId, runId, topFindingId, total }` | Reporting (progressive disclosure), Closed Loop |

## Bounded-context interface

- **Consumes:** `FindingDraft`s from Evaluation (raw, method-tagged, evidence-bearing);
  `KnowledgeEntryId`s for cited heuristics; `ConfidenceBand` cutoffs + scoring weights from
  `SurfaceConfig` (Project State).
- **Exposes (published language):** the canonical `Finding` schema and the `Backlog` read
  model — consumed by Closed Loop (wraps each `Finding` as a `TrackedFinding`) and Reporting.
- **`explain <finding-id>` (FR-MODE-1, US-031):** a query returning the finding's plain-language
  `rationale`, cited heuristic (resolved from Knowledge Base), and verifiable `Evidence`.

## Cross-aggregate flow — draft → scored finding → backlog (sequence)

```
Evaluation        Findings (Finding aggregate)         Backlog aggregate     Reporting
  │ FindingDraft[] │                                        │                   │
  ├───────────────►│ validate FND-I1..I6                    │                   │
  │                ├─ deriveBand (FND-I4)                    │                   │
  │                ├─ applyGateRule (FND-I5) ─ FindingGated ─────────────────►  (gate honored)
  │                ├─ FindingScored ──────────────────────►│ synthesize        │
  │                │                                         ├─ priority sort    │
  │                │                                         ├─ MMR demote dups  │
  │                │                                         └─ BacklogProduced ─► top finding + count
```

A `gatedForHuman` finding flows into the Backlog for visibility but is annotated so neither
the agent nor a reporter ever presents it as auto-executable (FR-LOOP-3).
