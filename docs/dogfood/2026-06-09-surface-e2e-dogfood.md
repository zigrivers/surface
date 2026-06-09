# Surface 0.2.2 End-to-End Dogfood

Date: 2026-06-09
Repository: `/Users/kenallred/.codex/worktrees/c332/surface`
Commit: `f8932c70dfc41e90bbfc30ffc600307c8e5f035b`
Dogfood issue: `surface-7qj`

## Summary

Local HEAD is aligned with the published `@zigrivers/surface@0.2.2` package. The local CLI version, npm latest tag, top-level help output, and extracted local/published tarballs matched. Dogfood therefore used local HEAD as the authoritative target and used npm only for a smoke check.

The highest-risk result is that the default live localhost audit path is currently blocked: `surface audit --localhost http://127.0.0.1:5189 --json` captures successfully with `agent-browser`, then fails because the generated `computed-styles.json` artifact does not match the schema consumed by the lenses.

Seven actionable Beads issues were filed:

| Bead | Priority | Title |
| --- | --- | --- |
| `surface-8ay` | P1 | Live audits fail on agent-browser computed styles artifacts |
| `surface-a0k` | P1 | `--json` error envelopes are emitted on stderr instead of stdout |
| `surface-o14` | P1 | `surface capture` ignores project capture config and redaction rules |
| `surface-0cd` | P1 | Browser QA text assertions without locators cannot pass |
| `surface-xfz` | P2 | Pipeline run/status/next do not expose completed run history |
| `surface-5en` | P2 | `backlog --json` omits documented BacklogEntry fields |
| `surface-aa9` | P2 | CLI recovery guidance and error codes are often non-actionable |

## Environment And Package Metadata

| Item | Result |
| --- | --- |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| pnpm | `11.0.0` |
| Corepack | `corepack: command not found` |
| agent-browser | `0.27.1` |
| npm latest | `@zigrivers/surface@0.2.2` |
| npm dist tarball | `https://registry.npmjs.org/@zigrivers/surface/-/surface-0.2.2.tgz` |
| npm modified | `2026-06-09T11:42:57.396Z` |
| local CLI package | `packages/cli/package.json` version `0.2.2` |
| local/published pack diff | no differences after extracting both tarballs |

Setup commands:

- `corepack enable` failed because `corepack` was not on PATH.
- `pnpm install` succeeded and was already up to date.
- `pnpm --filter @zigrivers/surface-core build` succeeded.
- `pnpm --filter @zigrivers/surface build` succeeded.
- `node packages/cli/dist/index.js --help` succeeded.
- `npx @zigrivers/surface@latest --help` succeeded and matched local top-level help.

## Test App

Temporary app path: `/tmp/surface-dogfood-2026-06-09/app`
Output path: `/tmp/surface-dogfood-2026-06-09/output`
Screenshot path: `/tmp/surface-dogfood-2026-06-09/screenshots/initial-app.png`

The app is a static local shop served by `node server.mjs` on `http://127.0.0.1:5189`. It includes:

- Dashboard, products, product detail, cart, checkout, settings/profile, login/protected, and 404-like routes.
- Bad, fixed, and regressed variants via `?variant=bad|fixed|regressed`.
- Deliberate defects: low contrast, missing image alt text, duplicate IDs, bad focus outline, mobile overflow, unclear labels, hidden CTA, destructive action, auth-like localStorage state, and fake token/API key strings.
- Static evidence file: `/tmp/surface-dogfood-2026-06-09/app/static-evidence.json`.
- Browser QA flow and policy: `/tmp/surface-dogfood-2026-06-09/app/dogfood-flow.yml` and `/tmp/surface-dogfood-2026-06-09/app/dogfood-policy.json`.

## Coverage Matrix

