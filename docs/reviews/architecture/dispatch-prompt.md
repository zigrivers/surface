You are an independent senior software architect performing an adversarial review of the system
architecture for "surface" — an open-source CLI + MCP server that audits the built, running UI
of web apps (separating *measured* tool-confirmed findings from *judged* AI findings; producing
an agent-executable, re-verifiable fix backlog).

REVIEW TARGET: `docs/system-architecture.md`. Read it from disk.
CONTEXT (read what you need): `docs/domain-models/` (7 bounded contexts), `docs/adrs/`
(ADR-001..018, binding constraints), `docs/plan.md` (PRD), `docs/project-structure.md`
(package layout the architecture must map to).

Review across these architecture-specific failure modes:
1. Domain coverage — every bounded context maps to a component/module; none orphaned.
2. ADR constraint compliance — the architecture honors every accepted ADR; no violations
   (e.g. no DB given ADR-003; no REST given ADR-008; measured/judged discipline ADR-005).
3. Data-flow completeness — every component appears in ≥1 data flow; Must-have user journeys
   are covered; no orphaned components; error/degradation paths shown.
4. Module structure — merge-conflict risk, circular-dependency risk, import depth; core-only-
   downward dependency rule holds.
5. State consistency — the `.surface/` state design is coherent with ADR-003/domain Project State.
6. Diagram/prose drift — diagrams and prose agree; no contradictions.
7. Extension points — each has an interface, usage, and constraints; the "cannot extend without
   ADR" set is right.
8. Invariants — domain invariants (measured⇔evidence, identity-broken-never-silent, etc.) are
   preserved by the architecture.
9. Downstream readiness — can api-contracts/specs/implementation-plan proceed?

Be skeptical and specific. Cite the section. P0 blocks downstream; P1 causes rework; P2 debt;
P3 polish.

OUTPUT: emit ONLY a JSON object (no surrounding prose):
{
  "reviewer": "<model name>",
  "overall": "<2-3 sentences>",
  "findings": [
    {"severity":"P0|P1|P2|P3","pass":"<failure mode>","location":"<section>","finding":"<specific issue>","suggestion":"<concrete fix>"}
  ],
  "gate": "pass|conditional-pass|fail"
}
