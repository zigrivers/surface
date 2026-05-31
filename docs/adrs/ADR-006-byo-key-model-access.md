<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-006: Model access is BYO-key, layered, and fully optional

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-005
- **Related:** `tech-stack.md` §10; PRD §12 (BYO-key contract), NFR-DATA-1, FR-SCORE-5; Findings `ReconciliationService`

## Context

Judged findings need model inference, but surface is open-source and privacy-sensitive:
captures may contain PII or proprietary code (NFR-DATA-1). The product must run usefully with
**no model and no credentials**, and must never transmit captured content to a third party
without explicit user configuration.

## Decision

Three opt-in tiers layered over the always-on measured layer:

1. **No model → measured-only.** Zero config/cost; judged lenses are skipped and *reported* as
   skipped (graceful degradation, US-012).
2. **BYO-key SDK → judged findings.** The user supplies their own provider key (env var) or
   local endpoint; surface calls it via that provider's official SDK. The user owns cost, rate
   limits, and data exposure; surface never proxies or bills.
3. **Multi-model reconciliation (depth 4–5) → higher trust.** Via an `execa` adapter to
   installed `codex`/`claude`/`gemini` CLIs and/or optional `mmr`, reconciled by the Findings
   `ReconciliationService`.

surface ships **no model and no credentials**.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Layered BYO-key, optional (chosen)** | privacy-by-default; stands alone as OSS; user controls cost & data | judged quality depends on the user's chosen model |
| **Bundled/proxied inference** | turnkey judged findings | surface would bill/proxy, transmit captures by default — violates NFR-DATA-1; OSS cost model untenable |
| **Single hard-coded provider** | simpler | vendor lock-in; excludes local models and multi-model reconciliation (FR-SCORE-5) |

## Consequences

- **Positive:** the keyless default is safe and free; multi-model is an additive trust layer;
  no provider lock-in.
- **Negative / accepted:** judged-coverage variance across user models; reconciliation depends
  on external CLIs that may be absent (degrade to single-model, record which channels ran).
- **Risk / mitigation:** accidental transmission is a release blocker (NFR-DATA-1) → measured-
  only is the structural default (ADR-005); a model call happens only when a key is configured.
- **Usability mitigation (review: Gemini P2):** BYO-key is friction for the P2 non-designer.
  Beyond docs, provide a guided **`surface config setup-model`** command that detects which
  provider keys are present, links to where each key is issued, validates a pasted key with a
  cheap probe call, and writes it to `.env` (gitignored) — so key setup is a guided step, not a
  documentation scavenger hunt. (Committed as the concrete mitigation; exact UX → specs.)

## Team / maintenance

Provider SDKs + CLI invocation via `execa` are well-trodden; `mmr` is optional so the OSS tool
never hard-depends on it.
