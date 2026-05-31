<!-- scaffold:api-contracts v1 2026-05-31 -->

# surface — Interface Contracts (CLI · MCP · output schemas)

> surface exposes **no REST/GraphQL API** (ADR-008). Its public contracts are three: the
> **POSIX CLI** (FR-IF-1, NFR-CLI-1), the **MCP tool surface** (FR-IF-2, NFR-MCP-1), and the
> **machine output schemas** (`findings.json`, SARIF). This document is the definitive
> agreement those interfaces honor; plugin (inter-component) interfaces are summarized in §8
> and owned by `@surface/core` (system-architecture §2a). Inputs: system-architecture, ADRs,
> domain models.

## 1. Conventions

- **Transport:** CLI over argv/stdout/stderr; MCP over stdio (local). No network listener.
- **Exit codes (NFR-CLI-1):** `0` success · `1` runtime error · `2` usage error. Every command
  supports `--json` (machine-readable on stdout; diagnostics to stderr; byte-stable, NFR-OWNOUT-1).
- **JSON success envelope (`--json`):**
  ```jsonc
  { "ok": true, "command": "audit", "schemaVersion": "1.0", "data": { /* command-specific */ } }
  ```
- **JSON error envelope (maps the SurfaceError taxonomy, ADR-014):**
  ```jsonc
  { "ok": false, "command": "audit", "schemaVersion": "1.0",
    "error": { "code": "capture_backend_unavailable", "kind": "CaptureError",
               "message": "what failed, likely cause, next command", "exitCode": 1 } }
  ```
  `error.code` is a stable snake_case reason phrase (≥2 domain-specific codes per command, §6);
  `message` is actionable (US-050).
- **Versioning:** CLI follows semver; `schemaVersion` versions the JSON envelope + output
  schemas; the **MCP tool schema** is versioned and a breaking change forces a **major bump**
  (NFR-MCP-1), enforced by schema snapshot tests. No endpoint/tool is removed or renamed without
  a major bump.
- **Auth:** there is **no user authentication** (local tool, ADR-013). The only credentials are
  BYO model keys (env, ADR-006) and capture `--auth-state` injection (a *capture input*, §3).
- **Idempotency & determinism:** all commands are safely re-runnable. Measured findings are
  deterministic for identical captured input (SC-4, NFR-DET-1); re-audit transitions are derived
  from stable finding identity (ADR-010), not from run order.

## 2. CLI command contract (every verb)

Verb set from FR-IF-1. Each row: purpose · key args/flags · success data (`--json`) · primary
error codes (§6). All accept `--json`, `--verbose`; target/context flags noted where relevant.

