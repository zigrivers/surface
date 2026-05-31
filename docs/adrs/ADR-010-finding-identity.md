<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-010: Derive stable finding identity from hash(lens + issueType + location anchor)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-003, ADR-004, ADR-005
- **Related:** `tech-stack.md` §11; FR-RULE-5, FR-LOOP-2; Closed Loop domain

## Context

The closed loop is surface's unit of value: re-audit must reliably mark a finding
resolved/still-failing/regressed, which requires a **stable identity** for the same defect
across runs (FR-LOOP-2). DOM drift between runs must not silently break this — an unmatchable
anchor must be reported `identity-broken`, never silently `resolved` (FR-RULE-3, LOOP-I2). The
PRD fixes the *contract* (FR-RULE-5) and leaves the *algorithm* to this phase (§16).

## Decision

`FindingIdentity = hash(lens + ":" + issueType + ":" + locationAnchor)`, where `locationAnchor`
**prefers agent-browser's deterministic element ref (`@e1…`)** when present, else falls back to
`selector | component | file` (most-stable available). The identity key is immutable and never
reused. On re-audit, an anchor that cannot be matched yields `status: identity-broken`, not a
guessed resolved/regressed. The matching algorithm tolerates bounded DOM drift; exact tolerance
parameters are specced/tuned downstream.

**Collision handling (review: Codex P1).** Coarse anchors (`component`/`file` only) can collide
when two distinct findings share the same lens + issueType + location. The key therefore
includes a **stable secondary discriminator** (e.g. an ordinal over the sorted set of distinct
findings at that anchor) so distinct defects get distinct keys; if two candidates cannot be
disambiguated within a run, both are marked **`identity-broken`** rather than merged — never
collapse two real defects into one id.

**Drift-tolerance acceptance criteria (review: Codex P2).** Before implementation, the matching
algorithm must pass a fixture corpus exercising: unchanged node (keeps id), reordered siblings
(keeps id), moved/renested node (keeps id when a deterministic ref exists; else identity-broken),
attribute-only change (keeps id), and ambiguous/coarse-anchor collision (identity-broken). The
conservative default is **prefer `identity-broken` over a wrong match**; tolerance parameters
are revisited if the corpus shows excessive false breaks.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **lens+issueType+anchor, prefer element ref (chosen)** | stable across cosmetic DOM changes when a deterministic ref exists; degrades gracefully to selector/component/file; honors the explicit-identity-break rule | requires agent-browser for the strongest anchor; drift tolerance needs tuning |
| **Positional/index-based identity** | trivial | breaks on any reorder; high false regression/resolution |
| **Full-content hash of the finding** | exact-match dedupe | any rationale/severity change mints a new id — destroys cross-run continuity |
| **Model-judged "same issue?" matching** | flexible | non-deterministic — unacceptable for a trust/identity primitive (ADR-005) |

## Consequences

- **Positive:** reliable status transitions (FR-RULE-3); element-ref preference ties identity
  to the most stable anchor available (justifies agent-browser's value, ADR-004); the
  explicit `identity-broken` path prevents silent false "resolved" (the regression-ships
  failure mode).
- **Negative / accepted:** drift-tolerance parameters are an open tuning task (§16); without
  agent-browser, identity rests on selector/component stability.
- **Risk / mitigation:** over-aggressive matching → conservative default (prefer
  `identity-broken` over a wrong match); identity tests in CI (tdd.md: unchanged defect keeps
  its id; drift → identity-broken, never silent resolved).

## Team / maintenance

A pure hashing function over stable inputs is deterministic and unit-testable — exactly the
property a trust primitive needs.
