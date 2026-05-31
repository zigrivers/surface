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

// AGGREGATE ROOT — one evaluated issue.
interface Finding {
  readonly id: FindingId;               // identity within a run
  readonly lens: LensId;
  readonly issueType: IssueType;
  readonly method: EvaluationMethod;    // MUST be set explicitly (FR-LENS-5)
  readonly title: string;
  readonly rationale: string;           // plain-language (FR-OUT-3, FR-MODE-1)
  readonly citedHeuristics: KnowledgeEntryId[];
  readonly evidence: Evidence[];        // ≥1; constrained by method (see invariants)
  readonly dimensions: Dimensions;
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

- **`Finding`** is its own aggregate (its invariants involve only itself), referenced
  elsewhere by `FindingId`. It is small on purpose: scoring and gating are pure functions of
  the finding's own fields, so locking is trivial and many findings score in parallel.
- **`Backlog`** is a separate aggregate whose root enforces ordering/diversity invariants over
  `BacklogEntry`s (internal entities). It references `Finding`s by ID — it does not own them.
  A `Backlog` and its findings have independent lifecycles: findings exist the moment a lens
  emits them; the backlog is a derived synthesis (FR-PIPE-13) recomputable from the finding set.

## Invariants (runtime-checkable) — the project-critical ones

| # | Invariant | Expressed as | On violation |
|---|---|---|---|
| **FND-I1** | a `measured` finding carries ≥1 `tool-result` evidence | `m==="measured" ⟹ evidence.some(e=>e.kind==="tool-result")` | reject — lint/review fails the build (coding-standards, vision #2) |
| **FND-I2** | a `judged` finding is never emitted as measured | `m==="judged" ⟹ !evidence.some(e=>e.kind==="tool-result" && presentedAsMeasured)` | reject (zero-tolerance, NFR-TRUST-1) |
| **FND-I3** | a `suggestedPatch` exists only on measured findings | `suggestedPatch!==undefined ⟹ method==="measured"` | reject — judged findings stay proposed/gated (FR-SCORE-7) |
| **FND-I4** | `confidenceBand` is derived from `dimensions.confidence` per the band cutoffs | `band === bandFor(confidence)` | recompute; band cannot be set independently (FR-RULE-1) |
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
