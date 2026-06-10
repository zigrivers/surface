# Surface fourth deep e2e dogfood

Date: 2026-06-10

Branch: `codex/post-merge-dogfood-20260610`

Base commit tested: `e887575` (`origin/main` after PR #89 squash merge)

Dogfood issue: `surface-bht`

## Environment

- macOS local workspace: `/Users/kenallred/.codex/worktrees/b275/surface`
- Node: `v26.3.0`
- pnpm: `11.0.0`
- `agent-browser`: `0.27.1`
- Temp dogfood workspace: `/tmp/surface-dogfood-2026-06-10-fourth`
- Temp Surface project: `/tmp/surface-dogfood-2026-06-10-fourth/project`
- Local target: `http://127.0.0.1:60373`
- Command artifacts: 252 stdout/stderr/exit/command files under
  `/tmp/surface-dogfood-2026-06-10-fourth/output`

## Scope

This pass started after PR #89 merged and exercised current `origin/main` through a fresh branch.
It used a local CLI symlink to the built package and a temporary Surface project containing copied
browser-QA action policy and flow files.

The run covered:

- local package build and linked CLI smoke
- `surface --help`, `--version`, init, JSON usage errors
- live localhost capture and audit
- visual hierarchy and responsiveness lenses over computed-style artifacts
- `status --json`, `next --json`, `run discovery`, and `run all`
- deterministic browser flows with `--base-url`, `--target`, `--ci`, passing and failing outcomes
- `qa`, `explore`, `evidence`, `report qa`, `replay`, `flow promote`, and `qa cleanup`
- `gate --ci` and flow-aware gates
- JSON error envelopes for localhost URL misuse and missing flow files
- MCP-facing behavior through built `@zigrivers/surface-mcp` artifacts, including tool listing,
  status/next/gate calls, and `surface_artifact_read`
- subdirectory invocation behavior from below an initialized `.surface` project

## Command Matrix

Representative recorded commands:

| Area | Evidence | Result |
| --- | --- | --- |
| Build/link | `001-build-core`, `002-build-cli`, `003-build-mcp`, `004-linked-version` | All exit 0. |
| CLI basics | `005-help`, `006-version`, `007-json-unknown`, `008-init` | Help/version/init pass; unknown command exits 2 with JSON. |
| Capture/audit | `009-capture-checkout`, `010-capture-console`, `011-audit-default` | Pass; default audit found one measured finding. |
| Computed-style lenses | `012-audit-visual`, `013-audit-responsive` | Pass; no computed-style schema failures. |
| Pipeline projections | `014-status-after-audits`, `015-next-after-audits`, `027-run-discovery`, `028-run-all`, `058-status-after-all`, `059-next-after-all` | Pass; final status shows five completed runs and no eligible next steps. |
| Flow target overrides | `016-flow-checkout-baseurl`, `032-flow-checkout-rerun-fixed`, `034-gate-with-flows-rerun-fixed` | Initial failure was a temp-fixture HTML issue; after target fix, latest checkout flow and gate pass. |
| Bundled settings flow | `017-flow-settings-target`, `035-flow-settings-after-fix`, `043-flow-settings-policy-after-fix`, `044-gate-settings-policy-after-fix` | Found and fixed fixture metadata/action-policy defects; final run and gate pass. |
| Expected flow failures | `018-flow-denied`, `019-flow-bad-assert`, `026-gate-with-flows-fail` | Failed flow runs persisted evidence and flow-aware gate failed as expected. |
| Browser QA | `022-qa-hybrid`, `023-explore-billing`, `033-qa-hybrid-rerun-fixed` | Pass; bounded exploration returned structured empty candidate sets. |
| Evidence/reporting | `045-evidence-qa-run`, `046-evidence-bundle`, `047-report-qa-manifest`, `048-report-qa-json`, `049-report-qa-md` | Pass; JSON report is object-shaped and Markdown report is string-shaped inside JSON envelope. |
| Cleanup/errors | `050-replay-invalid`, `052-cleanup-dry-run-json`, `053-cleanup-model-egress-json`, `054-json-localhost-url-error`, `055-json-missing-flow-error` | Expected failures stay JSON-only on stdout with empty stderr. |
| MCP smoke | `031-mcp-built-smoke`, `057-mcp-artifact-read` | Pass; 23 tools listed and artifact read returned redacted JSON with plain `title` and `url`. |
| Subdirectory UX | `056-status-from-subdir`, `061-status-from-subdir-after-fix` | Found and fixed parent project-root discovery. |
| Promotion UX | `051-flow-promote-missing`, `063-flow-promote-missing-next-after-fix` | Found and fixed missing-candidate error wording and recovery command. |

## Findings And Fixes

### `surface-6lc`: Bundled settings browser-QA fixture failed CI execution

Repro:

```bash
surface --json flow run surface-flows/settings-profile.yml \
  --target http://127.0.0.1:60373/settings/profile \
  --ci
```

Actual before fix:

- First failure: `flow_invalid`, because the mutating flow had `resetRequired` and a reset endpoint
  but did not reference the bundled `seed-user` fixture account.
- Second failure after adding the account: the flow used `focus` through
  `agent-browser find label "Profile name" focus`, but `agent-browser 0.27.1` reports
  `Unknown subaction: focus`.

Fix:

- Added `isolation.fixtureAccountId: seed-user` to the settings flow.
- Replaced the unsupported `focus` step with a supported `fill` step.
- Split the action policy so Save button clicks and Profile name input mutations are explicitly
  allowed by separate locator-bound rules.
- Added e2e coverage proving the bundled settings flow gets through open, fill, and save under
  CI preflight.

Verification:

- `043-flow-settings-policy-after-fix` exits 0 with `status: "passed"`.
- `044-gate-settings-policy-after-fix` exits 0 with no failing flow runs.

### `surface-2f4`: CLI commands from subdirectories ignored parent Surface state

Repro:

```bash
cd /tmp/surface-dogfood-2026-06-10-fourth/project/subdir
surface --json status
```

Actual before fix: exited 0 but reported `currentStage: "new"`, zero runs, and created/used a
separate `subdir/.surface` instead of the initialized parent project.

Fix:

- Default composition now resolves `projectRoot` by walking upward to the nearest ancestor
  containing the configured Surface state directory.
- Explicit `projectRoot` remains authoritative for tests and MCP callers.
- Added composition coverage for nested cwd root discovery.

Verification:

- `061-status-from-subdir-after-fix` matches the parent project status exactly:
  `currentStage: "completed"`, `completedRuns: 5`, `findings: 1`.
- No `subdir/.surface` was recreated.

### `surface-b90`: Missing candidate flow promotion reported a generic sidecar error

Repro:

```bash
surface --json flow promote qflow_missing --out surface-flows/promoted.yml
```

Actual before fix: `state_read_failed` with `message: "Failed to read QA sidecar."`

Fix:

- `promoteFlow` now maps missing candidate-flow sidecars to `flow_invalid` with the candidate id.
- The error details include `nextCommand: "surface flow list --candidates --json"`.
- Added focused core coverage for ENOENT candidate-flow sidecars.

Verification:

- `063-flow-promote-missing-next-after-fix` exits 1 with:
  `message: "Candidate browser QA flow \"qflow_missing\" was not found."`
- JSON envelope now suggests `surface flow list --candidates --json`.

## Notes

- The first checkout-flow failure was not a Surface defect. It came from the temporary inline target
  server using backslash-escaped quotes inside HTML attributes; HTML does not treat that as escaping.
  The fixed target server rerun verified checkout flow and flow-aware gates.
- `surface flow run --ci` exits 0 for completed flow executions even when the flow status is
  `failed`; `surface gate --ci --with-flows` is the release-gating command. This remains consistent
  with observed current behavior.
- `surface explore` on the billing route attempted zero actions because deterministic exploration did
  not find a safe action under the supplied scope and policy. It returned a structured empty result.

## Validation Run During This Pass

- `pnpm --filter @zigrivers/surface-core test -- composition-factory.test.ts`
- `pnpm --filter @zigrivers/surface-core test -- flow-runner.test.ts composition-factory.test.ts`
- `pnpm --filter @zigrivers/surface-core test -- flow-runner.test.ts`
- `pnpm run test:e2e`
- `pnpm --filter @zigrivers/surface-core build`
- `pnpm --filter @zigrivers/surface build`
- `pnpm --filter @zigrivers/surface-mcp build`

Broader gates are still required before handoff closure.

## Remaining Risks

- `surface-437` remains open from prior dogfood: clarify backlog run IDs when scoped audits
  preserve older findings.
- The subdirectory fix intentionally honors an existing nearer `.surface` directory. If a user
  already created an accidental nested `.surface`, they still need to remove that nested state to
  use the parent project.
- No natural candidate flow was produced in this fixture, so successful `flow promote` and
  `replay --promote-on-repro` paths remain covered by unit tests rather than this live run.
