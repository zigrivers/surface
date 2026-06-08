# Changelog

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
