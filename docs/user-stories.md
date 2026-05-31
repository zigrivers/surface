<!-- scaffold:user-stories v1 2026-05-30 -->

# surface — User Stories

> Depth-5 story suite derived from `docs/plan.md`. Personas: **P1** AI agent / build
> pipeline (primary adopter), **P2** non-designer builder (beneficiary + authority), **P3**
> CI/platform maintainer. Acceptance criteria are Given/When/Then and testable (specific
> inputs/outputs, no vague adjectives). Each story traces to PRD FR(s). Domain-event hints
> (→) feed `domain-modeling`. Priority tags map to the PRD §8 MoSCoW tiers: **[gate]**,
> **[committed]**, **[should]**, **[could]**.

## Epic E1 — Capture & Inputs

### US-001 — Capture a route via auto-detected backend [gate]
*As P1/P2, I want surface to capture a target route so it can be evaluated.* (FR-CAP-3,
NFR-PORT-1)
- **Given** a reachable `--url`/`--localhost`/`--route` **and** Playwright or agent-browser
  installed, **When** I run `surface capture <target>`, **Then** a screenshot, DOM snapshot,
  accessibility tree, and computed styles are written under `.surface/captures/<id>/`.
- **Given** neither browser backend is installed, **When** I run capture, **Then** surface
  falls back to static+screenshot inputs and reports which measured checks were skipped.
- **Given** both backends are installed, **When** I capture, **Then** surface selects one
  deterministically and records which backend was used in the capture metadata.
- → events: `CaptureRequested`, `CaptureCompleted`, `CaptureDegraded`.

### US-002 — Capture routes behind authentication [gate]
*As P2, I want to audit pages behind a login.* (FR-CAP-8)
- **Given** a `--auth-state <file>` in Playwright storage-state format, **When** I capture an
  authenticated route, **Then** the session is injected before navigation and the
  authenticated DOM is captured.
- **Given** an invalid/expired auth-state file, **When** I capture, **Then** surface reports
  an auth-injection failure with a non-zero exit and does not silently capture the login page
  as if it were the target.

### US-003 — Ingest static and context inputs [gate]
*As P1/P2, I want to feed source, tokens, and Scaffold artifacts.* (FR-CAP-1,4)
- **Given** `--component`/source paths, design tokens, or `--scaffold-docs`, **When** I run an
  audit, **Then** surface uses them as evaluation context/guardrails and records which inputs
  were present.
- **Given** a built UI that contradicts a provided design-system token, **When** evaluated,
  **Then** the contradiction is emitted as a finding (not silently ignored).

### US-004 — Multi-state & dual-theme capture [should]
*As P2, I want hidden states and dark mode audited.* (FR-CAP-9, FR-CAP-10)
- **Given** a named task-flow recipe (declared click/type/navigate steps), **When** I capture,
  **Then** each reachable state is captured and any unreachable step is reported.
- **Given** `prefers-color-scheme` toggling enabled, **When** I capture, **Then** both light
  and dark are captured and findings are tagged with their theme.

### US-005 — Sensitive-data redaction [committed]
*As P2, I want PII/secrets redacted from captures and exports.* (FR-CAP-11, NFR-DATA-1)
- **Given** redaction rules configured, **When** captures/exports are written, **Then**
  matched content is replaced with a visible redaction marker and full evidence is retained
  local-only.

## Epic E2 — Evaluation Pipeline & Lenses

### US-010 — Classify app type [gate]
*As surface, I want to detect the app type so the right overlay applies.* (FR-PIPE-1, FR-OVL-1)
- **Given** a captured target, **When** discovery runs, **Then** an app type is assigned (or
  `generic`) and the chosen overlay is recorded in `.surface/state.json`.

### US-011 — Run measured accessibility audit [gate]
*As P1/P2, I want tool-grounded a11y findings.* (FR-PIPE-6, FR-LENS-1,5)
- **Given** a captured DOM, **When** the accessibility lens runs, **Then** each violation is
  produced/confirmed by Axe-core or Lighthouse, tagged `method: measured`, with the failing
  selector and the measured value as evidence.
