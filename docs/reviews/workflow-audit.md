<!-- scaffold:workflow-audit v1 2026-05-31 -->

# Workflow Consistency Audit — surface

> Cross-referenced every workflow-touching document for contradictions, stale references,
> missing steps, and inconsistent command formats. All workflow docs were authored in one
> consistent pass this session, so the audit is **clean** — verified, not assumed.

## Checks & results

| Check | Sources | Result |
|---|---|---|
| **Commit format** `[surface-<id>] <type>(<scope>): <summary>` | `CLAUDE.md`, `docs/coding-standards.md`, `docs/git-workflow.md` | ✓ identical in all three (uses the project prefix `surface-`, not the generic `bd-` placeholder) |
| **Branch naming** `surface-<id>/<short-desc>` | `CLAUDE.md`, `docs/git-workflow.md`, `scripts/setup-agent-worktree.sh` | ✓ consistent |
| **Key Commands ↔ package.json** | `CLAUDE.md` table, `docs/dev-setup.md`, `package.json` | ✓ every referenced `pnpm` script exists (also enforced by `tests/evals/consistency.test.ts`) |
| **CI gate = local gate** (`pnpm run check`) | `CLAUDE.md`, `docs/dev-setup.md`, `docs/git-workflow.md`, `.github/workflows/ci.yml` | ✓ the `check` job name matches everywhere (branch-protection context) |
| **PR workflow** (8 sub-steps incl. AI review + `--delete-branch`) | `docs/git-workflow.md` (full), `CLAUDE.md` (summary) | ✓ complete; review step integrates `docs/review-standards.md` |
| **operations vs CI/dev-setup** | `docs/operations-runbook.md` | ✓ extends the `check` CI / references dev-setup; does not redefine or contradict |
| **lessons.md** | `tasks/lessons.md`, `CLAUDE.md` autonomous-behavior | ✓ exists and is referenced (session-start read) |

## Notes

- The **bd-managed BEADS block** in `CLAUDE.md` (`<!-- BEADS INTEGRATION -->`) uses generic
  `bd create`/`bd-<id>` examples; this is auto-maintained tooling guidance and does **not**
  conflict with the project's `[surface-<id>]` commit convention (which is stated explicitly in
  the Commit Convention section). Left untouched (managed block).
- Local-only repo: PR/CI/auto-merge mechanics are documented and ship ready (`.github/`), and
  activate when a GitHub remote is added — `docs/git-workflow.md` states this clearly, so the
  PR steps are not "stale" but "pending remote."

## Outcome

**No contradictions or stale references found; no fixes required.** Workflow documentation is
internally consistent and ready for the implementation phase.
