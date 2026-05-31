<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-009: Use per-framework compilers behind an adapter interface (not generic DOM parsing)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-002
- **Related:** `tech-stack.md` §9; FR-SCORE-7, NFR-FW-1; adapters domain/packages

## Context

Several capabilities need real source introspection: file/component mapping in findings'
`Location`, and deterministic fix snippets for measured findings (FR-SCORE-7). NFR-FW-1 requires
stack-aware fixes verified for React/Next, Vue, and Svelte, with framework-agnostic DOM/HTML
checks on any stack. Generic HTML parsing cannot recover component structure from framework
source.

## Decision

One **adapter interface** in `core`; one leaf package per framework implementing it with that
framework's **actual compiler**: React/Next + TS/JS via `@babel/parser` +
`@typescript-eslint/typescript-estree`; Vue via `@vue/compiler-sfc`; Svelte via
`svelte/compiler`; framework-agnostic via `parse5` (+ optional `happy-dom`). New framework
support = a new additive `adapters/<fw>` package — conflict-free (ADR-002).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Per-framework compilers behind an interface (chosen)** | correct component introspection per stack; additive, conflict-free; agnostic `parse5` covers the rest | one dependency per framework |
| **Generic DOM/HTML parsing only** | one parser | can't recover component identity/props from JSX/SFC/Svelte source → no real file/component mapping or stack-aware fixes (conflates static parsing with DOM simulation) |
| **Babel-only for everything** | fewer deps | wrong for Vue SFC and Svelte, which need their own compilers |

## Consequences

- **Positive:** accurate location/fix data per framework (FR-SCORE-7); the adapter interface +
  per-adapter fixture suites (NFR-FW-1) keep each framework independently testable; the
  agnostic path always works so any stack gets DOM/HTML checks.
- **Negative / accepted:** more compiler dependencies; each must be tracked on upgrade.
- **Risk / mitigation:** a fix that only works on one stack while others are claimed is a bug
  (NFR-FW-1) → per-framework fixture suites gate this in CI.

## Team / maintenance

All are standard compiler/AST APIs (high agent compatibility). Adapters are leaf packages, so
framework work never touches `core` or other adapters.
