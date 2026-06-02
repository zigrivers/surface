# Surface

Surface is a local-first CLI and MCP server for auditing built, running web UIs. It combines measured checks, deterministic local state, and optional model-assisted review so agents can find UI issues, explain them, and verify fixes without sending captured UI data anywhere by default.

## Install

```bash
npm install --global @zigrivers/surface
surface --help
```

Run without installing:

```bash
npx @zigrivers/surface --help
```

Homebrew support is planned for the initial release through the `zigrivers/surface` tap:

```bash
brew tap zigrivers/surface
brew install surface
```

## Local Development

```bash
corepack enable
pnpm install
pnpm run check
```

Build and link the CLI locally:

```bash
pnpm --filter @zigrivers/surface build
pnpm --filter @zigrivers/surface exec npm link
surface --help
```

## Packages

| Package | Purpose |
| --- | --- |
| `@zigrivers/surface` | CLI package; publishes the `surface` binary |
| `@zigrivers/surface-core` | Core schemas, state, scoring, and orchestration |
| `@zigrivers/surface-mcp` | MCP server adapter |
| `@zigrivers/surface-grounding` | Measured grounding tools |
| `@zigrivers/surface-adapter-agnostic` | Framework-agnostic HTML adapter |
| `@zigrivers/surface-adapter-react` | React adapter |
| `@zigrivers/surface-adapter-svelte` | Svelte adapter |
| `@zigrivers/surface-adapter-vue` | Vue adapter |

## Release Checks

Release preparation is local-first to avoid routine GitHub Actions usage:

```bash
pnpm run check
pnpm run release:verify
```

The GitHub release workflow is manual and intended only for release publication, primarily to support npm trusted publishing and provenance.

## License

MIT. See [LICENSE](LICENSE).

