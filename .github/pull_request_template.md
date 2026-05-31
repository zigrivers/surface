<!-- Title: [surface-<id>] <type>(<scope>): <summary>   (see CLAUDE.md commit convention) -->

## What & why
<!-- One task = one branch = one PR. Link the Beads issue. -->
Closes: surface-<id>

## Changes
-

## Verification (Prove It — CLAUDE.md principle #4)
<!-- Paste the relevant output; don't claim it works without evidence. -->
- [ ] `pnpm run check` green (format, lint, typecheck, test)
- [ ] New/changed measured-finding producers have determinism tests (SC-4)
- [ ] Adapters touched → per-framework fixture suite passes (NFR-FW-1)
- [ ] CLI/MCP touched → contract tests pass (NFR-CLI-1 / NFR-MCP-1)

## Notes for reviewer
<!-- Risky/subjective/brand changes go to a human (principle #5). Flag anything gated. -->