- **Given** a contrast violation, **When** reported, **Then** the finding includes the
  measured ratio and the WCAG 2.2 AA threshold it failed.
- → events: `AuditRan`, `FindingDetected`.

### US-012 — Run judged usability/visual/content lenses [gate]
*As P2, I want expert-style findings tools can't produce.* (FR-PIPE-5,7,8,9; FR-LENS)
- **Given** a configured model (BYO key), **When** judged lenses run, **Then** each judged
  finding cites a named heuristic and carries evidence, tagged `method: judged`.
- **Given** no model configured, **When** I run an audit, **Then** judged lenses are skipped
  and surface reports "judged coverage unavailable — no model configured" (measured findings
  still produced).

### US-013 — Lenses flex by overlay and preset [gate]
*As P2, I want acceptance criteria to fit my app type.* (FR-LENS-4, FR-METH-1,2)
- **Given** preset `accessibility-first` at depth 4, **When** I run all, **Then** the lens set
  and thresholds match that preset/overlay and the active config is recorded.

## Epic E3 — Findings, Scoring & Trust

### US-020 — Structured, evidence-bearing findings [gate]
*As P1, I want machine-readable findings.* (FR-SCORE-1, FR-LENS-5)
- **Given** an audit completes, **When** findings are written, **Then** each validates against
  the `Finding` schema (id, lens, type, method, evidence[], dimensions, location, gatedForHuman)
  and `findings.json` parses without error.

### US-021 — Prioritized backlog with trust guards [gate]
*As P2, I want the one thing to fix next, safely.* (FR-SCORE-2,3,4; FR-RULE-1,2)
- **Given** scored findings, **When** the backlog is produced, **Then** it is ordered by the
  prioritization score, near-duplicates are de-prioritized (MMR), and no single headline score
  is emitted.
- **Given** a judged finding with confidence below the configured cutoff, **When** surfaced,
  **Then** it appears as a question, not a mandate.
- **Given** a finding that alters meaning/brand/critical-flow, **When** produced, **Then** it
  is `gatedForHuman: true` and never auto-executed.

### US-022 — Deterministic fix snippets for measured findings [committed]
*As P1, I want low-hallucination fixes.* (FR-SCORE-7)
- **Given** a measured finding with a computable fix (contrast hex, missing aria, target size),
  **When** produced, **Then** it includes a `suggestedPatch`; judged findings never receive an
  auto-generated patch.

### US-023 — Self-grounding accuracy & verdict loop [should]
*As P2/P3, I want to trust and correct judgments.* (FR-SCORE-6,8)
- **Given** measured ground truth and human verdicts, **When** self-grounding runs, **Then**
  surface reports its judged false-positive rate.
- **Given** `surface verdict <id> --reject --reason`, **When** recorded, **Then** the verdict
  persists and feeds future prioritization.

## Epic E4 — Output & Reporting

### US-030 — Human + machine artifacts [gate]
*As P2/P1, I want a readable report and a parseable file.* (FR-OUT-1,3)
- **Given** an audit, **When** complete, **Then** `findings.md` (plain-language, evidence) and
  `findings.json` (stable IDs, documented schema) are both produced.

### US-031 — Explain a finding to a non-designer [gate]
*As P2, I want to understand why something matters.* (FR-MODE-1)
- **Given** a finding id, **When** I run `surface explain <id>`, **Then** I get a plain-language
  rationale, the cited heuristic, and verifiable evidence (e.g., screenshot region).

### US-032 — CI-native reporters: SARIF + PR annotations [committed]
*As P3, I want findings where code review happens.* (FR-OUT-4)
- **Given** `--export sarif`, **When** I run, **Then** valid SARIF v2.1.0 is emitted.
- **Given** a PR context + token, **When** `surface gate` runs, **Then** findings post as
  GitHub Checks/annotations; local artifacts remain the source of truth.

## Epic E5 — Closed Loop, State & Baselines

