# Surface seventh deep e2e dogfood

Date: 2026-06-10

Branch: `codex/seventh-dogfood-20260610`

Base commit tested: `1c337b5` (`origin/main` after PR #92 squash merge)

Dogfood issue: `surface-ey6`

## Environment

- macOS local workspace: `/Users/kenallred/.codex/worktrees/b275/surface`
- Node: `v26.3.0`
- pnpm: `11.0.0`
- `agent-browser`: `0.27.1`
- Temp dogfood workspace: `/tmp/surface-dogfood-2026-06-10-seventh`
- Temp Surface project: `/tmp/surface-dogfood-2026-06-10-seventh/project`
- Local target: `http://127.0.0.1:53321`
- Command artifacts: stdout/stderr/exit/command files under
  `/tmp/surface-dogfood-2026-06-10-seventh/output`

## Scope

This pass started after PR #92 merged into `origin/main`. It intentionally covered less-recently
tested surfaces with a rebuilt local CLI symlink, the built MCP package, a temporary Surface project,
static DOM/screenshot inputs, copied browser-QA fixture policy/flows, and a real localhost HTTP
target modeled after the browser-QA seeded fixture routes.

The run covered:

- local package build and linked CLI smoke
- static inline DOM capture/audit and static screenshot capture/audit
- missing static screenshot input errors
- conflicting capture/audit target flags
- auth-state error handling for loopback targets
- live audit model-fallback disclosure with screenshot egress blocked
- browser-QA cleanup dry-run, reviewed flow execution with `--base-url`, evidence, report, flow
  list/show, gate-with-flows, bounded exploration, candidate replay, and candidate listing
- MCP `surface_artifact_read` success and registered-ref rejection via the built MCP package
- structured invalid report format, missing evidence, and missing flow glob errors
- final `surface status --json` and `surface next --json` projections

## Command Matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Build/link | `001-build-core`, `002-build-cli`, `003-build-mcp`, `004-linked-version`, `005-help` | All exit 0; linked CLI reports `0.2.3`. |
| Project setup | `006-init` | Init exits 0. |
| Static DOM | `007-capture-dom-string`, `008-audit-dom-content` | Inline DOM capture redacts target in output; content audit exits 0 with one P2 readability finding. |
| Static screenshot | `009-capture-screenshot`, `010-audit-screenshot-visual` | Static screenshot capture/audit exit 0; visual hierarchy over screenshot returns zero findings. |
| Static screenshot error | `011-capture-missing-screenshot`, `013-capture-missing-screenshot-fixed` | Before fix: browser backend unsupported-target error. After fix: static missing-file error with `sourcePath`. |
| Conflicting targets | `012-audit-conflicting-targets`, `014-audit-conflicting-targets-fixed`, `015-capture-conflicting-targets-fixed` | Before fix: audit exited 0. After fix: capture and audit exit 2 with `no_target` and target flag details. |
| Auth state | `016-capture-auth-state-bad-json`, `017-capture-auth-state-bad-json-localhost` | `--url` loopback is blocked by policy with localhost recovery; `--localhost` returns structured `auth_injection_failed`. |
| Model fallback | `018-audit-live-model-fallback-auto` | Live audit exits 0; output lists attempted channels, unsupported capabilities, and `screenshot_blocked_by_policy`. |
| QA cleanup/flow | `019-qa-cleanup-dry-run`, `020-flow-run-checkout-base-url` | Cleanup dry-run exits 0; reviewed checkout flow exits 0 with QA run `qa_checkout_5bdff320`. |
| QA evidence/report/list | `021-evidence-bundle`, `022-report-qa-manifest`, `023-flow-show-run`, `024-flow-list` | Evidence summary, manifest report, flow show, and flow list all exit 0 with coherent refs. |
| MCP artifact read | `025-mcp-artifact-read`, `026-mcp-artifact-read-invalid-ref` | Registered artifact read returns bounded redacted JSON; path-like ref is rejected with `config_invalid`. |
| Invalid CLI paths | `027-report-qa-invalid-format`, `028-evidence-missing-ref`, `030-flow-run-missing-glob` | Invalid report format exits 2; missing evidence and missing flow glob exit 1 with structured JSON. |
| Gate with flows | `029-gate-ci-with-flows-base-url` | Gate exits 0 with no failing flow run ids after the passing reviewed flow. |
| Exploration/replay | `031-explore-billing-policy`, `032-replay-candidate`, `033-flow-list-candidates`, `034-replay-candidate-fixed` | Exploration creates candidate refs; replay initially hides promotion, then after fix returns promoted finding details. |
| Projections | `035-status-after-seventh`, `036-next-after-seventh` | Status shows four completed audit runs; next lists `run discovery` and `run all`. |

## Findings And Fixes

### `surface-04e`: Missing screenshot capture reported the wrong backend error

Repro:

```bash
surface --json capture --screenshot assets/missing.png
```

Actual before fix:

- `011-capture-missing-screenshot` exited 1 with `capture_failed` from `agent-browser backend does
  not support screenshot targets`.
- The error did not identify the missing screenshot path.

Fix:

- When a selected browser backend fails for a static-file target, Surface now returns the static
  fallback validation error if fallback validation fails.
- Missing static screenshot errors now include `sourcePath` in details.
- Added regression coverage in `packages/core/src/capture-artifacts.test.ts`.

Verification:

- `013-capture-missing-screenshot-fixed` exits 1 with message
  `Static backend screenshot source must be a readable file.` and includes
  `reason: screenshot-source-unavailable` plus `sourcePath`.

### `surface-ctn`: Capture and audit accepted conflicting target flags

Repro:

```bash
surface --json audit --dom "<main></main>" --screenshot assets/static-screenshot.png
```

Actual before fix:

- `012-audit-conflicting-targets` exited 0 and silently chose one target.

Fix:

- Shared capture/audit target parsing now counts provided target flags before selecting a target.
- Multiple target flags return `no_target` usage errors with `details.targets`.
- Added CLI regression coverage for both `capture` and `audit`.

Verification:

- `014-audit-conflicting-targets-fixed` and `015-capture-conflicting-targets-fixed` both exit 2
  with `message: Target flags are mutually exclusive.`

### `surface-b8k`: Replay promotion omitted promoted finding details from JSON output

Repro:

```bash
surface --json replay qfc_4427e3eef17f --promote-on-repro
```

Actual before fix:

- `032-replay-candidate` exited 0 with only `replayStatus: reproduced`.
- State showed promotion was actually written under
  `.surface/qa/refs/promoted-findings/f_4427e3eef17f.json`.

Fix:

- The default composition replay wrapper now returns promotion details from replay-promoter output,
  matching the human-verdict promotion response shape.
- Added composition-level regression coverage that reproduces and promotes a candidate.

Verification:

- `034-replay-candidate-fixed` exits 0 and includes promotion details such as
  `findingId: f_4427e3eef17f`, `candidateFindingId`, `promotionSource: replay`, and checksums.

## Notes

- `016-capture-auth-state-bad-json` intentionally used `--url` against loopback and correctly hit
  target policy before auth-state injection. `017-capture-auth-state-bad-json-localhost` is the
  valid auth-state-path check.
- MCP artifact-read was dogfooded through `createSurfaceMcpServer().callTool(...)` against the
  built MCP package and temp `.surface` state. A stdio harness was not needed for this path.
- The temporary local HTTP target was stopped after the pass.

## Validation Run During This Pass

- `pnpm --filter @zigrivers/surface-core exec vitest run src/capture-artifacts.test.ts --testNamePattern "reports static screenshot validation errors"` failed before the fix and passed after.
- `pnpm --filter @zigrivers/surface exec vitest run src/index.test.ts --testNamePattern "rejects (capture|audit) with multiple target flags"` failed before the fix and passed after.
- `pnpm --filter @zigrivers/surface-core exec vitest run src/composition-factory.test.ts --testNamePattern "returns promotion details"` failed before the fix and passed after.
- `pnpm --filter @zigrivers/surface-core build`: pass.
- `pnpm --filter @zigrivers/surface build`: pass.

Final gates:

- `pnpm run format:check`: pass.
- `pnpm --filter @zigrivers/surface-core lint`: pass after one test-only unsafe-assignment fix.
- `pnpm --filter @zigrivers/surface-core typecheck`: pass.
- `pnpm --filter @zigrivers/surface-core test`: pass, 50 files and 527 tests.
- `pnpm --filter @zigrivers/surface lint`: pass.
- `pnpm --filter @zigrivers/surface typecheck`: pass.
- `pnpm --filter @zigrivers/surface test`: pass, 2 files and 105 tests.
- `pnpm --filter @zigrivers/surface-mcp lint`: pass.
- `pnpm --filter @zigrivers/surface-mcp typecheck`: pass.
- `pnpm --filter @zigrivers/surface-mcp test`: pass, 2 files and 26 tests.
- `pnpm run test:e2e`: pass, 2 files and 7 tests.
- `pnpm exec vitest run tests/acceptance/epic-e1-capture.test.ts tests/acceptance/epic-e6-interfaces.test.ts`:
  pass, 2 files and 69 tests.
- `git diff --check`: pass.

`pnpm run test:release` was not run because no release or package metadata changed.

## Remaining Risks

- This pass did not exercise a full MCP stdio client session; it used the server tool-call API for
  artifact-read behavior.
- Browser-QA cleanup had no stale sessions to remove, so only dry-run empty-state behavior was
  covered.
