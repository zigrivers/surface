# Surface sixth deep e2e dogfood

Date: 2026-06-10

Branch: `codex/sixth-dogfood-20260610`

Base commit tested: `54c4be0` (`origin/main` after PR #91 squash merge)

Dogfood issue: `surface-iur`

## Environment

- macOS local workspace: `/Users/kenallred/.codex/worktrees/b275/surface`
- Node: `v26.3.0`
- pnpm: `11.0.0`
- `agent-browser`: `0.27.1`
- Temp dogfood workspace: `/tmp/surface-dogfood-2026-06-10-sixth`
- Temp Surface project: `/tmp/surface-dogfood-2026-06-10-sixth/project`
- Local targets: `http://127.0.0.1:60412` and `http://127.0.0.1:60413`
- Command artifacts: 141 stdout/stderr/exit/command files under
  `/tmp/surface-dogfood-2026-06-10-sixth/output`

## Scope

This pass started after PR #91 was merged into `origin/main`. It used a rebuilt local CLI symlink,
the built MCP package, a temporary Surface project, copied browser-QA fixture policy/flows, and two
real local HTTP targets:

- a busy target with headings before checkout/profile/report controls
- a neutral target with headings before docs/guide/help controls to isolate exploration ordering
  from payment/account action-policy categories

The run covered:

- local package build and linked CLI smoke
- project initialization, `status --json`, and `next --json`
- localhost capture and measured default/visual audits over computed-style artifacts
- reviewed browser-QA flow execution and flow-aware gate failure behavior
- browser-QA exploration with tight and wider action budgets
- current `agent-browser --json snapshot` output with passive headings before controls
- candidate flow listing, promotion, promoted flow execution, evidence, report, and replay
- pipeline `run discovery`, `run all`, `gate --ci`, final status/next projections
- MCP status/next/candidate-list/report smoke through the built MCP package

## Command Matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Build/link | `001-build-core`, `002-build-cli`, `003-build-mcp`, `004-linked-version`, `005-help` | All exit 0. |
| Project setup | `006-init`, `007-status-initial` | Init and initial status pass. |
| Capture/audit | `008-capture-localhost`, `009-audit-default-localhost`, `010-audit-visual-localhost` | Capture includes computed styles; default audit returns one P2 content finding; visual audit returns zero findings. |
| Flow-aware gate failure | `011-flow-checkout`, `012-gate-with-checkout-flow` | Copied checkout fixture fails on this target; `gate --ci --with-flows` fails with `flowrun_checkout_94d33c27`. |
| Exploration before fix | `014-explore-tight-budget`, `015-explore-wider-budget`, `017-agent-browser-json-snapshot-rerun` | Reconfirmed `surface-msm`: target snapshot has five heading refs before controls; tight run spent two denied actions and hit `maxActions`. |
| Exploration after fix | `018-neutral-agent-browser-json-snapshot`, `019-neutral-explore-tight-after-msm-fix` | Neutral snapshot has five headings before controls; after fix, tight run has `deniedActions: 0` and creates `qflow_347a29e5193c`. |
| Candidate lifecycle | `020-neutral-flow-list-candidates`, `021-promote-neutral-candidate`, `022-run-promoted-neutral`, `023-evidence-neutral-candidate`, `024-report-neutral-qa`, `025-replay-neutral-candidate` | Candidate listing, promotion, promoted run, evidence, manifest report, and replay return structured JSON. |
| Pipeline projections | `026-status-after-sixth`, `027-next-after-sixth`, `028-run-discovery`, `029-run-all`, `030-gate-ci`, `031-status-after-pipeline`, `032-next-after-pipeline` | Pipeline commands pass; final status has four completed runs and no eligible next steps. |
| MCP smoke | `033-mcp-smoke` | 23 tools listed; status, next, candidate list, and QA report calls all succeed. |

## Findings And Fixes

### `surface-msm`: Browser QA exploration spent action budget on passive headings

Repro:

```bash
surface --json explore --url http://127.0.0.1:60412/ \
  --action-policy fixtures/browser-qa/action-policy.json \
  --max-depth 1 --max-actions 2 --max-states 3
```

Actual before fix:

- `014-explore-tight-budget` returned `attemptedActions: 2`, `deniedActions: 2`, and
  `exploration_degraded` for `maxActions`.
- Direct snapshot evidence in `017-agent-browser-json-snapshot-rerun` showed five passive heading
  refs before links/buttons.
- The parser generated hover/focus actions for passive roles, so bounded exploration could spend
  budget before reaching meaningful controls.

Fix:

- Limited snapshot-derived browser-QA exploration actions to actionable roles:
  `button`, `link`, form controls, menu/tab controls, and `dialog`.
- Kept legacy direct `@eN` line compatibility for older snapshot shapes.
- Added a composition-level regression test proving headings before controls do not consume the
  first exploration actions.

Verification:

- `019-neutral-explore-tight-after-msm-fix` uses a snapshot with five heading refs before two links
  and a button. It exits 0, creates `qflow_347a29e5193c`, and reports `deniedActions: 0`.
- Focused test `packages/core/src/composition-factory.test.ts` passes with 525 tests after the new
  regression.

## Notes

- `013-agent-browser-json-snapshot` failed because it ran `pnpm exec` from the temporary project,
  which is not a pnpm workspace. The valid rerun is `017-agent-browser-json-snapshot-rerun`.
- `011-flow-checkout` failed because the copied checkout fixture intentionally did not match the
  sixth target's simplified checkout page. The subsequent flow-aware gate failure is expected and
  verifies automation behavior.
- After the `surface-msm` fix, a two-action neutral exploration still reports `maxActions` because
  hover/focus on the first actionable ref uses the full tight budget. That is separate from passive
  role filtering and may be worth a future exploration-strategy pass if users need deeper navigation
  from very small action budgets.

## Validation Run During This Pass

- `pnpm --filter @zigrivers/surface-core test -- --run packages/core/src/composition-factory.test.ts`
  failed before the fix and passed after the fix.
- `pnpm --filter @zigrivers/surface-core build`
- `pnpm --filter @zigrivers/surface build`
- `pnpm --filter @zigrivers/surface-mcp build`

Final gates:

- `pnpm run format:check`: pass.
- `pnpm --filter @zigrivers/surface-core lint`: pass.
- `pnpm --filter @zigrivers/surface-core typecheck`: pass.
- `pnpm --filter @zigrivers/surface-core test`: pass, 50 files and 525 tests.
- `pnpm --filter @zigrivers/surface lint`: pass.
- `pnpm --filter @zigrivers/surface typecheck`: pass.
- `pnpm --filter @zigrivers/surface test`: pass, 2 files and 103 tests.
- `pnpm --filter @zigrivers/surface-mcp lint`: pass.
- `pnpm --filter @zigrivers/surface-mcp typecheck`: pass.
- `pnpm --filter @zigrivers/surface-mcp test`: pass, 2 files and 26 tests.
- `pnpm run test:e2e`: pass, 2 files and 7 tests.
- `pnpm exec vitest run tests/acceptance/epic-e6-interfaces.test.ts`: first attempt raced
  with the concurrent e2e build while `packages/core/dist` was being cleaned; rerun passed,
  1 file and 8 tests.
- `git diff --check`: pass.

`pnpm run test:release` was not run because no release or package metadata changed.

## Remaining Risks

- `surface-437` remains open from prior dogfood: clarify backlog run IDs when scoped audits
  preserve older findings.
- Exploration still spends two actions per actionable ref because generated action candidates are
  hover and focus. This pass only prevents passive roles from consuming that budget.
- `surface replay qfc_347a29e5193c` returns `not-reproduced` for the synthetic candidate. A future
  pass should use a deterministic real browser-QA defect to verify `--promote-on-repro`.
