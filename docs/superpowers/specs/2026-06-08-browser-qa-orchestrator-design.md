# Browser QA Orchestrator Design

Status: Draft for review
Bead: `surface-edw`
Date: 2026-06-08

## Summary

Surface should make `agent-browser` the primary engine for agent-led browser QA. The design is a
hybrid orchestrator:

- Scripted task flows are the deterministic core for replay, validation, and CI.
- Autonomous exploration discovers paths, states, and candidate issues.
- `surface qa` coordinates both, promotes verified issues into Surface findings, and persists
  evidence only when Surface needs it for findings, replay, validation, gates, or reports.
- Playwright and static capture remain fallbacks for existing capture/audit behavior, but the new
  QA experience assumes `agent-browser` when installed.

This should be implemented as a new QA workflow layer rather than by widening `Capture` until it
owns every browser concern. Existing `capture` and `audit` contracts stay stable; QA runs produce
evidence and candidate findings that can feed the backlog once replayed or otherwise verified.

## Goals

The browser QA orchestrator must let an agent test a running UI like a competent QA engineer:

- Discover routes, interactions, forms, dialogs, menus, errors, and hidden states.
- Execute reliable scripted flows for known user journeys.
- Capture issue-ready proof: annotated screenshots, step screenshots, video when needed, console
  errors, network summaries, snapshots with element refs, React diagnostics, and vitals.
- Convert high-quality discoveries into reusable flow files.
- Re-run flows to verify fixes and gate regressions.
- Keep all evidence local by default and apply redaction before evidence is persisted or reported.
- Preserve stable finding identity using route, state, action path, element refs, role/name,
  selectors, and component mapping when available.

## Non-Goals

The first implementation should not become a full test authoring IDE, a cloud execution service, a
production traffic mutator, or a replacement for normal unit/e2e tests. It should also not use
`agent-browser chat` as the core automation engine; Surface needs deterministic command execution
and structured artifacts. Natural-language instructions can compile to flow candidates later, but
the durable contract is structured actions.

## Current Surface Baseline

Surface already has:

- `agent-browser` as a preferred live capture backend, selected before Playwright.
- A `CaptureBackend` abstraction and a `Capture` aggregate.
- Four capture artifact types: screenshot, DOM snapshot, accessibility tree, computed styles.
- Stable identity that prefers `location.elementRef` when present.
- `runTaskFlowCapture`, but today its steps are route targets rather than browser actions.
- CLI verbs for `capture`, `audit`, `explain`, `backlog`, `validate`, `gate`, `baseline`,
  `verdict`, `diff`, `alternatives`, `trace`, `run`, `next`, and `status`.
- MCP equivalents for the analytical verbs.

The gap is that Surface does not yet model user interactions, discovered states, repro steps,
browser diagnostics, evidence bundles, or flow promotion.

## Compatibility and Migration

The QA orchestrator is additive. It must not break the existing `capture`, `audit`, `run`,
`validate`, `gate`, or MCP contracts.

Existing route-target task-flow capture remains executable through the current Capture path. The
new `surface flow` command owns browser-action recipes and does not replace `surface run`.
`surface run` continues to mean pipeline-stage execution; `surface flow run` means browser flow
execution.

Migration rules:

- Existing route-target task-flow recipes continue to work against `runTaskFlowCapture`.
- A new importer can translate simple route-target recipes into action flow files by emitting
  `open` and `capture` steps.
- Imported legacy flows must include a warning that interaction semantics were not inferred.
- Existing `Capture` artifacts remain valid evidence for current lenses.
- QA evidence references can point at existing `Capture` artifacts, but QA does not mutate old
  captures.

This keeps `surface flow` flexible without silently changing the meaning of existing pipeline
commands.

## Capability Map

| agent-browser capability | Current Surface use | QA orchestrator use |
| --- | --- | --- |
| Snapshot refs (`@eN`) | Stored in accessibility artifact | Primary element/action evidence anchor |
| Annotated screenshots | Not used | Static issue proof and state map |
| Video recording | Not used | Interactive repro proof |
| Console/errors | Not used | Console finding evidence |
| Network requests/HAR | Not used | Failed request evidence; HAR opt-in |
| React tree/inspect/renders | Not used | Component mapping and render churn findings |
| Vitals | Not used | Performance finding evidence |
| Sessions/auth/profile/state | Minimal state path | Authenticated QA sessions and reuse |
| Click/fill/type/hover/press | Not used by Surface | Flow execution and exploration |
| Allowed domains/action policy | Not used | Navigation and destructive-action guardrails |
| Trace/profiler | Not used | Deep performance evidence, opt-in |

## Product Model

### Three User-Facing Modes

`surface flow` is deterministic.

```bash
surface flow run surface-flows/checkout.yml --evidence failures
surface flow run surface-flows/checkout.yml --update-refs
```

It executes declared browser actions, captures configured states, runs assertions, and produces a
replayable run result. This mode is suitable for CI.

`surface explore` is exploratory.

```bash
surface explore --localhost --scope "settings and billing"
surface explore --url https://app.example.com --max-depth 2 --evidence minimal
```

It discovers navigable paths, exercises safe interactions, captures states, and emits candidate
issues and candidate flows. By default, these are not normal backlog findings until they are
replayed or promoted.

`surface qa` orchestrates both.

```bash
surface qa --localhost
surface qa --url http://localhost:3000 --explore --flows surface-flows/*.yml
surface qa --task "complete checkout" --auth-state .surface/auth/app.json --evidence full
```

It runs known flows first when provided, explores where no flow coverage exists, and writes a QA run
summary with evidence-backed findings and candidates.

### Source-Controlled Flows and `.surface` Working State

Support both durable flow files and `.surface` flow state.

Flow files are the reviewed, source-controlled contract:

```text
surface-flows/
  checkout.yml
  onboarding.yml
  settings-profile.yml
```

Use flow files for CI, team review, and stable regression coverage.

`.surface` is discovery and run memory:

```text
.surface/
  qa/
    runs/<qaRunId>/
      manifest.json
      flow-runs/<flowRunId>.json
      candidates/<candidateId>.json
      evidence/<evidenceBundleId>/manifest.json
      tombstones/<artifactOrBundleId>.json
    artifacts/sha256/<digest>
    candidates/<candidateId>.json
    evidence/<evidenceBundleId>.json
    flows/<workingFlowId>.json
    refs/
      latest.json
      promoted-findings/<findingId>.json
```

Use `.surface` for autonomous discoveries, candidate flows, last-known-good refs, replay history,
evidence links, and promotion metadata.

QA state is sidecar-owned. The orchestrator must not append browser QA records into the existing
top-level `.surface/state.json` blob except through stable cross-references to normal findings,
tracked findings, and reports. `QaRunStore` owns `.surface/qa/runs/<qaRunId>/manifest.json` plus
per-run sidecars. `QaEvidenceStore` owns immutable evidence manifests and content-addressed blobs
under `.surface/qa/artifacts/sha256/<digest>`.

Writes are performed through the existing `StateStore`/artifact writer lock:

- A run writes manifests to a temp directory under `.surface/tmp/qa/<qaRunId>/` on the same
  filesystem as the final destination, fsyncs manifests, then atomically renames into place.
- Artifacts are content-addressed by sanitized bytes and checksum-verified when read. CAS artifact
  writes under `.surface/qa/artifacts/sha256/` are lock-free aside from atomic create/rename on the
  digest path.
- Unique run outputs under `.surface/qa/runs/<qaRunId>/` are committed without a shared index lock
  because the run id owns that directory. Only shared refs, indexes, latest pointers, and promoted
  finding sidecars take the `StateStore` lock.
- Evidence bundles are immutable after the manifest is committed.
- Mutating commands such as verdict promotion append a new verdict or promotion sidecar instead of
  rewriting old run evidence.
- Promoted findings store stable refs to the evidence bundle id, manifest path, artifact checksums,
  and source run id so later runs can keep citing the original proof.
