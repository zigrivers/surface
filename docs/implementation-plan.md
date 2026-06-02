<!-- scaffold:implementation-plan v1 2026-05-31 -->

# surface — Implementation Plan (task graph)

> Decomposes the user stories + architecture into agent-sized tasks (**~150 ± 50 LOC net-new
> app code, ≤ 3 app files each**, co-located tests extra). Tasks form a **DAG** organized into
> **waves** (a wave's tasks are mutually parallel; a wave depends on prior waves). Scope = the
> **v1.0 Release Gate** (PRD §8) first, then v1.0-Committed. Traceability: PRD → story → task.
> Test refs point at `tests/acceptance/` skeletons; security/ops requirements are folded into
> the relevant tasks. No task contains an unresolved design decision (those are settled in the
> ADRs / api-contracts — agents implement, they don't architect).

Legend: **Tier** G=gate · C=committed · S=should. **Risk** flags noted inline.
Every task's acceptance = "its referenced AC tests go red→green + `pnpm run check` passes".

## Wave 0 — Core foundations (`@zigrivers/surface-core`)

| ID | Task (≤3 files) | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-001 | Scaffold `@zigrivers/surface-core` (package.json, tsconfig, tsup, vitest) | G | ADR-002 | — | build smoke |
| T-002 | zod schemas: `Finding`, `FindingDraft`, `Evidence`, `Dimensions`, `Location`, `SeverityBand` | G | US-020, FR-SCORE-1 | T-001 | E3 US-020 |
| T-003 | zod `SurfaceConfig` slices (Capture/Evaluation/Findings/Reporting) + precedence merge | G | FR-IF-5, ADR-013 | T-001 | unit |
| T-004 | `Result<T, SurfaceError>` + error taxonomy + edge→exit/MCP mapping | G | ADR-014, NFR-CLI-1 | T-001 | unit |
| T-005 | Plugin interfaces (`CaptureBackend`,`FrameworkAdapter`,`GroundingTool`,`Lens`,`ReportRenderer`,`GateEvaluator`,`IssueExporter`,`KnowledgeSource`,`StateStore`) | G | arch §2a/§6 | T-002 | type-only |
| T-006 | `pino` logger factory + privacy-safe fields (no captured content/secrets) | G | ADR-018, NFR-DATA-1 | T-001 | unit (redaction) |

## Wave 1 — Core domain logic

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-010 | `StateStore`: atomic write (write-file-atomic) + lock (proper-lockfile) + schema-version migration; **sole `.surface/` writer** | G | US-041, ADR-003 | T-003,T-005 | E5 US-041 (concurrency, resume) |
| T-011 | `scoreFinding`: dimensions→`SeverityBand`/`ConfidenceBand`, gate rule (`gatedForHuman`) | G | US-021, FR-RULE-1/2 | T-002 | E3 US-021 |
| T-012 | Backlog synthesis: priority sort + MMR de-dup (no vanity score) | G | US-021, FR-SCORE-2/4 | T-011 | E3 US-021 (MMR) |
| T-013 | `ReconciliationService` (multi-model merge, divergence→question) — candidate `@surface/reconciliation` leaf pkg (review Gemini P2) | S | US-071, FR-SCORE-5 | T-011 | E8 US-071 |
| T-014 | `FindingIdentity` hash (lens+issueType+anchor) + collision/drift handling | G | US-040, ADR-010, FR-RULE-5 | T-002 | E5 US-040; identity-drift corpus |
| T-015 | `TrackedFinding` state machine + status transitions (resolved/still-failing/regressed/identity-broken) | G | US-040, FR-RULE-3 | T-014,T-010 | E5 US-040 |
| T-016 | Baseline + Waiver + `GateDisposition` (expiry restores status) | C | US-042, FR-RULE-6 | T-015 | E5 US-042 |
| T-017 | `Verdict` adjudication + feed to prioritization/self-grounding | S | US-023, FR-SCORE-8 | T-015 | E3 US-023 |
| T-018 | `PipelineOrchestrator`: stage machine + skip rules + resumability + events | G | ADR-012, FR-PIPE-1..14 | T-010,T-005 | integration (resume) · **risk: orchestration complexity → keep stages pure** |
| T-019 | **Model-provider abstraction** (BYO-key resolution, availability check, no-model skip result, prompt/input boundary) — the interface judged lenses call | **G** | US-012 (AC2), ADR-006 | T-003,T-005 | E2 US-012 (no-model skip) · *added: review Codex P0 — judged lenses had no model interface* |

## Wave 2 — Capture · grounding · adapters

**Subwaves (intra-wave deps — review Codex P1):** W2a = T-020 (capture registry/selection) →
W2b = T-021/022/023/024/025a (backends + auth, depend on T-020) ∥ T-026/027/028 (grounding) ∥
T-029/030/031/032 (adapters, fully independent leaf packages). Grounding and adapter tasks are
the truly-parallel set; the capture backends share the registry (T-020) so they serialize on it.

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-020 | Capture interface impl: backend auto-detect (deterministic) + `DegradationReport` | G | US-001, NFR-PORT-1 | T-005 | E1 US-001 |
| T-021 | Playwright backend (screenshot/DOM/a11y-tree/computed-styles) | G | US-001 | T-020 | E1 US-001 · capture matrix |
| T-022 | agent-browser backend via `execa` (array-args, `@e` refs) | C | US-001, FR-CAP-7 | T-020 | contract test · **risk: young CLI → behind interface** |
| T-023 | Static + screenshot fallback | G | US-001, FR-CAP-6 | T-020 | E1 US-001 (degraded) |
| T-024 | AuthState injection + `TargetVerification` (auth-before-nav, not-login-page) | G | US-002, FR-CAP-8 | T-021 | E1 US-002 (e2e) · **risk: silent login capture → CAP-I3** |
| T-025a | SSRF allow/deny defaults + capture-write redaction | G | NFR-SEC-1, NFR-DATA-1 | T-020 | security fixtures · **risk: secure-by-default** |
| T-033 | **ContextIngestor / Target construction**: ingest `--component`/source/`--dom`/`--screenshot`/tokens/`--scaffold-docs`; record input provenance; emit **token-contradiction findings** | **G** | US-003, FR-CAP-1/2/4 | T-020,T-029 | E1 US-003 · *added: review Codex P0 — US-003 ACs were uncovered* |
| T-025b | Export-time redaction (consumed by reporters/exporters) | C | FR-CAP-11, US-005 | T-050 | unit (redaction on export) · *split from old T-025 (review Codex P1)* |
| T-026 | axe grounding adapter → `tool-result` Evidence (WCAG 2.2 AA) | G | US-011, FR-PIPE-6 | T-005 | E2 US-011 (determinism) |
| T-027 | Lighthouse adapter (lazy-loaded) | G | US-011, NFR-PERF-1 | T-005 | grounding (recorded JSON) |
| T-028 | eslint-jsx-a11y static a11y pass (React source) | G | US-011 | T-005 | unit |
| T-029 | Agnostic adapter (parse5/happy-dom introspection) | G | US-003, NFR-FW-1 | T-005 | adapter fixtures |
| T-030 | React/Next adapter (@babel/parser + ts-estree) → component/file mapping | G | US-003, FR-SCORE-7 | T-005 | adapter fixtures (react) |
| T-031 | Vue adapter (@vue/compiler-sfc) | C | NFR-FW-1 | T-005 | adapter fixtures (vue) |
| T-032 | Svelte adapter (svelte/compiler) | C | NFR-FW-1 | T-005 | adapter fixtures (svelte) |
| T-034 | Multi-state + dual-theme capture (task-flow recipes; `prefers-color-scheme` toggle; theme-tagged findings) | S | US-004, FR-CAP-9/10 | T-021 | E1 US-004 · *added (review: all three) — was uncovered* |

## Wave 3 — Lenses · knowledge · overlays

**Subwaves (review Codex P1 / Gemini P3):** W3a = T-046 (KB loader) → T-047s (scaffold KB
entries, so judged lenses have content to load) → W3b = T-040..044 lenses (judged lenses depend
on T-046 **and** T-019 model-provider) → W3c = T-045 registry/selection + T-049 discovery. Not
mutually parallel within the wave; the lenses parallelize among themselves once W3a is done.

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-040 | Accessibility lens (measured) — consumes grounding evidence | G | US-011, FR-LENS-1 | T-026,T-011 | E2 US-011 |
| T-041 | Usability/heuristic lens (judged, cited) | G | US-012, FR-PIPE-5 | T-046,T-019,T-011 | E2 US-012 |
| T-041b | Cognitive-walkthrough + conversion lens | S | US-014, FR-PIPE-10/11 | T-046,T-019,T-049 | E2 US-014 · *added (review: all three) — was uncovered* |
| T-042 | Visual-hierarchy + design-system lens (token-measurable) | G | US-012, FR-PIPE-7 | T-046 | E2 US-012 |
| T-043 | Content/microcopy lens (retext readability) | G | US-012, FR-PIPE-8 | T-046 | unit |
| T-044 | Responsiveness + empty/loading/error-state lens | G | US-012, FR-PIPE-9 | T-021 | integration |
| T-045 | Lens registry + overlay∩preset selection + skip rules + `SynthesisDecision` (measured-wins) | G | US-013, FR-LENS-4, EVAL-I7 | T-018,T-005 | E2 US-013 |
| T-046 | KB loader (gray-matter) + relevance query + `resolve(id)` | G | US-070, FR-KB-1 | T-005 | E8 US-070 |
| T-047s | **Scaffold** KB entry files (per-category, valid frontmatter incl. Citation+Freshness, TODO bodies) — agent-sized | G | US-070, FR-KB-2/4 | T-046 | E8 US-070 (structure) |
| T-047c | Author KB **content** per category (heuristics/a11y/forms/nav/states/visual-content/design-systems/agent-impl) — one task **per category** | G | FR-KB-2 | T-047s | per-entry citation/freshness validation · *split from old T-047 (review Codex/Gemini P2): scaffold is code-sized; content is N per-category authoring tasks* |
| T-048 | App-type overlays (generic gate; saas/ecommerce/marketing committed) yaml + registry | G/C | US-010, FR-OVL-1/2 | T-018 | E2 US-010 |
| T-049 | Discovery/app-type classification + persona/task + RouteInventory (cap+RoutesSkipped) | G | US-010, FR-PIPE-1/2/3, NFR-SCALE-1 | T-018 | E2 US-010 |

## Wave 4 — Reporters · integrations

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-050 | `findings.md` + `findings.json` renderers (byte-stable, no vanity score) | G | US-030, FR-OUT-1/3 | T-012 | E4 US-030 |
| T-050b | Backlog + agent-plan + validation-report renderers (StateStore-mediated writes) | G | FR-OUT-1, FR-PIPE-13 | T-050,T-012 | byte-stability · *added (review Codex P1): FR-OUT-1 artifacts beyond findings.md/json* |
| T-051 | `explain` renderer (plain-language + cited heuristic + evidence) | G | US-031, FR-MODE-1 | T-050,T-046 | E4 US-031 |
| T-052 | SARIF v2.1.0 renderer (node-sarif-builder) | C | US-032 AC1, FR-OUT-4 | T-050 | E4 US-032 (schema-valid) |
| T-053 | GitHub Issues `IssueExporter` (octokit, retry/backoff, local-first, unsynced report) | G | US-060, FR-INT-2 | T-050 | E7 US-060 · **risk: rate limits → backoff+local fallback** |
| T-054a | **GateEvaluator (default policy)**: fail on new measured P0/P1 by `SeverityBand`; **never** judged/gated | **G** | FR-RULE-4 | T-011,T-012 | E5 US-042 (gate) · *re-tiered to G (review Codex P0): default gate is release-gate scope* |
| T-054b | Baseline/waiver-aware gate (net-new vs baseline; `gateDisposition`) | C | US-042, FR-RULE-6 | T-054a,T-016 | E5 US-042 (baseline) |
| T-056 | `SuggestedPatch` schema + deterministic generators (contrast-hex, aria, target-size); judged findings never patched | C | US-022, FR-SCORE-7 | T-002,T-040 | E3 US-022 · *added (review Codex/Claude P1): was uncovered* |
| T-057 | GitHub **Checks / PR annotations** exporter (local-first) — distinct from Issues export | C | US-032 AC2, FR-OUT-4 | T-052 | E4 US-032 AC2 · *added (review Codex P1): separate integration surface* |
| T-058 | Linear / Jira `IssueExporter` | S | US-061, FR-INT-3 | T-053 | E7 US-061 · *added (review: all three) — was uncovered* |
| T-055 | `diff` + `alternatives` renderers (all-status diff; bounded alternatives) | S | US-015, FR-IF-4 | T-015,T-041 | E2 US-015 |

## Wave 5 — Interfaces (composition root)

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-059 | Shared **composition factory** in `core` (build the wired registry of plugins) — used by both CLI and MCP so neither depends on the other | G | arch §2a | core+plugins | unit · *added (review Codex P1): CLI/MCP are siblings over core* |
| T-060 | `@zigrivers/surface` commander app + exit codes 0/1/2 + `--json` envelope + error→exit mapping | G | US-050, FR-IF-1, NFR-CLI-1 | T-059,T-004 | E6 US-050 (e2e) |
| T-061a | CLI verbs **core loop**: `init`/`status`/`run`/`next`/`capture`/`audit` | G | US-050, api-contracts §2 | T-060 | E6 US-050 · CLI contract |
| T-061b | CLI verbs **findings/loop**: `explain`/`backlog`/`validate`/`gate`/`trace` | G | US-050/031/042 | T-060 | E6 US-050 |
| T-061c | CLI verbs **committed/should**: `baseline` (C) / `verdict`,`diff`,`alternatives` (S) | C/S | US-042/023/015 | T-060 | E5/E3/E2 |
| T-062a | `@zigrivers/surface-mcp` server bootstrap + tool-schema infra + snapshot harness (depends on **core**, not CLI) | G | US-051, NFR-MCP-1 | T-059 | E6 US-051 · MCP snapshot |
| T-062b | MCP **analytical** tools (`surface_capture/audit/explain/backlog/status`) | G | US-051, api-contracts §3 | T-062a | E6 US-051 |
| T-062c | MCP **closed-loop** tools (`surface_gate/validate/baseline/verdict/diff/trace`) + optional (`alternatives`) | G/C/S | US-051 | T-062a | contract |
| T-063 | Runner skill (NL→CLI/MCP command mapping) per platform | G | US-052, FR-IF-3 | T-061a,T-062b | E6 US-052 |
| T-064 | Accessible terminal output + progressive disclosure (top finding + count; `--all`) | G | US-031, NFR-OWNOUT-1 | T-061b | E4 US-031 (no color-only) |

## Wave 6 — Fixtures · e2e · benchmark

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-070a | Seeded-defect fixture: plain HTML + React (contrast/focus/target/empty-state) | G | SC-6, tdd.md | T-029,T-030 | adapter+capture fixtures |
| T-070b | Seeded-defect fixture: Vue + Svelte | C | SC-6 | T-031,T-032 | adapter fixtures · *split by framework (review Codex P1)* |
| T-071 | CLI e2e closed-loop smoke (audit→fix→re-audit→resolved; gate) | G | US-050/040, e2e | T-061a/b,T-070a | `tests/e2e/cli-smoke` |
| T-072 | SC-6 before/after benchmark + perf gate (quick p95<30s) harness (consumes fixtures) | G | SC-4/6, NFR-PERF-1 | T-071 | benchmark CI |

## Dependency DAG (wave-level, acyclic)

```
W0 (foundations) → W1 (domain) ─┬→ W3 (lenses/KB) ─┐
                                 │                   ├→ W4 (reporters) → W5 (interfaces) → W6 (e2e/benchmark)
W0 → W2 (capture/grounding/adapters) ────────────────┘                      ▲
                                          (W2 also feeds W3 & W5 plugins) ───┘
```
Within a wave, tasks are mutually independent (different files/packages) → parallelizable. No
task depends on a later-ordered task (verified by the wave layering).

## Wave plan & agent allocation

| Wave | Tasks | Parallelism | Suggested agents | Notes |
|---|---|---|---|---|
| W0 | T-001..006 | T-002/003/004/006 parallel after T-001 | 2–3 | foundations gate everything; do first |
| W1 | T-010..019 | high (findings ∥ closed-loop ∥ orchestrator ∥ model-provider) | 3–4 | T-018 on critical path |
| W2 | T-020..034 | **subwaved** (see W2 note): grounding ∥ adapters are truly parallel; capture backends serialize on T-020 | 4–5 | classic parallel-agent wave (ADR-002), minus the shared capture registry |
| W3 | T-040..049 | **subwaved** (W3a KB loader/scaffold → W3b lenses ∥ → W3c registry) | 3–4 | judged lenses need T-019+T-046 first |
| W4 | T-050..058 | medium (renderers ∥; exporters depend on T-050) | 2–3 | reporters read-only over findings |
| W5 | T-059..064 | low (T-059 composition factory + T-060 CLI app serialize; verb groups then parallel-ish but contend on the commander app) | 1–2 | **do not parallelize the composition factory / CLI app** |
| W6 | T-070..072 | medium | 2 | benchmark + perf gate close the release |

**Correction (review Codex/Gemini P1):** "mutually parallel within a wave" is **not** universally
true — intra-wave dependencies exist (W2 backends→T-020; W3 lenses→T-046/T-019; W4 exporters→
T-050; W5 verbs→T-060). The subwave notes above state the real ordering; parallelism is within a
subwave.

**Conflict rule (ADR-002):** parallelize across packages, never on shared files; serialize
`core` and the CLI composition root.

## Critical path (recomputed from explicit deps — review Codex P1)

`T-001 → T-002 → T-005 → T-010 → T-018 → T-045 → T-059 → T-060 → T-061a → T-071 → T-072`
(foundations → schema → interfaces → state → orchestrator → lens registry/selection →
composition factory → CLI app → core-loop verbs → closed-loop e2e → SC-6 benchmark).

Note the **gate branches that must all converge at T-059 (composition factory) before T-060**:
capture (T-020→T-021→T-024), grounding (T-026), context-ingestion (T-033), model-provider
(T-019), accessibility lens (T-040), discovery/overlay (T-048/T-049), KB (T-046→T-047s),
findings renderers (T-050), and the default gate (T-054a). The release gate closes when **T-071**
(closed-loop e2e) and **T-072** (SC-6 benchmark + perf gate) pass — both depend on the full
gate-tier set being wired at T-059/T-060. T-050 does **not** depend on T-045 (corrected — it
depends on T-012 scoring only).

## High-risk tasks (flagged with mitigation)

| Task | Risk | Mitigation |
|---|---|---|
| T-018 orchestrator | complexity creep, hidden coupling | keep stages pure; orchestrator only sequences/skips; events for cross-aggregate effects |
| T-022 agent-browser | young external CLI | strictly behind `CaptureBackend`; contract-tested; static fallback always works |
| T-024 auth injection | silent login-page capture | `TargetVerification` (CAP-I3) gates; non-zero exit on bounce |
| T-025 SSRF/redaction | secure-by-default failure = release blocker | default deny metadata/link-local/file://; redaction before any egress; security fixtures |
| T-041 judged lenses | prompt injection via captured content | measured anchor unaffected; delimiting + "evaluate-don't-follow" framing; gated findings never auto-exec |
| T-053 GitHub export | rate limits/outage lose findings | local-first write + backoff + unsynced report + non-zero exit |

## Traceability (transitive: PRD → story → task)

Every PRD §6 feature → ≥1 story (`docs/user-stories.md` coverage) → ≥1 task above (story IDs in
the tables). Every architecture component (§2 of system-architecture) → tasks: core→W0/W1,
capture→T-020..025, grounding→T-026..028, adapters→T-029..032, lenses/KB→W3, reporters→W4,
cli/mcp→W5. Gate-tier (G) tasks = the v1.0 Release Gate; Committed (C) = ship-if-ready;
Should (S) = v1.1. Deferred PRD §14 items have **no** tasks (intentional).

## Estimated shape

~68 tasks (after the review split CLI/MCP/fixtures/gate/KB and added model-provider,
context-ingestor, report renderers, suggestedPatch, GitHub-Checks, and the US-004/014/061
should-tasks) at ~150 LOC each ≈ the v1.x scope. **Every defined story US-001..071 now maps to
≥1 task** (the `task-coverage.json` `uncovered` list is closed by T-019/T-033/T-034/T-041b/
T-056/T-057/T-058). Release gate = all **G** tasks + T-070a/071/072 green. Committed tasks ship
in v1.0 if ready, else v1.1; should-tier (S) = v1.1 — without failing the gate (PRD §8).
