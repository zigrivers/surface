#!/usr/bin/env bash
# cli-pr-review.sh — fallback multi-model code review (Codex + Gemini) with manual reconciliation.
# Use when `mmr` / `scaffold run review-pr` is unavailable. Mirrors the dual-model pattern used
# for this project's planning-doc reviews.
#
# Usage:
#   scripts/cli-pr-review.sh [base-ref]      # default base: main
# Output: writes codex + gemini JSON findings to /tmp and prints paths; you reconcile P0-P3.
set -euo pipefail

BASE="${1:-main}"
DIFF="$(git diff "${BASE}"...HEAD)"
if [ -z "$DIFF" ]; then echo "no diff vs ${BASE}"; exit 0; fi

PROMPT="You are reviewing a code diff for 'surface' (CLI+MCP UI-audit tool). Apply
docs/review-standards.md (P0-P3) and docs/coding-standards.md. Focus: trust spine (measured/judged,
ADR-005), determinism, Result<T,SurfaceError> error handling, package boundaries (no deep imports,
core imports no leaf), security (execa array-args, SSRF, no secrets in logs), tests-first.
Output ONLY JSON: {\"findings\":[{\"severity\":\"P0|P1|P2|P3\",\"file\":\"\",\"finding\":\"\",\"suggestion\":\"\"}],\"gate\":\"pass|fail\"}.

DIFF:
${DIFF}"

echo "Running Codex + Gemini review of ${BASE}...HEAD ..."
command -v codex  >/dev/null && codex exec "$PROMPT"            > /tmp/surface-pr-codex.json  2>/dev/null || echo "codex unavailable"
command -v gemini >/dev/null && gemini -m gemini-2.5-pro -p "$PROMPT" > /tmp/surface-pr-gemini.json 2>/dev/null || echo "gemini unavailable"

echo "Findings:"
echo "  codex:  /tmp/surface-pr-codex.json"
echo "  gemini: /tmp/surface-pr-gemini.json"
echo "Reconcile: objective/measured concerns win; fix all P0/P1 before merge (docs/review-standards.md)."
