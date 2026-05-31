<!-- scaffold:system-architecture v1 2026-05-31 -->

# surface — System Architecture

> The blueprint agents reference when deciding where code lives and how components
> communicate. It translates the 7 bounded contexts (`docs/domain-models/`) and the 18 ADRs
> (`docs/adrs/`) into concrete components, data flows, module structure, and extension points,
> over the package layout in `docs/project-structure.md`. Every ADR is a binding constraint;
> every domain context lands in a package; every Must-have user journey appears in a data flow.

## 1. Architectural style

surface is a **locally-run, modular-monorepo CLI + MCP tool** (ADR-001, ADR-002, ADR-008) — no
hosted service, no database (ADR-003), no REST API. The shape is a **pipeline core wrapped by
thin interface adapters**, with pluggable backends at the edges:

- A **pure domain core** (`@surface/core`) owns the canonical schema, scoring, identity, state,
  and the pipeline orchestrator. It depends on nothing in the workspace.
- **Interface adapters** (`cli`, `mcp`) are thin layers over `core` (ADR-007, ADR-008); the
  runner skill is a conversational adapter over them (ADR-008).
- **Edge plugins** — capture backends, framework adapters, grounding tools, reporters — sit
  behind interfaces defined in `core`, so each is independently testable and additive
  (ADR-004, ADR-009, ADR-016, ADR-017).
- **Knowledge Base** and **Project State** are shared services every run touches.

```
                    ┌────────────────────── interface adapters ──────────────────────┐
                    │   @surface/cli (commander, POSIX)     @surface/mcp (MCP SDK)     │
                    │   + runner skill (NL→command)         versioned tool schema      │
                    └───────────────┬─────────────────────────────┬───────────────────┘
                                    │  domain commands (Result<T, SurfaceError>)        │
                    ┌───────────────▼───────────────────────────────────────────────┐
                    │                       @surface/core                            │
                    │  PipelineOrchestrator · Finding/Backlog schema (zod) · scoring │
                    │  /MMR · FindingIdentity · TrackedFinding/closed-loop · State   │
                    │  layer (atomic+lock) · SurfaceConfig · interfaces for plugins  │
                    └───┬───────────┬───────────┬───────────┬───────────┬────────────┘
            capture API │  adapter  │ grounding │  reporter │   KB API  │ (interfaces owned by core)
        ┌───────────────▼┐ ┌────────▼────────┐ ┌▼─────────┐ ┌▼─────────┐ ┌▼──────────────┐
        │ @surface/capture│ │@surface/adapters│ │@surface/ │ │@surface/ │ │ @surface/     │
        │ playwright /    │ │ react/vue/      │ │grounding │ │reporters │ │ knowledge     │
        │ agent-browser / │ │ svelte/agnostic │ │axe/light-│ │md/json/  │ │ (entries +    │
        │ static          │ │ (compilers)     │ │house/a11y│ │sarif/gh  │ │  loader)      │
        └─────────────────┘ └─────────────────┘ └──────────┘ └──────────┘ └───────────────┘
                                    persists to  ──►  .surface/  (Project State, ADR-003)
```

## 2. Context → component map (every domain context lands in a package)

| Bounded context (domain) | Package / module | Notes |
|---|---|---|
| Project State | `core/src/state` | `.surface/` IO: atomic writes + lock (ADR-003); config slices + identity registry |
| Evaluation | `core/src/pipeline` (orchestrator, ADR-012) + `core/src/lenses` + `grounding`/`adapters` | orchestrator sequences stages; lenses run measured/judged |
| Findings & Backlog | `core/src/findings` | canonical `Finding` (zod), scoring/MMR, bands, gating, `ReconciliationService` |
| Closed Loop | `core/src/closed-loop` | `FindingIdentity`, `TrackedFinding`, baselines/waivers, verdicts |
| Capture | `@surface/capture` | backends behind the capture interface (ADR-004) |
| Knowledge Base | `@surface/knowledge` | entries (`content/knowledge/`) + loader; relevance + `resolve(id)` |
| Reporting & Integrations | `@surface/reporters` | md/json/sarif/github reporters + gate evaluator (ADR-016) |
| Interfaces (adapters, not a domain) | `@surface/cli`, `@surface/mcp` | thin over `core`; runner skill maps NL→command (ADR-008) |

