You are reviewing a PRODUCT REQUIREMENTS DOCUMENT (PRD) for an open-source tool called `surface` — a CLI + MCP server that audits the *built, running* UI of web apps, separates measured (tool-confirmed) from judged (AI) findings, and emits an agent-executable, re-verifiable backlog of fixes. Its two audiences: AI agents/build-pipelines (primary adopter) and non-designer builders (beneficiary + authority on risky changes).

A PRD says WHAT and for whom, not HOW (architecture/specs own the HOW). Review it using these 8 passes, each targeting a specific PRD failure mode:

1. **Problem Statement Rigor** — specific, testable, observable, names a specific user group, has evidence, does NOT prescribe a solution.
2. **Persona & Stakeholder Coverage** — goal-driven personas with constraints/behavior/success; every stakeholder represented; no "Everything User"; 2-6 meaningful personas.
3. **Feature Scoping Completeness** — in-scope / out-of-scope / deferred all present; features specific enough to estimate; MoSCoW prioritization that actually forces tradeoffs (not everything "Must"); no requirements-as-solutions (technical prescriptions that belong in architecture).
4. **Success Criteria Measurability** — every criterion has a target value AND a measurement method; tied to the problem statement; covers behavior/business/technical/adoption types.
5. **NFR Quantification** — categories addressed (performance, scalability, availability, security, accessibility, data retention, i18n, browser/device support, monitoring); quantified with numbers + conditions, not adjectives. Flag any category completely absent (or absent without an explicit N/A rationale).
6. **Constraint & Dependency Documentation** — technical/timeline/budget/team/regulatory constraints; each traceable to downstream impact; external integrations have documented API limits/costs/rate-limits/auth.
7. **Error & Edge Case Coverage** — sad paths for every feature with user input or external dependency; failure modes for integrations; concurrency/large-data/interrupted-state scenarios.
8. **Downstream Readiness for User Stories** — can stories be written without guesswork? features map ~1:N to stories; personas are story actors; business rules explicit enough for acceptance criteria.

## Severity
- **P0**: Breaks the next phase (user-stories) — cannot proceed or will produce wrong output.
- **P1**: Significant gap — stories can proceed but will make wrong assumptions.
- **P2**: Improvement — correct but could be clearer.
- **P3**: Polish.

Special context to weigh honestly:
- This is a DELIBERATELY BROAD v1 (the product owner chose breadth: many lenses, several overlays, all framework adapters, both capture backends, MCP in v1). §3 documents this as accepted scope risk with MoSCoW containment. Judge whether the Must-Have list is realistically "v1" or whether breadth undermines prioritization — this is a key thing to assess, not rubber-stamp.
- The PRD names specific technologies (TypeScript, React/Vue/Svelte, Axe-core, Lighthouse, Playwright, agent-browser, MCP). Assess whether each is legitimate product-scoping/inherited-from-vision vs. an architecture decision that shouldn't be in a PRD.

Be rigorous and honest. Flag genuine issues; don't invent problems to seem thorough. Zero or few findings is valid if the doc is strong. Verify claims against the actual text.

## Output Format
Respond with ONLY a JSON array (no prose before/after):
[
  {"severity":"P0|P1|P2|P3","pass":"<pass name>","location":"<section>","description":"<concrete issue>","suggestion":"<specific fix>"}
]

## DOCUMENT UNDER REVIEW (docs/plan.md) follows:

---

