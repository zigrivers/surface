You are doing TECHNOLOGY-STACK RESEARCH for an open-source tool called `surface` — a CLI + MCP server that audits the *built, running* UI of web apps (measured + judged findings → agent-executable, re-verifiable fix backlog). Full PRD is below.

FIXED CONSTRAINTS (already decided — do NOT re-litigate; recommend WITHIN these):
- Language/runtime: **TypeScript on Node.js** (LTS).
- License: **MIT** (must stay compatible with Apache-2.0 deps like agent-browser).
- Distribution: **npm + npx + Homebrew tap**.
- Repo: **monorepo with workspaces/packages** (e.g. core / cli / mcp / adapters/*).
- Capture backends already chosen: **Playwright** and **agent-browser** (external Rust CLI). Grounding: **Axe-core + Lighthouse**. Agent interface: **MCP server**.

Recommend a SPECIFIC, current choice (not a menu) for each category below, with a one-line why, the top alternative rejected, AI-compatibility note (training-data availability / convention strength), and any gotcha. Categories:
1. CLI framework/argument parser (e.g. commander / yargs / oclif / clipanion / citty)
2. MCP server SDK (TypeScript)
3. Monorepo tooling (package manager + task runner: pnpm workspaces / turborepo / nx / bun workspaces)
4. Build/bundle for libs+CLI (tsup / unbuild / esbuild / tsc)
5. Test runner (vitest / node:test / jest)
6. Lint/format (eslint+prettier / biome)
7. Schema/validation for findings + config (zod / valibot / arktype)
8. Config + knowledge-base file format (yaml parser, frontmatter)
9. Accessibility/perf grounding integration: how to invoke Axe-core + Lighthouse from Node (libraries vs CLI)
10. Framework adapters: how to statically introspect React/Next, Vue, Svelte components (parsers/compilers: @babel/parser, @typescript-eslint/parser, vue/compiler-sfc, svelte/compiler) + framework-agnostic DOM/HTML parsing
11. Multi-model invocation (judged findings): call Codex/Gemini/Claude — via their CLIs, an SDK, or the `mmr` tool?
12. Reading-level/content analysis library
13. Anything critical the PRD needs that isn't listed.

Be specific and current (2026). Flag any choice where the ecosystem is immature. Quality over noise.

## Output Format — ONLY a JSON array, no prose:
[
  {"category":"<category>","choice":"<specific lib/tool + approx version>","why":"<one line>","alternativeRejected":"<lib + why not>","aiCompat":"<note>","gotcha":"<note or 'none'>"}
]

## PRD (docs/plan.md) follows:
---
