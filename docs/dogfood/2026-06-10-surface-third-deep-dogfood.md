# Surface Third Deep E2E Dogfood

Date: 2026-06-10
Repository: `/Users/kenallred/.codex/worktrees/b275/surface`
Branch: `codex/release-0.2.3`
Commit tested before fixes: `14151fa3f694137a5d1ad433075b2c78702bff7a`
Dogfood issue: `surface-kur`
Command evidence: `/tmp/surface-dogfood-2026-06-10-third/output`

## Summary

This third pass used a fresh localhost fixture and temp Surface project to stress browser-QA
lifecycle behavior beyond the prior runs: flow ref maintenance, stale flow history in gates, MCP
artifact reads, QA cleanup, report formats, replay/promote failure paths, and closed-loop
audit/pipeline state.

Three scoped bugs were found and fixed:

| Bead | Status | Fix |
| --- | --- | --- |
| `surface-5jj` | fixed | `surface flow update-refs` now writes the reviewed flow YAML when it reports ref updates. |
| `surface-n9n` | fixed | `surface gate --with-flows` now evaluates the latest matching flow run instead of stale historical failures. |
| `surface-2qg` | fixed | Browser QA evidence snapshots now store plain `title` and `url` strings from current `agent-browser` JSON envelopes. |

The known backlog ambiguity remains open:

| Bead | Status | Finding |
| --- | --- | --- |
| `surface-437` | open | Backlog JSON can still be ambiguous when scoped audits preserve findings from older runs. |

## Environment

| Item | Result |
| --- | --- |
| Node | `v26.0.0` |
| npm | `11.12.1` |
| pnpm | `11.0.0` |
| local Surface CLI | `0.2.3` |
| linked local binary | `/tmp/surface-dogfood-2026-06-10-third/npm-global/bin/surface` |
| fixture target | `http://127.0.0.1:59384` |
| temp app | `/tmp/surface-dogfood-2026-06-10-third/app/server.mjs` |
| temp project | `/tmp/surface-dogfood-2026-06-10-third/project` |
| command artifacts | 207 stdout/stderr/exit files under `/tmp/surface-dogfood-2026-06-10-third/output` |

The isolated npm prefix needed `npm-global/lib` pre-created before `npm link --prefix ...` would
work with npm `11.12.1`.

## Fixture

The temporary app exposed:

| Route | Purpose |
| --- | --- |
| `/` | Navigation, missing image, and low-contrast seeded copy. |
| `/dashboard` | Grid metrics, low-contrast copy, bad focus outline, and a fixed-width panel. |
| `/checkout` | Payment guard flow with a redacted `sk_live_...` token. |
| `/settings` | Mutating fixture-account flow with fill/click/assert steps. |
| `/account` | Policy-denied delete-account flow. |
| `/upload` | Upload-policy surface for future deeper flow work. |
| `/network` | Console error and failed-request seed for exploration evidence. |

Project config allowed `http://127.0.0.1:59384` and `http://localhost:59384`, redacted
`sk_live_[A-Za-z0-9_]+`, and set `reporting.gatePolicy.failOnNewMeasuredAtOrAbove: P1`.

## Coverage

| Surface area | Result |
| --- | --- |
| Build/link local CLI | Pass after creating the isolated npm prefix `lib` directory. |
| `surface --help`, `--version` | Pass. Linked CLI reported `0.2.3`. |
| JSON usage errors | Pass. Missing capture target, `init --yes`, invalid config, positional `validate`, missing replay ref, and missing promote candidate all returned JSON envelopes with empty stderr. |
| `surface init --json` | Pass after correcting the temp config schema. |
| `surface qa cleanup --dry-run` | Pass. Returned `{ cleaned: [], skipped: [], dryRun: true }`. |
| `surface capture --localhost` | Pass against `/checkout`; produced screenshot, DOM, accessibility, and computed-style artifacts. |
| `surface capture --url` | Pass with persona/task/depth/model flags against `/dashboard`. |
| unsupported capture option | Pass as error path. `--viewport` returned structured `unknown_option`. |
| `surface audit` with static evidence | Pass after using the current `Evidence` schema; produced measured contrast and judged content findings. |
| visual hierarchy lens | Pass against live dashboard computed styles. |
| responsiveness lens | Pass against live dashboard computed styles. |
| accessibility lens | Pass against `/network`. |
| DOM/static audit | Pass with inline DOM content. |
| `surface flow run` passing flow | Pass after explicit checkout navigation policy was added to the temp action policy. |
| policy-denied flow | Pass as intentional failed flow; status `failed`, CLI exit 0, evidence captured. |
| mutating CI flow | Pass with fixture account, `gateEligible: true`, and `resetSatisfied: true`. |
| `surface flow list/show` | Pass. Listed historical runs and showed full step details. |
| `surface flow update-refs` | Found `surface-5jj`; after fix, removed stale `@e999` and `@e998` from YAML and rerun still passed. |
| `surface gate --ci --with-flows` | Found `surface-n9n`; after fix, checkout-only gate passed despite earlier stale failure, delete flow still failed. |
| `surface qa` hybrid | Pass. Flow plus bounded exploration completed with one visited state and redacted evidence. |
| `surface explore` | Pass. Network route explored one state with no generated candidates. |
| `surface evidence` | Pass for both QA run and evidence bundle refs. |
| `surface report qa` | Pass for manifest, JSON, and Markdown formats. |
| `surface replay` | Pass as failure paths for non-candidate refs. |
| `surface flow promote` | Pass as missing-candidate failure path. No natural candidate flow was generated in this fixture. |
| MCP artifact read | Found `surface-2qg`; after fix, artifact text exposed `title: "Checkout"` and `url: "http://127.0.0.1:59384/checkout"`. |
| backlog/explain/trace | Pass for the measured contrast finding. |
| validate/gate/baseline/diff/alternatives | Pass with supported flag forms. |
| `surface run discovery` and `surface run all --depth 5` | Pass. Final `status --json` showed seven completed runs and `next --json` returned no eligible steps. |

