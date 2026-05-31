<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-017: Grounding & lens execution (measured producers, source-of-truth precedence)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-004, ADR-005, ADR-012
- **Related:** `tech-stack.md` §8,§13; Evaluation & Findings domains; FR-PIPE-5..9, FR-LENS-1..5, NFR-A11Y-STD-1
- **Added by:** review-adrs (Codex P1)

## Context

The core evaluation produces measured and judged findings, but no ADR recorded *how* tools
become canonical `Evidence`, the measured-vs-judged source-of-truth precedence, lazy-loading of
heavy tools, or the lens plugin boundary. ADR-005 fixes the trust invariant and ADR-012 places
orchestration in a service; this ADR records the grounding/lens execution architecture between
them.

## Decision

- **Measured producers:** `@axe-core/playwright` + `axe-core` (a11y, default WCAG 2.2 AA,
  NFR-A11Y-STD-1), `lighthouse` (perf-perception/extra a11y, **lazy-loaded** — large footprint),
  `eslint-plugin-jsx-a11y` (static source a11y for React), and computed-styles/contrast from the
  capture backend. Each emits a `tool-result` `Evidence` (tool, rule, measuredValue, threshold).
- **Judged producers:** model-backed lenses (ADR-006) emit `cited-heuristic`/`dom`/
  `screenshot-region` evidence; never a `tool-result`.
- **Source-of-truth precedence (EVAL-I7):** for a contested fact, **measured wins**; the model
  interprets, never overrides, a measurement — recorded as a `SynthesisDecision`.
- **Lens boundary:** each `Lens` declares its `method`, `requiresModel`, `requiresLiveDom`; the
  orchestrator (ADR-012) selects the lens set from overlay ∩ preset and skips lenses whose
  inputs are absent (emitting `LensSkipped`). Lenses are additive modules behind a lens
  interface in `core`.
- **Lazy loading:** heavy tools (Lighthouse) load only when their lens runs, protecting CLI
  startup/perf (NFR-PERF-1, ADR-001).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Tool adapters → canonical Evidence, measured-wins (chosen)** | uniform Evidence; trust precedence explicit; lenses pluggable; lazy heavy tools | adapter layer per tool |
| **Lenses call tools directly (no Evidence normalization)** | fewer layers | every lens reinvents evidence shaping; measured-wins becomes ad hoc; hard to test determinism |
| **Eager-load all grounding tools** | simpler wiring | Lighthouse footprint hurts startup on every run (NFR-PERF-1) |

## Consequences

- **Positive:** measured findings are deterministic and uniformly evidenced (SC-4); the
  measured-wins rule is centralized and auditable; new lenses are additive.
- **Negative / accepted:** a normalization adapter per grounding tool.
- **Risk / mitigation:** nondeterministic tool output → determinism tests over recorded tool
  JSON (ADR-015); mock the tool *runner*, never the assertion logic (tdd.md).
