<!-- scaffold:adrs v1 2026-05-31 -->

# ADR-003: Persist project state as files under `.surface/` (atomic writes + advisory lock), not a database

- **Status:** Accepted
- **Date:** 2026-05-31
- **Depends on:** ADR-001
- **Related:** ADR-010; `tech-stack.md` §11; Project State domain; FR-IF-5, US-041, PRD §7
- **Supersedes:** none

## Context

surface must persist pipeline progress, the finding-identity registry, findings, captures,
baselines/waivers, and a decisions log per project (FR-IF-5). The closed loop requires
**concurrency-safe, resumable** state (US-041, §7). This is also the de-facto "database
decision" — and, by extension, the ORM decision.

## Decision

**File-based `.surface/` state** — `state.json`, `findings/` (JSON/JSONL), `captures/`,
`config.yml`, baseline/waiver files — written with **`write-file-atomic`** (temp + rename) and
guarded by a single **`proper-lockfile`** advisory lock. **No database; therefore no ORM.**
`runHistory` is bounded/rotated to keep per-run write size constant (Project State domain
note). A schema `version` field gates explicit migration (PS-I7).

**Retention classes (review: Codex P1 — durable vs sensitive-transient).** `.surface/` holds
two distinct kinds of data, handled differently (security details in ADR-013):

| Class | Examples | Default | Git | Lifetime |
|---|---|---|---|---|
| **Durable** | `state.json`, `findings/`, `config.yml`, baselines/waivers, decisions log | persisted | safe to commit (inspectable/diffable — the value below) | until the user removes |
| **Ephemeral evidence** | `captures/` (DOM, screenshots, computed styles) | **ephemeral per run** | **git-ignored** (may hold PII/source — NFR-DATA-1) | purged per the retention default unless the user opts to retain |

The "inspectable/diffable/committable" property below applies to the **durable** class;
captures are sensitive transient evidence and are *not* committed by default.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **File-based + atomic + lock (chosen)** | human-inspectable & git-diffable (auditability — a surface value); no native bindings → clean npx/brew; matches Scaffold's `.scaffold/`; atomic+lock answers the race/interrupt sad path | weaker at very large finding volumes; manual concurrency primitives |
| **Embedded SQLite (better-sqlite3 + Drizzle)** | robust at scale; transactional | native bindings complicate npx/Homebrew; state stops being inspectable/diffable; ORM weight |
| **In-memory only** | trivial | no resumability, no closed loop across runs — violates FR-LOOP |

## Consequences

- **Positive:** users can read/diff/commit their `.surface/` state; distribution stays
  binding-free; the design directly satisfies US-041 and §7 resumability.
- **Negative / accepted:** large finding sets cost more in file I/O than a DB would; concurrency
  is advisory-lock-based, not MVCC.
- **Risk / mitigation:** the state layer sits **behind an interface** so embedded SQLite can
  drop in later if finding volume or identity-matching cost outgrows files (explicit revisit
  trigger). PS-I7 migration rule prevents the version-skew misread that degraded scaffold's own
  state file.

## Team / maintenance

File I/O + a lockfile is low-complexity and high agent-compatibility. The inspectability is a
maintenance asset: a broken run can be debugged by reading `.surface/` directly.