## Confirmed Findings And Fixes

### `surface-5jj`: `flow update-refs` reported updates without writing YAML

Repro:

- Temp flow `surface-flows/settings-mutating.yml` had semantic locators plus `refHint: "@e999"` and
  `refHint: "@e998"`.
- `surface flow update-refs surface-flows/settings-mutating.yml --json` exited 0 and reported
  `updatedRefs: 2`.
- The YAML still contained both original `refHint` values.

Fix:

- `updateFlowRefs` now edits the YAML AST, removes volatile `refHint` fields from step locators and
  teardown locators, and writes the file atomically when it reports updates.
- Semantic locators are preserved.

Verification:

- Added a regression test that failed before the fix and passed after it.
- Live rerun removed both stale refs and `surface flow run surface-flows/settings-mutating.yml --ci
  --json` still passed.

### `surface-n9n`: flow-aware gate failed on stale historical flow failures

Repro:

- First checkout flow run failed because the temp action policy was missing explicit checkout
  navigation.
- After fixing the policy, rerunning the same flow passed.
- `surface gate --ci --with-flows surface-flows/checkout-pass.yml ... --json` still exited 1 with
  `failingFlowRunIds: ["flowrun_third-checkout-pass_cb764619"]`.

Fix:

- Flow-aware gate selection now collapses stored runs by source/flow/target and keeps the run with
  the latest step timestamp before evaluating the gate.

Verification:

- Added a regression test for failed-then-passed history.
- Live checkout-only flow gate now exits 0 with no failing flow IDs.
- Live delete-flow gate still exits 1 with the intentional denied flow ID.

### `surface-2qg`: Browser QA evidence stored nested JSON strings for title/url

Repro:

- MCP `surface_artifact_read` for a browser QA evidence bundle returned snapshot text where
  `title` and `url` were serialized agent-browser command envelopes, for example
  `{"success":true,"data":{"title":"Checkout"},"error":null}`.

Fix:

- Agent-browser scalar parsing now extracts strings from current `{ data: { title } }` and
  `{ data: { url } }` envelopes while preserving existing `{ value }` support.

Verification:

- Added a driver regression test that failed before the parser change and passed after it.
- Live post-fix MCP artifact read returned plain `title: "Checkout"` and
  `url: "http://127.0.0.1:59384/checkout"`.

## Notes

- The `surface init --yes --json` command remains unsupported; this run recorded it as a structured
  error path and used `surface init --json`.
- `surface validate <runId>` is unsupported; `surface validate --run <runId>` is the correct form.
- The static evidence file must use Surface `Evidence` shape, such as `kind`, `tool`, `rule`,
  `measuredValue`, and `threshold`.
- No natural QA candidate flow was generated from this fixture, so `flow promote` was covered through
  the missing-candidate failure path rather than a successful promotion.
- `surface-437` remains the practical follow-up for backlog JSON source-run ambiguity.

## Validation During This Pass

- `pnpm --filter @zigrivers/surface-core test -- --run src/browser-qa/flow-runner.test.ts -t "persists volatile ref hint updates"`: failed before the fix, then passed; package script ran 49 files / 516 tests after adding that test.
- `pnpm --filter @zigrivers/surface-core test -- --run src/browser-qa/gate-flows.test.ts -t "uses the latest matching run"`: failed before the fix, then passed; package script ran 50 files / 517 tests after adding that test.
- `pnpm --filter @zigrivers/surface-core test -- --run src/browser-qa/agent-browser-driver.test.ts -t "parses agent-browser title and URL"`: failed before the fix, then passed; package script ran 50 files / 518 tests after adding that test.
- `pnpm --filter @zigrivers/surface-core build`: pass after fixes.
- `pnpm --filter @zigrivers/surface build`: pass after fixes.
- `pnpm --filter @zigrivers/surface-mcp build`: pass after fixes.
- Live reruns of `flow update-refs`, `flow run`, `gate --with-flows`, and MCP artifact read verified the fixed behavior.

Final validation for tracked changes is recorded in the session handoff.
