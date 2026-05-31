You are an independent senior software architect performing an adversarial review of a
domain model (DDD) for "surface" — an open-source CLI + MCP server that audits the built,
running UI of web apps, separating *measured* (tool-confirmed) from *judged* (AI) findings
and producing an agent-executable, re-verifiable fix backlog.

REVIEW TARGET: all files in `docs/domain-models/` (index.md + 7 bounded-context files:
capture, evaluation, findings, closed-loop, knowledge-base, reporting, project-state).
SOURCE OF TRUTH for coverage: `docs/plan.md` (the PRD). Also relevant: `docs/user-stories.md`.

Read those files yourself from disk. Then review across these passes:
1. PRD Coverage — every PRD §6 feature (FR-CAP/PIPE/LENS/KB/OVL/METH/SCORE/OUT/LOOP/IF/INT/
   MODE/RULE) maps to ≥1 domain; no phantom domains lacking PRD traceability.
2. Bounded Context Integrity — clean boundaries; shared entities have explicit integration
   (shared kernel / ACL / published language); no context reaches into another's internals.
3. Entity vs Value Object — correct classification (identity+lifecycle vs immutable-by-value).
4. Aggregate Boundary — each aggregate protects ≥1 invariant, is right-sized (≤~7 entities),
   references other aggregates by ID, no invariant spans aggregates without a service/saga.
5. Domain Event Completeness — every meaningful state transition emits an event with a
   sufficient payload.
6. Ubiquitous Language Consistency — one term per concept across ALL files; no synonyms/homonyms.
7. Invariant Testability — each invariant is a runtime-checkable condition, not prose.

Be skeptical and specific. Prefer finding real P0/P1 issues over praise. A P0 blocks the next
phase (decisions/ADRs); P1 causes downstream rework; P2 is improvement; P3 is polish.

OUTPUT: emit ONLY a JSON object (no prose around it) of the form:
{
  "reviewer": "<your model name>",
  "overall": "<2-3 sentence assessment>",
  "findings": [
    {"severity":"P0|P1|P2|P3","pass":"<pass name>","location":"<file/section>","finding":"<specific issue>","suggestion":"<concrete fix>"}
  ],
  "gate": "pass|conditional-pass|fail"
}
