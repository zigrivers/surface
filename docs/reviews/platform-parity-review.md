<!-- scaffold:platform-parity-review v1 2026-05-31 -->

# Platform Parity Review — surface

> Reviewer: Claude (enhanced single-model; multi-model reserved for the implementation-plan
> gate). **Scope note:** by *deployment target*, surface is **single-platform (web-first)** —
> it is a local CLI that audits **web** UI; native mobile/desktop are deferred (PRD §11/§14), so
> the deployment-target dimension of this step is **N/A (correctly single-platform)**. Per owner
> direction, this review audits the dimension where surface genuinely targets 2+ platforms: the
> **agent/AI-tool platforms** it integrates with — **claude-code · codex · gemini** — as (a)
> consumers of surface's interfaces and (b) multi-model reconciliation channels (FR-SCORE-5).

## Feature parity matrix (agent platforms)

| Capability | claude-code | codex | gemini | Parity verdict |
|---|---|---|---|---|
| **MCP server consumption** (FR-IF-2) | native MCP client | MCP support varies by version | MCP support varies by version | **Gap** — not guaranteed on codex/gemini |
| **CLI invocation** (FR-IF-1, NFR-CLI-1) | yes (shell) | yes (shell) | yes (shell) | **Parity** — universal fallback |
| **Runner skill** (FR-IF-3, NL→command) | skill format native | needs equivalent | needs equivalent | **Gap** — skill packaging is claude-leaning |
| **Multi-model reconciliation channel** (FR-SCORE-5, via execa CLI) | `claude` CLI | `codex` CLI | `gemini` CLI | **Parity by design**, but see resilience |
| **Generated agent-instruction asset** | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` | **Parity** — all three emitted |
| **Structured output (`--json`/SARIF)** | yes | yes | yes | **Parity** — interface-level, platform-agnostic |

## Findings per concern

| # | Sev | Concern | Finding | Recommended fix |
|---|---|---|---|---|
| PP1 | P1 | Interface availability | MCP (FR-IF-2) is the headline agent interface, but native MCP client support is **not guaranteed** on codex/gemini. A codex/gemini agent could be left without surface access if it assumes MCP. | Make the **POSIX CLI the universal contract** (it already is, NFR-CLI-1) and document MCP as the *preferred-when-available* path with CLI fallback. The runner skill maps to CLI when MCP is absent (ADR-008). Recorded as a handoff to implementation-plan. |
| PP2 | P2 | Runner-skill parity | The NL runner skill (FR-IF-3) is easy to ship as a claude-code skill but needs an equivalent invocation path for codex/gemini. | Implement the runner skill as a thin NL→CLI/MCP mapper that ships per-platform (skill for claude-code; prompt/command templates for codex/gemini), all over the same `core` commands. |
| PP3 | P2 | Reconciliation resilience (observed) | The `gemini` CLI exhibited model-router flakiness during these very reviews (`NumericalClassifierStrategy` errors; needed an explicit `-m` model). A reconciliation run that hard-depends on every channel would be fragile. | Confirm FR-SCORE-5's documented behavior is implemented: **degrade to single-model and record which channels participated** when a CLI fails (US-071). Prefer explicit model selection over auto-routing for the gemini channel. |
| PP4 | P3 | Asset parity | `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` exist; ensure they stay content-equivalent (pointers to the same Key Commands / workflow), not drifting per platform. | `claude-md-optimization` + an asset-sync note keep the three in parity (one source, per-platform pointers). |

## Coverage by document

- `docs/plan.md` — web-first deployment target is explicit and consistently single-platform
  (no native gaps); the *agent-platform* targeting is implicit in the agent-first GTM. **OK.**
- `docs/tech-stack.md` §10 — multi-model via codex/claude/gemini CLIs is documented with
  optional `mmr`; degradation stated. **OK** (PP3 is an implementation-resilience note).
- `docs/api-contracts.md` — CLI is the universal contract; MCP is the agent-native one. PP1 is
  an availability/positioning clarification, addressed by the existing CLI fallback.
- `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` — present for all three platforms (PP4).

## Readiness

- **Gate:** **Conditional pass.** No deployment-platform parity issues (single-platform by
  design). The agent-platform findings (PP1/PP2/PP3) are **implementation-plan handoffs**, not
  blockers for planning: the CLI universal-contract + documented degradation already de-risk them.
- **Handoff to implementation-plan:** (1) CLI as the guaranteed cross-agent contract with MCP
  preferred-when-available; (2) per-platform runner-skill packaging over one `core`; (3)
  resilient reconciliation that degrades + records channels.