| Command | Purpose | Key args / flags | `--json` data | Exit / error codes |
|---|---|---|---|---|
| `init` | create `.surface/` state + config | `--preset --depth` | `{ stateDir, config }` | 0; `2 usage`; `1 state_write_failed` |
| `run <step>` / `run all` | run a pipeline step / full pipeline | `<step>`, target/context flags | `{ runId, stage, status }` | 0; `1 step_failed`; `2 unknown_step` |
| `next` | list eligible next steps | — | `{ eligible: string[] }` | 0 |
| `status` | pipeline progress + last run | — | `{ progress, currentStage, runHistory[] }` | 0; `1 state_read_failed` |
| `capture <target>` | observe a target → `Capture` | `--url --localhost --route --screenshot --component --dom --storybook --auth-state --persona --task` | `{ captureId, backend, artifacts[], degradation? }` | 0; `1 capture_unreachable`, `1 auth_injection_failed`; `2 no_target` |
| `audit [<lens>] <target>` | capture → lenses → findings → backlog | target/context flags, `--preset --depth --all` | `{ runId, topFinding, findingCount, backlogId }` | 0; `1 capture_failed`, `1 model_unavailable` (degrade, not fail); `2 unknown_lens` |
| `explain <finding-id>` | plain-language rationale + evidence (FR-MODE-1) | `<finding-id>` | `{ finding, rationale, citedHeuristics[], evidence[] }` | 0; `1 finding_not_found` |
| `backlog [--export <target>]` | emit prioritized backlog / export | `--export github\|linear\|jira\|sarif --all` | `{ backlog: BacklogEntry[] }` or `{ export: IssueExport }` | 0; `1 export_partial` (non-zero, unsynced reported), `1 export_failed`; `2 unknown_export_target` |
| `validate` | run validation checks (closed loop) | `--run <id>` | `{ checks: { id, passed }[] }` | 0; `1 validation_run_failed` |
| `gate [--ci]` | CI quality gate on re-audit | `--ci --policy <file>` | `{ gateResult: GateResult }` | `0` pass · `1` gate-fail · `2` usage |
| `baseline` | snapshot accepted findings (FR-RULE-6) | `--reason` | `{ baselineId, count }` | 0; `1 baseline_write_failed` |
| `verdict <finding-id>` | adjudicate (accept/reject/correct/defer, FR-SCORE-8) | `--accept\|--reject\|--correct\|--defer --reason` | `{ verdict: Verdict }` | 0; `1 finding_not_found`; `2 no_decision_flag` |
| `alternatives <target>` | bounded improvement proposals (FR-IF-4) | target flags | `{ alternatives: Report }` | 0; `1 capture_failed` |
| `diff <before> <after>` | before/after finding diff (FR-IF-4) | `<before> <after>` | `{ resolved[], introduced[], stillFailing[] }` | 0; `1 run_not_found` |

**Progressive disclosure (US-021/US-030, the "pagination" analog):** human output shows the
**top finding + a count of the rest** by default; `--all`/`--verbose` reveals the full backlog.
The JSON output is never truncated. List ordering is the backlog priority order (MMR-diversified);
the route set is bounded by `RouteInventory.cap` with skipped routes reported, never silently
dropped (NFR-SCALE-1).

### Example — `surface audit --localhost --json`
```jsonc
// stdout
{ "ok": true, "command": "audit", "schemaVersion": "1.0",
  "data": { "runId": "run_01H…", "findingCount": 7,
    "topFinding": { "id": "f_a1", "issueType": "contrast-insufficient",
      "method": "measured", "severityBand": "P1", "title": "Button text fails AA contrast",
      "gatedForHuman": false } } }
```
### Example — usage error
```jsonc
{ "ok": false, "command": "audit", "schemaVersion": "1.0",
  "error": { "code": "no_target", "kind": "UsageError", "exitCode": 2,
    "message": "No target given. Pass --url/--localhost/--route or a --screenshot/--component path. Try: surface audit --localhost" } }
```

## 3. MCP tool contract

The MCP server (`@surface/mcp`, ADR-008) exposes surface's capabilities as tools — one tool per
agent-relevant CLI verb — with **zod-derived JSON schemas** (NFR-MCP-1). Tools are thin over the
same `core` services as the CLI (system-architecture §2a), so behavior is identical.

| MCP tool | Input schema (zod) | Output schema | Errors |
|---|---|---|---|
| `surface_capture` | `{ target: Target, authState?: AuthStateRef }` | `Capture` | `capture_unreachable`, `auth_injection_failed` |
| `surface_audit` | `{ target: Target, preset?, depth?, persona?, task? }` | `{ runId, backlog: Backlog, findings: Finding[] }` | `model_unavailable` (degraded), `capture_failed` |
| `surface_explain` | `{ findingId: string }` | `{ finding: Finding, rationale, evidence[] }` | `finding_not_found` |
| `surface_backlog` | `{ runId?: string, exportTarget? }` | `Backlog` \| `IssueExport` | `export_partial`, `unknown_export_target` |
| `surface_gate` | `{ runId?: string, policy?: GatePolicy }` | `GateResult` | — |
| `surface_validate` | `{ runId: string }` | `{ checks[] }` | `validation_run_failed` |
| `surface_baseline` | `{ reason?: string }` | `{ baselineId, count }` | `baseline_write_failed` |
| `surface_verdict` | `{ findingId, decision: "accept"\|"reject"\|"correct"\|"defer", rationale }` | `Verdict` | `finding_not_found` |
| `surface_status` | `{}` | `{ progress, currentStage, runHistory[] }` | `state_read_failed` |