- Retention pruning removes only unreferenced expired artifacts, writes tombstones, and preserves
  manifests required by promoted findings, tracked findings, reports, or gate history.
- Browser action loops, waits, exploration, artifact CAS writes, and unique run-manifest commits do
  not hold the shared `StateStore` lock. Only short shared index, ref, latest pointer, promotion,
  and tombstone commits acquire the lock.
- Concurrent QA commands either acquire the short commit lock, wait up to
  `--state-lock-timeout` (default 10 seconds), or record an index-update degradation while leaving
  the unique run manifest readable. Browser profiles and sessions use separate per-profile process
  locks.
- Indexes are caches over committed unique run manifests, not the only way to read a valid run.
  `surface evidence`, `surface replay`, and `surface_artifact_read` can rebuild or verify the
  relevant run registration from `.surface/qa/runs/<qaRunId>/manifest.json`, provided the run id is
  exact, the manifest schema is valid, the manifest digest matches the artifact checksums, and every
  artifact path passes the same realpath/root/sensitivity checks. Index-update degradation never
  makes committed run evidence unreadable.
- The same fallback applies to unique candidate and flow sidecars. `qfc_*` resolves to
  `.surface/qa/candidates/<candidateId>.json`; `qflow_*` resolves to
  `.surface/qa/flows/<flowId>.json`. Each sidecar must contain the owning `qaRunId`,
  `evidenceBundleId` where applicable, and manifest checksum refs that cross-verify against the run
  manifest before any artifact read. Canonical candidate and flow sidecars use the same unique-id
  temp, fsync, and atomic rename commit pattern as run manifests; shared refs and indexes remain
  cache/update records.
- Evidence and promoted-finding ids also have exact fallback paths. `ev_*` resolves to
  `.surface/qa/evidence/<evidenceBundleId>.json`, which records the owning `qaRunId`, run manifest
  digest, bundle manifest digest, artifact digests, media types, and sensitivity flags. `f_*`
  resolves through `.surface/qa/refs/promoted-findings/<findingId>.json`, which records the source
  candidate/run/evidence refs and must cross-verify against both the normal tracked finding and the
  source run manifest.
- Under `--ci`, failure to update a required shared index/ref is a run failure unless Surface can
  rebuild the index from unique run manifests and verify the target run is present before gate
  evaluation. Non-CI commands may degrade, but `surface gate --with-flows` must self-heal or fail
  closed when indexes are out of sync.

CLI and MCP outputs expose artifact refs, manifest paths, checksums, sizes, media types, and
redacted summaries. They do not inline raw artifact bytes.

Promotion moves reviewed working memory into a durable flow file:

```bash
surface flow list --candidates
surface flow promote qflow_checkout --out surface-flows/checkout.yml
```

## Public Commands

### `surface qa`

Primary entry point for agent-led QA.

```bash
surface qa --localhost
surface qa --url https://app.example.com --scope "billing"
surface qa --task "complete checkout" --auth-state .surface/auth/app.json
surface qa --react --flows "surface-flows/*.yml" --explore
surface qa --json --evidence failures
```

Key options:

- `--url`, `--localhost`, `--route`, existing target flags.
- `--flows <glob>` run one or more reviewed flow files.
- `--explore` enable autonomous exploration.
- `--task <text>` guide exploration and candidate flow generation.
- `--scope <text>` constrain exploration.
- `--auth-state <path>` load session state without exposing secrets.
- `--react` enable React DevTools integration for React tree, render profile, and Suspense data.
- `--vitals` collect Web Vitals.
- `--network summary|har|off` choose network evidence level.
- `--video off|failures|all` choose recording level.
- `--evidence minimal|failures|full` choose persistence level.
- `--allowed-domains <csv>` constrain navigation.
- `--max-depth <n>`, `--max-actions <n>`, and `--max-states <n>` bound exploration.
- `--session-mode isolated|shared` choose browser context isolation; default is `isolated`.
- `--reauth-flow <flow>` optional policy-authorized flow for auth drift recovery.
- `--state-lock-timeout <ms>` controls how long short shared index/ref commits wait for the
  `StateStore` lock.

`--task` and `--scope` do not execute natural-language instructions. They are deterministic text
signals used to prioritize candidate actions, name candidate flows, and filter reports. Future
natural-language-to-flow support must compile text into a validated structured flow before any
browser action runs.

JSON output:

ID conventions: `qa_*` for QA runs, `flowrun_*` for flow runs, `qfc_*` for candidate findings,
`qflow_*` for candidate flows, and `ev_*` for evidence bundles.

```json
{
  "qaRunId": "qa_...",
  "target": { "kind": "localhost", "ref": "http://localhost:3000" },
  "mode": "hybrid",
  "flowRuns": [{ "flowId": "checkout", "status": "failed", "findingIds": ["f_..."] }],
  "exploration": {
    "visitedStates": 12,
    "candidateFindings": 5,
    "candidateFlows": 3
  },
  "findings": ["f_..."],
  "candidateFindings": ["qfc_..."],
  "candidateFlows": ["qflow_..."],
  "candidates": [
    {
      "id": "qfc_...",
      "title": "Checkout submit lacks payment validation feedback",
      "replayable": true,
      "replayStatus": "not-run",
      "gateEligible": false,
      "evidenceBundleId": "ev_..."
    }
  ],
  "evidenceBundles": ["ev_..."],
  "degradation": []
}
```

### `surface explore`

Focused discovery.

```bash
surface explore --localhost --max-depth 2
surface explore --url https://app.example.com --scope "admin user management"
surface explore --url http://localhost:3000 --max-states 25 --max-actions 100
```

Output is candidate-first:

```json
{
  "qaRunId": "qa_...",
  "candidateFindings": [{ "candidateId": "qfc_...", "replayable": true }],
  "candidateFlows": [{ "candidateId": "qflow_...", "title": "Update profile name" }]
}
```

`surface explore` accepts the same target, evidence, action-policy, session-mode, and exploration
bound options as `surface qa`, including `--max-depth`, `--max-actions`, `--max-states`, and
`--state-lock-timeout`.

### `surface flow`

Flow lifecycle.

```bash
surface flow run surface-flows/checkout.yml
surface flow run surface-flows/checkout.yml --headed
surface flow run surface-flows/checkout.yml --target http://127.0.0.1:5173
surface flow run surface-flows/checkout.yml --url https://preview.example.com
surface flow run surface-flows/checkout.yml --url http://localhost:5173
surface flow run surface-flows/checkout.yml --base-url https://preview.example.com
surface flow run surface-flows/checkout.yml --state-lock-timeout 5000
surface flow list
surface flow list --candidates
surface flow show checkout
surface flow promote qflow_checkout --out surface-flows/checkout.yml
surface flow update-refs surface-flows/checkout.yml
```

`update-refs` refreshes unstable element refs after successful replay while preserving semantic
locators and action intent.

Flow target resolution:

1. `surface flow run --target <url>` overrides the flow target completely.
2. `--url <url>` is a target-specific alias with the same precedence as `--target`.
   `--localhost` is a boolean shortcut for `http://localhost:3000`; custom local ports use
   `--url` or `--target`.
3. `--base-url <url>` replaces only the origin for relative `open` URLs.
4. The flow file `target` is the fallback default.
5. If no target can be resolved, the command exits with a usage error.

This makes the same source-controlled flow runnable against local dev, preview deploys, staging,
and CI-provided URLs without editing YAML.

`--base-url` produces an effective target origin for the run. Allowed origins, allowed domains,
action-policy target bindings, destructive-action rules, and driver `--allowed-domains` arguments
are derived from that effective origin, not the YAML default. A destructive rule that only
authorizes the YAML origin is rejected after `--base-url` substitution. Dynamic origins are matched
to policy `environmentGroups` before action, reset, and fixture-account rules are evaluated.

### `surface evidence`

Inspect evidence for a finding, candidate, or QA run.

```bash
surface evidence f_123
surface evidence qfc_123 --json
surface evidence qa_123 --open
```

