<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-013: Safe-by-default security & data-handling boundary

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001, ADR-003, ADR-006, ADR-008
- **Related:** NFR-SEC-1, NFR-DATA-1, FR-CAP-8, FR-CAP-11; Capture & Project State domains
- **Added by:** review-adrs (consensus P1 — Codex, Gemini, Claude)

## Context

Captures (DOM, screenshots, source) may contain PII or proprietary code. surface must be safe
by default: read-only against the target, **no source/code exfiltration**, captures local-only
and ephemeral, with redaction available. It also accepts injected session state (FR-CAP-8) and
runs an MCP server (ADR-008). The "authentication" category is N/A in the user-account sense,
but the **security/data boundary** is a first-class architecture decision — initially left
implicit, now recorded.

## Decision

A single safe-by-default boundary, enforced structurally:

1. **No default exfiltration (NFR-DATA-1, release-blocking).** Nothing leaves the machine
   except (a) content the user explicitly sends to a configured model (ADR-006) and (b) issue
   exports the user requests (ADR-016). The keyless default is measured-only (ADR-005).
2. **Capture retention.** Captures are **ephemeral per run** under `.surface/captures/` unless
   the user opts to retain; a documented purge default applies (see ADR-003 retention classes).
3. **Redaction (FR-CAP-11).** Configurable PII/secret redaction applies to captures **and**
   exports, with visible markers; full evidence is retained local-only.
4. **Auth-state injection (FR-CAP-8)** is a *capture input*, not system auth: a provided
   storage-state is injected before navigation; an invalid/expired state fails with a non-zero
   exit and never captures the login page as the target (CAP-I3).
5. **Live-capture safety:** domain **allowlists** (agent-browser) bound what can be navigated;
   network interception is **opt-in**.
6. **MCP server posture (v1):** stdio/local transport, no remote listener and no auth in v1
   (recorded deliberately, not omitted); revisit if a networked transport is added.
7. **Read-only against target source** — surface reads, never builds or mutates the project.

A security/privacy review (OWASP-aligned) is a release gate; any default-on transmission of
captured content to a third party is a blocker.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **Safe-by-default boundary as an ADR (chosen)** | the privacy guarantee is explicit, testable, and release-gated | requires redaction + retention plumbing |
| **Leave to specs/convention** | less upfront | the one guarantee surface can't afford to get wrong would rest on convention (rejected by Gemini/Codex P1) |
| **Opt-in privacy (telemetry/transmit by default)** | richer signals | violates NFR-DATA-1 outright |

## Consequences

- **Positive:** privacy is structural (measured-only default + redaction + ephemeral captures);
  the MCP posture and allowlists are recorded, not assumed.
- **Negative / accepted:** redaction and retention/purge add implementation surface.
- **Risk / mitigation:** accidental exfiltration → release-blocking security review + the
  measured-only structural default (ADR-005); auth-state mishandling → CAP-I3 verification.
