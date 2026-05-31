<!-- scaffold:review-security v1 2026-05-31 -->

# Review Report: Security Review (`docs/security-review.md`)

> Reviewer: Claude (enhanced single-model; multi-model reserved for the implementation-plan
> gate). Audited against `docs/system-architecture.md`, `docs/api-contracts.md`, and the domain
> model.

## Readiness Status

**PASS** (after one classification addition). No unresolved P0/P1 — the planning phase
(`implementation-plan`) can proceed.

## Findings by Pass

| # | Sev | Pass | Finding | Resolution |
|---|---|---|---|---|
| S1 | P2 | Data classification completeness | the matrix covered Capture/Finding/secrets/state entities but omitted **`KnowledgeEntry`** | added a row (Public reference data; integrity matters — a poisoned entry could feed a judging prompt) |
| S2 | P3 | Auth-boundary alignment | confirm the "no auth" model agrees with api-contracts | **verified consistent** — both record no user auth; MCP is local stdio; only BYO/auth-state credentials (ADR-013) — no change |

## Pass coverage (audited)

- **OWASP Top 10:** all 10 mapped to surface; the two genuinely-primary categories (A03
  Injection — command + prompt; A10 SSRF) are identified with concrete controls. N/A categories
  (A01/A07) justified. ✓
- **Threat model / trust boundaries:** all 7 boundaries (target→capture, content→model,
  execa→CLIs, →model, →trackers, MCP, secrets-at-rest) have STRIDE threats + controls. ✓
- **Data classification:** now covers every domain entity class (Capture evidence, Findings,
  Secrets, Durable state, **KnowledgeEntry**). ✓
- **Secrets management:** all env vars / API keys / tracker tokens covered; no DB credentials
  (no DB); never-logged + git-ignored + user-rotated. ✓
- **Dependency audit:** scope = all deps (pnpm audit + Renovate + frozen lockfile + provenance);
  watch-items called out. ✓
- **Auth boundaries vs API contracts:** consistent (no auth; local single-user). ✓

## Fix Log

| Finding | Change | New issues |
|---|---|---|
| S1 | added `KnowledgeEntry` (Public) to the data-classification matrix | None |
| S2 | none — verified consistency | None |

## Downstream Readiness

- **Gate:** Pass — `implementation-plan` can proceed.
- **Handoff (security acceptance criteria for the build phase):** (1) SSRF secure-by-default
  blocklist (metadata/link-local/`file://`/private-ranges); (2) judging-prompt injection
  hardening with adversarial fixtures; (3) execa array-args + a lint rule against `shell:true`;
  (4) secret-scan git hook + CI. These are implementation tasks, not planning blockers.
