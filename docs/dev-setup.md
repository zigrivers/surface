<!-- scaffold:dev-env-setup v1 2026-05-31 -->

# surface — Development Setup

> Local development guide for the `surface` monorepo (pnpm + Turborepo, TypeScript/ESM,
> Node ≥ 22.13.0, pinned to the CI patch release and modern pnpm/Vite/Vitest floor). surface is a **CLI + MCP server** — there is no web dev server and **no
> database**; "dev mode" means watch-mode compilation plus a locally linked `surface` binary.
> The canonical command list lives in `CLAUDE.md` → **Key Commands**; this file explains
> the workflow behind it.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | **≥ 22.13.0** (LTS) | runtime + ESM; matches `engines` and the CI patch release |
| pnpm | **11.x** | workspace package manager (pinned via `packageManager`) |
| Git | any recent | version control + Beads hooks |

Enable pnpm through Corepack (ships with Node) so the pinned version is used:

```bash
corepack enable
corepack prepare pnpm@11.0.0 --activate
```

Verify: `node -v` (≥ 22.13.0) and `pnpm -v` (11.x).

## First-time setup (clone → running, ≤ 5 steps)

```bash
git clone <repo-url> surface && cd surface   # 1. clone
corepack enable                              # 2. activate pnpm
pnpm install                                 # 3. install all workspace deps
cp .env.example .env                         # 4. (optional) add model keys for judged findings
pnpm run check                               # 5. verify: format + lint + typecheck + test
```

No `.env` is required: surface runs **measured-only** with zero keys (NFR-DATA-1). Add
keys only to enable judged / multi-model findings.

## Daily development

```bash
pnpm dev            # watch-mode build across all packages (turbo watch build)
pnpm test:watch     # run package test watchers
pnpm run check      # the full local gate, identical to CI
```

`pnpm dev` rebuilds every changed package on save. Run it in one terminal and the linked
`surface` CLI (below) in another to exercise changes immediately.

### Running the CLI locally

Once `packages/cli` exists and has been built, expose the `surface` binary globally:

```bash
pnpm --filter @zigrivers/surface build
pnpm --filter @zigrivers/surface exec npm link    # or: cd packages/cli && pnpm link --global
surface --help                              # now resolves to your local build
```

During iteration, skip the link and run straight from source with tsx:

```bash
pnpm --filter @zigrivers/surface exec tsx src/index.ts audit http://localhost:3000
```

To remove the global link later: `pnpm --filter @zigrivers/surface exec npm unlink -g surface`.

### Running the MCP server locally

```bash
pnpm --filter @zigrivers/surface-mcp build
pnpm --filter @zigrivers/surface-mcp exec node dist/index.js   # speaks MCP over stdio
```

Point your MCP client (e.g. Claude Code) at that command to test the tool surface.

### Debug output

surface writes diagnostics to **stderr** (stdout stays clean for `--json` piping). Enable them with either:

```bash
surface audit … --verbose      # flag
SURFACE_DEBUG=1 surface audit … # env var (mirrors the flag)
SURFACE_LOG_LEVEL=debug surface audit …   # pino level control
```

## Common tasks

| Task | Command |
|---|---|
| Install / refresh deps | `pnpm install` |
| Watch-build everything | `pnpm dev` |
| Build everything once | `pnpm build` |
| Run all tests | `pnpm test` |
| Watch tests | `pnpm test:watch` |
| Test one package | `pnpm --filter @zigrivers/surface-core test` |
| Lint | `pnpm lint` |
| Type-check | `pnpm typecheck` |
| Format (write) | `pnpm format` |
| Format (check only) | `pnpm format:check` |
| Full local gate (CI mirror) | `pnpm run check` |
| Clean caches & build output | `pnpm clean` |

## Database

**Not applicable.** surface persists per-project state as files under `.surface/`
(written atomically + locked, US-041) in the *user's* project — never a database, and
never inside this repo. There is no `db-setup` / `db-reset` step. See
`docs/project-structure.md` → "Runtime state".

## Platform notes (Mac / Linux / WSL)

- **macOS**: install Node via the official installer, `nvm`, or `brew install node`. Corepack handles pnpm.
- **Linux**: use your distro's Node ≥ 22.13.0 packages or `nvm`. Nothing else is platform-specific — there are no native build steps in dev (Playwright browsers are fetched on demand by the `capture` package when first used).
- **WSL2**: work inside the Linux filesystem (`~/…`), **not** `/mnt/c/…` — file-watching (`turbo watch`, Vitest) is slow and unreliable on the Windows-mounted FS. Otherwise identical to Linux.

## Verification checklist

After setup, confirm each of these passes:

- [ ] `node -v` reports ≥ 22.13.0 and `pnpm -v` reports 11.x
- [ ] `pnpm install` completes with no errors
- [ ] `pnpm run check` is green (format, lint, typecheck, test, build smoke)
- [ ] `pnpm dev` starts watch-mode and rebuilds on a saved change
- [ ] `pnpm test:watch` re-runs on a saved test change
- [ ] (once `packages/cli` is built) `surface --help` resolves to your local build

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Unsupported engine` / wrong Node | Node < 22.13.0 active | `nvm install 22.13.0 && nvm use 22.13.0` or reinstall Node ≥ 22.13.0 |
| `pnpm: command not found` | Corepack not enabled | `corepack enable && corepack prepare pnpm@11.0.0 --activate` |
| `turbo: command not found` | deps not installed | `pnpm install` (turbo is a root devDependency) |
| `pnpm dev` does nothing | no package defines a `build` task yet | expected on the skeleton; tasks appear as packages land |
| `surface: command not found` after link | CLI not built, or link not run | `pnpm --filter @zigrivers/surface build` then re-link |
| File changes not picked up (WSL) | working under `/mnt/c` | move the repo into the WSL Linux home |
| Stale build / mystery failures | cached artifacts | `pnpm clean` then rebuild |

## For AI agents

- The **single source of truth** for commands is `CLAUDE.md` → Key Commands. Use those exact
  invocations; do not guess flags.
- Before claiming a change works, run `pnpm run check` and show the output (CLAUDE.md
  principle #4, "Prove It"). `pnpm run check` is byte-for-byte what CI runs.
- Follow TDD (`docs/tdd.md`): write the failing test first. Co-locate `*.test.ts`.
- Never write secrets into `.env.example`; it is committed documentation. Real keys go in
  `.env` (gitignored).
- surface must not transmit captured UI to any model/service unless a key is explicitly
  configured (NFR-DATA-1) — keep measured-only the keyless default.
