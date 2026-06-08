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

## Browser QA

Surface includes agent-led browser QA powered by `agent-browser`. Use it when you want an agent to
run reviewed browser flows, explore a target within policy limits, collect redacted evidence, replay
candidate findings, and make release gates aware of browser-flow failures.

Run QA against the default local target:

```bash
surface qa --localhost --explore --task "complete checkout"
```

Run a reviewed flow file against a custom local port:

```bash
surface flow run surface-flows/checkout.yml --url http://localhost:5173
```

Apply an action policy to allow only the browser actions, origins, routes, fixture accounts, and
teardown contracts that are safe for the target:

```bash
surface qa --url https://app.example.com \
  --flows "surface-flows/*.yml" \
  --action-policy .surface/qa/action-policy.json
```

Use reviewed flow results in CI gates:

```bash
surface gate --ci --with-flows --url http://localhost:5173
```

Primary browser QA commands:

| Command | Purpose |
| --- | --- |
| `surface qa` | Run agent-led QA over a target, optional reviewed flows, and bounded exploration |
| `surface flow run <flow.yml>` | Run deterministic source-controlled browser QA flows |
| `surface evidence <ref>` | Read redacted browser QA evidence metadata |
| `surface replay <ref>` | Replay a browser QA finding or candidate |
| `surface report qa --run <qaRunId>` | Render QA reports as Markdown, JSON, or manifest output |
| `surface gate --with-flows` | Include verified browser QA flow results in the quality gate |

Safety defaults are intentionally strict:

- Action policies gate destructive or browser-mutating behavior, including payment, account, save,
  delete, upload, submit, and externally visible actions.
- Resolved secrets must not be passed through argv, logs, traces, serialized step payloads, or
  artifacts.
- Browser QA state and evidence are stored under `.surface/qa`.
- `--localhost` is a boolean shortcut for `http://localhost:3000`; use `--url` or `--target` for
  custom ports.

For deeper implementation details, see
[`docs/superpowers/specs/2026-06-08-browser-qa-orchestrator-design.md`](docs/superpowers/specs/2026-06-08-browser-qa-orchestrator-design.md)
and
[`docs/superpowers/plans/2026-06-08-browser-qa-orchestrator-implementation.md`](docs/superpowers/plans/2026-06-08-browser-qa-orchestrator-implementation.md).

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
