<!-- scaffold:operations v1 2026-05-31 -->

# surface — Operations Runbook (release & distribution)

> surface is a **locally-run OSS CLI + MCP tool — there is no hosted service** (ADR-008,
> ADR-011; PRD §10 marks availability/uptime/RTO/RPO/horizontal-scaling **N/A**). "Operations"
> here is therefore **release & distribution ops**, not production-server ops. Local dev is in
> `docs/dev-setup.md` (not redefined here); the base CI (`check` job) is in `docs/git-workflow.md`
> and is **extended**, not redefined, below.

## Hosted-service items — explicitly N/A (with rationale)

| Classic ops concern | Status | Why |
|---|---|---|
| Deployment topology / health-check endpoints | **N/A** | nothing is hosted; the CLI runs on the user's machine; the MCP server is local stdio (ADR-008) |
| Uptime SLA, RTO, RPO | **N/A** | no service to be down (PRD §10, explicit) |
| Horizontal scaling / capacity planning | **N/A** | "scale" is bounded by routes-per-run (NFR-SCALE-1), not users |
| Centralized log aggregation | **N/A** | logs are local (pino → stderr, ADR-018); no telemetry by default |
| Secret rotation (server) | **N/A**; user-side keys covered | surface holds no secrets; users rotate their own BYO model keys / tracker tokens in their `.env` |

What remains and matters: **shipping good releases and rolling back bad ones.**

## Deployment pipeline (= release pipeline; extends the base CI)

Stages (build → test → publish → verify → rollback-ready), extending the `check` CI job:

1. **Build** — `pnpm build` (turbo); optional Bun/esbuild single-binary for the Homebrew formula (ADR-001/011).
2. **Test** — the full release-gating set (ADR-015): `pnpm run check` + capture/grounding matrix + CLI/MCP contract + SARIF + perf gate. (Base `lint`/`test` are **not** redefined — see git-workflow.)
3. **Version** — Changesets in `.changeset/` (build-phase tooling) drive semver; the MCP tool schema bumps **major** on a breaking change (NFR-MCP-1).
4. **Publish** — `npm publish` (provenance on) + update the **Homebrew tap** formula (wraps the Node CLI or the single binary).
5. **Verify** — post-publish smoke: `npx surface@latest --version` and `surface audit` on a fixture app produce a valid `findings.json`; MCP server lists tools with the expected schema version.
6. **Rollback-ready** — see below.

## Operational scenarios

### Scenario: Release
Cut from green `main`; tag `vX.Y.Z`; publish to npm; bump the brew formula; run the verify smoke;
announce in the changelog. Trigger to **halt**: verify smoke fails → do not bump brew; `npm
deprecate` the just-published version with a pointer to the prior good version.

### Scenario: Rollback (a bad release shipped)
- **Trigger conditions:** post-publish smoke fails; a P0 regression is reported (e.g. a measured
  finding becomes nondeterministic — NFR-DET-1; CLI exit-code contract breaks — NFR-CLI-1; MCP
  schema breaks consumers — NFR-MCP-1; or surface transmits captures without config — NFR-DATA-1,
  the highest-severity trigger).
- **Procedure:** (1) `npm deprecate surface@X.Y.Z "regression — use X.Y.(Z-1)"` (never unpublish a
  >24h public version); (2) revert the Homebrew formula to the prior good version; (3) `npx
  surface@X.Y.(Z-1)` is the immediate user workaround; (4) ship a patch `X.Y.(Z+1)` with a
  regression test that reproduces the failure first (TDD, ADR-015).
- **"Health check" analog:** the verify smoke (step 5) is the gate; there is no live endpoint.

### Scenario: Security incident / data-handling regression
- **Highest severity:** any default-on transmission of captured content without explicit user
  config (NFR-DATA-1) or a source-exfiltration path (NFR-SEC-1) — both release blockers.
- **Response:** treat as a P0 rollback (above) immediately; publish a `SECURITY` advisory;
  coordinate disclosure via `SECURITY.md` (build-phase artifact). Redaction (ADR-013) and the
  measured-only keyless default (ADR-005) are the standing mitigations.

### Scenario: Dependency / CVE response
- Renovate/Dependabot PRs (ADR-018 watch-items: agent-browser, MCP SDK, Playwright). On a CVE in
  a capture/grounding dep, re-run the capture matrix before release; pin Playwright + browser
  together (tech-stack §18).

## "Monitoring" (right-sized for an OSS CLI)

No server metrics. The signals surface *does* track:

| Signal | Where | Threshold / action |
|---|---|---|
| Release smoke (`--version`, fixture audit) | CI post-publish | any failure → halt release / rollback |
| Perf gate (`quick` p95) | CI (NFR-PERF-1) | >30s warns, >45s fails the perf gate |
| Self-grounding judged FP rate (SC-5) | `surface` self-report | ≥15% triggers a trust review (NFR-TRUST-1) |
| Knowledge-gap signals (NFR-OBS-1) | local run logs / KB audit | feed KB freshness backlog |
| Issue/CVE inflow | GitHub issues / Dependabot | triage per severity; P0 → rollback path |

Telemetry is **opt-in only** (ADR-018) — there is no default phone-home, so "monitoring" of end
users is deliberately absent (privacy posture, NFR-DATA-1).

## Incident response (summary)

Severity P0 (trust/privacy/contract regression) → immediate rollback + advisory + reproduce-then-
fix. P1 (functional regression) → patch release on the normal pipeline. The durable record is the
Beads issue + the (local, inspectable) `.surface/` state of any failing run a reporter shares.
