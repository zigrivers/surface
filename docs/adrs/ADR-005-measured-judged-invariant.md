<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-005: Enforce the measured/judged separation as a core architectural invariant

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** ADR-006, ADR-010, ADR-012; vision principle #2; FR-LENS-5, NFR-TRUST-1; Findings domain

## Context

surface's entire trust proposition is that it never presents an AI opinion as a tool-confirmed
fact. The domain model encodes this as invariants (FND-I1/I2: a `measured` finding carries
real tool evidence; the rendered label derives solely from `Finding.method`). For this to be
real rather than aspirational, it must be an **architectural** constraint, not a convention.

## Decision

Make the measured/judged discipline a structural invariant of the codebase:

1. The canonical `Finding` schema (zod, owned by `core`) requires `method` explicitly and ties
   evidence kinds to method (measured ⟹ ≥1 `tool-result` evidence).
2. Every external input (captured DOM/JSON, model output, config, integration payload) is
   **parsed with zod at the boundary**; internal code trusts validated types.
3. Package boundaries return a discriminated **`Result<T, SurfaceError>`**; throwing is
   confined to the CLI/MCP edge where it maps to an exit code (NFR-CLI-1) / MCP error.
4. A **lint/review rule** rejects a `method:"measured"` finding without attached tool evidence,
   and reporters derive the measured/judged label only from `method` (RPT-I9).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Schema + boundary-zod + Result + lint rule (chosen)** | the trust invariant is enforced by the type system, runtime validation, and CI — not docs | upfront schema/boundary discipline |
| **Convention + code review only** | less ceremony | the one invariant surface cannot afford to violate would rest on human vigilance (NFR-TRUST-1 is zero-tolerance) |
| **Exceptions everywhere (throw-based)** | familiar | obscures the typed success/failure contract at package seams; harder for agents to handle exhaustively |

## Consequences

- **Positive:** a judged-as-measured finding becomes structurally hard to ship (schema +
  lint + render rule); exhaustive `switch` on the `Result`/method unions aids agent edits.
- **Negative / accepted:** more boilerplate at boundaries (zod parse + Result wrapping).
- **Risk / mitigation:** boundary discipline drift → enforced by the lint rule and determinism
  tests for measured producers (tdd.md). This ADR is the codebase expression of vision #2.

## Team / maintenance

Explicit `Result` + zod boundaries are highly agent-legible and make failure paths testable.