`core` owns the canonical schema and every plugin interface; all other packages depend on
`core`, never the reverse (ADR-002 boundary rule). Adapters/reporters/capture/grounding are
conflict-free leaf packages.

## 3. The pipeline (orchestrator) — control flow

`PipelineOrchestrator` (`core/src/pipeline`, ADR-012) is a stateless application service that
sequences the FR-PIPE stages and drives resumability via `ProjectState.currentStage`:

```
discovery → persona-task → inventory → capture → lens-evaluation → synthesis → validation
   │            │             │           │            │              │            │
 AppType     Persona[]     RouteInventory delegates   Lens set =      Backlog     TrackedFinding
 classified  TaskDef[]     (+RoutesSkipped) to        overlay∩preset  (FR-PIPE-13) status (FR-PIPE-14)
 (US-010)                  NFR-SCALE-1    @surface/    skip if no                  → Closed Loop
                                          capture      model/live-DOM
```

- The orchestrator **sequences and skips** stages by depth/preset and emits
  `StageAdvanced`/`LensSkipped`/`AuditRunFailed`; it **never computes findings or scores**
  (that stays in Evaluation/Findings — ADR-005, ADR-012).
- Each completed stage is persisted to `ProjectState` under the state lock, so an interrupted
  run resumes from `currentStage` (US-041, ADR-003).

## 4. Data flows (Must-have user journeys)

### 4.1 Audit a route → prioritized backlog (US-001, 010–013, 020, 021, 030)

```
CLI/MCP ─ audit ─► Orchestrator ─► Capture.observe(target)
                                     │  CaptureCompleted/Degraded/Unreachable
                                     ▼
                        Evaluation.lens-evaluation
                          ├─ Grounding (axe/lighthouse/jsx-a11y, computed styles) → measured FindingDraft (tool-result evidence)
                          ├─ Adapters (component/file mapping) ─────────────────► Location
                          ├─ Judged lenses (BYO model, ADR-006) → judged FindingDraft (cited heuristic)
                          └─ KB.getRelevant(lens, appType) ───────────────────► citedHeuristics
                                     │  FindingDetected { full FindingDraft }
                                     ▼
                        Findings.scoreFinding(draft, config)
                          → Dimensions, SeverityBand, ConfidenceBand, gatedForHuman   (FND-I1..I5)
                          → ReconciliationService (depth 4–5, multi-model)            (FR-SCORE-5)
                                     │  FindingScored / FindingGated
                                     ▼
                        Backlog synthesis (priority sort + MMR demote)  → BacklogProduced
                                     │
                        Reporters: findings.md + findings.json (byte-stable) + backlog  (local-first, ADR-016)
                                     │
                        State: persist findings/ + identity registry (atomic+lock)
                                     ▼
                        CLI: top finding + count (progressive disclosure); exit 0
```
*Degradation paths:* no model → judged lenses skipped, reported (US-012); no backend →
static+screenshot, skipped measured checks reported (FR-CAP-6); measured⟂judged conflict →
`SynthesisDecision` measured-wins (EVAL-I7, ADR-017).

### 4.2 Re-audit → status transitions → gate (US-040, 042; FR-LOOP, FR-RULE-3,4,6)

```
CLI ─ gate/validate ─► Orchestrator (validation stage) ─► Closed Loop
   acquire state lock (US-041) ─►
   for each prior TrackedFinding:
     match anchor (prefer @e ref, ADR-010) in new run?
       yes + ValidationCheck passes → resolved      ── FindingResolved
       yes + still fails            → still-failing
       was resolved, detected again → regressed      ── FindingRegressed
       no/ambiguous match           → identity-broken (never silent resolved — LOOP-I2)
   apply Baseline + Waivers (gateDisposition orthogonal to status — LOOP-I5/I6)
   persist transitions atomically ─► release lock
        │
   Reporters: GateResult on SeverityBand; fail on new measured P0/P1; never on judged/gated (FR-RULE-4)
        │  exit 0 (pass) | 1 (fail) | 2 (usage)
```

### 4.3 Export backlog → tracker (US-060; ADR-016)

```
Backlog ─► Reporters.export(github) ─► write local artifacts FIRST (RPT-I1)
                                       create Issues/Checks via octokit
                                         success → synced
                                         rate-limit/outage → retry w/ backoff (ADR-014)
                                         persistent failure → unsynced, exit non-zero (US-060)
```

