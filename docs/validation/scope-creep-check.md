<!-- scaffold:scope-creep-check v1 2026-05-31 -->

# Validation: Scope-Creep Check

> Reviewer: Claude (enhanced). Confirms the task plan stays within the PRD §8 scope tiers and the
> §14 deferred boundary — nothing crept into v1 that shouldn't have, and nothing in v1 exceeds web-first.

## Result: **PASS** — no scope creep; tiers honored; deferred items have no tasks.

## Tier discipline (PRD §8)

- **Gate (G) tasks** map to the v1.0 Release Gate scope exactly: closed loop on web for
  React/Next + agnostic HTML, one capture backend (+static fallback), generic overlay, core
  lenses, KB, depth/presets, structured findings + trust guards, CLI+MCP+skill+`.surface`,
  Axe/Lighthouse + GitHub Issues, explain, auth injection. ✓ No gate task exceeds this.
- **Committed (C) tasks** = Vue/Svelte adapters, agent-browser (2nd backend), SaaS/e-commerce/
  marketing overlays, baseline/waivers, SARIF, GitHub Checks, redaction, suggestedPatch — all
  PRD-§8-committed. ✓
- **Should (S) tasks** = walkthrough/conversion lens (T-041b), multi-state/dual-theme (T-034),
  Linear/Jira (T-058), multi-model reconciliation (T-013), verdict (T-017), diff/alternatives
  (T-055) — all PRD-§8-should. ✓

## Deferred boundary (PRD §14) — confirmed NO tasks

No task implements: native mobile/desktop, kiosk/TV overlays, Figma ingestion, visual-regression
baselines, session-replay/analytics, deep component-library analysis, multi-step interactive
login (only single-step auth-state is in — T-024), automated interactive-state discovery (only
declared task-flow recipes — T-034), monorepo multi-app target resolution, i18n breadth. ✓

## Web-first containment

Every capture/adapter/lens task is web-scoped; no task adds a non-web target. The "design-system"
and "ux-spec" steps were correctly **skipped** (no GUI), preventing GUI-scope creep. ✓

## Anti-vision adherence

- No vanity-score task (FR-SCORE-4) — confirmed: renderers/gate use ordering/`SeverityBand`, no
  headline number (T-050/054a).
- No blank-canvas generation — `alternatives` (T-055) is bounded-improvement only (US-015).

## Findings: none. (If anything, the plan is slightly *under* the should-tier — acceptable, those
are v1.1.)

## Disposition: PASS — scope is contained; proceed to finalization + build.