| Surface area | Tested | Result |
| --- | --- | --- |
| `init --json` | initial and repeated init | Pass; idempotent success envelope. |
| `status --json` | before/after audit and pipeline run | Partial; reports stage but no run history. See `surface-xfz`. |
| `next --json` | before/after pipeline run | Partial; still suggests `run discovery` after completion. See `surface-xfz`. |
| `run discovery`, `run all` | success and unknown step | Partial; returns run IDs but does not persist history. |
| `capture` | localhost, DOM, screenshot, missing target, unreachable, auth-state | Partial; capture works for valid paths, but config/redaction ignored and errors are weak. |
| `audit` | localhost bad/fixed/regressed, DOM, screenshot, evidence, bad lens, missing target | Blocked for live URLs by computed-styles mismatch. DOM/screenshot/evidence paths work. |
| `backlog` | JSON, human `--all`, SARIF export | Partial; works but JSON omits documented fields. |
| `explain` | valid and invalid finding IDs | Pass for valid; invalid error envelope goes to stderr. |
| `baseline` | after evidence audit | Pass. |
| `validate` | valid and invalid run | Pass mechanically; output is confusing because checks are marked passed even for active findings. |
| `gate` | default, after baseline, with flows | Pass for available state; flow gate fails when a failing flow exists. |
| `verdict` | reject, missing decision, invalid finding | Pass for valid; error envelopes go to stderr. |
| `diff` | same run against itself | Pass; reports still-failing findings. |
| `trace` | valid and invalid finding IDs | Pass for valid; invalid error envelope goes to stderr. |
| `alternatives` | DOM target | Pass; returns bounded proposals without model setup. |
| `cleanup` | `model-egress`, unknown area | Pass for known area; unknown area returns config error. |
| `qa`, `explore` | QA with reviewed flow and bounded exploration | Partial; flow assertion bug prevents positive text assertion from passing. |
| `flow run/list/show` | reviewed flow, missing flow, bad policy | Partial; diagnostics useful through `flow show`, assertion bug blocks success. |
| `evidence` | QA evidence ref | Pass. |
| `replay` | invalid ref | Pass as structured runtime error; envelope goes to stderr. |
| `report qa` | manifest, JSON, Markdown formats | Pass; `--format json --json` wraps a JSON string in the envelope. |
| MCP parity | tool discovery | Not directly tested; current Codex environment did not expose Surface MCP tools. |
| Existing fixtures | read and compared | Useful but narrow: checkout and settings flows, policy, seeded app. E2E tests use a fake `agent-browser`, so they do not catch the real assertion bug found here. |

## Commands And Key Outputs

Full stdout/stderr/exit artifacts are under `/tmp/surface-dogfood-2026-06-09/output`.

Representative outcomes:

- `capture-localhost`: exit 0, backend `agent-browser`, writes screenshot, DOM, accessibility tree, computed styles.
- `audit-bad`, `audit-fixed`, `audit-regressed`: exit 1, `capture_failed`, `Computed styles artifact is invalid.`
- `audit-evidence`: exit 0, `findingCount: 3`, top finding `accessibility:contrast-insufficient:.hidden-cta`.
- `backlog-json`: exit 0, three backlog rows but reduced fields.
- `flow-run-dogfood-policy-fixed`: exit 0 envelope with `status: failed`; `flow show` pinpoints failing text assertion.
- `gate-with-flows`: exit 1 with failing flow run `flowrun_dogfood-checkout_94d1950d`.
- `corrupt-status`: exit 1, `state_corrupt`.
- `concurrent-a` and `concurrent-b`: both exit 0 for simultaneous static evidence audits.
- `spaces-init` and `spaces-capture-dom`: both exit 0 in a path with spaces.
- `subdir-status`: exit 0 but reports a fresh `new` project instead of discovering the parent `.surface`.

## Confirmed Findings

### DF-001: Live audits fail on agent-browser computed styles artifacts

Type: Bug
Severity: P1
Affected component: `surface audit`, agent-browser capture backend, visual hierarchy and responsiveness lenses
Beads issue: `surface-8ay`

Repro steps:

1. Start the test app from `/tmp/surface-dogfood-2026-06-09/app` with `node server.mjs`.
2. Run `node packages/cli/dist/index.js audit --localhost http://127.0.0.1:5189 --json`.
3. Repeat with `?variant=fixed` and `?variant=regressed`.

Expected:

