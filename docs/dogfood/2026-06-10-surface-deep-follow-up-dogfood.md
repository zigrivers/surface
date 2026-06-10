# Surface Deep Follow-Up Dogfood

Date: 2026-06-10
Repository: `/Users/kenallred/.codex/worktrees/b275/surface`
Branch: `codex/release-0.2.3`
Commit tested before follow-up fix: `c25fcf54480a4b22857b76605564e6dda28c0511`
Dogfood issue: `surface-f1b`
Related PR: `https://github.com/zigrivers/surface/pull/89`

## Summary

This second pass went deeper on current PR 89 after the first dogfood commit by using a custom
localhost app with multiple routes, seeded bad UI states, a project config, action policy, passing
and failing browser QA flows, redaction rules, pipeline state, and closed-loop commands.

One confirmed bug was found and fixed:

| Bead | Status | Fix |
| --- | --- | --- |
| `surface-1ec` | fixed | Failed browser QA flow steps now record a real `completedAt` timestamp instead of `1970-01-01T00:00:00.000Z`. |

The open follow-up from the first pass remains:

| Bead | Status | Finding |
| --- | --- | --- |
| `surface-437` | open | `backlog --json` can be ambiguous when scoped audits preserve older findings under a newer backlog run ID. |

## Environment

| Item | Result |
| --- | --- |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| pnpm | `11.0.0` |
| local Surface CLI | `0.2.3` |
| linked local binary | `/tmp/surface-dogfood-2026-06-10/npm-global/bin/surface` |
| test target | custom HTTP fixture at `http://127.0.0.1:59273` |
| temp app | `/tmp/surface-dogfood-2026-06-10-deep/app/server.mjs` |
| temp project | `/tmp/surface-dogfood-2026-06-10-deep/project` |
| command evidence | `/tmp/surface-dogfood-2026-06-10-deep/output` |

## Fixture

The temporary fixture app exposed:

| Route | Purpose |
| --- | --- |
| `/` | Navigation, missing image, and baseline page for accessibility checks. |
| `/checkout` | Browser QA form flow with a redacted `pk_live_...` token and a payment-error assertion. |
| `/dashboard` | Low-contrast button and fixed-width panel for accessibility, visual, and responsiveness lenses. |
| `/settings` | Basic form route for local navigation. |
| `/network` | Failing fetch and console error route for browser evidence stress. |

Project config allowed `http://127.0.0.1:59273` and `http://localhost:59273`, and applied a DOM
redaction rule for `pk_live_[A-Za-z0-9_]+`.

## Coverage

| Surface area | Result |
| --- | --- |
| Project init | Pass. `surface init --yes --json` created project state in the temp project. |
| `surface status --json` initial/final | Pass. Initial state showed no pipeline; final state showed five completed runs and three findings. |
| `surface next --json` initial/final | Pass. Returned `run discovery` and `run all` as eligible next steps. |
| JSON usage error | Pass. `surface qa --localhost=59273 --json` exited 2 with a structured `unknown_option` envelope on stdout and empty stderr. |
| `surface capture --url` | Pass. Captured `/checkout` via allowlisted `127.0.0.1`; redaction and computed styles were present. |
| `surface capture --localhost` | Pass. Captured `/dashboard` through the localhost target path. |
| `surface audit` all lenses | Pass. Dashboard all-lens audit returned one measured contrast finding and one content finding. |
| visual hierarchy lens | Pass. Dashboard visual audit exited 0 with no computed-style artifact failure. |
| responsiveness lens | Pass. Dashboard responsiveness audit exited 0 with no computed-style artifact failure. |
| accessibility lens | Pass. Home accessibility audit exited 0. |
| content lens | Pass. Checkout content audit exited 0 and produced one content finding. |
| `surface flow run` passing flow | Pass. Checkout flow clicked Pay now and asserted the payment error text. |
| `surface flow run` failing flow | Pass as failure capture. The flow failed on the intended missing success assertion and wrote evidence. |
| `surface gate --ci --with-flows` | Pass. Passed flow exited 0; failing flow exited 1 with `failingFlowRunIds` populated. |
| `surface qa` hybrid | Pass. Flow plus bounded exploration exited 0 with one visited state and redacted evidence. |
| `surface evidence` | Pass. Returned the expected evidence bundle metadata for the hybrid run. |
| `surface report qa --format json --json` | Pass. `data.report` was a structured object. |
| `surface report qa --format md` | Pass. Printed Markdown beginning `# Browser QA Report ...`. |
| `surface flow show --json` | Found `surface-1ec`; after the fix, the failed step `completedAt` was a real 2026 timestamp. |
| `surface backlog` | Pass. Returned current active backlog entries for dashboard findings. |
| `surface explain` | Pass. Explained the measured contrast finding. |
| `surface trace` | Pass. Returned trace evidence for the measured contrast finding. |
| `surface validate` | Pass. Dashboard run validation returned ok. |
| `surface gate --ci` | Pass before and after baselining accepted dashboard findings. |
| `surface diff` | Pass. Compared dashboard/content run references successfully. |
| `surface baseline` | Pass. Accepted the current dashboard findings with reason `deep dogfood accepted current findings`. |
| `surface run all` | Pass. Completed a depth-limited full pipeline run. |
| MCP-facing behavior | Practical smoke remains package/e2e coverage: `@zigrivers/surface-mcp` tests and browser-QA e2e exercise MCP tool registration and artifact reads without a separate harness. |

## Confirmed Finding And Fix

### `surface-1ec`: Failed browser QA flow steps used Unix epoch `completedAt`

Repro:

- Ran `surface flow run checkout-fail.yml --json`.
- Ran `surface flow show flowrun_deep-checkout-fail_aaa2302d --json`.
- The failed `assert-missing-success` step had `startedAt: 2026-06-10T11:39:49.900Z` but
  `completedAt: 1970-01-01T00:00:00.000Z`.

Fix:

- `failedStepResult` now receives the runner's current timestamp from both policy-denial and failed
  assertion paths.
- The regression test injects a deterministic `now()` and verifies failed assertion steps preserve
  that completion timestamp.

Verification:

- Focused test initially failed before the implementation fix, then passed after the fix.
- Rebuilt `@zigrivers/surface-core` and `@zigrivers/surface`.
- Reran the failing live flow and `surface flow show`.
- The failed `assert-missing-success` step then showed `completedAt:
  2026-06-10T11:43:29.585Z`, not the Unix epoch.

## Notes

The deeper pass did not identify another small, clearly scoped bug beyond `surface-1ec`. The main
remaining UX concern is still `surface-437`, because backlog JSON consumers may need clearer source
run metadata when active backlog entries survive scoped follow-up audits.

`surface qa --localhost=59273` is not a supported option, and the CLI handled that correctly with a
structured usage error. The command is still a useful reminder that QA target entry points differ
from capture/audit target entry points; the current error points users to `surface qa --help`.

## Validation During This Pass

- `pnpm --filter @zigrivers/surface-core test -- --run src/browser-qa/flow-runner.test.ts -t "executes steps in order and captures failed assertion evidence"`: pass; due package script argument behavior this ran the full core suite, 49 files and 515 tests.
- `pnpm --filter @zigrivers/surface-core build`: pass.
- `pnpm --filter @zigrivers/surface build`: pass.
- Live rerun of `surface flow run checkout-fail.yml --json`: pass as intentional failed-flow capture, exit 0.
- Live rerun of `surface flow show <new failing run> --json`: pass, failed step had a real completion timestamp.

Final validation for the changed tracked files is recorded in the handoff for this session.
