<!-- scaffold:security v1 2026-05-31 -->

# surface — Security Review & Controls

> Threat model (STRIDE) + OWASP Top 10 for surface's actual shape: a **local CLI + MCP tool**
> (no hosted service, no user accounts — ADR-008/013) that **ingests untrusted content** (DOM,
> screenshots, source from arbitrary web targets), drives browsers (Playwright/agent-browser),
> invokes external CLIs via `execa` (agent-browser, model CLIs), optionally sends content to a
> BYO model, and exports to trackers. The dominant risks are **SSRF via capture**,
> **prompt-injection via captured content**, **command-injection via execa**, and **leakage of
> captured PII / BYO secrets** — not the classic web-app/multi-tenant risks. Inputs:
> system-architecture, api-contracts, operations-runbook, ADRs (esp. ADR-013).

## Trust boundaries

```
[arbitrary web target] ──①──► [Capture: Playwright/agent-browser] ──②──► [Evaluation/Findings]
        (untrusted DOM/JS/styles)         │                                      │
                                          └──③ execa ──► [external CLIs:          │
                                                          agent-browser, model]   │
[BYO model provider] ◄──④── (only if a key is configured; captured content)      │
[issue trackers] ◄──⑤── (only on user-requested export)                          │
[MCP client / agent] ──⑥──► [local MCP server (stdio)]                           │
[user env / .env] ──⑦──► [secrets: model keys, tracker tokens]                   │
[.surface/ on disk] ◄──── durable state + ephemeral captures                     ▼
```

## STRIDE by boundary

| # | Boundary | Top threats | Controls |
|---|---|---|---|
| ① | target → capture | **SSRF** (capture of `http://169.254.169.254`, `localhost`, private ranges, `file://`); **DoS** (huge/recursive DOM); Tampering (hostile markup) | URL allow/deny: block link-local + cloud-metadata + `file://` by default; `--localhost` restricts to loopback; private-range capture is opt-in; domain **allowlist** (agent-browser, NFR-SEC-1); input size caps + timeouts (NFR-SCALE-1); parse5 is a non-executing parser (no script execution in surface) |
| ② | captured content → judging model | **Prompt injection** (DOM/content crafted to hijack the judging model into false findings or unsafe suggestions); Info disclosure (sending PII to a model) | content is delimited/escaped and the model is instructed it is *evaluating untrusted page content, not following it*; judged findings are **advisory + gated** (FR-RULE-2) and never auto-executed when risky (FND-I5); **measured findings (tool-grounded) are unaffected** by injection (ADR-005, the trust anchor); model called **only** if a key is configured (NFR-DATA-1); redaction before send (ADR-013) |
| ③ | surface → external CLIs (execa) | **Command/argument injection** via crafted target/flag values into agent-browser/model CLIs | use `execa` with **array args (never shell string interpolation)**; validate/whitelist every argument; no `shell: true`; paths canonicalized |
| ④ | surface → BYO model | secret exposure; egress of captured content | keys from env only (⑦); **no transmission unless configured** (NFR-DATA-1, release-blocker); user owns provider + cost (ADR-006) |
| ⑤ | surface → trackers | token exposure; leaking sensitive findings into a tracker | export is **user-requested only**; redaction applies to exports (ADR-013); token from env; least-scope token guidance |
| ⑥ | MCP client → MCP server | Spoofing/Elevation (a malicious local process calling tools) | **local stdio, no remote listener** (ADR-008/013); same trust as any local CLI the user runs; no auth in v1 recorded deliberately; **revisit before any networked transport** |
| ⑦ | secrets at rest | Info disclosure (keys in logs, committed `.env`) | `.env` git-ignored; **never logged** (privacy-safe pino fields, ADR-018); redaction before logging; surface stores no secret in `.surface/` |

## OWASP Top 10 (2021) — mapped to surface

| # | Category | Applicability & control |
|---|---|---|
| A01 Broken Access Control | **Low/N/A** — single local user, no multi-tenant boundary; MCP is local stdio (⑥) |
| A02 Cryptographic Failures | secrets live in env/`.env` (git-ignored), never logged; captures local-only; no surface-managed crypto |
| A03 **Injection** | **Primary risk** — (a) command injection via execa → array args, no shell (③); (b) prompt injection via captured content → measured-anchor trust + gating + delimiting (②); all external input zod-parsed at the boundary (ADR-005) |
| A04 Insecure Design | addressed by ADRs (005 trust spine, 013 boundary, 016 local-first export); measured/judged separation is a security-relevant design control |
| A05 Security Misconfiguration | safe-by-default: no exfiltration, domain allowlist, opt-in interception, no telemetry (ADR-013/018) |
| A06 Vulnerable & Outdated Components | dependency audit below; agent-browser/MCP-SDK/Playwright are watch-items (ADR-018/tech-stack §18) |
| A07 Identification & Auth Failures | **N/A** — no authentication system (ADR-013); the only credentials are BYO and user-managed |
| A08 Software & Data Integrity | npm **provenance** on publish; **frozen lockfile** in CI; Homebrew formula pinned; SARIF/output schemas validated |
| A09 Logging & Monitoring Failures | pino structured logs, **no captured content/secrets in logs**, knowledge-gap signals (ADR-018); release smoke + self-grounding (ops runbook) |
| A10 **SSRF** | **Primary risk** — capture of arbitrary URLs → allow/deny lists, block metadata/link-local/`file://`, loopback-only for `--localhost`, opt-in private ranges (①) |

