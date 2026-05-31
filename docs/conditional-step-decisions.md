<!-- scaffold:conditional-step-decisions v1 2026-05-31 -->

# surface — Conditional ("if-needed") Pipeline Step Decisions

> Explicit rulings on each conditional step, recorded per the build-out instruction
> ("make an explicit decision and record it"). Drivers: surface is a **CLI + MCP tool with no
> GUI and no database** (ADR-003 file-based state; ADR-008 CLI+MCP, no REST), targeting the
> claude-code / codex / gemini agent platforms.

| Step | Decision | Rationale |
|---|---|---|
| **api-contracts** (+ review-api) | **YES — run** | surface has an MCP server (FR-IF-2, NFR-MCP-1) with versioned tool schemas + a POSIX CLI (FR-IF-1) + structured `findings.json`/SARIF output. The contracts (CLI verbs, MCP tools, output schemas, exit codes) are first-class and were explicitly deferred here by review-architecture. |
| **platform-parity-review** | **YES — run** | surface ships agent integrations for claude-code / codex / gemini (config.yml platforms); parity of the generated command/skill assets across them is real and worth auditing. |
| **add-e2e-testing** | **YES — run** | CLI e2e is feasible and valuable (spawn the `surface` binary, assert exit codes / `--json` shape / closed-loop on a fixture app). Complements the unit/contract layers in ADR-015. |
| **design-system** | **SKIP** | surface has **no GUI** — it *audits* other apps' visual languages; it does not render one. A color palette / typography scale / theme config is N/A. (The KB's design-system *knowledge* for auditing targets lives in `content/knowledge/`, not a design system for surface itself.) |
| **database-schema** (+ review-database) | **SKIP** | ADR-003 chose **file-based `.surface/` state, no database**; therefore there is no schema/ORM/migration. The state-file shapes are zod schemas (ADR-005) defined in `core/src/schema`, not DB tables. |
| **ux-spec** (+ review-ux) | **SKIP** | No GUI ⇒ no visual user flows, breakpoints, or component states to specify. surface's only "UX" is **terminal/CLI + MCP** interaction, already specified: progressive disclosure + accessible terminal output + actionable errors (`docs/user-stories.md` UX enhancements), NFR-OWNOUT-1, and ADR-018 (output/logging). A GUI-oriented ux-spec would be N/A boilerplate. |

*If surface later grows a GUI/dashboard (not in v1 scope, PRD §14), design-system + ux-spec
should be revisited.*
