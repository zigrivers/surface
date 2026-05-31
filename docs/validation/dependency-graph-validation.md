<!-- scaffold:dependency-graph-validation v1 2026-05-31 -->

# Validation: Dependency-Graph Validation

> Reviewer: Claude (enhanced). Validates the task DAG (`docs/implementation-plan.md`) and the ADR
> decision graph (`docs/adrs/index.md`) are acyclic with no forward/dangling dependencies.

## Result: **PASS** — both graphs are acyclic; no task depends on a later wave; no ADR depends on an unrecorded decision.

## Task DAG

- **Wave layering is a topological order:** W0 → W1 → {W2 ∥ W3-after-W1} → W4 → W5 → W6. Every
  task's `Deps` point only to same-or-earlier tasks (verified per row). No back-edges.
- **Intra-wave dependencies** (made explicit after review-tasks): W2 backends depend on T-020;
  W3 lenses depend on T-046/T-019; W4 exporters depend on T-050; W5 verbs depend on T-060. These
  are forward-within-wave (subwave order), not cycles — the subwave notes encode the order.
- **Convergence point:** T-059 (composition factory) depends on the full gate-tier plugin set;
  T-060 (CLI) depends on T-059; both T-062a (MCP) and T-060 depend on T-059 (siblings) — **no**
  MCP→CLI edge (fixed in review-tasks). Acyclic.
- **No dangling deps:** every referenced task id (T-001..T-072, incl. the split ids T-025a/b,
  T-047s/c, T-054a/b, T-061a/b/c, T-062a/b/c, T-070a/b) is defined in the plan.

## ADR decision graph

- Re-checked the `docs/adrs/index.md` dependency graph: root ADR-001 → 002/003/004/005/007/011;
  002→009/012/015; 003→010/012/013/016; 005→006/010/012/014/015/016/017; 007→008/014; 008→013/014;
  006→013; 013→018; 014→016. **Acyclic** (every edge points to a recorded ADR; the two missing
  edges — 010→004, 012→003 — were added in review-adrs).
- No ADR depends on a decision that isn't recorded (the 6 cross-cutting ADRs 013–018 closed the
  prior gaps).

## Cycle scan

No cycles detected in either graph. The critical path (a single longest chain) is well-defined,
which is only possible in an acyclic graph.

## Disposition: PASS — graphs are valid DAGs; safe for wave-based parallel execution.
