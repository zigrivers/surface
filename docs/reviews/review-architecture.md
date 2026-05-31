<!-- scaffold:review-architecture v1 2026-05-31 -->

# Review Report: System Architecture (`docs/system-architecture.md`)

## Executive Summary

The architecture was reviewed across the architecture-specific failure modes by three
reviewers — Claude (all passes), **Codex** (9 findings, gate: *conditional-pass*), **Gemini**
(2 findings, gate: *conditional-pass*). The document was sound on domain coverage, ADR
traceability, and invariants; the findings clustered on one root theme — an **implicit
composition/ownership model** — plus two incomplete flows. **12 findings actioned (7 P1, 5 P2,
1 P3 folded in)**; all fixed in `system-architecture.md` and one ADR amended.
**Final gate: PASS** — api-contracts / specs / implementation-plan can proceed.

Raw reviews: `architecture/codex-review.json`, `architecture/gemini-review.json`; synthesis in
`architecture/review-summary.md`.

## Findings by Pass (reconciled)

| # | Sev | Pass | Finding | Reviewer(s) | Resolution |
|---|---|---|---|---|---|
| R1 | P1 | Module structure | Composition root / DI unspecified → apparent core→leaf dependency | Claude (root theme) | §2a Composition root + published-export rule added |
| R2 | P1 | ADR compliance | §1/§5/§6 put `CaptureBackend` in core, but ADR-004 said `packages/capture` | Codex | ADR-004 amended (interface in core); §1/§5/§6 consistent |
| R3 | P1 | State consistency | Reporters/export/capture wrote `.surface` directly vs "Project State is sole writer" | Codex | §7 `StateStore` is sole writer; others return bytes/write-intents |
| R4 | P1 | Data-flow completeness | Only the live "audit a route" flow; static/source/screenshot/context inputs missing | Codex | §4.5 non-live/context-heavy flow added |
| R5 | P1 | Invariants | Re-audit could auto-resolve `gatedForHuman` findings without a Verdict | Codex + Gemini(P3) | §4.1/§4.2 gatedForHuman branch (no agent auto-resolve, FR-LOOP-3) |
| R6 | P1 | Extension points | Single `Reporter` interface conflated pure render with side-effectful export | Codex | §6 split → ReportRenderer / GateEvaluator / IssueExporter |
| R7 | P1 | Module structure | Lenses added by editing `core` → contention bottleneck vs ADR-002 | Gemini | lenses → `@surface/lenses/*` leaf packages, registered at runtime |
| R8 | P2 | Module structure | "implement core/src/interfaces" invites deep imports vs published-entry rule | Codex | §2a published-export-only + lint ban on `@surface/core/src/*` |
| R9 | P2 | Extension points | "cannot extend without ADR" list omitted persistence/REST/telemetry/proxy/egress | Codex | §6 list expanded; SQLite tied to a superseding ADR |
| R10 | P2 | Diagram/prose drift | `history.log` "outside the locked aggregate" read as outside lock | Codex | §7 clarified: under the same `.surface` StateLock |
| R11 | P2 | Data-flow completeness | §4.4 auth flow was CLI-only; FR-CAP-8 needs CLI+MCP | Codex | §4.4 → CLI/MCP + MCP auth-state input + structured error |
| R12 | P2 | Downstream readiness | api-contracts needs the CLI verb↔MCP tool↔core command map pointer | Claude | noted (handoff) — enumerated in api-contracts |

## Fix Plan (executed)

- **Batch 1 — composition/ownership (R1, R2, R3, R7, R8):** the root-cause batch. Added §2a
  (composition root + DI + published-export rule); `core` owns all plugin interfaces incl.
  `CaptureBackend` and `StateStore`; lenses became leaf packages; ADR-004 amended.
- **Batch 2 — flow & invariant completeness (R4, R5, R11):** §4.5 non-live flow; gatedForHuman
  branches in §4.1/§4.2; §4.4 CLI+MCP auth.
- **Batch 3 — interface & constraint precision (R6, R9, R10):** Reporter split into three
  interfaces; expanded the no-extension-without-ADR list; clarified `history.log` locking.

## Fix Log

| Batch | Findings | Changes | New issues |
|---|---|---|---|
| 1 | R1,R2,R3,R7,R8 | §2a added; §2/§5/§6 interface ownership + lenses-as-packages; §7 StateStore; ADR-004 amended | None |
| 2 | R4,R5,R11 | §4.5 added; §4.1/§4.2 gatedForHuman; §4.4 CLI/MCP | None |
| 3 | R6,R9,R10 | §6 Reporter split + extended ADR-gated list; §7 history.log lock note | None |

## Re-Validation Results

- Verified present: composition-root section, `StateStore` sole-writer (8 refs), `@surface/lenses`
  leaf packages, the three split reporter interfaces, the gatedForHuman branch, the non-live
  flow, MCP auth-state input.
- ADR-004 now states the capture interface lives in `core` (no longer conflicts with §1/§5/§6).
- Re-checked: core imports no leaf package (DI at composition root); no new P0/P1 introduced.

## Downstream Readiness Assessment

- **Gate result:** **Pass** — api-contracts (CLI verb / MCP tool / core command schemas),
  specs, and implementation-plan can proceed.
- **Handoff notes:**
  1. **api-contracts** enumerates the concrete CLI verb ↔ MCP tool ↔ core-command mapping and
     the three reporter interface signatures (ReportRenderer/GateEvaluator/IssueExporter).
  2. The **lens package boundary** (`@surface/lenses/*`) and the orchestrator's runtime lens
     registry are an implementation-plan concern.
  3. The **`StateStore` write-intent API** (how capture/reporters hand bytes to the sole writer)
     is a specs detail.
- **Remaining P2/P3:** 0 open (all actioned).