The command prints local paths and summaries, never raw secrets.

### `surface replay`

Reproduce a finding or candidate.

```bash
surface replay f_123
surface replay qfc_123 --video
surface replay qfc_123 --promote-on-repro
```

Replay turns a candidate into a normal finding only when the original issue condition is
reproduced or otherwise validated by deterministic evidence. A clean flow pass means the candidate
was not reproduced; it must not be promoted. `--promote-on-repro` promotes only when the replayed
assertion fails or the measured signal recurs in the expected state.

### `surface report qa`

Render persisted QA reports.

```bash
surface report qa --run qa_123 --format md
surface report qa --run qa_123 --format json
surface report qa --run qa_123 --format manifest
```

Reports contain redacted summaries and local artifact refs. They never embed raw HAR bodies,
cookies, local storage, auth headers, or unredacted screenshots/videos.

### `surface qa cleanup`

Terminate stale browser sessions recorded by incomplete QA run manifests.

```bash
surface qa cleanup
surface qa cleanup --dry-run --json
```

Cleanup is scoped to Surface-owned session ids, process groups, lockfiles, temporary profile
directories, and validated child process records from `.surface/qa/runs/*/manifest`. It must not
terminate unrelated browser processes. A PID alone is never sufficient because operating systems
recycle PIDs; cleanup must verify the session token, process group, executable path or command
signature, start time when the platform exposes it, and Surface-owned lockfile before sending a
signal. Cleanup also scans orphaned Surface-owned lockfiles, process-group records, and temporary
browser profiles under `.surface/tmp/qa/` that were created before a manifest commit and are not
associated with an active process.

`surface qa` and `surface explore` run a non-destructive stale-session check for the current
worktree before launching a browser. In CI, stale Surface-owned locks or profiles that cannot be
validated or cleaned safely fail closed with a sanitized cleanup error instead of silently reusing a
possibly corrupted profile.

### Candidate Verdict Promotion

Human promotion uses the existing verdict concept, extended to candidate ids:

```bash
surface verdict qfc_123 --promote --reason "Confirmed during manual QA"
```

Human-promoted candidates become normal reportable findings. They are not automated-replay
eligible unless replay or measured confirmation later marks them deterministic, but high and
critical unresolved human-promoted findings block gates under the default manual-verdict policy.

### `surface gate --with-flows`

Extends gate evaluation with flow results.

```bash
surface gate --with-flows --ci
surface gate --with-flows "surface-flows/*.yml" --ci
```

The gate should fail on configured measured regressions and flow failures. It should not fail on
unverified exploratory candidates.

### CLI Contract Defaults

Target flags are mutually exclusive. If more than one target flag is supplied, CLI exits with usage
error code 2. `--localhost` is a strict boolean flag that accepts no value and resolves to
`http://localhost:3000`; custom local ports use `--url` or `--target`.

Option precedence is:

1. CLI flags for this invocation.
2. Flow-file fields.
3. Project configuration.
4. Built-in Surface defaults.

Action policy resolution is:

1. `--action-policy <path>`.
2. `actionPolicy.ref` in the flow file.
3. `.surface/qa/action-policy.json` when present.
4. Project configuration.
5. Built-in safe policy.

The built-in safe policy allows read-only navigation and reveal interactions only. A missing action
policy is not permissive: destructive, persistent, externally visible, payment, account, upload,
submit, save, clear, and delete actions are denied unless an explicit policy permits them.

Exploration bounds:

- `maxDepth` limits action path length from the starting state.
- `maxActions` limits attempted actions, including skipped policy-denied actions recorded as
  coverage.
- `maxStates` limits unique `stateId` values captured and enqueued.
- Precedence follows the normal option order: CLI, flow, project config, action policy, built-in
  defaults.
- When a bound is hit, the command records `exploration_degraded` with the exact bound and count.

Session isolation defaults:

- `surface flow run` uses a fresh browser context per invocation and reapplies `--auth-state` when
  provided.
- `surface qa --flows ...` uses a fresh browser context per top-level reviewed flow by default.
- Browser profile directories are unique per worktree and QA run by default. Shared profiles require
  an explicit `--profile`/policy opt-in and a per-profile process lock.
- Exploration starts from a fresh context after reviewed flows unless `--session-mode shared` is
  explicitly set.
- `--session-mode shared` is local-debug only for hybrid runs and emits a degradation warning that
  flow results may be polluted by previous actions.
- Browser-context isolation protects cookies, local storage, and browser profile state only. It does
  not reset backend fixture state.
- A flow that mutates backend state must declare `isolation.mutatesState: true` plus a
  policy-authorized teardown/reset endpoint or fresh fixture account. Missing reset contracts are
  gate-blocking errors under `--ci`.

Glob expansion for `--flows` is performed by Surface after shell expansion so quoted globs work on
all supported shells. Unmatched explicit flow globs are usage errors for `flow run`, but are
degradation entries for `qa` when exploration is also enabled.

Evidence flags compose as follows:

- `--evidence` controls what Surface persists.
- `--video` controls WebM recording within the evidence retention limit.
- `--network` controls network evidence within the evidence retention limit.
- `--network har` and `--video all` require explicit flags and never come from `--evidence full`
  alone.

All QA JSON envelopes use the existing CLI envelope shape:

```json
{
  "ok": true,
  "command": "qa",
  "schemaVersion": "1.0",
  "data": {}
}
```

Degradation entries use a consistent shape:

```json
{
  "code": "exploration_degraded",
  "severity": "warning",
  "scope": "explore",
  "message": "Exploration skipped 4 candidate actions because policy denied form submit.",
  "details": { "skippedActions": 4 }
}
```

Exit codes follow existing Surface conventions: `0` for successful or degraded runs whose requested
contract completed, `1` for runtime, policy, domain, or file/config validation failures, and `2`
for CLI argument-shape usage errors such as missing or mutually exclusive target flags. Failures use
Surface error envelopes with new codes such as `qa_unavailable`, `target_not_allowed`,
`action_policy_denied`, `flow_invalid`, `flow_step_failed`, `evidence_unavailable`,
`replay_failed`, and `promotion_rejected`.

## MCP Tools

Add agent-facing tools alongside existing analytical tools:

- `surface_qa`
- `surface_explore`
- `surface_flow_run`
- `surface_flow_list`
- `surface_flow_promote`
- `surface_evidence`
- `surface_replay`
- `surface_report_qa`
- `surface_verdict`
- `surface_artifact_read`

Tool schemas mirror CLI inputs and return the same structured data without shell-specific details.
MCP outputs should include local artifact refs, not artifact contents, unless a small redacted
summary is explicitly part of the schema.

`surface_artifact_read` is a bounded local resource tool for agent review:

- Inputs: StateStore-registered run, candidate, finding, evidence, or artifact id; optional byte
  range; and max bytes.
- Output: redacted text, structured JSON, or image metadata only when the artifact is marked
  `mcpReadable: true`.
- Size limit defaults to an 8 KB summary; callers must ask for ranges explicitly.
- Raw file paths, absolute paths, caller-supplied manifest paths, symlinks, and refs containing
  `..` are rejected.
- The implementation resolves the real path and verifies it remains under `.surface/qa/runs/`,
  `.surface/qa/artifacts/`, or another configured QA artifact root before reading.
- Content-addressed blobs under `.surface/qa/artifacts/` are readable only through a manifest
  relationship. The tool resolves the run, candidate, finding, or evidence id through the verified
  `StateStore` index when present, or by deriving the exact run manifest path from the run id under
  `.surface/qa/runs/<qaRunId>/manifest.json`, the exact candidate sidecar path under
  `.surface/qa/candidates/<candidateId>.json`, or the exact flow sidecar path under
  `.surface/qa/flows/<flowId>.json`, the exact evidence sidecar path under
  `.surface/qa/evidence/<evidenceBundleId>.json`, or the promoted-finding ref under
  `.surface/qa/refs/promoted-findings/<findingId>.json` and rebuilding the registration. It
  recomputes manifest and sidecar digests, rejects tampered records, cross-verifies sidecar
  `qaRunId`, finding, candidate, and evidence refs against the run manifest and tracked finding
  when applicable, verifies that the requested artifact id, digest, checksum, media type, byte
  range, and sensitivity flags match that manifest, then reads only the referenced blob. Shared refs
  still require index consistency, but committed unique run, candidate, flow, evidence, and
  promoted-finding evidence stay readable after non-CI index-update degradation.
