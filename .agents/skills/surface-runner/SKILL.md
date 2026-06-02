---
name: surface-runner
description: Use when a user describes a Surface UI audit, capture, explain, backlog, validate, gate, status, next-step, or trace intent in natural language and needs it mapped to the correct surface CLI or MCP command with confirmation before action.
---

# Surface Runner

Map conversational requests onto the public Surface interfaces. The runner skill is a thin adapter over CLI and MCP; it is not a third protocol.

## Workflow

1. Identify the requested action, target, and identifiers from the user request.
2. Prefer MCP tools when the current agent environment exposes them. Use the POSIX CLI as the universal fallback.
3. Before executing, confirm the mapped action unless the user explicitly asked you to run it.
4. If a command needs a missing target or identifier, ask one concise clarifying question.

For deterministic mapping checks, run:

```bash
node .agents/skills/surface-runner/scripts/map_intent.mjs "<natural language request>"
```

## Mapping

| User intent | CLI command | MCP tool |
| --- | --- | --- |
| initialize or set up Surface | `surface init --json` | `surface_run` |
| status or progress | `surface status --json` | `surface_status` |
| run a closed-loop review | `surface run --<target-kind> <target> --json` | `surface_run` |
| next action or next task | `surface next --json` | `surface_next` |
| capture a page/component/DOM/screenshot | `surface capture --<target-kind> <target> --json` | `surface_capture` |
| audit or review a page/component/DOM/screenshot | `surface audit --<target-kind> <target> --json` | `surface_audit` |
| explain a finding | `surface explain <finding-id> --json` | `surface_explain` |
| show backlog or tracked findings | `surface backlog --json` | `surface_backlog` |
| validate a run | `surface validate --run <run-id> --json` | `surface_validate` |
| enforce the release gate or CI check | `surface gate --ci --json` | `surface_gate` |
| trace a finding or decision | `surface trace <id> --json` | `surface_trace` |

## Target Rules

- URLs beginning with `http://localhost`, `https://localhost`, `http://127.0.0.1`, or `https://127.0.0.1` use `--localhost`.
- Other `http://` or `https://` URLs use `--url`.
- Requests that say `DOM` or include HTML use `--dom`.
- Requests naming a route use `--route`.
- Requests naming a component use `--component`.
- Requests naming an image or screenshot file use `--screenshot`.

## Confirmation Shape

Confirm with the mapped intent, target, and exact command, for example:

```text
Mapped intent to surface audit for http://localhost:3000. Confirm before running: surface audit --localhost http://localhost:3000 --json
```

## Platform Notes

- Claude Code and Codex: use this skill directly; call MCP tools when exposed, otherwise run the CLI.
- Gemini or other agents: use the same mapping table as a prompt/command template and run the CLI when MCP is unavailable.
- CI and non-interactive environments: prefer `--json` and preserve exit codes `0` success, `1` runtime failure, and `2` usage error.
