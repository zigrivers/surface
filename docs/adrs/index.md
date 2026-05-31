<!-- scaffold:adrs v1 2026-05-31 -->

# surface — Architecture Decision Log

> One ADR per significant decision (`ADR-NNN-title.md`). Dependency-level choices and their
> rejected alternatives are detailed in `docs/tech-stack.md` (multi-model-researched); these
> ADRs record the **architecturally significant** decisions with full context, options,
> consequences, and cross-references. No ADR may contradict `tech-stack.md` or another ADR
> without an explicit supersession link. Inputs: `docs/domain-models/`, `docs/plan.md`,
> `docs/tech-stack.md`.

## Decision log

| ADR | Decision | Status | Depends on | PRD / domain driver |
|---|---|---|---|---|
| [ADR-001](./ADR-001-typescript-node-esm.md) | TypeScript on Node.js ≥22, ESM | Accepted | — | tech-stack §2; agent-maintainability |
| [ADR-002](./ADR-002-modular-monorepo.md) | Modular monorepo (pnpm + Turborepo) | Accepted | 001 | PRD R-1; project-structure |
| [ADR-003](./ADR-003-file-based-state.md) | File-based `.surface/` state, atomic + locked (no DB) | Accepted | 001 | FR-IF-5, US-041, §7; Project State domain |
| [ADR-004](./ADR-004-dual-capture-backends.md) | Dual auto-detected capture backends behind one interface | Accepted | 001 | FR-CAP-3,6,7; NFR-PORT-1; Capture domain |
| [ADR-005](./ADR-005-measured-judged-invariant.md) | Measured/judged separation as a core architectural invariant | Accepted | 001 | vision #2; FR-LENS-5; Findings domain |
| [ADR-006](./ADR-006-byo-key-model-access.md) | BYO-key, layered, optional model access | Accepted | 001, 005 | PRD §12, NFR-DATA-1; FR-SCORE-5 |
| [ADR-007](./ADR-007-cli-commander-posix.md) | CLI via commander; POSIX conformance as contract | Accepted | 001 | FR-IF-1, NFR-CLI-1 |
| [ADR-008](./ADR-008-mcp-server-api-style.md) | Public API = CLI + MCP (no REST); versioned MCP schema | Accepted | 001, 007 | FR-IF-2, NFR-MCP-1 |
| [ADR-009](./ADR-009-per-framework-adapters.md) | Per-framework compilers behind an adapter interface | Accepted | 002 | FR-SCORE-7, NFR-FW-1; adapters |
| [ADR-010](./ADR-010-finding-identity.md) | Finding identity = stable hash(lens+issueType+anchor) | Accepted | 003, 005 | FR-RULE-5, FR-LOOP-2; Closed Loop |
| [ADR-011](./ADR-011-distribution-license.md) | Distribution npm+npx+Homebrew; MIT license | Accepted | 001 | PRD §11,§12 (Apache-2.0 compat) |
| [ADR-012](./ADR-012-pipeline-orchestration.md) | Pipeline orchestration as an application service | Accepted | 002, 003, 005 | FR-PIPE-1..14; Evaluation domain (review: Gemini P3) |
| [ADR-013](./ADR-013-security-data-boundary.md) | Safe-by-default security & data-handling boundary | Accepted | 001,003,006,008 | NFR-SEC-1, NFR-DATA-1, FR-CAP-8,11 |
| [ADR-014](./ADR-014-error-handling.md) | Unified error handling (`Result<T,SurfaceError>`) | Accepted | 001,005,007,008 | PRD §7, NFR-CLI-1, NFR-MCP-1, US-050 |
| [ADR-015](./ADR-015-verification-test-architecture.md) | Verification & test architecture (release gates) | Accepted | 001,002,005 | SC-4, NFR-DET/CLI/MCP/FW/PORT/PERF |
| [ADR-016](./ADR-016-reporting-export.md) | Reporting & export (local-first; never lose a finding) | Accepted | 003,005,014 | FR-OUT-1..4, FR-INT-2,3, FR-RULE-4, US-060 |
| [ADR-017](./ADR-017-grounding-lens-execution.md) | Grounding & lens execution (measured-wins precedence) | Accepted | 004,005,012 | FR-PIPE-5..9, FR-LENS-1..5, NFR-A11Y-STD-1 |
| [ADR-018](./ADR-018-observability-logging.md) | Observability & logging (privacy-safe, no telemetry) | Accepted | 001,013 | NFR-OBS-1, NFR-DATA-1, NFR-OWNOUT-1 |

## Decision dependency graph

```
ADR-001 (TS/Node/ESM)
  ├── ADR-002 (monorepo) ── ADR-009 (adapters), ADR-012 (orchestration), ADR-015 (verification)
  ├── ADR-003 (file state) ── ADR-010 (identity), ADR-012, ADR-013 (security), ADR-016 (reporting)
  ├── ADR-004 (capture) ── ADR-010, ADR-017 (grounding)
  ├── ADR-005 (measured/judged) ── ADR-006 (model access), ADR-010, ADR-012, ADR-014 (errors), ADR-015, ADR-016, ADR-017
  ├── ADR-006 ── ADR-013
  ├── ADR-007 (CLI) ── ADR-008 (CLI+MCP+skill API), ADR-014
  ├── ADR-008 ── ADR-013, ADR-014
  ├── ADR-013 ── ADR-018 (observability)
  ├── ADR-014 ── ADR-016
  └── ADR-011 (distribution/license)
```

All edges point to an existing, lower-or-recorded ADR; the graph is acyclic.

## Criteria-mandated categories that are N/A (recorded explicitly, not forgotten)

The ADR quality criteria list database/ORM/deployment/auth/API-style. surface is a **locally-run
CLI + MCP tool**, so several map to "deliberately none":

- **Database & ORM → N/A.** [ADR-003](./ADR-003-file-based-state.md) chooses file-based
  `.surface/` state instead of a database; there is therefore no ORM. (Revisit trigger noted
  in ADR-003 if finding volume outgrows files.)
- **Deployment target → N/A (no hosted service).** surface runs on the user's machine /
  CI runner; "deployment" is package **distribution**, decided in
  [ADR-011](./ADR-011-distribution-license.md). No uptime/RTO/RPO (PRD §10 marks these N/A).
- **Authentication → N/A in the user-account sense, but the security boundary is recorded.**
  surface has no user accounts or sessions. The security-relevant concerns it *does* have —
  the MCP server posture (stdio/local, no remote listener, no auth in v1), **BYO model keys**
  ([ADR-006](./ADR-006-byo-key-model-access.md)), **capture auth-state injection** (FR-CAP-8, a
  *capture input*), domain allowlists, redaction, and no-default-exfiltration — are recorded in
  **[ADR-013](./ADR-013-security-data-boundary.md)** (NFR-SEC-1 / NFR-DATA-1). (Updated per
  review: Codex/Gemini P1 — the boundary is decided, not dismissed.)
- **API style → CLI + MCP + runner skill, not REST.** [ADR-008](./ADR-008-mcp-server-api-style.md):
  the public contracts are the POSIX CLI and the versioned MCP tool schema, with the NL runner
  skill (FR-IF-3) as a conversational adapter over them; there is no HTTP/REST API.
