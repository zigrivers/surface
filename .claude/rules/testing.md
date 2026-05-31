---
description: TDD + the non-negotiable test types for surface (Vitest)
globs: ["packages/**/*.test.ts", "tests/**/*.ts"]
---

- **TDD:** write the failing test first, watch it fail, make it pass, refactor. No production code
  without a test that demanded it. A bugfix starts with a reproducing test.
- Co-locate `*.test.ts`; Vitest is the runner; fixtures in `fixtures/`.
- **Non-negotiable (release-gating) test types** (ADR-015):
  - Determinism: every measured producer — same input ⇒ byte-identical findings (SC-4).
  - Identity: unchanged defect keeps id; drift → `identity-broken`, never silent `resolved`.
  - Method-integrity: no judged-as-measured; measured ⇒ tool evidence.
  - Degradation: no-model→measured-only; no-backend→static; oversized→reported truncation.
  - Concurrency: overlapping runs don't corrupt `.surface/state.json`.
  - Contract: CLI exit/JSON, MCP schema snapshot, SARIF v2.1.0 validation.
- **Mock:** model inference, external tracker APIs, the agent-browser CLI process, the clock.
  **Don't mock:** framework compilers, zod schemas, scoring math, the file-state layer, Axe/Lighthouse
  assertion logic.
- Source of truth: `docs/tdd.md`, ADR-015.