**Auth-state via MCP (FR-CAP-8):** `authState` is passed in the tool input as a reference to a
storage-state file/handle; injection failure returns a **structured MCP error**
(`auth_injection_failed`), never a silent login-page capture (§4.4 of system-architecture); the
auth-state value is redacted from logs (ADR-018).

**Versioning & compatibility (NFR-MCP-1):** the tool schema carries a version; a backward-
compatible change is additive; an incompatible change (renamed/removed tool, changed required
field, narrowed output) forces a **major** server version and is caught by schema snapshot tests.
Listing tools returns their versioned schemas.

**Errors:** MCP tool errors are structured `{ code, kind, message }` mirroring §1's error
envelope (no exit codes; the calling agent reads `code`).

## 4. Canonical output schemas

These are the machine artifacts (`findings.json`, SARIF) and the in-memory shapes the CLI/MCP
return. Authoritative definitions are the zod schemas in `core/src/schema` (ADR-005); shown here
as the wire contract.

### `Finding` (the central record — FR-SCORE-1)
```jsonc
{ "id": "f_a1", "lens": "accessibility", "issueType": "contrast-insufficient",
  "method": "measured",                       // "measured" | "judged" — sole source of the label (FND-I2)
  "title": "…", "rationale": "…",
  "citedHeuristics": ["kb_wcag_143"],
  "evidence": [ { "kind": "tool-result", "tool": "axe", "rule": "color-contrast",
                  "measuredValue": "3.1:1", "threshold": "4.5:1" } ],
  "dimensions": { "severity": 0.8, "confidence": 1.0, "effort": 0.2, "userImpact": 0.7,
                  "businessImpact": 0.5, "a11yLegalRisk": 0.9, "evidenceQuality": 1.0,
                  "agentImplementability": 0.9 },
  "severityBand": "P1",                       // derived; what the gate evaluates (FR-RULE-4)
  "location": { "file": "src/Button.tsx", "component": "Button", "selector": ".btn-primary",
                "elementRef": "@e12" },
  "confidenceBand": "assert",                 // assert | surface-as-question | suppress-unless-deep
  "gatedForHuman": false,
  "suggestedPatch": { "kind": "contrast-hex", "change": "#6b7280 → #4b5563" } // measured-only (FND-I3)
}
```
Invariants enforced at the boundary (zod + lint): `method==="measured" ⇒ ≥1 tool-result evidence`
(FND-I1); `suggestedPatch ⇒ method==="measured"` (FND-I3); `evidence.length ≥ 1` (FND-I6).

### `findings.json` envelope
```jsonc
{ "schemaVersion": "1.0", "runId": "run_…", "generatedAt": "<iso>",
  "findings": [ /* Finding[] */ ], "degradation": { "skippedLenses": [], "reason": null } }
```
Byte-stable for identical input (NFR-CLI-1); no headline/vanity score anywhere (FR-SCORE-4).

### `Backlog` / `BacklogEntry`
```jsonc
{ "id": "bk_…", "runId": "run_…",
  "entries": [ { "findingId": "f_a1", "rank": 1, "priority": 0.71,
                 "demotedAsDuplicateOf": null } ] }   // ordered; gated findings flagged non-executable
```

### `GateResult` (FR-RULE-4)
```jsonc
{ "passed": false, "exitCode": 1,
  "failingFindingIds": ["f_a1"], "policy": { "failOnNewMeasuredAtOrAbove": "P1" } }
```
Never fails on `judged` or `gatedForHuman` findings (RPT-I5).