- Raw HAR bodies, auth state, cookies, local storage, headers, unredacted screenshots/videos, and
  artifacts marked `sensitiveRaw` are never MCP-readable.
- Remote MCP clients receive refs and summaries, not direct file-system traversal authority.
- For remote clients that cannot open local paths, the tool can return redacted OCR/text
  summaries, dimensions, hashes, and policy-approved low-resolution redacted thumbnails. A future
  authenticated local asset proxy can be added, but raw local paths remain the source of truth.

## Flow File Schema

Flow files are versioned YAML. They favor semantic locators over volatile refs while allowing refs
as fast-path hints.

```yaml
schemaVersion: "1.0"
id: checkout
title: Checkout validation flow
severity: high
isolation:
  mode: isolated
  mutatesState: true
  resetRequired: true
  resetEndpointId: checkoutReset
  fixtureAccountId: checkoutUserAccount
target:
  kind: localhost
  ref: http://localhost:3000
actionPolicy:
  ref: .surface/qa/action-policy.json
inputs:
  checkoutEmail:
    default: "qa+{{$timestamp}}@example.test"
secrets:
  testPassword:
    fromEnv: SURFACE_QA_TEST_PASSWORD
fixtures:
  - id: checkoutUserData
    path: surface-fixtures/checkout-user.json
defaults:
  timeoutMs: 25000
  viewport:
    label: desktop
    width: 1440
    height: 1000
  evidence: failures
steps:
  - id: open-cart
    action: open
    url: /cart
    capture: true
  - id: start-checkout
    action: click
    timeoutMs: 10000
    locator:
      role: button
      name: Checkout
      refHint: "@e12"
    wait:
      url: "**/checkout"
  - id: fill-email
    action: fill
    locator:
      label: Email
    value: "{{inputs.checkoutEmail}}"
  - id: submit-empty-payment
    action: click
    severity: high
    locator:
      role: button
      name: Pay now
    expect:
      text: "Card number is required"
    capture:
      label: payment-validation-error
      evidence: full
teardown:
  always:
    - id: clear-cart
      action: open
      url: /test-support/reset-cart
```

Supported action types:

- `open`
- `pushstate`
- `click`
- `dblclick`
- `hover`
- `focus`
- `fill`
- `type`
- `press`
- `check`
- `uncheck`
- `select`
- `upload`
- `scroll`
- `wait`
- `capture`
- `assert`
- `setViewport`
- `setTheme`

Locators:

- `refHint`: previous `@eN`, used only after confirming it still maps to the expected role/name.
- `role` + `name`
- `label`
- `placeholder`
- `text`
- `testId`
- `selector` as fallback.

Frames:

- Frame-scoped steps and `switchFrame` are out of v1 because the agent-browser CLI driver does not
  expose a stable frame execution contract yet.
- Iframe state can still appear in exploration evidence as `framePath` metadata, but reviewed flow
  steps must use top-level semantic locators in v1.

Step options:

- `timeoutMs` overrides `defaults.timeoutMs` for one step.
- `severity` can be `critical`, `high`, `medium`, or `low`. Step severity overrides flow severity
  for failures on that step.
- `capture` can be `true` or an object with `label`, `evidence`, and `assertions`.
- `wait` supports URL, network-idle, visible locator, hidden locator, and timeout conditions.
- `retry` is allowed only for idempotent waits and assertions, not for mutating actions.
- `teardown.always` runs after pass or fail when the action policy permits it; denied teardown
  actions become degradation entries and never mask the original flow result.

Isolation:

- `isolation.mode` is `isolated` or `shared`; `isolated` is the default for reviewed flows.
- `isolation.mutatesState: true` declares that the flow may change backend or persisted browser
  state.
- `isolation.resetRequired: true` requires either policy-authorized `teardown`, a reset endpoint in
  action policy, or a fresh fixture account before the flow is gate-eligible.
- `isolation.resetEndpointId` points at `actionPolicy.resetEndpoints[].id`.
- `isolation.fixtureAccountId` points at `actionPolicy.fixtureAccounts[].id` for per-run or pooled
  fixture-account provisioning. `fixtureRef` inside that policy entry can point to a local flow
  fixture id first, then a project fixture root entry.
- Under `--ci`, a mutating flow without a valid reset/teardown contract is a `flow_invalid` error.
- In local non-CI runs, Surface may execute the flow but records degradation and marks the result
  non-gate-eligible.

Inputs, secrets, fixtures, and generated values:

- Flow files may use `{{inputs.name}}`, `{{secrets.name}}`, `{{fixtures.id.path.to.value}}`, and
  generated variables such as `{{$uuid}}`, `{{$timestamp}}`, `{{$randomEmail}}`, and
  `{{$randomString}}`.
- `inputs` are non-secret values that can be overridden by CLI, config, or MCP input.
- Inputs are still redacted before persistence when they match configured sensitive patterns,
  common PII patterns, credentials, tokens, emails, phone numbers, or payment-like values.
- `secrets` are references only, such as `fromEnv` or future keychain refs. Inline secret literals
  are schema errors.
- Secret values are never placed in command-line arguments, persisted step payloads, traces, or
  serialized `agent-browser` commands.
- `BrowserQaDriver` passes resolved secrets only through memory-backed transport such as stdin,
  pipes, or secure IPC/private session channels. V1 must not write resolved secrets to
  `.surface/`, the project directory, traces, or any packageable path.