### 4.4 Capture behind auth (US-002; ADR-013)

```
CLI ─ --auth-state <file> ─► Capture: inject storage-state BEFORE navigation
   verify landed URL is the requested target (TargetVerification, CAP-I3)
     ok    → authenticated DOM captured
     bounced/invalid → CaptureAuthFailed, non-zero exit, NEVER capture login page as target
```

## 5. Module structure (file-level, `@surface/core`)

```
core/src/
├── schema/            # zod: Finding, FindingDraft, Evidence, Dimensions, Location, Backlog, SurfaceError
├── findings/          # scoreFinding, severity/confidence bands, MMR, ReconciliationService, gate rule
├── closed-loop/       # FindingIdentity (hash+collision), TrackedFinding state machine, Baseline, Waiver, Verdict
├── pipeline/          # PipelineOrchestrator, PipelineStage transitions, stage skip rules
├── lenses/            # Lens interface + lens registry (measured/judged), per-lens modules
├── state/             # ProjectState aggregate, atomic write (write-file-atomic), lock (proper-lockfile), config slices, migration (PS-I7)
├── interfaces/        # published plugin interfaces: CaptureBackend, FrameworkAdapter, GroundingTool, Reporter, KnowledgeSource
├── result/            # Result<T, SurfaceError> + SurfaceError taxonomy (ADR-014)
└── logging/           # pino logger factory, privacy-safe fields (ADR-018)
```

Leaf packages implement `core/src/interfaces`: `capture/src/{playwright,agent-browser,static}`,
`adapters/{react,vue,svelte,agnostic}/src`, `grounding/src/{axe,lighthouse,jsx-a11y}`,
`reporters/src/{md,json,sarif,github}`, `knowledge/src/loader`.

## 6. Extension points (interface + usage + constraints)

| Extension point | Interface (in `core/src/interfaces`) | Add by | Constraints |
|---|---|---|---|
| **Capture backend** | `CaptureBackend { detect(): bool; observe(target, opts): Result<Capture> }` | new module in `@surface/capture` | must report `DegradationReport`; must not transmit captures (ADR-013); deterministic backend choice recorded |
| **Framework adapter** | `FrameworkAdapter { supports(file): bool; introspect(src): ComponentMap }` | new `adapters/<fw>` package | uses the framework's real compiler (ADR-009); leaf package, no cross-adapter deps; ships a fixture suite (NFR-FW-1) |
| **Grounding tool** | `GroundingTool { run(capture): ToolResult[] }` | new module in `@surface/grounding` | emits `tool-result` Evidence only; measured-wins (ADR-017); lazy-load if heavy |
| **Lens** | `Lens { id; method; requiresModel; requiresLiveDom; evaluate(ctx): FindingDraft[] }` | `core/src/lenses/<lens>.ts` + a KB entry | must set `method`; measured lens needs tool evidence (ADR-005); judged lens never emits a measured label |
| **Reporter** | `Reporter { format; render(findings, backlog): Report }` | new module in `@surface/reporters` | read-only over findings; local artifact first (ADR-016); no vanity score (FR-SCORE-4) |
| **App-type overlay** | yaml in `content/methodology/overlays/` | add a yaml file | shifts acceptance criteria per lens (FR-LENS-4); registered via overlay registry |
| **Knowledge entry** | md+frontmatter in `content/knowledge/` | add a file | requires `## Summary`/`## Deep Guidance` + Citation + Freshness (FR-KB-1,4) |

**Cannot be extended without an ADR:** the canonical `Finding`/`SurfaceError` schema, the
measured/judged discipline, the state-file format/lock model, and the CLI/MCP contracts —
these are the stable contracts everything else builds on (ADR-005, ADR-003, ADR-007/008).

## 7. State management

Per ADR-003: `.surface/` is the single persistence surface, written via `write-file-atomic`
under one `proper-lockfile` advisory lock, with explicit schema-version migration (PS-I7).
Retention classes (ADR-003/013): **durable** (`state.json`, `findings/`, `config.yml`,
baselines/waivers, decisions) committable+diffable; **ephemeral evidence** (`captures/`)
git-ignored, purged per default unless retained. `runHistory` is rotated to bound per-run write
size (keep last N; older rolls to `history.log` outside the locked aggregate).

