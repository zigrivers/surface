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

Homebrew installation is available through the `zigrivers/surface` tap:

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

If `npm link` reports that `surface` already exists because Homebrew or another global install owns
the binary, avoid overwriting that package-manager-owned file unless you intend to replace it. For a
one-off local smoke test, run the built CLI directly:

```bash
node packages/cli/dist/index.js --help
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

## Model Fallback

Surface audits stay measured-only by default. When you explicitly opt in, `surface audit` can reuse
authenticated subscription CLIs for judged synthesis without requiring project API keys.

Run a one-off audit through direct subscription providers:

```bash
surface audit --url http://localhost:5173 \
  --model-fallback direct \
  --model-channels claude,gemini \
  --model-depth 3
```

Let Surface try direct providers first and report compatible MMR fallback availability if direct
providers cannot run:

```bash
surface audit --url http://localhost:5173 --model-fallback auto
```

Screenshot egress is separate from model fallback consent. Binary screenshots are blocked for
subscription-backed providers in this release; use `--model-screenshots redacted-only` only when
you want redacted screenshot metadata considered alongside text artifacts.

Primary model fallback controls:

| Control | Purpose |
| --- | --- |
| `--model-fallback off\|direct\|mmr\|auto` | Select measured-only, direct CLI, MMR-only, or direct-then-MMR behavior |
| `--model-channel <id>` | Add a direct subscription channel; repeatable |
| `--model-channels <ids>` | Set comma-separated direct subscription channel order |
| `--model-depth <1-5>` | Control judged synthesis depth and reconciliation |
| `--model-screenshots blocked\|redacted-only` | Keep screenshots blocked or permit redacted screenshot metadata |
| `surface cleanup model-egress` | Remove persisted model egress artifacts from the Surface state directory |

BYO-key and local model providers still take precedence over subscription fallback when configured.
MMR is a fallback boundary only when a compatible Surface audit capability is available; the current
diff-shaped MMR review flow is reported as unavailable instead of receiving captured UI artifacts.

## Reliability and State Safety

Surface persists audit, gate, browser QA, and verdict records through a durable local state store.
Recent releases tighten those paths so state transitions are atomic, canonical durable fields are
validated before persistence, and CLI/MCP verdict writes produce the same canonical records.

Capture and browser automation failures are also sanitized before they reach machine-readable error
envelopes. Unsafe `agent-browser` command details are replaced with redacted context, keeping raw
capture output and command failure payloads out of logs and artifacts.

The `0.2.3` release also aligns live `agent-browser` computed-style artifacts with the visual
hierarchy and responsiveness lenses, honors requested capture configuration through `surface
capture`, and projects completed or failed pipeline runs through `surface status` and `surface
next`.

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