- `BrowserQaDriver` launches `agent-browser` with an explicit child-environment allowlist, not a
  copy of `process.env`. The default allowlist is `PATH`, `HOME`, `TMPDIR`, `TEMP`, `TMP`, `LANG`,
  `LC_*`, `CI`, and tool-specific non-secret variables explicitly approved by config. It must never
  include variables consumed by secret refs or variables whose names match sensitive patterns such
  as `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `COOKIE`, `AUTH`, or configured project patterns.
- If a future `agent-browser` capability requires file-backed secret handoff, it must use an
  OS-managed memory-backed or encrypted mechanism, never `.surface/`, and must get a separate
  security review. On Windows, standard filesystem temp files are not an acceptable fallback; the
  design must use secure IPC, OS-secured memory-mapped files, or DPAPI-encrypted handles.
- Secret values are masked before logging, reports, state manifests, and error details.
- Fixtures are read-only, project-local files validated to stay under configured fixture roots.
- Fixture paths reject absolute paths and `..` segments before resolution, then resolve symlinks
  with `realpath` and verify the real file path remains under the configured fixture root before
  reading.
- Generated values are recorded only as masked run metadata unless explicitly marked
  `recordGeneratedValue: true` for non-sensitive debugging.

Severity resolution:

- Assertion severity overrides step severity.
- Step severity overrides flow severity.
- Flow severity defaults to `medium`.
- `FlowRun` records the highest resolved severity among failed steps and assertions so
  `GateEvaluator` can compare it to policy without reinterpreting YAML.

Assertions:

- text appears or disappears
- URL matches
- element visible/enabled/checked
- no page errors
- no failed network requests matching a filter
- vitals threshold
- React render count threshold

## Core Data Model

### `QaRun`

```ts
type QaRun = {
  id: string;
  target: Target;
  mode: "flow" | "explore" | "hybrid";
  startedAt: string;
  completedAt?: string;
  status: "completed" | "degraded" | "failed";
  flowRuns: FlowRunSummary[];
  exploration?: ExplorationSummary;
  findings: string[];
  candidateFindings: string[];
  candidateFlows: string[];
  evidenceBundles: string[];
  degradation: QaDegradation[];
  manifestPath: string;
};
```

### `FlowRun`

```ts
type FlowRun = {
  id: string;
  flowId: string;
  source: { kind: "file" | "surface-state"; ref: string };
  status: "passed" | "failed" | "degraded";
  target: Target;
  severity: "critical" | "high" | "medium" | "low";
  highestFailedSeverity?: "critical" | "high" | "medium" | "low";
  actionPolicyRef?: string;
  isolation: {
    mode: "isolated" | "shared";
    mutatesState: boolean;
    resetSatisfied: boolean;
  };
  steps: FlowStepResult[];
  evidenceBundles: string[];
  findingIds: string[];
};
```

### `ExplorationState`

```ts
type ExplorationState = {
  id: string;
  stateId: string;
  url: string;
  title?: string;
  depth: number;
  actionPath: BrowserAction[];
  actionPathHash: string;
  viewport: Viewport;
  theme?: Theme;
  dialogState?: string;
  framePath?: string[];
  authStatus: "authenticated" | "anonymous" | "auth-drift" | "reauthenticated";
  reauthFlowRef?: string;
  snapshotRef?: string;
  annotatedScreenshotRef?: string;
  discoveredElements: DiscoveredElement[];
  consoleSummary?: BrowserConsoleSummary;
  networkSummary?: BrowserNetworkSummary;
};
```

### `CandidateFinding`

```ts
type CandidateFinding = {
  id: string;
  qaRunId: string;
  title: string;
  category: "visual" | "functional" | "ux" | "content" | "performance" | "console" | "accessibility";
  severity: "critical" | "high" | "medium" | "low";
  confidence: "candidate" | "replayed" | "verified";
  replayable: boolean;
  replayStatus: "not-run" | "reproduced" | "not-reproduced" | "blocked" | "not-replayable";
  promotionSource?: "replay" | "measurement" | "human-verdict";
  identityConfidence: "none" | "low" | "medium" | "high";
  gateEligible: boolean;
  actionPath: BrowserAction[];
  evidenceBundleId: string;
  promotion?: { findingId: string; promotedAt: string; reason: string };
};
```

### `EvidenceBundle`

```ts
type EvidenceBundle = {
  id: string;
  qaRunId: string;
  findingId?: string;
  candidateFindingId?: string;
  artifacts: QaEvidenceArtifact[];
  sourceCaptureArtifactIds: string[];
  reproSteps: ReproStep[];
  manifestPath: string;
  checksums: Record<string, string>;
  redacted: boolean;
  sanitizedAtCapture: boolean;
  containsSensitiveRaw: boolean;
};
```

QA evidence artifacts use the shared `CaptureArtifact` base instead of duplicating capture
persistence. `BrowserQaDriver` owns interaction and browser sessions; state materialization goes
through `BrowserStateCapture`, an adapter that collaborates with `CaptureService` or narrow shared
artifact/redaction services for artifact validation, redaction, path normalization, symlink checks,
and `StateStore.writeArtifact`.

QA evidence wraps or references Capture artifacts with QA-specific meaning:

- `annotated-screenshot`
- `step-screenshot`
- `repro-video`
- `browser-snapshot`
- `dom-snapshot`
- `console-log`
- `network-summary`
- `har`
- `react-tree`
- `react-inspect`
- `react-render-profile`
- `vitals`
- `trace`

Artifacts can have QA-specific `kind` metadata, but file ownership, path validation, redaction, and
local-first retention remain shared with the Capture domain.

## Evidence Retention Policy

Evidence is persisted according to the requested level:

- `minimal`: QA run summary, redacted candidate summaries, and only screenshots needed for top
  findings.
- `failures`: evidence for failed flow steps, verified findings, and replayable candidates.
- `full`: all state screenshots, snapshots, step screenshots, console/network summaries, and
  requested videos/traces.

HAR, trace, profiler output, and full video are never default-on for all states. They are opt-in,
or captured only for failures when configured.

Redaction and sanitization happen before persistence:

- `BrowserQaDriver` strips or masks `Authorization`, `Cookie`, `Set-Cookie`, session tokens, CSRF
  tokens, local storage values, and configured secret patterns before bytes reach
  `QaEvidenceStore`.
- Network summaries persist method, URL origin/path, status, duration, and failure class by default.
  Query strings, request bodies, response bodies, and sensitive headers are dropped unless a
  policy explicitly allows a redacted excerpt.
- HAR capture defaults to metadata-only entries with bodies omitted. Full HAR bodies require both
  `--network har` and an action policy field that permits raw local debugging for the specific
  target.
- Auth state files in `.surface/auth/` are never copied into evidence bundles.
- Screenshots and videos are treated as sensitive even after redaction because they may display
  user data. Reports and MCP tools reference them by local path only.
- Any opt-in raw debugging artifact is marked `sensitiveRaw`, excluded from reports and MCP reads,
  expires quickly, and is never promoted as finding evidence.
- Retention pruning also deletes expired unique browser profile directories and temporary profile
  caches under `.surface/tmp/qa/` after confirming no active Surface lockfile or process group owns
  them.

## Candidate Promotion Rules

Autonomous exploration can create candidate findings directly, but candidates do not enter the
normal backlog or fail gates until promoted.

Promotion paths:

- Deterministic replay reproduces the issue condition. For bug repro flows, this usually means the
  assertion fails in the expected way or the measured bad signal recurs; it does not mean the whole
  flow passed cleanly.
- A measured tool confirms the issue, such as a failed accessibility check or a failed network
  request.
- A human verdict promotes it with rationale.

Unreplayed exploratory issues stay visible in QA reports as candidates. This keeps exploration
useful without making probabilistic discoveries look like deterministic regressions.

Promotion outputs:

- Replay or measured promotion creates a normal `Finding`, creates or transitions the corresponding
  `TrackedFinding`, sets `promotionSource`, and sets `gateEligible: true` when the underlying
  validation check is deterministic.
- Human promotion creates a reportable normal `Finding` with `promotionSource: "human-verdict"`,
  but keeps automated replay eligibility false until replay or measured confirmation proves it can
  be evaluated automatically. High and critical unresolved human-promoted findings are still
  gate-blocking under the default manual-verdict gate policy.
- Candidates with `replayStatus: "not-reproduced"`, `blocked`, or `not-replayable` cannot be
  auto-promoted.
- Gate evaluation ignores unresolved candidates by default. Once a human verdict promotes a
  candidate into a normal finding, normal severity, waiver, and gate-disposition policy applies.

## Finding Identity

QA findings should derive identity from a richer action-aware anchor:

```json
{
  "lens": "browser-qa",
  "issueType": "form-validation-missing-feedback",
  "anchorKind": "element-ref",
  "locationAnchor": "@e12",
  "context": {
    "route": "/checkout",
    "stateId": "payment-validation-error",
    "actionPathHash": "aph_...",
    "role": "button",
    "name": "Pay now",
    "component": "CheckoutSubmitButton"
  }
}
```

Identity priority:

1. Verified element ref plus route and state id.
2. Semantic locator plus route and state id.
3. Component plus action path.
4. Selector plus action path.
5. Screenshot region plus state id for purely visual issues.

`stateId` is deterministic and versioned. It is derived from:

- normalized route and query allowlist, excluding volatile query params
- viewport label, dimensions, theme, locale, and feature flags known to Surface
- modal, dialog, popover, drawer, and frame path state
- normalized interactive subtree for the relevant container, form, dialog, route landmark, or target
  element ancestry: role, accessible name, selected/checked/disabled state, visibility, semantic
  group, and stable text excerpts
- canonical action-path semantic signature: action type, semantic locator, assertion intent, and
  frame, excluding `refHint`, coordinates, generated ids, timestamps, random fixture values,
  animation state, and CSS class hashes

The hash should be emitted as `sid_v1_<digest>`. Capture labels such as
`payment-validation-error` can be human-friendly aliases, but they are not the stable `stateId`
unless their canonical hash matches.

Class and style normalization uses extensible adapters, not a single regex. The first
implementation should include framework-aware heuristics for CSS Modules, Tailwind utility order,
hashed build class names, common bundler suffixes, and generated component ids. Unknown volatile
class patterns are dropped from identity and kept only as evidence.

If replay cannot match the anchor, Surface marks the existing `TrackedFinding` with the existing
`identity-broken` lifecycle status rather than resolving it. QA-specific details live in
`trackedFinding.metadata.browserQa`:

```json
{
  "identityBroken": true,
  "lastKnownStateId": "sid_v1_...",
  "replayRunId": "qa_...",
  "replayStatus": "blocked",
  "reason": "semantic locator no longer matched within payment frame"
}
```

`diff` and `trace` should therefore surface browser-QA identity drift through the same closed-loop
read model already used for other findings. Gate policy treats `identity-broken` as not confirmed
unless explicitly configured to fail on identity drift.

## Exploration Strategy

Autonomous exploration should be bounded, deterministic enough to debug, and safe by default.

The first exploration engine should:

- Start from the target URL.
- Capture an initial annotated screenshot and interactive snapshot.
- Build a queue of safe actions from links, tabs, menus, accordions, disclosure buttons, dialog
  open/close controls, hover/focus targets, scrolling, and non-mutating route navigation.
- Prefer navigation and reveal-only actions.
- Avoid destructive actions unless the flow file or action policy explicitly permits them.
- Re-snapshot after every page-changing action.
- Capture console errors and network failures at each state.
- Generate candidate flows from action paths that reach meaningful states.
- Stop at configured `maxDepth`, `maxActions`, `maxStates`, and allowed domains.
- Monitor auth drift: unexpected login redirects, session-expired screens, 401/403 bursts, or loss
  of expected authenticated landmarks. Auth drift stops the run with `exploration_degraded` unless
  a policy-authorized re-auth flow is configured.
- After a re-auth flow completes, the Explorer discards stale element refs, reopens the last clean
  route from the canonical action path, reapplies non-secret generated inputs when policy allows,
  captures a fresh snapshot, and rebuilds the queue from the new `stateId`. If the route or required
  landmark cannot be restored, the run degrades instead of continuing from stale DOM state.

Candidate flows are generated only from meaningful states. A meaningful state is one or more of:

- new `stateId` plus at least one newly reachable interactive control or landmark
- error, validation, empty, loading-stuck, permission, or auth-drift state
- form, dialog, menu, popover, drawer, wizard step, iframe, or checkout/payment/account boundary
- console error, failed network request, vitals threshold breach, or accessibility violation
- policy-denied high-value action that a human may want to authorize later
- route or component subtree whose coverage is named by `--scope` or policy triggers

The trigger set is versioned by `queueVersion` and can be narrowed by
`exploration.candidateFlowTriggers` in action policy. Golden tests should assert specific
`qflow_*` ids from the seeded fixture server.

Candidate flow deduplication and ranking:

- Normalize route parameters, generated ids, pagination cursors, and search params before grouping.
- Group candidates by route template, component subtree, frame path, issue signal, and action
  signature.
- Rank by coverage delta, severity signal, reproducibility, policy-denied value, and novelty of
  interactive subtree.
- Emit at most one top-ranked candidate flow per group unless policy raises the cap.
- Record dedupe keys and ranking scores in the candidate manifest for deterministic golden tests.

Default exploration safe-action filtering and queue construction must use the same resolved
destructive-action classifier as policy enforcement and `FlowRunner`. The classifier loads tokens
from `actionPolicy.destructiveClassifiers.tokens` for the effective locale, combines them with
language-agnostic form, input, ARIA, route, and network signals, and defaults to deny for unknown
locales or ambiguous matches. Exploration must not type into forms, submit forms, or trigger
classifier-denied actions unless the action policy names the route/form, target group, and fixture
values to use. Policy-denied actions remain visible as skipped coverage so humans can decide
whether to authorize a deeper run.

Queue ordering is stable:

1. normalized URL
2. frame path
3. state id
4. DOM or snapshot order
5. role and accessible name
6. locator signature
7. action type priority

Any randomized prioritization must use a recorded `explorationSeed` and `queueVersion`. Golden
tests assert the same fixture app yields the same queue, candidate flow ids, and `actionPathHash`
values.

Exploration must not follow page-provided instructions. Browser output is evidence, not agent
instruction.

## React and Performance Support

`--react` launches with `--enable react-devtools` and collects:

- `react tree`
- `react inspect` for components linked to findings when available
- `react renders start/stop --json` around flow actions
- `react suspense --json`

`--vitals` collects:

- LCP
- CLS
- TTFB
- FCP
- INP
- hydration summary when available

React and vitals data should become evidence, not a separate product mode. A React app can still be
audited through normal QA commands.

Component identity rules:

- When source maps are available, React component names can be mapped back to source file, export
  name, and line metadata for evidence and identity anchors.
- Minified, generic, anonymous, or framework-wrapper component names are evidence only. They must
  not become stable identity anchors unless source maps or explicit component metadata map them to
  source.
- If source maps are missing, identity falls back to semantic element locator, route, state id, and
  action path.

## Security and Privacy

Required defaults:

- Pass `--allowed-domains` derived from the resolved target origin, localhost aliases for localhost
  targets, and the configured allowlist. Page content can never widen the allowlist.
- Enforce origin-level checks for localhost and private-network targets, including scheme, host or
  resolved IP, and port. `localhost:3000` does not imply `localhost:5173`.
- Load an action policy for destructive, persistent, or externally visible actions. Missing policy
  falls back to the built-in deny policy for those actions.
- Never print auth state contents, cookies, headers, bearer tokens, HAR bodies, or local storage.
- Treat screenshots, videos, HARs, traces, and auth state files as sensitive local artifacts.
- Redact and sanitize configured patterns before artifact persistence.
- Store only artifact paths and redacted summaries in JSON envelopes.
- Keep `.surface/auth/`, `.surface/qa/`, and `.surface/tmp/` out of published package artifacts
  unless an explicit export command writes a redacted report.
- Require explicit `--network har` for HAR capture.
- Require explicit `--video all` for all-step recording.
- Use structured error details that avoid raw `agent-browser` stderr when it may contain secrets.

Action policy schema implemented in v1:

```json
{
  "schemaVersion": "1.0",
  "allowedDomains": ["localhost", "127.0.0.1", "app.example.com"],
  "environmentGroups": [
    {
      "id": "local",
      "origins": ["http://localhost:*", "http://127.0.0.1:*"]
    }
  ],
  "rules": [
    {
      "id": "allow-seeded-checkout",
      "decision": "allow",
      "actions": ["click"],
      "categories": ["payment"],
      "origins": ["http://localhost:*"],
      "routes": ["/checkout"],
      "locators": [{ "role": "button", "name": "Pay now" }]
    }
  ],
  "resetEndpoints": [
    {
      "id": "checkoutReset",
      "origin": "http://localhost:*",
      "method": "POST",
      "path": "/test-support/reset-cart"
    }
  ],
  "fixtureAccounts": [
    {
      "id": "checkoutUserAccount",
      "fixtureRef": "fixtures/browser-qa/users/checkout.json"
    }
  ]
}
```

Policy validation rules:

- `allowedDomains` is matched on normalized hostname/origin before navigation, redirects, and
  subresource capture.
- `environmentGroups` are loaded and preserved for future target grouping, but the v1 matcher uses
  rule-level `origins` directly.
- `rules` are allow or deny rules. If no allow rule matches a destructive action, the action is
  denied.
- Destructive action allow rules must bind to an effective target origin through `origins`.
  `--target`, `--url`, `--localhost`, and `--base-url` first produce the effective target; Surface
  then revalidates matching action rules against that origin.
- Route and locator constraints provide specificity but do not replace origin binding for
  destructive, persistent, payment, account, upload, submit, save, clear, or delete actions.
- `resetEndpoints` define policy-authorized backend reset hooks for future runner integration. The
  current runner does not execute those hooks, so `resetEndpointId` alone does not satisfy CI
  isolation.
- `fixtureAccounts` define fixture-backed fresh state. A backend-mutating flow is gate-eligible in
  CI only when it uses a validated fixture account or explicit policy-authorized teardown actions
  that classify as `clear`.
- Submit, save, create, update, delete, clear, reset, purchase, payment, account, upload, invite,
  send, logout, and external navigation actions require explicit policy entries.
- Destructive-action classification in v1 uses built-in conservative tokens and signals over:
  - HTML form method and action, especially non-GET forms
  - input types `submit`, `reset`, `file`, and payment/account credential fields
  - button, link, and menuitem roles with accessible-name tokens matching delete, remove, destroy,
    reset, clear, save, submit, publish, send, invite, purchase, pay, checkout, confirm, logout,
    revoke, transfer, or account-change verbs
  - ARIA roles `button`, `menuitem`, `switch`, `checkbox`, `radio`, `option`, and `link` when
    combined with the tokens above or inside a mutating form
  - HTTP requests observed or predicted as non-GET, cross-origin, payment, account, email, upload,
    or webhook actions
  - language-agnostic signals such as form method/action, input type, network method, URL path
    patterns, data attributes, and route/action metadata
- Rich `destructiveClassifiers`, policy-owned exploration defaults, re-auth flow references, and
  raw-evidence retention controls are not implemented in v1. They remain follow-up policy extensions
  and must be added through schema, loader, classifier, and tests before being documented as active
  fields.
- Raw artifacts are marked `sensitiveRaw`, non-reportable, non-MCP-readable, ignored by gate, and
  pruned by short retention.
- Auth injection failures and policy denials return sanitized messages with enough locator, route,
  and policy-ref context to debug without exposing secrets.

## Architecture

New core units:

- `BrowserQaDriver`: typed wrapper around `agent-browser` command execution, lifecycle, and
  sanitized event capture.
- `FlowRecipeParser`: validates YAML flow files into typed recipes.
- `FlowRunner`: executes flow recipes through `BrowserQaDriver`.
- `Explorer`: bounded autonomous exploration that emits candidates and working flows.
- `BrowserStateCapture`: adapts live browser state into shared `CaptureArtifact`-compatible
  artifacts without adding interactive browser ownership to `CaptureService`.
- `QaEvidenceStore`: persists sanitized evidence manifests and artifacts through
  `StateStore.writeArtifact`.
- `QaFindingPromoter`: turns candidates into normal Surface findings when verified.
- `QaRunStore`: commits unique QA run sidecars under `.surface/qa/runs/<qaRunId>/` with atomic
  same-filesystem renames; only shared indexes, refs, latest pointers, promotions, and tombstones
  use the `StateStore` lock.
- `QaOrchestrator`: coordinates flow runs, exploration, evidence persistence, and promotion.

Existing units stay in place:

- `CaptureService` remains the low-level single-state capture service.
- `LensRegistry` remains the analytical lens selector.
- `GateEvaluator` gains optional flow-run inputs but does not learn browser automation.
- Report renderers gain QA report formats.

`BrowserQaDriver` lifecycle requirements:

- Run `agent-browser doctor` or an equivalent capability check before the first browser command.
- Create fresh browser contexts according to session isolation defaults: one per `surface flow run`,
  one per reviewed flow inside `surface qa`, and one fresh context for exploration unless
  `--session-mode shared` is explicitly set.
- Reapply `--auth-state` or configured auth bootstrap to each isolated context without copying auth
  state into evidence.
- Run a configured reauth flow only after auth drift is detected and only when the resolved action
  policy authorizes the reauth flow for the current origin.
- Apply command, navigation, step, and total-run timeouts; step timeout comes from the flow step,
  then flow defaults, then CLI defaults.
- Normalize `agent-browser` stdout/stderr into typed results and sanitized errors.
- Never pass resolved secrets through argv, shell command text, persisted command payloads, or
  traces.
- Build the child environment from the explicit safe allowlist only; never inherit arbitrary parent
  environment variables.
- Close sessions in `finally` blocks, on SIGINT/SIGTERM, and after timeout cancellation.
- Record session ids, browser profile ids, process-group ids, child process ids, process start
  times when available, executable/command signatures, and Surface-owned lockfile tokens in the run
  manifest for cleanup.
- Provide `surface qa cleanup` to terminate stale sessions recorded by incomplete manifests; startup
  doctor checks should report stale sessions and suggest or perform cleanup when policy allows.
- Prevent concurrent commands from corrupting the same browser profile or `.surface/qa` state with
  process locks.
- Detect local port conflicts and unavailable targets before starting long explorations.
- Surface cleanup degradations separately from flow failures so teardown issues do not hide the
  original result.

## Data Flow

Hybrid QA run:

```text
CLI/MCP
  -> QaOrchestrator
  -> FlowRunner for reviewed flows
  -> Explorer for uncovered states
  -> BrowserQaDriver(agent-browser)
  -> BrowserStateCapture / CaptureService artifact writer
  -> QaEvidenceStore
  -> CandidateFinding / Finding promotion
  -> StateStore
  -> QA report / backlog / gate