Live audits should produce findings/backlog or explicitly degrade unavailable lenses.

Actual:

All live audits fail with exit 1:

`Computed styles artifact is invalid.`

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/audit-bad.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/audit-fixed.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/audit-regressed.stderr`
- Example artifact: `/tmp/surface-dogfood-2026-06-09/app/.surface/captures/cap-localhost-127-0-0-1-5189-mq6m3abg-1-45f3e1aebba049db/computed-styles.json`

Root cause observed:

The agent-browser path serializes `agent-browser get styles body`, producing `{ "styles": { ... } }`. The lenses parse `z.array(ComputedStyleEntrySchema)`. The Playwright path writes the expected array using `computedStyleSnapshot`.

User impact:

The primary first-time adopter workflow, live local audit, is blocked when agent-browser is selected.

Suggested fix:

Make the agent-browser capture backend produce the same computed-style snapshot array as the Playwright backend, or mark computed-style-dependent lenses degraded when only body-level styles are available.

### DF-002: `--json` error envelopes are emitted on stderr instead of stdout

Type: Contract bug
Severity: P1
Affected component: CLI JSON output
Beads issue: `surface-a0k`

Repro steps:

1. Run `surface explain no-such-finding --json`.
2. Run `surface audit --json`.
3. Run `surface status --bogus --json`.

Expected:

The documented machine-readable JSON envelope should be on stdout; diagnostics should be on stderr.

Actual:

stdout is empty and the JSON envelope is on stderr.

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/explain-invalid.stdout`
- `/tmp/surface-dogfood-2026-06-09/output/explain-invalid.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/audit-missing-target.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/unknown-flag.stderr`

User impact:

Agents and CI parsers that read stdout for JSON cannot parse failures without special stderr handling, contradicting `docs/api-contracts.md`.

Suggested fix:

Emit the JSON envelope to stdout for `--json` in both success and error paths, and reserve stderr for non-envelope diagnostics.

### DF-003: `surface capture` ignores project capture config and redaction rules

Type: Security/privacy bug
Severity: P1
Affected component: `surface capture`
Beads issue: `surface-o14`

Repro steps:

1. Create `/tmp/surface-dogfood-2026-06-09/app/.surface/config.yml` with:
   ```yaml
   capture:
     allowlist:
       - "http://127.0.0.1:5189"
     redactionRules:
       - pattern: "pk_live_[A-Za-z0-9_]+"
         appliesTo: [dom]
   ```
2. Run `surface capture --localhost http://127.0.0.1:5189/protected --auth-state auth-state.json --json`.
3. Inspect the generated DOM artifact.

Expected:

The API key-like text should be replaced with `[Redacted]`, and the DOM artifact should report `redacted:true`.

Actual:

The DOM artifact contains `pk_live_public_but_should_redact_123`, and all artifact metadata reports `redacted:false`.

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/capture-auth-redacted.stdout`
- DOM artifact path reported in that envelope under `.surface/captures/.../dom.html`

Root cause observed:

`captureTarget` passes `DEFAULT_SURFACE_CONFIG.capture` to `observeCliTarget`; `auditTarget` resolves config first.

User impact:

Users may believe capture redaction is active because config exists, while sensitive DOM content is persisted unredacted.

Suggested fix:

Resolve project/user/CLI config in `captureTarget` and pass `config.value.capture`, matching `auditTarget`.

### DF-004: Browser QA text assertions without locators cannot pass

Type: Bug
Severity: P1
Affected component: Browser QA flow runner
Beads issue: `surface-0cd`

Repro steps:

1. Run `surface flow run dogfood-flow.yml --url http://127.0.0.1:5189 --json`.
2. Run `surface flow show flowrun_dogfood-checkout_c8625a3b --json`.
3. Manually confirm with agent-browser that the text appears after clicking `Pay now`.

Expected:

The assert step with `expect.text: "Payment failed. Try again."` should pass when the text is in `document.body.innerText`.

Actual:

The assert step fails with `Expected text was not found in the browser state.`

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/flow-run-dogfood-policy-fixed.stdout`
- `/tmp/surface-dogfood-2026-06-09/output/flow-show-policy-fixed.stdout`

Root cause observed:

The driver runs `agent-browser eval Boolean(document.body.innerText.includes(expected)) --json`, which returns JSON containing `"result": true`; Surface then checks whether stdout contains the literal expected text.

User impact:

Reviewed flows that assert global text can fail even when the UI is correct.

Suggested fix:

Parse the eval JSON result and pass on `data.result === true`, or use an `agent-browser wait --text`/text command that returns the matched text.

### DF-005: Pipeline run/status/next do not expose completed run history

Type: Reliability/state UX bug
Severity: P2
Affected component: `run`, `status`, `next`
Beads issue: `surface-xfz`

Repro steps:

1. Run `surface run discovery --json`.
2. Run `surface run all --json`.
3. Run `surface status --json`.
4. Run `surface next --json`.

Expected:

`status` should show run history and progress for the completed pipeline runs; `next` should reflect the completed state.

Actual:

`run` returns run IDs, but state only records `currentStage`. `status` returns `runHistory: []`; `next` still suggests `run discovery` and `run all`.

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/run-discovery.stdout`
- `/tmp/surface-dogfood-2026-06-09/output/run-all.stdout`
- `/tmp/surface-dogfood-2026-06-09/output/status-after-run.stdout`
- `/tmp/surface-dogfood-2026-06-09/output/next-after-run.stdout`

User impact:

Users cannot tell what just ran or resume confidently from `status`/`next`, despite run IDs being returned.

Suggested fix:

Persist pipeline run records or remove run history from the contract; update `next` to derive from actual pipeline state.

### DF-006: `backlog --json` omits documented BacklogEntry fields

Type: Contract bug
Severity: P2
Affected component: `backlog --json`
Beads issue: `surface-5en`

Repro steps:

1. Run the evidence-backed audit:
   `surface audit --dom '<main>...</main>' --evidence static-evidence.json --json`.
2. Run `surface backlog --json`.

Expected:

Per `docs/api-contracts.md`, JSON backlog entries include fields such as `identityKey`, `method`, `executable`, `status`, `gateDisposition`, and `demotedAsDuplicateOf`. JSON should not be truncated.

Actual:

Entries contain only `findingId`, `title`, `severityBand`, `priority`, and `rank`.

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/backlog-json.stdout`

User impact:

Agents cannot make safe execution/gating decisions from the documented JSON shape.

Suggested fix:

Return the full BacklogEntry read model in JSON, or update docs/tests to match the intentionally reduced public shape.

### DF-007: CLI recovery guidance and error codes are often non-actionable

Type: UX/contract bug
Severity: P2
Affected component: Error taxonomy and remediation hints
Beads issue: `surface-aa9`

Repro steps:

Run the following:

- `surface frobnicate --json`
- `surface status --bogus --json`
- `surface status --json` with a corrupt state file
- `surface capture --localhost http://127.0.0.1:59998 --json`
- `surface capture --url http://127.0.0.1:5189/checkout --json`
- `surface capture --localhost http://127.0.0.1:5189/protected --auth-state bad-auth-state.json --json`

Expected:

Error codes should distinguish unknown command, unknown option, unreachable target, unsafe target, invalid auth-state content, and corrupt state. `nextCommand` should help recovery.

Actual:

Examples observed:

- Unknown command and unknown flag both use `unknown_step`.
- Corrupt state suggests `surface status --json`, which repeats the same error.
- Invalid auth-state content returns generic `capture_failed`; missing auth-state returns `auth_injection_failed`.
- Unreachable localhost returns generic `capture_failed`, not `capture_unreachable`.
- `--url` with localhost suggests `surface status --json` instead of using `--localhost`.

Evidence:

- `/tmp/surface-dogfood-2026-06-09/output/unknown-command.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/unknown-flag.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/corrupt-status.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/capture-auth-invalid.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/capture-localhost-unreachable.stderr`
- `/tmp/surface-dogfood-2026-06-09/output/capture-url.stderr`

User impact:

First-time adopters get structured errors but little usable recovery direction.

Suggested fix:

Add CLI parse-specific codes, distinguish auth parsing from backend failure, map connection failures to `capture_unreachable`, and generate context-aware `nextCommand` values.

## UX Gaps And Missing Capabilities

- `corepack enable` is in the README quickstart for local development, but Corepack was absent on this machine. Because `pnpm 11.0.0` was already installed, setup recovered quickly. The README should mention direct pnpm installation as an alternative.
- `init` returns a config object but does not write a starter `.surface/config.yml`. That makes redaction, allowlist, model policy, and gate policy configuration hard to discover.
- Running from a subdirectory under an initialized project reports a new project instead of walking up to the parent `.surface`. Evidence: `/tmp/surface-dogfood-2026-06-09/output/subdir-status.stdout`.
- `surface capture --url http://127.0.0.1:...` is intentionally blocked as unsafe URL-mode localhost, but the error does not suggest `--localhost`.
- Browser QA action policy categories are hard to infer. The checkout `open` action required a rule categorized as `payment`; a seemingly natural `navigation` category was denied. The fixture policy helped, but docs should explain policy matching.
- `surface report qa --format json --json` returns the report as a JSON string inside the outer JSON envelope. That is parseable but awkward for agents expecting an object.
- `validate --run` reports checks as `passed:true` for active still-failing findings. This may be intended as metadata validation, but the command name and `expectation` text read like fix validation.

## Documentation Gaps

- `docs/api-contracts.md` does not cover the newer browser QA commands (`qa`, `explore`, `flow`, `evidence`, `replay`, `report qa`, `cleanup`) even though README does.
- README browser QA examples do not show the minimal action policy needed for successful flow execution.
- API docs state every command supports `--json` and machine output goes to stdout, but observed error envelopes are on stderr.
- API docs describe full backlog JSON shape, while the CLI returns reduced backlog rows.
- Auth-state docs mention invalid/expired auth state should report auth-injection failure. Invalid JSON shape currently reports generic capture failure.
- No config quickstart shows `capture.redactionRules`, `capture.allowlist`, or the exact allowlist URL form.

## Security And Privacy Findings

- Configured capture redaction did not apply to `surface capture`, leaving `pk_live_public_but_should_redact_123` in a DOM artifact. Filed as `surface-o14`.
- Browser QA evidence summaries correctly reported redacted evidence metadata and did not expose raw artifacts through `surface evidence`.
- Error envelopes for failed agent-browser capture correctly avoided raw command payloads and reported `stderrPresent`/`stdoutPresent` booleans instead.

## Reliability And State Findings

- Live audit is blocked by a producer/consumer artifact schema mismatch. Filed as `surface-8ay`.
- Concurrent static evidence audits both exited 0. Because run history is not persisted, the user cannot confirm both from `status`.
- Corrupt state is detected as `state_corrupt`, but the recovery suggestion loops back to the failing command. Filed under `surface-aa9`.
- Paths with spaces worked for `init` and static DOM capture.

## Prioritized Recommendations

1. Fix agent-browser computed-style capture shape first; it blocks the core live audit path.
2. Fix `--json` error stdout semantics before agents depend on the current stderr behavior.
3. Make `surface capture` resolve config and add regression coverage for redaction and allowlist rules.
4. Fix Browser QA text assertions so reviewed flows can assert visible text without locators.
5. Persist run history/progress or narrow the status contract.
6. Align backlog JSON and docs.
7. Improve error taxonomy and next-command generation.
8. Add a config quickstart and a policy authoring example to README/docs.

## Artifact Index

- Test app: `/tmp/surface-dogfood-2026-06-09/app`
- Command outputs: `/tmp/surface-dogfood-2026-06-09/output`
- Initial browser screenshot: `/tmp/surface-dogfood-2026-06-09/screenshots/initial-app.png`
- Local/published package diff workspace: `/tmp/surface-pack-check`
- Main generated state: `/tmp/surface-dogfood-2026-06-09/app/.surface`
- Corrupt state fixture: `/tmp/surface-dogfood-2026-06-09/corrupt-state`

No commits, pushes, or Dolt syncs were performed.
