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

## Wave 0 — Core foundations (`@surface/core`)

| ID | Task (≤3 files) | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-001 | Scaffold `@surface/core` (package.json, tsconfig, tsup, vitest) | G | ADR-002 | — | build smoke |
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
| T-013 | `ReconciliationService` (multi-model merge, divergence→question) | S | US-071, FR-SCORE-5 | T-011 | E8 US-071 |
| T-014 | `FindingIdentity` hash (lens+issueType+anchor) + collision/drift handling | G | US-040, ADR-010, FR-RULE-5 | T-002 | E5 US-040; identity-drift corpus |
| T-015 | `TrackedFinding` state machine + status transitions (resolved/still-failing/regressed/identity-broken) | G | US-040, FR-RULE-3 | T-014,T-010 | E5 US-040 |
| T-016 | Baseline + Waiver + `GateDisposition` (expiry restores status) | C | US-042, FR-RULE-6 | T-015 | E5 US-042 |
| T-017 | `Verdict` adjudication + feed to prioritization/self-grounding | S | US-023, FR-SCORE-8 | T-015 | E3 US-023 |
| T-018 | `PipelineOrchestrator`: stage machine + skip rules + resumability + events | G | ADR-012, FR-PIPE-1..14 | T-010,T-005 | integration (resume) · **risk: orchestration complexity → keep stages pure** |

## Wave 2 — Capture · grounding · adapters (parallel; depend on interfaces)

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-020 | Capture interface impl: backend auto-detect (deterministic) + `DegradationReport` | G | US-001, NFR-PORT-1 | T-005 | E1 US-001 |
| T-021 | Playwright backend (screenshot/DOM/a11y-tree/computed-styles) | G | US-001 | T-020 | E1 US-001 · capture matrix |
| T-022 | agent-browser backend via `execa` (array-args, `@e` refs) | C | US-001, FR-CAP-7 | T-020 | contract test · **risk: young CLI → behind interface** |
| T-023 | Static + screenshot fallback | G | US-001, FR-CAP-6 | T-020 | E1 US-001 (degraded) |
| T-024 | AuthState injection + `TargetVerification` (auth-before-nav, not-login-page) | G | US-002, FR-CAP-8 | T-021 | E1 US-002 (e2e) · **risk: silent login capture → CAP-I3** |
| T-025 | SSRF allow/deny defaults + `RedactionRule` application (captures+exports) | G/C | US-005, NFR-SEC-1, NFR-DATA-1 | T-020 | security fixtures · **risk: secure-by-default** |
| T-026 | axe grounding adapter → `tool-result` Evidence (WCAG 2.2 AA) | G | US-011, FR-PIPE-6 | T-005 | E2 US-011 (determinism) |
| T-027 | Lighthouse adapter (lazy-loaded) | G | US-011, NFR-PERF-1 | T-005 | grounding (recorded JSON) |
| T-028 | eslint-jsx-a11y static a11y pass (React source) | G | US-011 | T-005 | unit |
| T-029 | Agnostic adapter (parse5/happy-dom introspection) | G | US-003, NFR-FW-1 | T-005 | adapter fixtures |
| T-030 | React/Next adapter (@babel/parser + ts-estree) → component/file mapping | G | US-003, FR-SCORE-7 | T-005 | adapter fixtures (react) |
| T-031 | Vue adapter (@vue/compiler-sfc) | C | NFR-FW-1 | T-005 | adapter fixtures (vue) |
| T-032 | Svelte adapter (svelte/compiler) | C | NFR-FW-1 | T-005 | adapter fixtures (svelte) |

## Wave 3 — Lenses · knowledge · overlays

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-040 | Accessibility lens (measured) — consumes grounding evidence | G | US-011, FR-LENS-1 | T-026,T-011 | E2 US-011 |
| T-041 | Usability/heuristic lens (judged, cited) | G | US-012, FR-PIPE-5 | T-046,T-011 | E2 US-012 |
| T-042 | Visual-hierarchy + design-system lens (token-measurable) | G | US-012, FR-PIPE-7 | T-046 | E2 US-012 |
| T-043 | Content/microcopy lens (retext readability) | G | US-012, FR-PIPE-8 | T-046 | unit |
| T-044 | Responsiveness + empty/loading/error-state lens | G | US-012, FR-PIPE-9 | T-021 | integration |
| T-045 | Lens registry + overlay∩preset selection + skip rules + `SynthesisDecision` (measured-wins) | G | US-013, FR-LENS-4, EVAL-I7 | T-018,T-005 | E2 US-013 |
| T-046 | KB loader (gray-matter) + relevance query + `resolve(id)` | G | US-070, FR-KB-1 | T-005 | E8 US-070 |
| T-047 | Author core KB entries (heuristics, a11y, forms, nav, states, visual/content, design-systems, agent-impl) w/ Citation+Freshness | G | US-070, FR-KB-2/4 | T-046 | E8 US-070 (structure) |
| T-048 | App-type overlays (generic gate; saas/ecommerce/marketing committed) yaml + registry | G/C | US-010, FR-OVL-1/2 | T-018 | E2 US-010 |
| T-049 | Discovery/app-type classification + persona/task + RouteInventory (cap+RoutesSkipped) | G | US-010, FR-PIPE-1/2/3, NFR-SCALE-1 | T-018 | E2 US-010 |

