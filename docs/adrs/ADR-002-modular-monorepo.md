<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-002: Structure surface as a modular monorepo (pnpm workspaces + Turborepo)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** ADR-009, ADR-012; `tech-stack.md` §1,§3; `project-structure.md`

## Context

surface has clean internal seams — a core engine, CLI, MCP server, capture backends, grounding,
per-framework adapters, a knowledge base, and reporters (the 7 bounded contexts of
`domain-models/`). The PRD's scope-discipline risk (R-1) and the agent-parallelism goal
(`project-structure.md`: "two agents rarely touch the same file") both favor explicit package
boundaries with independent versioning.

## Decision

A **modular monorepo**: pnpm workspaces (v11) for strict, disk-efficient dependency isolation +
Turborepo (v2.9) for cached task graphs. Packages communicate only through published entry
points (`@surface/<pkg>`); `core` owns the canonical schema and is depended on by all, never
the reverse; adapters and reporters are conflict-free leaf packages.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Modular monorepo (chosen)** | clean context boundaries; parallel agent work; independent versioning; task caching | workspace/build config overhead |
| **Single package** | simplest to start | blurs the adapter/interface seams the PRD needs; every change touches one tree (merge contention) |
| **Microservices / multi-repo** | independent deploy | surface is a *local tool* — no network service boundaries to justify it; cross-repo coordination cost |
| **Nx monorepo** | powerful generators/graph | heavier and more opinionated than a utility CLI warrants |

## Consequences

- **Positive:** bounded contexts map 1:1 to packages; new framework support = a new additive
  `adapters/<fw>` package (ADR-009); Turborepo caches lint/test/build across the graph.
- **Negative / accepted:** contributors must understand workspace filters; Turborepo *remote*
  caching needs CI care (local is zero-config).
- **Risk / mitigation:** deep cross-package imports would erode boundaries → lint-enforced
  "published entry points only" rule (coding-standards) and `core`-only-downward dependency.

## Team / maintenance

pnpm + Turborepo are small, declarative, well-documented configs — high agent compatibility.
The package graph is the unit of parallel work for both human and agent contributors.
