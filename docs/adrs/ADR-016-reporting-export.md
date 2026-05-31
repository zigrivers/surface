<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-016: Reporting & export architecture (local artifacts first; never lose a finding)

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-003, ADR-005, ADR-014
- **Related:** `tech-stack.md` §12; Reporting & Integrations domain; FR-OUT-1..4, FR-INT-2,3, FR-RULE-4, US-060, NFR-OWNOUT-1
- **Added by:** review-adrs (Codex P1)

## Context

Reporting & Integrations is a bounded context (domain-models/reporting.md) and tech-stack §12
chose octokit, `node-sarif-builder`, and sharp. The architecture-significant decisions —
local-artifacts-as-source-of-truth, export failure semantics, the CI gate, and output
accessibility — were not recorded as an ADR.

## Decision

- **Local artifacts are the source of truth (FR-OUT-1).** `findings.md`, `findings.json`,
  backlog, agent plan, and validation report are written under `.surface/` **before** any
  external export. `findings.json` is **byte-stable** for identical input (NFR-CLI-1).
- **Reporters are stateless domain services**, one per `ReportFormat` (md / json / sarif /
  github / alternatives); they are strictly read-only over Findings/Closed-Loop aggregates.
- **SARIF** output validates against **v2.1.0** (US-032); **GitHub** export via octokit creates
  Issues and posts Checks/PR annotations (FR-OUT-4).
- **Export failure semantics (US-060):** retry with backoff; on persistent failure, write the
  backlog locally, report **unsynced** items, and exit **non-zero** — never silently lose
  findings. Partial exports are tracked on the `IssueExport` aggregate.
- **CI gate (FR-RULE-4):** evaluates `SeverityBand`; fails on new measured P0/P1 by default;
  **never** fails on judged or `gatedForHuman`; thresholds are config-as-code.
- **Output accessibility (NFR-OWNOUT-1):** no color-only meaning; ANSI-degradable; progressive
  disclosure (top finding + count by default, `--all` for the rest).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Local-first, read-only reporters (chosen)** | findings are never lost on export failure; deterministic JSON; clean separation | must write locally even when exporting |
| **Export-first (tracker as source of truth)** | one place to look | a tracker outage loses findings; couples surface to a vendor (rejected, US-060) |
| **Single combined report** | simplest | can't serve both machine (json/sarif) and human (md) + CI annotations |

## Consequences

- **Positive:** export is best-effort over a durable local truth; the gate is tunable and never
  noisy on judged findings (P3 trust); SARIF/PR annotations meet findings where review happens.
- **Negative / accepted:** multiple reporters + tracker adapters to maintain.
- **Risk / mitigation:** tracker rate limits/outages → backoff + local fallback + non-zero exit
  (ADR-014 integration errors); SARIF drift → schema validation test (ADR-015).
