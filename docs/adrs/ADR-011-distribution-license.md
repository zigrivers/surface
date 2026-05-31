<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-011: Distribute via npm + npx + Homebrew; license MIT

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** `tech-stack.md` §15; PRD §11 (licensing constraint), §12

## Context

surface is open-source and locally-run; "deployment" is package distribution, not hosting.
The license must be compatible with key dependencies — notably **agent-browser (Apache-2.0)** —
and maximize community adoption (the agent-first OSS GTM). Sibling tools (`bd`, agent-browser)
are Homebrew-distributed.

## Decision

- **Distribution:** **npm** + **`npx surface`** (matches Scaffold and Node norms) + a
  **Homebrew tap**. The brew formula wraps the Node CLI (or an optional Bun/esbuild-built single
  binary for users without Node — ADR-001's retained Bun build path).
- **License: MIT** — permissive, ubiquitous for JS/TS OSS, fully compatible with Apache-2.0
  deps. A `NOTICE`/attributions file tracks bundled third-party licenses.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **npm+npx+Homebrew, MIT (chosen)** | zero-install via npx; brew fits the toolchain; MIT maximizes adoption and is Apache-2.0-compatible | maintain a brew formula + npm release |
| **npm only** | least to maintain | misses brew users who install `bd`/agent-browser that way |
| **Apache-2.0 license** | patent grant | heavier than MIT for a community utility; no dependency requires it |
| **Copyleft (GPL/MPL)** | share-alike | deters commercial/agent-pipeline embedding — counter to the agent-first adoption bet |

## Consequences

- **Positive:** frictionless adoption (`npx surface`); brew parity with sibling tools; MIT
  removes licensing friction for embedding in agent pipelines (P1) and is clean against
  Apache-2.0 deps.
- **Negative / accepted:** two release channels (npm + brew) to keep in sync; a `NOTICE` file
  to maintain.
- **Risk / mitigation:** license incompatibility from a future dep → CI license check; keep the
  attributions file current on dependency changes.

## Team / maintenance

npm publish + a brew formula are standard OSS release mechanics; the optional single-binary
build is the only nuance (Bun/esbuild), isolated to the release pipeline.
