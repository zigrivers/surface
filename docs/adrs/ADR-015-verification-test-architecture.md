<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-015: Verification & test architecture (release gates mapped to NFRs)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-002, ADR-005
- **Related:** `docs/tdd.md` (testing standard of record); SC-4, NFR-DET-1, NFR-CLI-1, NFR-MCP-1, NFR-FW-1, NFR-PORT-1, NFR-PERF-1
- **Added by:** review-adrs (consensus P1 — Codex P1, Gemini P2, Claude P2)

## Context

surface has multiple **release-blocking** verification contracts — measured-finding determinism
(SC-4/NFR-DET-1), CLI exit-code/JSON conformance (NFR-CLI-1), MCP schema stability (NFR-MCP-1),
the capture backend matrix (NFR-PORT-1), per-framework adapter fixtures (NFR-FW-1), finding-
identity transitions, SARIF validity, and a perf gate (NFR-PERF-1). `tdd.md` is the detailed
standard; this ADR records verification as an **architectural** decision and maps gates to NFRs.

## Decision

`docs/tdd.md` is the **testing standard of record**; this ADR fixes the architecture and the
release gates:

- **Runner/layers:** Vitest 4 (unit/integration), Playwright for capture tests, co-located
  `*.test.ts`, fixtures in `fixtures/`.
- **Non-negotiable test types (release-gating):** determinism tests for every measured producer
  (SC-4); identity tests (unchanged defect keeps id; drift → identity-broken, never silent
  resolved); method-integrity tests (no judged-as-measured, ADR-005); degradation tests (no
  model / no backend / oversized / context-overflow); concurrency tests (US-041).
- **Contract tests:** CLI exit codes + `--json` shape (NFR-CLI-1); MCP tool **schema snapshot**
  tests with mandatory major-bump on breaking change (NFR-MCP-1); SARIF v2.1.0 validation.
- **Matrices:** capture backend {playwright, agent-browser, neither} (NFR-PORT-1); per-framework
  adapter fixtures (NFR-FW-1).
- **Perf gate:** `quick` preset p95 < 30s benchmark in CI (NFR-PERF-1).
- **Coverage floors:** core ≥90% line+branch; adapters/grounding ≥85%; CLI/MCP smoke+contract.
- **CI mirror:** CI runs `pnpm run check` — identical to local (dev-setup).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Verification-as-architecture ADR + tdd.md (chosen)** | release gates are explicit and traced to NFRs; nothing trust-critical rests on convention | upfront test infrastructure |
| **Leave testing to tdd.md only** | less duplication | the *gating* decisions (what blocks release) weren't recorded as architecture (Codex P1) |
| **Coverage-target-only policy** | simple metric | coverage % misses determinism/identity/method-integrity — the tests that actually protect trust |

## Consequences

- **Positive:** every release-blocking NFR has an owning test type; mock boundaries are fixed
  (mock model inference + external CLIs/APIs + clock; never mock compilers/zod/scoring/state).
- **Negative / accepted:** the capture+grounding matrix is slower CI (run on changes to those
  packages).
- **Risk / mitigation:** flaky capture tests → real headless browser on local fixture HTML;
  agent-browser behind a contract-tested interface (ADR-004).
