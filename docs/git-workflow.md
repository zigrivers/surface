<!-- scaffold:git-workflow v1 2026-05-31 -->

# surface — Git Workflow

> Configures the repo for **parallel Claude Code sessions** (PRD R-1, project-structure's
> parallel-agent goal). One task = one branch = one PR. Commit convention and Key Commands come
> from `CLAUDE.md`; CI mirrors the local gate from `docs/dev-setup.md`.
>
> **Local-only note:** this repo currently has **no git remote** (Beads runs local-only). The
> branch/worktree/commit mechanics below apply today; the PR/CI/auto-merge mechanics activate
> once a GitHub remote is added (the `.github/` workflow + PR template ship ready for that).

## Branching strategy

- **GitHub Flow**, short-lived branches off `main`. `main` is always green.
- **Branch naming (Beads):** `surface-<task-id>/<short-desc>` — e.g. `surface-7c2/capture-playwright-backend`.
- One Beads issue → one branch → one PR. Don't bundle unrelated tasks.

## Commit standards

Per `CLAUDE.md`: `[surface-<id>] <type>(<scope>): <summary>` (Conventional Commits type), with a
body bullet for the change and a bullet for the test/verification. Every commit references its
Beads task for task↔commit traceability.

## Rebase strategy

- Rebase the feature branch on `main` before opening/refreshing a PR: `git pull --rebase` (or
  `git rebase main`). Keep branches short (1–3 days) so divergence stays small.
- Never rebase shared/`main` history; rebase only your own feature branch.

## PR workflow (8 sub-steps)

1. **Commit** with the `[surface-<id>]` convention.
2. **AI review** — self-review the diff (and use `/code-review` where available) before pushing.
3. **Rebase** on `main`.
4. **Push** the branch.
5. **Create** the PR (the template auto-loads; fill task id + verification).
6. **Auto-merge** with squash + delete-branch: `gh pr merge --squash --auto --delete-branch`.
7. **Watch CI** — the `check` job must pass (it runs `pnpm run check`).
8. **Confirm merge** and that the branch was deleted.

## Task closure

On merge, close the Beads issue: `bd close surface-<id>`. If the work spawned follow-ups, file
them as new issues (don't leave TODOs in code — CLAUDE.md).

## Parallel sessions & worktrees

- Use `scripts/setup-agent-worktree.sh <task-id> <desc>` to create a **permanent worktree** per
  agent under `../surface-worktrees/<task-id>` on its own branch.
- Set `BEADS_ACTOR=agent:<task-id>` (the script does this) so Beads attributes activity correctly.
- **Conflict-prevention rule:** never parallelize two tasks that touch the same files. The
  monorepo's package boundaries (ADR-002) make this easy — assign agents to different packages
  (`adapters/vue` vs `reporters`, etc.).

## Worktree awareness

- Each worktree has its own `node_modules` after `pnpm install`; run `pnpm run check` inside it.
- Remove a finished worktree: `git worktree remove ../surface-worktrees/<task-id> && git branch -d surface-<id>/<desc>`.
- Batch cleanup of merged branches: `git branch --merged main | grep -v '^\*\| main' | xargs -r git branch -d`.

## Agent crash recovery

If an agent session dies mid-task: its worktree and branch persist. Recover by `cd`-ing back
into the worktree, running `git status`, and `bd show surface-<id>` to see the issue state; the
file-based `.surface/`-style state and Beads issue are the durable record. Re-run `pnpm run
check` to re-establish a known-good baseline before continuing.

## CI pipeline (`.github/workflows/ci.yml`)

- Job **`check`** runs `pnpm run check` on Node 22 + pinned pnpm (Corepack) — identical to local
  (the mirror principle). This is the job name branch protection should require.
- Job **`capture-matrix`** runs Playwright/grounding tests **only when** `packages/capture` or
  `packages/grounding` change (browser install is expensive).

## Branch protection (once a remote exists)

Require the `check` status context and ≥1 review on `main`; enable squash-merge + auto-delete
branches. Example: `gh api -X PUT repos/<owner>/<repo>/branches/main/protection ...` with
`required_status_checks.contexts=["check"]` (the context name must match the CI job name).

## Conflict prevention (summary)

- One task = one branch; package-scoped assignments; rebase often; no parallel tasks on shared
  files; `core` changes (the shared dependency) are serialized, not parallelized.
