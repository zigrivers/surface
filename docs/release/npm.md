# npm Release Setup

## Package Names

The public npm package names are:

| Package | Directory |
| --- | --- |
| `@zigrivers/surface` | `packages/cli` |
| `@zigrivers/surface-core` | `packages/core` |
| `@zigrivers/surface-mcp` | `packages/mcp` |
| `@zigrivers/surface-grounding` | `packages/grounding` |
| `@zigrivers/surface-adapter-agnostic` | `packages/adapters/agnostic` |
| `@zigrivers/surface-adapter-react` | `packages/adapters/react` |
| `@zigrivers/surface-adapter-svelte` | `packages/adapters/svelte` |
| `@zigrivers/surface-adapter-vue` | `packages/adapters/vue` |

The unscoped `surface` package and the `@surface/*` scope are already used by other npm projects, so this repository publishes under the `@zigrivers` scope.

## Trusted Publishing

Configure npm trusted publishing for each public package:

- repository owner/name: `zigrivers/surface`
- workflow file: `.github/workflows/release.yml`
- environment: `npm-release`
- package repository URL: `git+https://github.com/zigrivers/surface.git`

The release workflow is manual to minimize GitHub Actions minutes. It publishes only when `publish` is set to `true`.

npm trusted publishing currently requires a GitHub-hosted runner, npm CLI 11.5.1 or newer, and Node 22.14.0 or newer. The release workflow uses Node 22.14.0 and upgrades npm before publishing pnpm-built tarballs with `npm publish --provenance`.

## Local Verification

```bash
pnpm run check
pnpm run release:verify
```

`release:verify` packs each public package, checks that `README.md` and `LICENSE` are included, installs the CLI tarball in a temporary directory, and runs `surface --help`.
