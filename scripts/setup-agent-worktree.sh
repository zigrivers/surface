#!/usr/bin/env bash
# setup-agent-worktree.sh — create a permanent git worktree for a parallel Claude Code agent.
#
# One task = one branch = one worktree, so multiple agents work without stepping on each other
# (git-workflow.md "Parallel sessions"). Branch naming follows the Beads convention:
#   surface-<task-id>/<short-desc>
#
# Usage:
#   scripts/setup-agent-worktree.sh <task-id> <short-desc>
# Example:
#   scripts/setup-agent-worktree.sh surface-7c2 capture-playwright-backend
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <task-id> <short-desc>" >&2
  echo "  e.g. $0 surface-7c2 capture-playwright-backend" >&2
  exit 2
fi

TASK_ID="$1"
DESC="$2"
BRANCH="${TASK_ID}/${DESC}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="${REPO_ROOT}/../surface-worktrees/${TASK_ID}"

# Agent identity for Beads (so issue activity is attributed correctly).
export BEADS_ACTOR="${BEADS_ACTOR:-agent:${TASK_ID}}"
echo "BEADS_ACTOR=${BEADS_ACTOR}"

git -C "$REPO_ROOT" fetch --all --prune 2>/dev/null || true   # no-op if no remote (local-only)
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_DIR" main

echo "Worktree ready:"
echo "  dir:    $WORKTREE_DIR"
echo "  branch: $BRANCH"
echo "Next:"
echo "  cd \"$WORKTREE_DIR\" && corepack enable && pnpm install && pnpm run check"
echo "Remove when merged:"
echo "  git worktree remove \"$WORKTREE_DIR\" && git branch -d \"$BRANCH\""