### SARIF (US-032, FR-OUT-4)
`--export sarif` emits **SARIF v2.1.0**: each `Finding` → a `result` (ruleId = `lens/issueType`,
level from `severityBand`, message = `rationale`, `locations` from `Location`, `properties` carry
`method`/`confidenceBand`/`gatedForHuman`). Validated against the SARIF schema (ADR-015/RPT-I8).

## 5. Inputs that aren't endpoints

- **`Target`** (capture input): one of `{ url | localhost | route | screenshot | component | dom | storybook }` (FR-CAP-1,2,3).
- **`AuthStateRef`** (FR-CAP-8): Playwright storage-state file/handle; injected pre-navigation, redacted from logs.
- **Context inputs** (FR-CAP-4): `--persona --task --scaffold-docs` → `Persona[]`/`TaskDefinition[]`/overlay guardrails.

## 6. Error catalog (SurfaceError → reason phrase → exit/MCP code)

| Code (`error.code`) | `kind` (ADR-014) | Exit | When |
|---|---|---|---|
| `unknown_step` / `unknown_lens` / `unknown_export_target` / `no_target` / `no_decision_flag` | `UsageError` | 2 | bad args (≥2 domain-specific usage codes) |
| `config_invalid` | `ConfigError` | 1 | malformed `.surface/config.yml` |
| `capture_unreachable` / `auth_injection_failed` | `CaptureError` | 1 | target down / auth-state invalid (US-002) |
| `model_unavailable` | `ModelError` | 0\* | no model configured — **degrades** to measured-only (US-012), not a hard error unless the command requires judged |
| `finding_not_found` | `StateError` | 1 | `explain`/`verdict` on unknown id |
| `export_partial` / `export_failed` | `IntegrationError` | 1 | tracker push partial/failed; unsynced reported, never lost (US-060) |
| `state_read_failed` / `state_write_failed` / `baseline_write_failed` | `StateError` | 1 | `.surface/` IO under lock |
| `validation_run_failed` | `RuntimeError` | 1 | re-audit validation could not run |
| `mcp_schema_incompatible` | `McpError` | n/a | MCP client/server schema mismatch (NFR-MCP-1) |

\* `model_unavailable` is a *reported degradation*, not a failure (ADR-014 degradation≠failure).

## 7. Rate limits & retries

surface itself imposes no rate limits (local tool). **External** integrations do: GitHub/Linear/
Jira exports retry with backoff and, on persistent failure, fall back to the local backlog,
report unsynced items, and exit non-zero (US-060, ADR-016). Model providers' limits are the
user's (BYO key, ADR-006).

## 8. Plugin (inter-component) interface contracts

Component-to-component contracts are TypeScript interfaces in `@surface/core/interfaces`
(system-architecture §2a/§6), not network APIs: `CaptureBackend`, `FrameworkAdapter`,
`GroundingTool`, `Lens`, `ReportRenderer`, `GateEvaluator`, `IssueExporter`, `KnowledgeSource`,
`StateStore`. They are versioned with the `@surface/core` package; breaking a published interface
is a major bump. Their signatures and constraints are specified in system-architecture §6 and
realized in the implementation plan.

## 9. Traceability

CLI verbs ← FR-IF-1; MCP tools ← FR-IF-2/NFR-MCP-1; output schemas ← FR-SCORE-1/FR-OUT-1,3,4;
error catalog ← ADR-014/§7 PRD sad paths; auth-state ← FR-CAP-8/ADR-013; gate ← FR-RULE-4;
progressive disclosure ← US-021/US-030. Every domain operation that crosses the CLI/MCP boundary
(audit, capture, explain, backlog, validate, gate, baseline, verdict, diff, alternatives) maps to
≥1 CLI command **and** its MCP tool.
