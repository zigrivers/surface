<!-- scaffold:domain-modeling v1 2026-05-31 -->

# surface — Domain Model (index & context map)

> Tactical DDD model derived from `docs/plan.md` (PRD) and `docs/user-stories.md`.
> One file per **bounded context**. This index holds the **context map**, the
> **ubiquitous language** glossary (canonical terms — no synonyms anywhere downstream,
> per `coding-standards.md`), and the **PRD-feature → domain** coverage matrix.
>
> The single most important domain rule, present in every context that touches a
> `Finding`: **a `judged` finding is never presented as `measured`, and a `measured`
> finding must carry real tool evidence** (vision principle #2, FR-LENS-5).

## Bounded contexts (one file each)

| # | Context | File | Role | Core invariant it protects |
|---|---|---|---|---|
| 1 | **Capture** | [capture.md](./capture.md) | core | a Capture is honest about what it could and couldn't observe |
| 2 | **Evaluation** | [evaluation.md](./evaluation.md) | core | every Finding declares a `method`; judged lenses need a model |
| 3 | **Findings & Backlog** | [findings.md](./findings.md) | **core (heart)** | measured⇔evidence; judged≠measured; gated never auto-executes; no vanity score |
| 4 | **Closed Loop** | [closed-loop.md](./closed-loop.md) | core | finding identity is stable; an unmatchable anchor is `identity-broken`, never silently `resolved` |
| 5 | **Knowledge Base** | [knowledge-base.md](./knowledge-base.md) | supporting | every cited heuristic resolves to an inspectable, cited, freshness-stamped entry |
| 6 | **Reporting & Integrations** | [reporting.md](./reporting.md) | supporting | local artifacts are the source of truth; an export never loses findings |
| 7 | **Project State** | [project-state.md](./project-state.md) | generic | `.surface/` state is never corrupted by concurrency and is resumable |

Interfaces (CLI / MCP / runner skill, FR-IF-1..3) are **delivery adapters**, not domains:
they translate user/agent intent into the commands listed per context and render the
resulting read models. Their contracts live in `api-contracts`/architecture, not here.

## Context map

```
                         ┌──────────────────────────────────────────────┐
                         │              Project State (generic)           │
                         │  ProjectState · SurfaceConfig · DecisionLog    │
                         │  (resolved config + finding-identity registry) │
                         └───────▲───────────────▲───────────────▲────────┘
        config/overlay/preset    │               │ identity registry      │ run history
                                 │               │                        │
   ┌─────────────┐  Capture   ┌──┴───────────┐  Findings  ┌──────────────┴───┐
   │   Capture   │  artifacts │  Evaluation  │  emitted   │ Findings & Backlog│
   │  (context)  ├───────────►│  (pipeline + ├───────────►│   (core / heart)  │
   │             │            │   lenses)    │  Finding[] │                   │
   └─────▲───────┘            └──────┬───────┘            └────────┬──────────┘
         │ AuthState                 │ relevance request           │ Backlog / Finding[]
         │ (storage-state)           ▼                             │
   ┌─────┴───────┐            ┌──────────────┐            ┌────────▼──────────┐
   │  Interfaces │            │ Knowledge    │ entries    │   Closed Loop     │
   │ CLI/MCP/    │            │ Base (supp.) ├───────────►│ identity · status │
   │ skill (adapt)│           │ KnowledgeEntry│  (cited)   │ baseline · verdict│
   └─────────────┘            └──────────────┘            └────────┬──────────┘
                                                                   │ TrackedFinding[]
                              ┌────────────────────────────────────▼──────────┐
                              │        Reporting & Integrations (supp.)        │
                              │  Report (md/json/sarif) · IssueExport (github) │
                              └────────────────────────────────────────────────┘
```

**Relationship types (DDD):**
- **Capture → Evaluation**: customer–supplier. Evaluation consumes `Capture` read models; Capture has no knowledge of lenses.
- **Evaluation → Findings**: customer–supplier via a **published language** — the `Finding` schema. Evaluation produces `Finding`s; Findings & Backlog owns the canonical `Finding` definition and scoring.
- **Knowledge Base → Evaluation/Findings**: open-host / published language. Lenses request entries by relevance; a `Finding` cites entries by `KnowledgeEntryId`. Anticorruption: findings store the citation id, not the entry body.
- **Findings → Closed Loop**: shared kernel on `Finding` + `FindingIdentity`. Closed Loop wraps a `Finding` as a `TrackedFinding` across runs.
- **Closed Loop / Findings → Reporting**: customer–supplier; reporters are downstream and read-only over findings.
- **Project State**: shared kernel for identity + config consumed by all contexts; the only context that owns writes to `.surface/`.

Solid arrows = direct read-model/data dependency. The Knowledge Base and Project State are
shared services every evaluation touches; they are deliberately kept generic/supporting so
the core (Findings, Closed Loop) stays small and pure.

## Ubiquitous language (canonical glossary)

Every term below is used **with this exact spelling and meaning in all domain files and all
downstream code** (no synonyms, no homonyms — `coding-standards.md` §Naming). Type names are
`PascalCase`; the inferred zod type and the term are the same word.

| Term | Kind | Meaning |
|---|---|---|
| **Target** | value object | what to evaluate: a url, localhost route, screenshot, component/source path, or DOM snapshot |
| **Capture** | aggregate root | the result of observing a `Target` once: a set of `CaptureArtifact`s + metadata |
| **CaptureArtifact** | entity (internal) | one observed output: screenshot, DOM snapshot, accessibility tree, or computed styles |
| **CaptureBackend** | value object | the mechanism used: `playwright` \| `agent-browser` \| `static` |
| **AuthState** | value object | injected session (storage-state) used to reach routes behind a login |
| **DegradationReport** | value object | the explicit list of checks/lenses that could **not** run, and why |
| **AuditRun** | aggregate root | one execution of the pipeline over a set of `Capture`s at a chosen depth/preset |
| **Lens** | value object | one evaluation perspective (accessibility, usability, …); declares its `method` |
| **EvaluationMethod** | value object | `"measured"` (tool-confirmed) \| `"judged"` (model-interpreted) |
| **AppType** | value object | classified archetype (saas-dashboard, e-commerce, marketing, generic, …) |
| **Overlay** | value object | the acceptance-criteria set an `AppType` activates |
| **Preset** | value object | named bundle of lens-set + thresholds (`quick`…`agent-ready`) |
| **Depth** | value object | thoroughness scale 1–5 |
| **Finding** | aggregate root | one evaluated issue: method, evidence, dimensions, location, gating |
| **Evidence** | value object | proof for a finding: tool result, DOM selector/element-ref, screenshot region, or cited heuristic |
| **Dimensions** | value object | the scoring axes (severity, confidence, effort, userImpact, businessImpact, a11yLegalRisk, evidenceQuality, agentImplementability) |
| **Location** | value object | where the issue lives: `{ file?, component?, selector? , elementRef? }` |
| **ConfidenceBand** | value object | `assert` \| `surface-as-question` \| `suppress-unless-deep` |
| **SuggestedPatch** | value object | a computed, deterministic fix for a **measured** finding only |
| **gatedForHuman** | attribute (boolean) | finding alters meaning/brand/copy/critical-flow or is a high-severity judged finding → never auto-executed |
| **Backlog** | aggregate root | the prioritized, MMR-diversified ordering of a run's findings |
| **BacklogEntry** | entity (internal) | a `Finding` reference plus its computed priority rank within a `Backlog` |
| **FindingIdentity** | value object | stable key = `lens` + `issueType` + `locationAnchor` (preferring a deterministic element ref) |
| **TrackedFinding** | aggregate root | a `Finding` followed across runs, carrying a `FindingStatus` |
| **FindingStatus** | value object | `new` \| `still-failing` \| `resolved` \| `regressed` \| `identity-broken` \| `ignored` |
| **Baseline** | aggregate root | a snapshot of accepted findings; the gate fails only on net-new/expired relative to it |
| **Waiver** | entity | accepted-debt record: `{ findingId, reason, owner, expiry? }`; expiry re-activates the finding |
| **Verdict** | entity | human adjudication of a finding: `accept` \| `reject` \| `correct` \| `defer`, with rationale |
| **KnowledgeEntry** | aggregate root | a best-practice catalog entry with `## Summary`/`## Deep Guidance`, `Citation`, `Freshness` |
| **Citation** | value object | the cited source backing a knowledge entry / heuristic |
| **Freshness** | value object | volatility + last-reviewed metadata for a `KnowledgeEntry` |
| **Report** | value object | a rendered artifact (`findings.md`, `findings.json`, backlog, agent plan, validation report) |
| **Reporter** | domain service | renders findings into a `Report` format (md / json / sarif / github) |
| **IssueExport** | aggregate root | an attempt to push the backlog to an external tracker; tracks synced/unsynced items |
| **ProjectState** | aggregate root | `.surface/state.json` — pipeline progress + the `FindingIdentity` registry + run history |
| **SurfaceConfig** | value object | resolved `.surface/config.yml` — preset/depth/stack/app-type/integrations |
| **DecisionLogEntry** | entity | an appended record of a config or gating decision |

## PRD feature → domain coverage (every feature maps to ≥1 domain)

| PRD area | Domain(s) |
|---|---|
| FR-CAP-1..11 (inputs, capture, auth, redaction, degradation) | Capture |
| FR-PIPE-1..14 (pipeline stages) | Evaluation (+ Closed Loop for 14) |
| FR-LENS-1..5 (lenses, method tag, evidence) | Evaluation + Findings |
| FR-KB-1..5 (knowledge base) | Knowledge Base |
| FR-OVL-1..4 (app-type overlays) | Evaluation (+ Project State for active config) |
| FR-METH-1..4 (presets, depth) | Evaluation (+ Project State) |
| FR-SCORE-1..8 (findings, scoring, trust, multi-model, self-grounding, verdict) | Findings (+ Closed Loop for verdict/self-grounding) |
| FR-OUT-1..4 (artifacts, plain-language, SARIF/PR) | Reporting & Integrations |
| FR-LOOP-1..3 (closed loop, identity, human gate) | Closed Loop (+ Findings for gate) |
| FR-IF-1..5 (CLI, MCP, skill, `.surface/`) | Interfaces (adapters) + Project State (FR-IF-5) |
| FR-INT-1..5 (Axe/Lighthouse, GitHub/Linear/Jira, token parsers) | Capture/Evaluation (grounding) + Reporting (export) |
| FR-MODE-1..3 (explain, CI gate, diff/alternatives) | Findings (explain) + Closed Loop (gate/diff) + Reporting |
| FR-RULE-1..6 (bands, gate categories, status, CI policy, identity, baseline/waiver) | Findings (1,2) + Closed Loop (3,5,6) + Reporting (4) |

Every PRD §6 capability area maps to at least one bounded context; the core loop
(Capture → Evaluation → Findings → Closed Loop) carries the gate-tier requirements.

## Quality-indicator self-check

- **Value objects outnumber entities** — yes: most concepts (Target, Evidence, Dimensions,
  Location, ConfidenceBand, FindingIdentity, Citation, …) are values; only items with a
  lifecycle across runs (Capture, AuditRun, Finding, TrackedFinding, Baseline, KnowledgeEntry,
  IssueExport, ProjectState) are entities/aggregate roots.
- **Aggregate boundaries match transaction boundaries** — each aggregate is the smallest
  cluster that must be consistent in one write (see each file's "Aggregate boundary" note).
- **No transaction spans aggregates** — cross-aggregate effects flow through domain events
  (e.g. `FindingDetected` → backlog; `ReAuditRan` → status transitions) documented per file.
