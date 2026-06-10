# Surface fifth deep e2e dogfood

Date: 2026-06-10

Branch: `codex/fifth-dogfood-20260610`

Base commit tested: `f3efe5d` (`origin/main` after PR #90 squash merge)

Dogfood issue: `surface-j4a`

## Environment

- macOS local workspace: `/Users/kenallred/.codex/worktrees/b275/surface`
- Node: `v26.3.0`
- pnpm: `11.0.0`
- `agent-browser`: `0.27.1`
- Temp dogfood workspace: `/tmp/surface-dogfood-2026-06-10-fifth`
- Temp Surface project: `/tmp/surface-dogfood-2026-06-10-fifth/project`
- Local target: `http://127.0.0.1:60411`
- Command artifacts: 199 stdout/stderr/exit/command files under
  `/tmp/surface-dogfood-2026-06-10-fifth/output`

## Scope

This pass started after PR #90 was merged into `origin/main`. It used a rebuilt local CLI symlink,
the built MCP package, a temporary Surface project, copied browser-QA fixtures/action policy, and a
real local HTTP target with checkout, settings, billing, modal, and navigation routes.

The run covered:

- local package build and linked CLI smoke
- deterministic browser-QA flow runs from project root and nested cwd
- flow-aware gates over multiple reviewed flow runs
- candidate discovery with live `agent-browser` snapshots
- candidate flow listing through CLI and MCP
- candidate promotion into reviewed YAML and immediate promoted-flow execution
- candidate evidence, replay, and QA report rendering
- `status --json`, `next --json`, `run discovery`, `run all`, and `gate --ci`
- localhost capture and measured visual hierarchy/responsiveness audits over computed-style artifacts
- JSON error envelopes for unsafe localhost `--url` usage and targetless promoted flow execution

## Command Matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Build/link | `001-build-core`, `002-build-cli`, `003-build-mcp`, `004-linked-version` | All exit 0. |
| Project setup | `005-init` | Exit 0. |
| Reviewed flows | `006-flow-checkout-pass`, `007-flow-settings-pass`, `016-subdir-flow-run-project-relative` | All pass. |
| Flow gates | `008-gate-two-flows`, `044-gate-ci-after-fifth-fixes` | Both pass. |
| Candidate listing bug | `010-flow-list-candidates`, `013-mcp-candidate-list`, `020-flow-list-candidates-after-fix-rerun`, `021-subdir-flow-list-candidates-after-fix-rerun` | Found flow-run leakage; fixed list output to return candidates only. |
| Snapshot parsing bug | `009-explore-home-candidates`, `023-agent-browser-snapshot-home`, `025-agent-browser-json-snapshot-home`, `026-explore-home-candidates-after-json-snapshot-fix` | Found zero-action exploration; fixed JSON snapshot and bracket ref parsing; final explore produced `qflow_928565bc75c0`. |
| Candidate promotion | `030-flow-promote-discovered-home`, `031-flow-run-promoted-discovered-home`, `032-flow-promote-discovered-home-after-target-fix`, `033-flow-run-promoted-discovered-home-after-target-fix` | Found targetless promoted flow; fixed promotion to write target; promoted run passes. |
| Evidence/replay/report | `034-evidence-candidate-finding`, `035-replay-candidate-finding`, `036-report-qa-manifest-discovery` | All return structured JSON. Replay returns `not-reproduced` for the synthetic candidate. |
| Pipeline projections | `040-status-after-fifth-fixes`, `041-next-after-fifth-fixes`, `042-run-discovery-after-fifth-fixes`, `043-run-all-after-fifth-fixes`, `048-status-after-pipeline`, `049-next-after-pipeline` | Pipeline commands pass; final status has completed run history and no eligible next steps. |
| Capture/audit | `037-capture-localhost-rich`, `038-audit-visual-hierarchy-measured`, `039-audit-responsiveness-measured`, `045-capture-localhost-option-rich`, `046-audit-visual-hierarchy-localhost-measured`, `047-audit-responsiveness-localhost-measured` | Unsafe `--url 127.0.0.1` errors are structured; `--localhost` capture/audits pass and capture computed styles. |
| MCP smoke | `019-mcp-candidate-list-after-fix`, `029-mcp-candidate-list-after-discovery` | MCP candidate list returns empty before discovery and `qflow_928565bc75c0` after discovery. |

## Findings And Fixes

### `surface-bh4`: `surface flow list --candidates` returned flow runs

Repro:

```bash
surface --json flow list --candidates
```

Actual before fix:

- CLI and MCP returned reviewed flow run summaries such as `flowrun_checkout_c95cc206`.
- Candidate listing could not be used as the recovery command from missing-candidate promotion
  errors.

Fix:

- Added `QaRunStore.listCandidateFlows()`.
- Wired `BrowserQaFlowService.listFlows({ candidates: true })` to read candidate flow sidecars.
- Kept default `flow list` behavior on reviewed flow run history.
- Added focused store, service, and CLI JSON envelope coverage.

Verification:

- `020-flow-list-candidates-after-fix-rerun` exits 0 with `flows: []` before discovery.
- `028-flow-list-candidates-after-explore` exits 0 with `qflow_928565bc75c0`.
- `029-mcp-candidate-list-after-discovery` exits 0 with the same candidate id.

### `surface-1x6`: Browser QA exploration missed current `agent-browser` snapshot refs

Repro:

```bash
surface --json explore --url http://127.0.0.1:60411/ \
  --action-policy fixtures/browser-qa/action-policy.json \
  --max-depth 1 --max-actions 4 --max-states 2
```

Actual before fix:

- `009-explore-home-candidates` returned `attemptedActions: 0` and no candidates.
- Direct `agent-browser snapshot` showed visible refs as `[ref=e2]`.
- Driver JSON snapshots wrapped the tree under `data.snapshot`.

Fix:

- Unwrap `snapshot` and `data.snapshot` strings before extracting actions.
- Recognize bracket refs like `[ref=e2]` and normalize them to Surface's internal `@e2`
  locator convention.
- Strip bracket ref tokens from generated action labels.
- Added composition-level coverage using the real `agent-browser --json snapshot` envelope shape.

Verification:

- `026-explore-home-candidates-after-json-snapshot-fix` exits 0 with `attemptedActions: 4`,
  one candidate finding, and candidate flow `qflow_928565bc75c0`.

### `surface-6ii`: Promoted candidate flows omitted runnable targets

Repro:

```bash
surface --json flow promote qflow_928565bc75c0 --out surface-flows/discovered-home.yml
surface --json flow run surface-flows/discovered-home.yml --ci
```

Actual before fix:

- Promotion succeeded, but the YAML only contained an absolute `open` step and no top-level
  `target`.
- Immediate flow run failed with `target_not_allowed`.

Fix:

- Promotion now infers `target: { kind: "url", ref: ... }` from a first absolute HTTP(S) `open`
  action.
- Candidates without an absolute first open step keep the previous output shape.
- Added focused promotion coverage.

Verification:

- `032-flow-promote-discovered-home-after-target-fix` writes `target.kind: url` and the localhost
  ref into `surface-flows/discovered-home.yml`.
- `033-flow-run-promoted-discovered-home-after-target-fix` exits 0 with `status: "passed"`.

## Notes

- `037`, `038`, and `039` intentionally exercised unsafe `--url http://127.0.0.1:60411/` usage.
  Surface rejected those with structured `target_not_allowed` JSON and a `--localhost` recovery
  command. The follow-up `045`, `046`, and `047` commands followed that guidance and passed.
- `017` and `018` are invalid local harness artifacts caused by executing a command string variable
  as a single binary name. The valid reruns are `020` and `021`.
- The discovered candidate is synthetic and replay returned `not-reproduced`, which is expected for
  a candidate generated from initial page coverage rather than a real user-visible defect.

## Validation Run During This Pass

- `pnpm --filter @zigrivers/surface-core test -- --run packages/core/src/browser-qa/state-store.test.ts packages/core/src/browser-qa/flow-runner.test.ts`
- `pnpm --filter @zigrivers/surface test -- --run packages/cli/src/browser-qa-commands.test.ts`
- `pnpm --filter @zigrivers/surface-core test -- --run packages/core/src/composition-factory.test.ts`
- `pnpm --filter @zigrivers/surface-core test -- --run packages/core/src/browser-qa/flow-runner.test.ts`
- `pnpm --filter @zigrivers/surface-core test -- --run packages/core/src/composition-factory.test.ts packages/core/src/browser-qa/state-store.test.ts`
- `pnpm --filter @zigrivers/surface-core build`
- `pnpm --filter @zigrivers/surface build`
- `pnpm --filter @zigrivers/surface-mcp build`

Final gates:

- `pnpm run format:check`: pass.
- `pnpm --filter @zigrivers/surface-core lint`: pass after tightening test types.
- `pnpm --filter @zigrivers/surface-core typecheck`: pass after tightening test types.
- `pnpm --filter @zigrivers/surface-core test`: pass, 50 files and 524 tests.
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
- `surface-msm` tracks a follow-up to prioritize genuinely interactive refs during browser-QA
  exploration; this pass only restored parsing for the current snapshot format.
- `surface replay qfc_928565bc75c0` returns `not-reproduced` for the synthetic candidate. A
  future pass should use a target with a deterministic real browser-QA defect to verify
  `--promote-on-repro`.
