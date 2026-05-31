# Evals — verifying surface meets its own documented standards

These are **eval test files in the project's own runner (Vitest)**, not a separate tool. They
check that code/docs conform to surface's standards — surface holding itself to the bar it
audits (NFR-OWNOUT-1). Run with the eval workspace once a root Vitest config exists; the
doc/config-checking evals already pass against the current repo.

## Core evals (always generated — present now)

| File | Checks | Status |
|---|---|---|
| `consistency.test.ts` | CLAUDE.md Key Commands ↔ package.json scripts; the `check` gate referenced by CLAUDE.md + CI | **runnable now** |
| `cross-doc.test.ts` | canonical terminology (`method`/`gatedForHuman`, no synonyms); ADR links resolve; Node≥22 consistency | **runnable now** |
| `structure.test.ts` | monorepo packages + `content/` exist; (pending) no deep cross-package imports | partial (skeleton for code rules) |
| `adherence.test.ts` | lint encodes no-`any`/no-floating-promises/no-`console`; (pending) method/evidence, named exports, zod boundaries, no TODOs | partial |
| `coverage.test.ts` | every story has a tagged acceptance test; map lists every story; (pending) feature→code | **runnable now** (code map pending) |

## Conditional evals (source doc exists → generate during build phase)

| Category | Source doc | What it will check |
|---|---|---|
| architecture conformance | `system-architecture.md` | components map to packages; `core` imports no leaf; StateStore is sole `.surface` writer |
| API contract | `api-contracts.md` | CLI exit codes + `--json` envelope; MCP tool schema snapshot; `findings.json`/SARIF shapes |
| security patterns | `security-review.md` | execa array-args (no `shell:true`); SSRF allow/deny defaults; no secrets in logs |
| accessibility | (surface's own output) | `findings.md`/CLI output: no color-only meaning, ANSI-degradable (NFR-OWNOUT-1) |
| performance budget | `plan.md` NFRs | `quick` preset p95 < 30s (NFR-PERF-1) |
| configuration validation | `dev-setup.md` | `.env.example` documents every required var; first-clone setup ≤ 5 steps |
| error-handling completeness | `coding-standards.md` | `Result<T, SurfaceError>` at boundaries; actionable messages (US-050) |

These are **pending** until the corresponding production code exists; they become enforceable in
the build phase (ADR-015 maps each to a release gate).
