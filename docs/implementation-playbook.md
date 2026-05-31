<!-- scaffold:implementation-playbook v1 2026-05-31 -->

# surface — Implementation Playbook

> The operational doc you consult **each time you start a task**. (Orientation is in
> `docs/onboarding-guide.md`; the task graph is `docs/implementation-plan.md`.) The corpus is
> **frozen** (`docs/validation/fix-log.md`) — implement against it; if you discover a real gap,
> file a Beads issue and re-run the affected `review-*` before changing a gate artifact.

## Build-phase entry

The pipeline stops at the build phase deliberately. To begin implementation, a human starts one
of: **`scaffold run single-agent-start`** (one agent) or **`scaffold run multi-agent-start`**
(parallel agents in worktrees). This playbook governs what those agents do.

## Task ordering (waves)

Execute `implementation-plan.md` **wave by wave**; within a wave honor the **subwave** notes
(some tasks depend on others in the same wave):

```
W0 foundations → W1 domain logic → W2 capture/grounding/adapters → W3 lenses/KB/overlays
→ W4 reporters/integrations → W5 interfaces (composition root) → W6 fixtures/e2e/benchmark
```

- **Release gate = all G (gate) tasks + T-070a/071/072 green.** Do G tasks first; C
  (committed) and S (should) tasks can follow or slip to v1.1 without failing the gate (PRD §8).
- **Critical path:** T-001→T-002→T-005→T-010→T-018→T-045→T-059→T-060→T-061a→T-071→T-072. Keep
  it unblocked; schedule off-path tasks around it.
- **Parallelize across packages, serialize `core` + the composition factory (T-059) + CLI app
  (T-060).** Never give two agents tasks that touch the same file.

## Per-task context (what to load before coding)

For task `T-xxx`, load: its row in `implementation-plan.md` (deps, files, tier, test ref) → the
cited **story** (`user-stories.md`) and **PRD FR** → the relevant **domain context**
(`domain-models/<context>.md`) → the governing **ADR(s)** → the **api-contract** section if it's
a CLI/MCP/output task → the **`.claude/rules/`** that match the file globs. Don't load the whole
corpus — load the task's slice. Use the **context7 MCP** for live library docs (zod, commander,
Playwright, MCP SDK) instead of guessing APIs.

## The TDD loop (per task — non-negotiable)

1. Open the task's referenced `tests/acceptance/epic-*.test.ts` skeleton (or the determinism/
   contract test type from ADR-015). **Un-skip** the relevant `it`(s).
2. **Red:** write the failing test that the AC demands; run it; watch it fail.
3. **Green:** write the minimum code to pass (~150 LOC, ≤3 app files).
4. **Refactor** with tests green.
5. Add the **non-negotiable test types** that apply (ADR-015 / `docs/tdd.md`): determinism for a
   measured producer; identity for closed-loop; method-integrity; degradation; concurrency.
6. **Prove It:** run `pnpm run check` (+ the relevant eval in `tests/evals/`); paste output.

A task is **not done** on "it seems to work" — only when its AC tests are green and `pnpm run
check` passes (CLAUDE.md principle #4).

## Quality gates (run before opening a PR)

- `pnpm run check` — format + lint + typecheck + test (the CI mirror).
- Applicable evals (`tests/evals/`): consistency, structure, adherence, coverage, cross-doc.
- For the task's layer: capture matrix (capture/grounding), per-framework fixtures (adapters),
  CLI/MCP contract + SARIF/MCP-snapshot (interfaces), perf gate (NFR-PERF-1).
- Security tasks: SSRF default-deny, execa array-args (no `shell:true`), no secrets in logs.

## Definition of done (per task)

- [ ] AC tests un-skipped and green; non-negotiable test types added where applicable.
- [ ] ≤3 app files changed (~150 LOC) or justified; no TODO/stub left (file a Beads issue instead).
- [ ] `method` set on any finding emitter; measured ⇒ tool evidence; no judged-as-measured.
- [ ] `pnpm run check` green; output pasted in the PR (Prove It).
- [ ] Commit `[surface-<id>] <type>(<scope>): <summary>`; PR reviewed (`review-pr`); Beads closed.

## Agent handoff format

When handing off (end of session / to the next agent), report:
1. **Task(s)**: id(s) + status (done / in-progress / blocked).
2. **Changed files** + the test(s) now green.
3. **Validation**: paste of `pnpm run check` (and which evals ran).
4. **Next**: the newly-unblocked task id(s) (`scaffold next`-style) and any blocker with the exact
   command + error.
5. **Issues filed** for any discovered gaps.

The durable record is the **Beads issue** + the inspectable `.surface/` state of any run —
not chat history.

## Success criteria (release gate)

The v1.0 Release Gate is met when: the closed loop works end-to-end on web for React/Next +
agnostic HTML with one capture backend (+static fallback); measured a11y is deterministic
(SC-4); CLI+MCP+skill+`.surface` state work (NFR-CLI-1/MCP-1); GitHub export + explain + auth
injection work; and **T-071** (closed-loop e2e) + **T-072** (SC-6 before/after benchmark + perf
gate) pass. SC-5 (judged FP rate <10%) is tracked via self-grounding from first runs.
