<!-- scaffold:project-structure v1 2026-05-30 -->

# surface — Project Structure

> pnpm + Turborepo monorepo (tech-stack §1,3). Layout optimizes for **parallel agent work**:
> small packages with clean published entry points so two agents rarely touch the same file.
> `content/` mirrors Scaffold's prompt+knowledge model (idea.md appendix B); `.surface/` is
> per-project runtime state (created at `surface init`, not committed by surface itself).

## Top-level layout

```
surface/
├── packages/
│   ├── core/            # pipeline engine, Finding/Task schema (zod), scoring/MMR, state, identity
│   ├── cli/             # commander app; bin entry `surface`; presentation layer (NFR-OWNOUT-1)
│   ├── mcp/             # MCP server exposing surface tools (FR-IF-2)
│   ├── capture/         # backends: playwright/, agent-browser/ (execa), static/screenshot; auto-detect
│   ├── grounding/       # axe-core + lighthouse adapters; eslint-jsx-a11y static pass
│   ├── adapters/
│   │   ├── react/       # @babel/parser + ts-estree introspection
│   │   ├── vue/         # @vue/compiler-sfc
│   │   ├── svelte/      # svelte/compiler
│   │   └── agnostic/    # parse5 / happy-dom
│   ├── knowledge/       # KB loader + entries (md + yaml frontmatter)
│   └── reporters/       # md / json / sarif (node-sarif-builder) / github (octokit)
├── content/
│   ├── pipeline/        # meta-prompts per evaluation step, grouped by phase
│   ├── knowledge/       # best-practice entries (## Summary / ## Deep Guidance)
│   └── methodology/     # presets + app-type overlays (yaml)
├── fixtures/            # seeded-defect apps (react/vue/svelte/html) for tests + SC-6 benchmark
├── docs/                # this pipeline's artifacts (vision, plan, specs, reviews, ...)
├── .changeset/          # release/versioning (build phase)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json · eslint.config.mjs · .prettierrc.json · .editorconfig
└── package.json         # root (private, workspace scripts)
```

## Boundary rules (parallel-agent safety)
- Packages communicate **only** through published entry points (`@zigrivers/<pkg>`); no deep
  imports. This lets an agent work in `adapters/vue` while another works in `reporters`
  without merge conflicts.
- `core` owns the canonical schema + vocabulary; everything else depends on `core`, never the
  reverse. Adapters and reporters are leaf packages (no cross-leaf deps).
- New framework support = new `adapters/<fw>` package implementing the adapter interface from
  `core` — additive, conflict-free (the PRD's "framework-flexible via adapters").
- New capture backend = new module under `capture/` behind the capture interface.

## Where things go
| Kind | Location |
|---|---|
| Finding/Task types, scoring, state, identity | `packages/core/src` |
| A new CLI verb | `packages/cli/src/commands/<verb>.ts` |
| A new MCP tool | `packages/mcp/src/tools/<tool>.ts` |
| A new lens | `packages/core/src/lenses/<lens>.ts` (+ KB entry) |
| A best-practice KB entry | `content/knowledge/<category>/<slug>.md` |
| A preset / overlay | `content/methodology/{presets,overlays}/<name>.yml` |
| A test | co-located `*.test.ts`; fixtures in `fixtures/` |

## Runtime state (not surface's own repo — created in the user's project)
`.surface/`: `state.json`, `config.yml`, `findings/`, `captures/`, `decisions`, `generated/`
— parallel to `.scaffold/`. Written atomically + locked (US-041).