```

Candidate promotion:

```text
CandidateFinding
  -> replay via FlowRunner
  -> evidence comparison / measured confirmation
  -> QaFindingPromoter
  -> normal Finding + TrackedFinding
```

Flow promotion:

```text
Exploration action path
  -> CandidateFlow in .surface
  -> human/agent review
  -> surface flow promote
  -> surface-flows/<id>.yml
```

## Error Handling

New error codes:

- `qa_unavailable`: `agent-browser` missing or failed doctor check.
- `qa_state_locked`: another Surface process owns the QA state lock.
- `agent_browser_conflict`: browser profile, session, or port conflict prevented execution.
- `target_not_allowed`: target, redirect, or subresource violated allowed-domain policy.
- `action_policy_denied`: action is outside the resolved action policy.
- `flow_invalid`: flow file schema or action validation failed.
- `flow_step_failed`: deterministic flow step failed.
- `exploration_degraded`: exploration skipped states because of limits or policy.
- `evidence_unavailable`: requested evidence artifact is missing.
- `raw_evidence_denied`: command requested raw sensitive evidence without explicit local policy.
- `replay_failed`: replay setup or execution failed.
- `promotion_rejected`: candidate did not meet promotion requirements.

`replayStatus: "not-reproduced"` is a successful replay result, not an error. If
`--promote-on-repro` was requested and the replay is not reproduced, Surface returns a successful
replay envelope with `promotion_rejected` in the promotion result. `agent-browser` command failures
should be normalized without exposing sensitive args or stderr.

## Reporting

Add report formats:

- `qa-json`
- `qa-md`
- `flow-run-json`
- `evidence-manifest-json`

QA Markdown should be repro-first:

- summary counts
- flows run and status
- verified findings
- candidate findings
- candidate flows
- evidence artifact paths
- degradation and skipped coverage

## Gate Integration

`surface gate --with-flows` should fail on:

- reviewed flow failures at or above configured severity
- promoted measured findings that violate current policy
- browser QA findings with `gateEligible: true` and deterministic replay failures when configured
- unresolved high or critical human-promoted browser QA findings unless waived or explicitly
  excluded by policy

It should not fail on:

- unverified candidates
- low or medium human-promoted findings unless the configured manual-verdict gate threshold includes
  them
- judged findings already excluded by current gate policy
- evidence retention failures when the flow itself passed, unless policy says evidence is required

## Test Strategy

Unit tests:

- flow schema parsing
- flow input, secret-ref, generated-value, fixture, teardown, and timeout validation
- flow isolation schema and mutating-flow reset requirements
- fixture-account lookup from policy `fixtureAccounts` with local flow fixture fallback through
  `fixtureRef`
- locator normalization
- action policy decisions
- destructive-action classifier patterns and explicit classification overrides
- localized destructive-action classifier token sets from `destructiveClassifiers.tokens` and
  language-agnostic mutating-form signals
- origin and port enforcement for localhost/private-network targets
- dynamic target policy matching for `environmentGroups`, preview origins, and local port patterns
- exploration queue construction and safe-action filtering
- meaningful-state candidate-flow trigger decisions
- exploration bound precedence for `maxDepth`, `maxActions`, and `maxStates`
- `BrowserQaDriver` command argument arrays
- `agent-browser` JSON envelope parsing
- pre-persistence redaction and masking
- secret transport assertions that argv, traces, serialized step payloads, and artifacts do not
  contain resolved secret values
- secret transport assertions that consumed `fromEnv` values are removed from the child process
  environment
- child environment allowlist assertions that undeclared secret-like parent variables are absent
- secret transport assertions that resolved secrets are never written under `.surface/`
- evidence retention decisions
- candidate promotion rules
- state id derivation and volatile-field exclusion
- QA identity derivation
- flow severity resolution and gate-threshold comparison
- fixture realpath, symlink, and root-boundary rejection
- artifact-read verified-StateStore registration, manifest-relationship, tamper detection, path
  traversal, symlink, realpath, and root-boundary rejection
- artifact-read fallback that reads a committed run manifest after simulated non-CI index-lock
  degradation
- artifact-read fallback that resolves `qfc_*`, `qflow_*`, `ev_*`, and `f_*` sidecars after
  simulated non-CI index-lock degradation and rejects tampered refs
- cleanup process validation for process group, start time, executable signature, and lockfile token

Integration tests:

- seeded fixture server with login, checkout, billing, iframe payment, modal, dropdown, console
  error, failed request, and reset endpoints
- fake `agent-browser` harness for deterministic stdout/stderr/session lifecycle tests
- scripted flow success and failure against seeded HTML
- two-flow isolated QA run where the first flow mutates fixture state and the second flow asserts a
  clean start
- autonomous exploration discovers modal/dropdown/form-validation states
- autonomous exploration skips policy-denied submits, destructive actions, and external navigation
- autonomous exploration stops on auth drift
- autonomous exploration runs a policy-authorized reauth flow after auth drift
- autonomous exploration uses stable queue ordering and records `explorationSeed`/`queueVersion`
- autonomous exploration emits candidate flows only for deterministic meaningful-state triggers
- autonomous exploration deduplicates and ranks candidate flows on route template, subtree, signal,
  and coverage delta
- console error and failed request become candidate evidence
- React/vitals commands are invoked only under flags
- redaction applies before artifact persistence and again before report rendering
- `surface flow promote` writes stable YAML
- retention pruning preserves promoted evidence and tombstones expired unreferenced artifacts
- `surface qa cleanup` terminates only process-validated stale Surface-owned sessions from
  incomplete manifests

CLI e2e tests:

- `surface qa --localhost` produces a QA run envelope
- `--localhost` is parsed as a boolean and custom local ports use `--url` or `--target`
- `surface explore` produces candidate flows/findings
- `surface flow run` replays a promoted flow
- `surface flow run --url` and `--localhost` override the YAML target
- `surface flow run` rejects destructive action policy rules that do not authorize the overridden
  target origin
- `surface flow run --base-url` accepts preview/local origins only when policy origin patterns or
  environment groups authorize them
- `surface replay` promotes or rejects candidates
- `surface gate --with-flows --ci` fails only on configured flow failures
- `surface report qa --run` renders md/json/manifest
- `surface verdict qfc_... --promote` records human promotion without making it gate-eligible

Golden tests:

- flow YAML fixtures
- QA JSON output
- evidence manifest JSON
- MCP tool schemas
- redacted network summaries, redacted artifact-read responses, and state sidecar manifests

## Phased Implementation

Phase 1: Foundation

- Add QA domain types and schemas.
- Add `BrowserQaDriver` lifecycle, doctor check, timeout, session cleanup, and sanitized error
  handling.
- Add action policy schema, default deny policy, origin/port enforcement, and safe-action
  classification.
- Add flow file parser and deterministic `surface flow run`, including target overrides,
  severity, isolation, step timeouts, inputs, fixtures, memory-only secret refs, and teardown
  validation.
- Persist unique sidecar QA run manifests and sanitized evidence manifests with lock-free atomic
  commits; use `StateStore` locks only for shared indexes, refs, latest pointers, promotions, and
  tombstones.
- Add per-flow isolated browser contexts and stale session cleanup.
- Add seeded fixture server, fake `agent-browser` harness, schema golden tests, and safety policy
  unit tests.

Phase 2: Evidence and Replay

- Add screenshots, annotated screenshots, snapshots, console/errors, and network summary evidence.
- Add `BrowserStateCapture` shared with CaptureService artifact validation and redaction.
- Add `surface evidence`.
- Add `surface replay`.
- Promote replayed or measured candidates into normal findings with `TrackedFinding` integration.
- Add retention pruning, tombstones, and manifest-authorized path-hardened redacted artifact-read
  support.

Phase 3: Exploration

- Add bounded `surface explore`.
- Generate candidate findings and candidate flows.
- Add `surface flow promote`.
- Add exploration queue builder, safe-action filter, state dedupe with `stateId`, and skipped
  coverage reporting.
- Add stable queue ordering, `maxStates`, auth-drift detection, optional policy-authorized reauth,
  meaningful-state triggers, and recorded exploration seed.

Phase 4: Rich Diagnostics

- Add `--react` support.
- Add `--vitals`.
- Add opt-in video, HAR, trace, and profiler artifacts.

Phase 5: Integration

- Add `surface qa`.
- Add MCP tools, including report, verdict, and redacted artifact read.
- Add `surface gate --with-flows`.
- Add report renderers and backlog integration.

## Proposed Beads Breakdown

Parent: `surface-edw`.

Suggested child issues:

- Add QA domain schemas and state model.
- Add typed `agent-browser` QA driver.
- Add action policy schema and safe browser action enforcement.
- Add browser session isolation and stale cleanup.
- Add flow YAML parser and `surface flow run`.
- Add QA evidence store and manifest reports.
- Add path-hardened redacted artifact-read support.
- Add replay and candidate promotion.
- Add bounded exploration engine.
- Add flow promotion to source-controlled YAML.
- Add React/vitals diagnostics.
- Add video/HAR/trace opt-in evidence.
- Add `surface qa` orchestration.
- Add QA MCP tools.
- Add flow-aware gate integration.
- Add seeded QA fixtures and golden contract tests.

## Implementation Defaults

- Flow files live in `surface-flows/` by default.
- Flow targets can be overridden per invocation with `--target`, `--url`, `--localhost`, or
  `--base-url`; YAML targets are defaults, not environment locks.
- Localhost and private-network allowlists are origin-scoped by default, including port.
- `.surface/qa/` stores discovered candidates, run history, evidence manifests, content-addressed
  sanitized artifacts, tombstones, and replay metadata.
- `.surface/qa/action-policy.json` is optional, but missing policy means built-in safe browsing
  only.
- Reviewed flows run in isolated browser contexts by default; shared session mode is local-debug
  only.
- Resolved secrets are memory-only in v1 and are never written under `.surface/`.
- Redacted artifact reads must be authorized through a run/evidence manifest relationship, not just
  by a digest path.
- `--state-lock-timeout` defaults to 10 seconds and applies only to short state commit sections.
- `surface qa cleanup` is the supported cleanup path for stale Surface-owned browser sessions.
- `surface qa` runs bounded exploration when no flow files are provided or discovered.
- `surface gate --with-flows` auto-discovers `surface-flows/*.yml` unless explicit flow globs are
  provided.
- QA artifacts are referenced from a separate `qa-json` report with cross-references to promoted
  findings. Existing `findings.json` remains focused on normal Surface findings.
- Raw sensitive evidence is never a default Surface artifact and is not reportable, MCP-readable,
  or gate-eligible.
