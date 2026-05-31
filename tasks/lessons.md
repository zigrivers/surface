# Lessons Learned

Cross-session memory for agents working on `surface`. Capture a lesson the moment you're
corrected, a test fails on a pattern you should have known, or you discover a project
convention. Keep each entry specific, actionable, and preventive.

## Patterns

(Add discovered patterns here.)

## Anti-Patterns

(Add anti-patterns here.)

## Common Gotchas

- **Beads issue prefix is `surface-`, not `bd-`.** Commit messages and references use
  `[surface-<id>]` (e.g., `[surface-q2p]`). The generic scaffold docs say `bd-<id>`; this
  project's actual prefix is `surface`.
- **`bd` runs in embedded-Dolt mode here.** `bd doctor --fix` is not supported in embedded
  mode (v1.0.5) — it prints an informational note, not an error. Use `bd init --force` to
  repair hooks/config if they drift.
- **Auto-export warns "no Dolt remote configured."** Expected until a git remote exists;
  `.beads/issues.jsonl` is a passive export, not the source of truth.