### US-040 — Stable finding identity across re-runs [gate]
*As P1, I want reliable status transitions.* (FR-LOOP-2, FR-RULE-3,5)
- **Given** an unchanged defect, **When** I re-audit, **Then** the finding keeps its id and is
  marked `still-failing`; a fixed one becomes `resolved`; a reappeared one becomes `regressed`;
  an unmatchable anchor is reported `identity-broken` (never silently resolved).
- → events: `ReAuditRan`, `FindingResolved`, `FindingRegressed`.

### US-041 — Concurrency-safe, resumable state [gate]
*As P1, I want runs not to corrupt state.* (PRD §7, NFR)
- **Given** two runs touching `.surface/state.json`, **When** they overlap, **Then** state
  access is locked and neither corrupts the store; **Given** an interrupted run, **When**
  re-invoked, **Then** it resumes rather than leaving a half-written state.

### US-042 — Baseline & waivers [committed]
*As P3, I want to adopt the gate on a debt-laden app.* (FR-RULE-6)
- **Given** `surface baseline`, **When** run, **Then** current findings snapshot to a baseline
  and `surface gate` thereafter fails only on net-new or expired findings.
- **Given** a waiver with an expiry, **When** the expiry passes, **Then** the finding
  re-activates.

## Epic E6 — Interfaces (CLI / MCP / Skill)

### US-050 — POSIX-conformant CLI [gate]
*As P1, I want a scriptable contract.* (FR-IF-1, NFR-CLI-1)
- **Given** any command, **When** run with `--json`, **Then** output is machine-readable and
  exit codes are 0 success / 1 error / 2 usage.
- **Given** an unknown subcommand, **When** invoked, **Then** exit code is 2 with a usage error.

### US-051 — MCP server for native agent embedding [gate]
*As P1, I want to call surface as MCP tools.* (FR-IF-2, NFR-MCP-1)
- **Given** the MCP server running, **When** an agent lists tools, **Then** surface's
  capabilities appear with versioned schemas; **When** the schema changes incompatibly,
  **Then** the major version increments.

### US-052 — Natural-language runner skill [gate]
*As P2, I want to drive surface conversationally.* (FR-IF-3)
- **Given** the runner skill, **When** I describe intent in natural language, **Then** it maps
  to the correct surface command and confirms the action.

## Epic E7 — Integrations

### US-060 — GitHub Issues export [gate]
*As P2/P3, I want the backlog in my tracker.* (FR-INT-2)
- **Given** a token + `--export github`, **When** I export, **Then** issues are created with
  finding context; **Given** a rate-limit/API failure, **When** export fails, **Then** surface
  retries with backoff, writes the backlog locally, reports unsynced items, and exits non-zero.

### US-061 — Linear/Jira export & token parsers [should]
*As P2, I want my tracker/tokens supported.* (FR-INT-3)
- **Given** `--export linear|jira`, **When** I export, **Then** items are created per that
  vendor's API within its rate limits.

## Epic E8 — Knowledge Base, Presets & Multi-model

### US-070 — Inspectable, cited knowledge base [gate]
*As P2, I want to verify the standard behind a finding.* (FR-KB-1,2,4)
- **Given** a finding citing a heuristic, **When** I open the KB entry, **Then** it has
  `## Summary`/`## Deep Guidance`, a source citation, and freshness metadata.

### US-071 — Multi-model reconciliation [should]
*As P2, I want higher trust on judged findings.* (FR-SCORE-5)
- **Given** depth 4–5 and installed `codex`/`claude`/`gemini` CLIs (or `mmr`), **When** judged
  lenses run, **Then** findings are reconciled by confidence and divergence is surfaced as a
  question; **Given** a CLI is unavailable, **When** reconciliation runs, **Then** surface
  degrades to single-model and records which channels participated.

## Traceability & Coverage

Every PRD §6 capability area and accepted innovation (I1–I8) maps to ≥1 story above; every
persona (P1/P2/P3) authors ≥1 story. Coverage matrix to be formalized in `review-user-stories`
(depth ≥4 produces `coverage.json`). Deferred items (§14) intentionally have no v1 stories.

*Downstream: `review-user-stories` (coverage + INVEST), `innovate-user-stories` (UX-level
gaps), `domain-modeling` (consumes the → domain-event hints).*
