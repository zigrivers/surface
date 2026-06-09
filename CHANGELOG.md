# Changelog

## 0.2.2 - Durable State and Capture Reliability

- Redacts unsafe `agent-browser` capture command failure details so command errors do not leak raw
  capture output into Surface error envelopes.
- Makes pipeline state transitions atomic, preserving overlapping-run acceptance behavior while
  avoiding partially written stage updates.
- Validates canonical durable state fields and persists canonical verdict records from CLI and MCP
  paths.
- Adds regression coverage for agent-browser capture redaction, pipeline transition races, state
  validation, and closed-loop CLI/MCP verdict persistence.

## 0.2.1 - Subscription-Backed Model Fallback

- Adds opt-in judged synthesis through existing subscription CLIs, starting with direct Claude and
  Gemini providers.
- Adds model fallback controls for `surface audit`, including `--model-fallback`,
  `--model-channel`, `--model-channels`, `--model-depth`, and `--model-screenshots`.
- Adds explicit egress policy, redacted model artifact persistence, cleanup support, and audit
  output disclosures for attempted, completed, unavailable, and blocked model channels.
- Adds a compatible MMR audit fallback boundary that reports unsupported capability without sending
  captured artifacts.
- Adds release and smoke coverage for subscription-backed model discovery while keeping default
  audits measured-only.

## 0.2.0 - Browser QA Orchestrator

- Adds agent-led browser QA orchestration powered by `agent-browser`.
- Adds deterministic browser flow parsing, execution, replay, reporting, and promotion support.
- Adds action policy enforcement for destructive or browser-mutating actions, fixture accounts, and
  CI-safe reset/teardown contracts.
- Adds `.surface/qa` evidence storage with redacted metadata and MCP-approved artifact reads.
- Adds flow-aware gates through `surface gate --with-flows`.
- Adds browser QA CLI and MCP tools, including `surface qa`, `surface flow run`,
  `surface evidence`, `surface replay`, `surface report qa`, and `surface_artifact_read`.
- Adds seeded browser QA fixtures and end-to-end coverage for the new QA workflow.

## 0.1.1 - Initial Release Candidate

- Adds the Surface CLI package under `@zigrivers/surface`.
- Adds core audit orchestration, state, scoring, reporting, integration, MCP, grounding, and framework adapter packages.
- Adds local-first release validation for npm package metadata and packed artifacts.
- Adds manual-only GitHub release automation to minimize routine GitHub Actions usage.
- Adds Homebrew tap/formula guidance for the first public release.
