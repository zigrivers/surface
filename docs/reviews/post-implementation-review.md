# Post-Implementation Review

Date: 2026-06-02

Mode: post-implementation review after all implementation-plan Beads were closed. Findings were
not fixed in this pass because the confirmed issues are cross-cutting release-gate follow-up work;
they were filed as Beads tasks for implementation.

## Channel Status

| Channel | Status | Notes |
|---|---|---|
| Codex CLI | Completed | Returned valid JSON findings. |
| Claude CLI | Completed | Returned structured findings in JSON inside the result payload. |
| Gemini CLI | Failed | Auth check passed, but the full review run hit a routing/content failure, then hung; the orphaned Gemini process was terminated. |
| Local verification | Completed | Checked CLI/MCP audit paths, acceptance tests, state/capture code, and file tree. |

Verdict: degraded-pass for review coverage, with confirmed P1 follow-up work filed.

## Consolidated Findings

### P1 - CLI Audit Bypasses The Real Evaluation Pipeline

Bead: `surface-j51` - PIR-001 Route CLI audit through shared evaluation pipeline

Sources: Codex, Claude, local verification.

Evidence:
- `packages/cli/src/index.ts:840` calls `findingsForSeededFixture(target.value)`.
- `packages/cli/src/index.ts:1804` hardcodes a seeded low-contrast measured finding.
- `packages/mcp/src/index.ts` has a real grounding/lens path via `selectLensExecutionPlan` and `findingsForPlan`.

Impact: the primary CLI can pass seeded smoke tests without exercising capture, grounding, lenses,
scoring, backlog synthesis, or stable tracking through the shared architecture.

### P1 - MCP State Is Process-Local Instead Of Shared Durable State

Bead: `surface-8ld` - PIR-002 Persist MCP runs and closed-loop state via shared StateStore

Source: Codex.

Impact: MCP runs, baselines, verdicts, and tracked findings are lost on restart and can diverge from
CLI-visible `.surface` state.

### P1 - Artifact Writes Bypass The StateStore Sole-Writer Boundary

Bead: `surface-ylg` - PIR-003 Move capture and context artifact writes behind StateStore

Sources: Codex, Claude.

Impact: capture/context files are written directly under `.surface/`, bypassing the StateStore lock,
atomic write behavior, and ADR-003 sole-writer invariant.

### P1 - Pipeline State Transitions Are Not Atomic Across Overlapping Runs

Bead: `surface-u1k` - PIR-004 Make pipeline state transitions atomic for overlapping runs

Source: Codex.

Impact: separate `readState`/`writeState` cycles can interleave under concurrent runs; the acceptance
coverage for overlapping runs is currently skipped.

### P1 - agent-browser Errors Can Expose Sensitive Details

Bead: `surface-cyi` - PIR-005 Redact agent-browser command and stderr details in errors

Source: Codex.

Impact: raw command args and stderr can leak auth-state paths, target details, or captured-content
details through CLI/MCP error envelopes.

### P1 - Durable State Validation Is Incomplete

Bead: `surface-7ks` - PIR-006 Validate all durable state fields with canonical schemas

Sources: Codex, Claude.

Impact: findings, backlog, run records, and verdicts can persist without canonical schema validation,
weakening the measured/judged trust boundary.

### P1 - CLI E2E/Benchmark Tests Assert The Seeded Shortcut

Bead: `surface-k74` - PIR-007 Replace seeded-fixture CLI e2e with real audit pipeline coverage

Source: Claude, local verification.

Dependency: depends on `surface-j51`.

Impact: current e2e and benchmark coverage can pass while the production CLI audit path never runs
the real evaluation pipeline.

### P2/P3 Follow-Ups

| Bead | Finding |
|---|---|
| `surface-bkl` | PIR-008 Implement or remove advertised unimplemented MCP tools |
| `surface-8l2` | PIR-009 Implement or remove ignored CLI flags |
| `surface-w8g` | PIR-010 Reconcile SurfaceError taxonomy with ADR-014 |
| `surface-3fg` | PIR-011 Remove committed sensitive `.surface` context artifacts |
| `surface-ngr` | PIR-012 Replace duplicated CLI structural types with canonical core types |

## Created Beads

Created 12 Beads tasks:

- `surface-j51`
- `surface-8ld`
- `surface-ylg`
- `surface-u1k`
- `surface-cyi`
- `surface-7ks`
- `surface-k74`
- `surface-bkl`
- `surface-8l2`
- `surface-w8g`
- `surface-3fg`
- `surface-ngr`

Dependency edges added: 1 (`surface-k74` depends on `surface-j51`).

## Recommended Next Ready Work

Start with `surface-j51`. It is the highest-leverage blocker because the e2e rewrite and several
interface/state cleanups are easier once CLI audit uses the shared evaluation service instead of the
seeded-fixture shortcut.