## Wave 4 — Reporters · integrations

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-050 | `findings.md` + `findings.json` renderers (byte-stable, no vanity score) | G | US-030, FR-OUT-1/3 | T-012 | E4 US-030 |
| T-051 | `explain` renderer (plain-language + cited heuristic + evidence) | G | US-031, FR-MODE-1 | T-050,T-046 | E4 US-031 |
| T-052 | SARIF v2.1.0 renderer (node-sarif-builder) | C | US-032, FR-OUT-4 | T-050 | E4 US-032 (schema-valid) |
| T-053 | GitHub `IssueExporter` (octokit, retry/backoff, local-first, unsynced report) | G | US-060, FR-INT-2 | T-050 | E7 US-060 · **risk: rate limits → backoff+local fallback** |
| T-054 | `GateEvaluator` (SeverityBand; never judged/gated; baseline-aware) | C | US-042, FR-RULE-4 | T-016,T-012 | E5 US-042 |
| T-055 | `diff` + `alternatives` renderers (all-status diff; bounded alternatives) | S | US-015, FR-IF-4 | T-015,T-041 | E2 US-015 |

## Wave 5 — Interfaces (composition root)

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-060 | `@surface/cli` commander app + **composition root** (wire plugins) + exit codes 0/1/2 | G | US-050, FR-IF-1, NFR-CLI-1 | all core+plugins | E6 US-050 (e2e) |
| T-061 | CLI verbs (init/run/next/status/capture/audit/explain/backlog/validate/gate/baseline/verdict/diff/alternatives/trace) + `--json` | G | US-050, api-contracts §2 | T-060 | E6 US-050 · CLI contract |
| T-062 | `@surface/mcp` server + tools + versioned schema (snapshot-tested) | G | US-051, FR-IF-2, NFR-MCP-1 | T-060 | E6 US-051 · MCP snapshot |
| T-063 | Runner skill (NL→CLI/MCP command mapping) per platform | G | US-052, FR-IF-3 | T-061,T-062 | E6 US-052 |
| T-064 | Accessible terminal output + progressive disclosure (top finding + count; `--all`) | G | US-031, NFR-OWNOUT-1 | T-061 | E4 US-031 (no color-only) |

## Wave 6 — Fixtures · e2e · benchmark

| ID | Task | Tier | Stories/refs | Deps | Tests |
|---|---|---|---|---|---|
| T-070 | Seeded-defect fixture apps (react/vue/svelte/html: contrast/focus/target/empty-state) | G | SC-6, tdd.md | T-029,T-030 | adapter+capture fixtures |
| T-071 | CLI e2e closed-loop smoke (audit→fix→re-audit→resolved; gate) | G | US-050/040, e2e | T-061,T-070 | `tests/e2e/cli-smoke` |
| T-072 | SC-6 before/after benchmark + perf gate (quick p95<30s) harness | G | SC-4/6, NFR-PERF-1 | T-071 | benchmark CI |

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
| W1 | T-010..018 | high (findings vs closed-loop vs orchestrator) | 3 | T-018 is on the critical path |
| W2 | T-020..032 | very high (capture/grounding/adapters are separate leaf pkgs) | 4–5 | classic parallel-agent wave (ADR-002) |
| W3 | T-040..049 | high (one lens per agent) | 3–4 | lenses are leaf packages (Gemini P1 fix) |
| W4 | T-050..055 | medium | 2–3 | reporters read-only over findings |
| W5 | T-060..064 | low (CLI is the shared composition root — serialize) | 1–2 | **do not parallelize core wiring** |
| W6 | T-070..072 | medium | 2 | benchmark gates release |

**Conflict rule (ADR-002):** parallelize across packages, never on shared files; serialize
`core` and the CLI composition root.

## Critical path

`T-001 → T-002 → T-005 → T-010 → T-018 → T-045 → T-050 → T-060 → T-061 → T-071 → T-072`
(foundations → schema → interfaces → state → orchestrator → lens selection → core renderer →
CLI + composition root → verbs → e2e → benchmark). This is the longest chain; the release gate
closes when T-071 (closed-loop e2e) and T-072 (SC-6 benchmark) pass. Capture/adapter/lens waves
run alongside but converge at T-045/T-060.

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

~52 tasks at ~150 LOC each ≈ the v1.0 scope. Release gate = all **G** tasks + T-070/071/072
green. Committed tasks (Vue/Svelte adapters, 2nd backend, overlays, baseline/SARIF/redaction/
patches) ship in v1.0 if ready, else v1.1 — without failing the gate (PRD §8).
