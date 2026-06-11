# Surface eighth deep e2e dogfood

Date: 2026-06-10

Branch: `codex/eighth-dogfood-20260610`

Base commit tested: `f781f66` (`origin/main` after the seventh dogfood fixes)

Dogfood issue: `surface-1zs`

## Environment

- Local `main` sync target: `/Users/kenallred/Developer/surface`
- Dogfood workspace: `/Users/kenallred/.codex/worktrees/b275/surface`
- Node: `v26.3.0`
- pnpm: `11.0.0`
- `agent-browser`: `0.27.1`
- Temp dogfood workspace: `/tmp/surface-dogfood-2026-06-10-eighth`
- Temp Surface project: `/tmp/surface-dogfood-2026-06-10-eighth/project`
- Seeded local target: `http://127.0.0.1:57159`
- Command artifacts: stdout/stderr/status files under
  `/tmp/surface-dogfood-2026-06-10-eighth/output`

## Main Sync

Before testing, local `main` in `/Users/kenallred/Developer/surface` was fast-forwarded to
`origin/main` at `f781f66`. Existing local Beads export dirt in `.beads/issues.jsonl` and
`.beads/interactions.jsonl` was left untouched. The dogfood branch was created from the synced
`origin/main` commit.

## Scope

This pass intentionally focused on surfaces that were not deeply covered in the seventh pass:

- linked local CLI build/install smoke
- supported and unsupported capture target paths, including component and route targets
- live localhost capture/audit with real browser artifacts
- static evidence validation and targeted visual hierarchy/responsiveness lens runs
- baseline, verdict, diff, trace, backlog, gate, cleanup, status, next, and pipeline runs
- browser QA flow failure evidence, bounded exploration, evidence, replay, report, and flow-aware
  gate behavior
- direct built MCP server calls for status, next, trace, gate, evidence, and QA report tools
- JSON envelopes, structured errors, and human output readability

## Command Matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Build/link | `001-build-core`, `002-build-cli`, `003-build-mcp`, `004-linked-version`, `005-help` | Built packages and linked CLI. `surface --version` reported `0.2.3`; help rendered. |
| Project setup | `006-init`, `007-status-initial` | Init and initial status succeeded. |
| Component/static evidence | `008-capture-component`, `009-audit-component-static-evidence`, `010-audit-invalid-static-evidence` | Component capture/audit succeeded with measured static evidence; invalid evidence returned structured `config_invalid`. |
| Route target | `011-capture-route-safe`, focused route regression | Before fix, safe `--route /dense` fell through to `agent-browser backend does not support route targets`. Regression now covers route URL resolution. |
| Route safety | `012-capture-route-unsafe` | Unsafe traversal route was rejected with `Route capture target must be a path-only route.` |
| Supported localhost capture/audit | `016-capture-localhost-dense-supported`, `017-audit-localhost-dense-deep` | Live seeded target captured screenshot, DOM, a11y, and computed styles; deep audit produced one P2 content finding with model egress blocked by policy. |
| Targeted lenses | `020-audit-visual-hierarchy-component-file`, `021-audit-responsiveness-component-file` | Visual hierarchy and responsiveness lens runs completed with zero findings over static component input. |
| Status/next | `022-status-after-lens-runs`, `023-next-after-lens-runs`, `040-status-after-run-all`, `041-next-after-run-all` | Status showed recent run history; next listed `run discovery`/`run all` before pipeline completion and no eligible steps after `run all`. |
| Backlog/gate/diff/trace | `024-backlog-human`, `025-gate-ci-before-baseline`, `026-diff-live-to-zero-lens`, `027-trace-human-content` | Backlog and diff were coherent. Human trace exposed raw JSON before the fix. |
| Baseline/verdict | `029-baseline-json`, `030-verdict-defer-json`, `031-status-after-baseline-verdict`, `032-gate-ci-after-baseline-verdict`, `033-trace-json-after-verdict` | Baseline and verdict persisted. Trace omitted verdict/baseline context before the fix. |
| Trace fixes | `028-trace-human-content-fixed`, `034-trace-human-after-context-fix`, `035-trace-json-after-context-fix` | Human trace is readable and both human/JSON trace include verdict and baseline context. |
| Cleanup | `036-cleanup-model-egress`, `037-cleanup-invalid-area` | `model-egress` cleanup succeeded; invalid area returned structured `config_invalid`. The audit ledger is retained as expected history. |
| Pipeline | `038-run-discovery`, `039-run-all` | Both completed; `run all` recorded completed and skipped stages. |
| Browser QA | `042-flow-run-checkout-baseurl`, `043-qa-explore-dense`, `044-evidence-candidate`, `045-replay-candidate`, `046-report-qa-manifest`, `047-gate-ci-with-flows-high` | Flow failure produced evidence; exploration created a candidate; evidence/report/replay succeeded; flow-aware gate exited 1 for the high-severity failed reviewed flow. |
| MCP direct API | `048-mcp-direct-calls` | Built MCP server listed 23 tools. `surface_status`, `surface_next`, `surface_trace`, `surface_gate`, `surface_evidence`, and `surface_report_qa` returned expected structured results. |

## Findings And Fixes

### `surface-jm4`: Safe route targets were advertised but not capturable

Repro:

```bash
surface --json capture --route /dense
```

Actual before fix:

- `011-capture-route-safe` exited with `capture_failed`.
- The backend-specific message said `agent-browser backend does not support route targets`.

Fix:

- Safe route refs now resolve to `http://localhost:3000/<route>` before browser backend capture.
- Unsafe route validation remains unchanged.
- Added an agent-browser capture contract regression in
  `tests/acceptance/epic-e1-capture.test.ts`.

Verification:

- The new route regression failed before the fix and passed after.
- Live CLI route capture could not be deterministically rerun because port 3000 was already owned by
  another local Node process; the browser-backed acceptance contract covers the route handoff.

### `surface-ak3`: `surface trace` human output was raw JSON

Repro:

```bash
surface trace content:retext-readability:readability:0
```

Actual before fix:

- `027-trace-human-content` printed a single line beginning with
  `surface trace: {"trackedFinding":...}`.

Fix:

- Added a trace-specific human renderer with status, gate disposition, identity, lens, anchor,
  first/last seen, validation, and history.
- Added CLI regression coverage in `packages/cli/src/index.test.ts`.

Verification:

- `028-trace-human-content-fixed` rendered readable trace lines without raw JSON.

### `surface-a81`: Trace omitted verdict and baseline closed-loop context

Repro:

```bash
surface --json baseline --reason "accepted dogfood baseline debt"
surface --json verdict content:retext-readability:readability:0 --defer --reason "needs copy review after dogfood"
surface --json trace content:retext-readability:readability:0
```

Actual before fix:

- `030-verdict-defer-json` wrote a verdict to state.
- `033-trace-json-after-verdict` returned only `trackedFinding`.
- MCP `surface_trace` had the same omission after MCP `surface_baseline` and `surface_verdict`.

Fix:

- CLI trace now includes matching `verdict` and active `baseline` context, matched by current finding
  id or stable identity key.
- Human trace now renders verdict and baseline lines when present.
- MCP `surface_trace` now returns the same optional context fields.
- Added focused CLI and MCP regression coverage.

Verification:

- `034-trace-human-after-context-fix` shows the defer verdict and accepted baseline.
- `035-trace-json-after-context-fix` includes `data.verdict` and `data.baseline`.
- `048-mcp-direct-calls` shows MCP trace returning the same context from built package output.

## Notes

- `013-capture-localhost-dense` was an operator error: it intentionally remains in the artifact
  directory as evidence that unsupported capture options return structured `unknown_option` errors.
- `018-audit-visual-hierarchy-evidence` and `019-audit-responsiveness-evidence` used an invalid
  component ref. The corrected component-file commands are `020` and `021`.
- A zero-finding narrow lens run can still leave previous findings in the active backlog when those
  earlier findings belong to lenses that were not re-evaluated. This was treated as expected
  closed-loop carry-forward behavior.
- The temporary local HTTP target was stopped before handoff completion.

## Validation Run During This Pass

- `pnpm exec vitest run tests/acceptance/epic-e1-capture.test.ts --testNamePattern "agent-browser backend resolves safe route targets"` failed before the route fix and passed after.
- `pnpm exec vitest run packages/cli/src/index.test.ts --testNamePattern "summarizes trace human output"` failed before the human trace renderer and passed after.
- `pnpm exec vitest run packages/cli/src/index.test.ts --testNamePattern "includes matching verdict and baseline context"` passed after adding trace context.
- `pnpm exec vitest run packages/mcp/src/index.test.ts --testNamePattern "runs closed-loop MCP tools"` failed before the MCP trace context fix and passed after.
- `pnpm --filter @zigrivers/surface-core build`: pass.
- `pnpm --filter @zigrivers/surface build`: pass.
- `pnpm --filter @zigrivers/surface-mcp build`: pass.
- `pnpm run format:check`: pass.
- `pnpm --filter @zigrivers/surface-core lint`: pass.
- `pnpm --filter @zigrivers/surface-core typecheck`: pass.
- `pnpm --filter @zigrivers/surface-core test`: pass, 50 files and 527 tests.
- `pnpm --filter @zigrivers/surface lint`: pass.
- `pnpm --filter @zigrivers/surface typecheck`: pass.
- `pnpm --filter @zigrivers/surface test`: pass, 2 files and 107 tests.
- `pnpm --filter @zigrivers/surface-mcp lint`: pass.
- `pnpm --filter @zigrivers/surface-mcp typecheck`: pass.
- `pnpm --filter @zigrivers/surface-mcp test`: pass, 2 files and 26 tests.
- `pnpm run test:e2e`: pass, 2 files and 7 tests.
- `pnpm exec vitest run tests/acceptance/epic-e1-capture.test.ts tests/acceptance/epic-e6-interfaces.test.ts`:
  pass on rerun, 2 files and 70 tests. The first attempt ran concurrently with `pnpm run test:e2e`
  while the e2e build cleaned/rebuilt `packages/core/dist`, causing a transient import failure in
  `epic-e6-interfaces`; the sequential rerun passed.
- `git diff --check`: pass.

`pnpm run test:release` was not run because no release or package metadata changed.

## Remaining Risks

- Route live CLI smoke was constrained by an unrelated process already listening on localhost port
  3000. The regression test covers route-to-browser URL resolution.
- Browser QA flow execution used a checkout fixture intentionally mismatched to the seeded app in
  order to exercise failed-flow evidence and flow-aware gate behavior.
