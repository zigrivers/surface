<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-001: Build surface in TypeScript on Node.js (LTS ≥ 22), ESM-only

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** — (root decision)
- **Related:** ADR-002, ADR-007, ADR-008, ADR-011; `tech-stack.md` §2

## Context

surface needs a language/runtime for a CLI + MCP server whose entire required ecosystem (MCP
SDK, Playwright, Axe-core, Lighthouse, octokit, retext) is JS/Node-native, and whose **primary
maintainer is an AI agent** (vision: agent-first). Scaffold — surface's sibling tool — is also
npm/Node. The PRD (§11) defers the implementation language to this phase.

## Decision

**TypeScript (strict) on Node.js LTS ≥ 22, ESM-only**, with `node:`-protocol builtins and no
default exports in library packages (see `coding-standards.md`).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **TypeScript / Node ≥22 (chosen)** | native to every required dep; best-represented stack in model training (agent-maintainability); Scaffold parity; mature MCP/Playwright tooling | Node startup slower than Bun; ESM/CJS interop care |
| **Bun** | fast startup, built-in bundler/test | Playwright + native modules less battle-tested; diverges from Scaffold; thinner training data |
| **Deno** | secure-by-default, built-in TS | weaker fit with npm-centric MCP/Playwright; smaller ecosystem |
| **Go / Rust** | single static binary, fast | would re-implement or FFI the entire JS grounding/MCP ecosystem; far less agent training data |

## Consequences

- **Positive:** maximal library availability and agent-edit reliability; strict TS + zod gives
  sound types at boundaries; ESM aligns with modern Node and the toolchain (tsup/vitest).
- **Negative / accepted:** CLI startup latency must be managed by lazy-loading heavy deps
  (Lighthouse) — tracked as a perf concern (NFR-PERF-1); ESM-only excludes a few CJS-only deps.
- **Risk / mitigation:** Node ESM edge cases → enforce `verbatimModuleSyntax`,
  `moduleResolution: NodeNext`; pin Node ≥22 in `engines`. Bun retained only as an optional
  build path for the Homebrew single-binary (ADR-011), not as the runtime.

## Team / maintenance

TS/Node is the most-represented stack in model training data — the decisive factor when agents
are primary maintainers. Human contributors find TS the lowest-friction OSS on-ramp.