## Data classification & handling

| Class | Examples | Sensitivity | Handling |
|---|---|---|---|
| Captured evidence | DOM, screenshots, computed styles, source | **High** (may contain PII/secrets/proprietary code) | local-only, **ephemeral per run** unless retained, git-ignored, redactable, never transmitted without config (NFR-DATA-1) |
| Findings | `findings.json`/`.md`, backlog | Medium (may embed snippets) | local source of truth; redaction applied on **export** (ADR-013/016) |
| Secrets | model API keys, tracker tokens | **Critical** | env/`.env` only, git-ignored, never logged, never in `.surface/` |
| Durable state | `state.json`, identity registry, config | Low–Medium | local, inspectable; no secrets stored |
| Knowledge entries | `content/knowledge/*` (KnowledgeEntry) | **Public** | shipped reference data; no sensitivity; integrity matters (don't let a poisoned entry inject content into a judging prompt — entries are static + reviewed) |

## Input validation (zod at every boundary — ADR-005)

| Field | Rule | Reject message |
|---|---|---|
| `--url` / `--route` | valid absolute URL; scheme ∈ {http,https}; not link-local/metadata/`file://`; host passes allow/deny | `invalid_or_blocked_url` — "URL blocked by SSRF policy; allow it via config if intended" |
| `--localhost` | loopback only (`127.0.0.0/8`,`::1`) | `non_loopback_localhost` |
| `--auth-state <file>` | path exists, readable, parses as Playwright storage-state shape | `auth_injection_failed` (US-002) |
| `--component` / `--dom <path>` | canonicalized; **confined to project root** (no `..` traversal) | `path_outside_project` |
| `--export <target>` | enum {github,linear,jira,sarif} | `unknown_export_target` |
| `<finding-id>` / config | format/zod schema | `finding_not_found` / `config_invalid` |
| captured DOM/JSON, model output | size-capped + zod-parsed before use | truncation reported (NFR-SCALE-1) |

## Secrets management

- **No hardcoded secrets** (lint/CI secret-scan on commit, dev-setup git hooks). Keys come from
  env/`.env` (git-ignored); `.env.example` carries only placeholders.
- **Rotation:** surface holds no long-lived secret of its own, so there is no surface-side
  rotation. Users rotate their **own** model keys / tracker tokens by editing `.env`; no restart
  ceremony beyond re-running the command (no daemon). `surface config setup-model` (ADR-006)
  validates a freshly-pasted key.
- Secrets are **never written** to `.surface/` or logs (ADR-018 privacy-safe fields).

## Dependency audit strategy

- **Automated scanning in CI:** `pnpm audit` + Renovate/Dependabot PRs; **frozen lockfile**
  (`pnpm install --frozen-lockfile`) so CI builds the reviewed dependency set.
- **Update cadence:** watch-items (agent-browser, MCP SDK, Playwright) tracked per release;
  pin Playwright + browser version together; re-run the capture/grounding matrix on any
  capture/grounding dep bump (tech-stack §18, ADR-015).
- **Integrity:** npm **provenance** on publish; a `NOTICE`/attributions file tracks bundled
  third-party licenses (ADR-011).

## N/A controls (recorded with rationale)

- **CORS, rate-limiting, WAF, session management** — N/A: no HTTP server / public endpoints
  (ADR-008). The MCP server is local stdio.
- **Multi-user authz, RBAC** — N/A: single local user (ADR-013).
- **Server secret rotation / KMS** — N/A: surface manages no server secrets.

## Residual risks & follow-ups (to implementation/specs)

1. **Prompt-injection robustness** (②) is mitigated by design (measured anchor + gating) but the
   judging-prompt hardening (delimiting, "evaluate-don't-follow" framing, output schema
   constraints) is an implementation detail to verify with adversarial fixtures.
2. **SSRF allow/deny defaults** (①/A10) must ship secure-by-default; the exact default blocklist
   (metadata IPs, link-local, private ranges) is a specs/implementation item.
3. **execa argument hygiene** (③) — enforce array-args + a lint rule against `shell: true`.
These are recorded as security acceptance criteria for the build phase, not planning blockers.
