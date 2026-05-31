# Lessons Learned

Cross-session memory for agents working on `surface`. Capture a lesson the moment you're
corrected, a test fails on a pattern you should have known, or you discover a project
convention. Keep each entry specific, actionable, and preventive.

## Patterns

- **`scaffold run <step>` auto-completes the step** (advances state on invocation) — it emits the
  meta-prompt AND marks the step done, trusting the agent to execute. Do the work + commit; no
  separate `scaffold complete` needed (it'll say "already completed").
- **Depth-5 review steps want multi-model.** Dispatch `codex exec "<prompt>"` and
  `gemini -m gemini-2.5-pro -p "<prompt>"` in the background, do your own structured passes,
  reconcile, fix, then write `docs/reviews/<step>/{codex,gemini}-review.json` + `review-summary.md`
  + the report. Save raw outputs; close findings P0→P3.
- **Reviews caught real gate-blockers.** The per-phase multi-model reviews found genuine P0/P1
  issues (e.g. implementation-plan missing model-provider + context-ingestor tasks; mis-tiered
  gate evaluator; oversized CLI/MCP tasks). Run them on the architecture spine — don't skip.
- **Adapt GUI-shaped meta-prompts to a CLI tool.** api-contracts→CLI/MCP/output schemas (no REST);
  operations→release/distribution ops (no hosted service); add-e2e→CLI e2e (no frontend);
  platform-parity→agent-platforms (web-only deploy). Record N/A items with rationale, don't fake them.

## Anti-Patterns

- **Don't claim a step is "complete" by rationalizing missing work.** (Prior session falsely
  reported 14/14; the real graph was 14/60 from a scaffold bug.) Verify with `scaffold status`/
  `next`/`check`; trust the tool over assumptions.
- **Don't hard-depend on the gemini CLI's auto model-router** — it throws
  `NumericalClassifierStrategy ... invalid content` intermittently. Pass `-m gemini-2.5-pro`
  explicitly. Multi-model reconciliation must degrade gracefully + record which channels ran.

## Common Gotchas

- **Beads issue prefix is `surface-`, not `bd-`.** Commit messages and references use
  `[surface-<id>]` (e.g., `[surface-q2p]`). The generic scaffold docs say `bd-<id>`; this
  project's actual prefix is `surface`.
- **`bd` runs in embedded-Dolt mode here.** `bd doctor --fix` is not supported in embedded
  mode (v1.0.5) — it prints an informational note, not an error. Use `bd init --force` to
  repair hooks/config if they drift.
- **Auto-export warns "no Dolt remote configured."** Expected until a git remote exists;
  `.beads/issues.jsonl` is a passive export, not the source of truth.