## 8. Cross-cutting concerns

- **Trust spine (ADR-005):** zod parse at every boundary; `Finding.method` is the sole source
  of the measured/judged label; lint rejects measured-without-tool-evidence; reporters derive
  the label from `method` (RPT-I9).
- **Errors (ADR-014):** `Result<T, SurfaceError>` at package boundaries; throwing only at the
  CLI/MCP edge → exit codes (0/1/2) / MCP structured errors; degradation ≠ failure.
- **Security/data (ADR-013):** safe-by-default, no exfiltration, redaction on captures+exports,
  domain allowlists, opt-in interception, MCP stdio/local no-auth-v1.
- **Observability (ADR-018):** pino structured logs to stderr (stdout pipe-clean), run/event
  ids, knowledge-gap signal, no captured content in logs, no default telemetry.
- **Verification (ADR-015):** determinism/identity/method-integrity/degradation/concurrency
  tests + CLI/MCP contract + capture matrix + per-framework fixtures + perf gate, mapped to NFRs.

## 9. Failure-mode coverage (PRD §7)

| Failure | Architectural handling | Component |
|---|---|---|
| No/sparse inputs | honest lens subset; `DegradationReport`; never fabricate measurement | Capture, Evaluation |
| Capture backend down / URL unreachable | static+screenshot fallback; `CaptureUnreachable`; exit-coded | Capture (ADR-004) |
| Auth required / off-target landing | `TargetVerification` → `CaptureAuthFailed`, non-zero exit | Capture (ADR-013) |
| measured⟂judged disagreement | `SynthesisDecision` measured-wins | Evaluation (ADR-017) |
| multi-model disagreement | reconcile by confidence; divergence as question | Findings reconciliation (FR-SCORE-5) |
| re-audit can't match prior finding | `identity-broken`, never silent resolved | Closed Loop (ADR-010) |
| malformed config / unknown subcommand | `UsageError` → exit 2 | CLI (ADR-014) |
| integration export failure | retry/backoff → local fallback → unsynced, non-zero exit | Reporters (ADR-016) |
| MCP version mismatch | structured error; refuse incompatible schema | MCP (ADR-008) |
| oversized route inventory | cap + `RoutesSkipped`, explicit report (no silent truncation) | Evaluation (NFR-SCALE-1) |
| LLM context overflow | chunk/subset or measured-only fallback for that view | Evaluation |
| interrupted / concurrent run | atomic+lock; resume from `currentStage` | State (ADR-003) |

## 10. Scalability & performance annotations

- **Routes per run (NFR-SCALE-1):** bounded by `RouteInventory.cap` (default ~50, raised by
  depth/preset); excess reported as `RoutesSkipped`, never silently dropped.
- **Findings volume:** file-based state is the v1 choice (ADR-003) with the state layer behind
  an interface — embedded SQLite is the documented escape hatch if volume outgrows files.
- **Startup/perf (NFR-PERF-1):** lazy `import()` per CLI command; Lighthouse lazy-loaded
  (ADR-001, ADR-017); `quick` preset p95 < 30s gated in CI.
- **Write size:** `runHistory` rotation keeps the locked aggregate's per-run write bounded.
- **Concurrency:** advisory single-writer lock (not multi-user) — surface is a local tool; "scale"
  is routes-per-run, not user count (PRD §10 N/A items).

## 11. Deployment topology

No hosted service (ADR-008, ADR-011). Distribution = **npm + `npx surface` + Homebrew tap**;
the brew formula wraps the Node CLI (optional Bun/esbuild single binary). The MCP server runs
locally over stdio, embedded by an agent host (e.g. Claude Code). The only network egress is
user-configured: model inference (BYO key) and tracker exports — both opt-in (ADR-013).

## 12. Traceability

Every ADR maps to a section here: 001→§1/§11, 002→§1/§2, 003→§7, 004→§6, 005→§8, 006→§4.1,
007/008→§1/§11, 009→§6, 010→§4.2/§6, 011→§11, 012→§3, 013→§7/§8/§11, 014→§8/§9, 015→§8,
016→§4.3/§6, 017→§4.1/§8, 018→§8. Every domain context maps to a package (§2). Every Must-have
journey appears in a §4 data flow. Components map to `project-structure.md` packages.
