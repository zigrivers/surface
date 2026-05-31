<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-004: Support dual auto-detected capture backends behind one capture interface

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** `tech-stack.md` §7; Capture domain; FR-CAP-3,6,7, NFR-PORT-1, NFR-SEC-1

## Context

Capture turns a `Target` into observed artifacts (screenshot, DOM, a11y tree, computed styles).
The PRD requires **two interchangeable, auto-detected backends** — Playwright and agent-browser
(vercel-labs) — with a static+screenshot fallback when neither is present (NFR-PORT-1), and
prefers agent-browser's deterministic element refs (`@e1`) as evidence/identity anchors
(FR-CAP-7, feeds ADR-010).

## Decision

Define a single **capture interface** in `packages/capture`; implement three backends behind it
— `playwright`, `agent-browser` (invoked as an external CLI via `execa`), and `static`. Backend
selection is a deterministic policy (record the chosen backend on the `Capture`). The interface
is the seam that keeps the rest of the system backend-agnostic.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Both, behind an interface (chosen)** | portability (NFR-PORT-1); agent-browser's `@e` refs improve identity stability (ADR-010); static fallback keeps surface useful with no browser | two backends = more surface area to test (R-5) |
| **Playwright only** | mature, one dependency | loses deterministic element refs and React-tree mapping; no fallback story |
| **agent-browser only** | best refs, agent-oriented | young external Rust CLI; not yet battle-tested as a sole dependency |
| **Headless-Chrome/CDP direct** | minimal deps | re-implements what Playwright/agent-browser already provide; high maintenance |

## Consequences

- **Positive:** matrix-tested across {playwright, agent-browser, neither} (NFR-PORT-1); the
  interface isolates agent-browser's youth (a watch item) from the core.
- **Negative / accepted:** added test matrix and capture-selection logic; Playwright needs a
  browser install (lazy-install + clear first-run messaging).
- **Risk / mitigation:** agent-browser instability is contained behind the interface and
  contract-tested; `execa` normalizes its CLI failures to `SurfaceError`. Domain allowlists +
  opt-in network interception satisfy NFR-SEC-1.

## Team / maintenance

`execa` child-process management is well-trodden. The capture interface is the only place that
knows backend specifics, minimizing change amplification.
