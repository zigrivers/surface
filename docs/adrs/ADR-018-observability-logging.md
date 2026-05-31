<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-018: Observability & logging (structured, privacy-safe, no default telemetry)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-013
- **Related:** `tech-stack.md` §12; NFR-OBS-1, NFR-DATA-1, NFR-OWNOUT-1
- **Added by:** review-adrs (Codex P2 / Claude P3)

## Context

NFR-OBS-1 requires structured run logs and a knowledge-gap signal when the KB lacks a topic
(mirroring Scaffold's observe model). tech-stack §12 chose `pino`. Logging touches privacy
(NFR-DATA-1) and the human-output standard (NFR-OWNOUT-1), so the boundaries deserve a record.

## Decision

- **Library:** `pino` for run logs in library code; **never `console.log`** in libraries (the
  CLI presentation layer owns human output, NFR-OWNOUT-1). Diagnostics go to **stderr**; stdout
  stays clean for `--json` piping.
- **Structure:** logs carry a run id and event ids aligned with domain events
  (Capture*/Audit*/Finding*/ReAudit*), so a run is reconstructable.
- **Knowledge-gap signal (NFR-OBS-1):** when a lens/step finds no relevant KB entry, emit a
  `KnowledgeGapSignalled` event for the freshness audit.
- **Privacy-safe (NFR-DATA-1):** logs **never** contain captured content (DOM/screenshots/
  source) or secrets; only ids, counts, durations, statuses. Redaction (ADR-013) applies before
  anything reaches a log.
- **Verbosity:** `SURFACE_LOG_LEVEL` / `--verbose` (mirrors `SURFACE_DEBUG`); default `info`.
- **Telemetry:** **none by default.** Any future usage telemetry must be opt-in and never
  include file paths/contents/PII (cli-architecture guidance).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **pino, stderr, privacy-safe, no telemetry (chosen)** | structured + fast; clean stdout for pipes; privacy-safe by construction | log schema discipline |
| **console.\* logging** | zero deps | unstructured; pollutes stdout/`--json`; no levels |
| **Opt-out telemetry** | richer adoption signals | conflicts with NFR-DATA-1 privacy posture |

## Consequences

- **Positive:** runs are debuggable via structured logs and the inspectable `.surface/` state;
  knowledge gaps feed the KB freshness audit; stdout stays pipe-clean.
- **Negative / accepted:** contributors must use the pino logger, not `console`.
- **Risk / mitigation:** accidental content in logs → privacy-safe field policy + redaction
  before logging (ADR-013); `no-console` lint rule (eslint config).
