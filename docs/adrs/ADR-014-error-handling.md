<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-014: Unified error-handling & failure semantics (`Result<T, SurfaceError>`)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-005, ADR-007, ADR-008
- **Related:** `coding-standards.md` §Error Handling; PRD §7 (sad paths), NFR-CLI-1, NFR-MCP-1, US-050
- **Added by:** review-adrs (Gemini P1 / Codex P2 — extracted from ADR-005)

## Context

surface is a modular monorepo (ADR-002) with many failure-prone subsystems (capture backends,
model CLIs, octokit, adapters). The PRD §7 enumerates many sad paths, and two interfaces map
failures differently: the CLI to exit codes (NFR-CLI-1) and MCP to structured errors
(NFR-MCP-1). ADR-005 introduced `Result<T, SurfaceError>` for the trust invariant; the broader
error strategy deserves its own record so handling is consistent across packages.

## Decision

1. **Typed `SurfaceError` taxonomy:** `UsageError` (→ CLI exit 2), `ConfigError`,
   `CaptureError`, `GroundingError`, `AdapterError`, `ModelError`, `IntegrationError`,
   `StateError`, `RuntimeError`, `McpError` — each carrying a `cause` and an
   **actionable message** (what failed, likely cause, next command — US-050).
2. **`Result<T, SurfaceError>` at every package boundary;** throwing is confined to the
   CLI/MCP **edge**, which maps errors to exit codes (0/1/2) or MCP structured errors.
3. **No swallowed errors** — catch only to add context, then rethrow/convert (coding-standards).
4. **Degradation vs failure:** recoverable shortfalls (no model, no backend, oversized input)
   are **degradations** (run continues, reported), not errors (PRD §7); only unrecoverable
   conditions become errors.
5. **External tools** (Playwright, agent-browser, model CLIs, octokit) are wrapped in adapters
   that normalize failures to a `SurfaceError` with `cause`. Retryable integration failures use
   backoff (ADR-016).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Typed `Result` + edge-mapping (chosen)** | consistent, exhaustively handleable (agent-legible); clean CLI/MCP mapping; degradation distinct from failure | boundary boilerplate |
| **Exceptions throughout** | familiar | obscures success/failure contract at seams; easy to swallow; harder exhaustive handling |
| **Error codes (ints) only** | simple | loses context/cause and actionable messages (US-050) |

## Consequences

- **Positive:** every sad path in PRD §7 has a typed home and a deterministic interface
  mapping; degradation is first-class (matches the graceful-degradation NFRs).
- **Negative / accepted:** `Result` wrapping/boilerplate at boundaries.
- **Risk / mitigation:** edge mapping drift → CLI contract tests (NFR-CLI-1) + MCP error
  snapshot tests (NFR-MCP-1) in the verification architecture (ADR-015).
