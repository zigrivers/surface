<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-008: The public API is CLI + MCP (no REST); the MCP tool schema is versioned

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-007
- **Related:** `tech-stack.md` §6; FR-IF-2, NFR-MCP-1; Interfaces (adapter); api-contracts

## Context

The "API style" decision for surface is unusual: surface is a local tool, not a web service.
Its agent-first GTM (vision) makes **native agent embedding** the headline interface — agents
should call surface as MCP tools, not over HTTP. The PRD requires an MCP server (FR-IF-2) with
a documented, **versioned, backward-compatible** tool schema (NFR-MCP-1).

## Decision

surface exposes **two public contracts and no REST/HTTP API**:
1. the POSIX **CLI** (ADR-007), and
2. an **MCP server** built on the official `@modelcontextprotocol/sdk` (`packages/mcp`),
   exposing surface's verbs as MCP tools with **versioned schemas**; an incompatible schema
   change forces a major-version bump (NFR-MCP-1), enforced by schema snapshot tests.

Both adapters are thin layers over the same `core` services (the domain commands per context).
The exact tool/command schemas are finalized in `api-contracts`.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **CLI + MCP, no REST (chosen)** | native agent embedding (the agent-first bet); no server to host/secure; matches NFR-DATA-1 (local) | MCP SDK is 1.x and evolving (watch item) |
| **Add a REST/HTTP API** | familiar integration | introduces a hosted-service surface surface explicitly is not (uptime/auth/security burden); contradicts local-only privacy |
| **CLI only (no MCP)** | simplest | forfeits the agent-first GTM (FR-IF-2) — the core differentiator |

## Consequences

- **Positive:** agents embed surface natively via MCP; the only network surface is the
  optional MCP server (NFR-MCP-1 covers it); no hosted-service NFRs (PRD §10 marks uptime N/A).
- **Negative / accepted:** MCP SDK is young — pin the minor, track releases, snapshot-test the
  schema.
- **Risk / mitigation:** silent incompatible schema changes → schema snapshot tests + mandatory
  major bump on breaking change (NFR-MCP-1).

## Team / maintenance

MCP SDK patterns are industry-standard and well-represented. Sharing one `core` behind both
adapters means a verb is implemented once and surfaced twice.
