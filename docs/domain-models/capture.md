<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Capture

> **Role:** core. **Responsibility:** turn a `Target` into an honest `Capture` — a set of
> observed artifacts plus an explicit record of what could **not** be observed. Capture
> never evaluates; it only observes and reports degradation.
> **Source FRs:** FR-CAP-1..11, FR-INT-1 (browser backends), NFR-PORT-1, NFR-DATA-1,
> NFR-SEC-1. **Stories:** US-001..005.

## Ubiquitous language (this context)

`Target`, `Capture`, `CaptureArtifact`, `CaptureBackend`, `AuthState`, `RedactionRule`,
`DegradationReport`, `Viewport`, `Theme`. (Defined canonically in [index.md](./index.md).)

## Entities & value objects

```typescript
// Value object — what the user pointed surface at. Self-validating: exactly one source.
interface Target {
  readonly kind: "url" | "localhost" | "route" | "screenshot" | "component" | "dom";
  readonly ref: string;               // url, path, or file location for `kind`
  readonly viewport?: Viewport;       // requested breakpoint (FR-PIPE-9, NFR-BROWSER-1)
  readonly theme?: Theme;             // "light" | "dark" (FR-CAP-10 dual-theme)
}

// Value object — a requested viewport in the documented matrix (NFR-BROWSER-1).
interface Viewport { readonly width: number; readonly height: number; readonly label: "mobile" | "tablet" | "desktop"; }

type Theme = "light" | "dark";

// Value object — the selected observation mechanism (NFR-PORT-1).
type CaptureBackend = "playwright" | "agent-browser" | "static";

// Value object — injected session to reach authenticated routes (FR-CAP-8).
// Validated as Playwright storage-state shape on construction; invalid => construction fails.
interface AuthState { readonly source: "file" | "env"; readonly format: "storage-state"; readonly ref: string; }

// Value object — a configured redaction rule (FR-CAP-11, NFR-DATA-1).
interface RedactionRule { readonly pattern: string; readonly appliesTo: ("dom" | "screenshot" | "export")[]; }

// Internal entity — one observed output. Not referenced outside the Capture aggregate.
interface CaptureArtifact {
  readonly id: CaptureArtifactId;
  readonly type: "screenshot" | "dom-snapshot" | "accessibility-tree" | "computed-styles";
  readonly path: string;              // under .surface/captures/<captureId>/
  readonly redacted: boolean;         // true if a RedactionRule altered this artifact
}

// Value object — the honest record of what was NOT observed (FR-CAP-6, §7).
interface DegradationReport {
  readonly skippedArtifacts: CaptureArtifact["type"][];
  readonly skippedReason: string;     // e.g. "no browser backend installed"
  readonly affectedLenses: string[];  // lens ids that cannot run measured on this capture
}

// AGGREGATE ROOT — the result of observing a Target once.
interface Capture {
  readonly id: CaptureId;                 // identity; immutable; never reused
  readonly target: Target;
  readonly backend: CaptureBackend;       // which backend actually ran (recorded, US-001)
  readonly artifacts: CaptureArtifact[];  // internal entities — accessed only via the root
  readonly authUsed: boolean;             // whether an AuthState was injected
  readonly degradation?: DegradationReport;
  readonly capturedAt: Timestamp;
  readonly status: CaptureStatus;
}

type CaptureStatus = "requested" | "completed" | "degraded" | "auth-failed" | "unreachable";
```

## State machine

```
requested ──► completed        (all requested artifacts produced)
requested ──► degraded         (some artifacts produced; DegradationReport set — FR-CAP-6)
requested ──► auth-failed       (AuthState invalid/expired — never falls through to "completed")
requested ──► unreachable       (target not reachable; no live DOM)
```

Invalid transitions (e.g. `completed → requested`) are rejected, not ignored. `auth-failed`
and `unreachable` are **terminal** — they never silently become `completed`.

## Aggregate boundary

`Capture` is the aggregate root; `CaptureArtifact`s are internal entities created and owned
by it. They share a consistency boundary because an artifact set must be written atomically
with the capture metadata and `DegradationReport`: a half-written capture (artifacts on disk
but no recorded backend/degradation) would let Evaluation mistake a degraded capture for a
complete one. They change together; nothing outside holds a reference to a `CaptureArtifact`.
`AuthState`, `RedactionRule`, `Target` are value objects (no identity, immutable).

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| CAP-I1 | `capture.artifacts.length >= 1` for `status ∈ {completed, degraded}` | after observation | reject; a capture with zero artifacts is `unreachable`, not `completed` |
| CAP-I2 | `status === "degraded"` ⟺ `degradation` is set and non-empty | always | reject inconsistent state |
| CAP-I3 | `authUsed === true` ⟹ navigation occurred **after** session injection | during capture | abort → `auth-failed`; never capture the login page as the target (US-002) |
| CAP-I4 | `backend === "static"` ⟹ `artifacts` excludes `accessibility-tree` from live DOM | always | record those types in `degradation.skippedArtifacts` |
| CAP-I5 | every `CaptureArtifact` matched by a `RedactionRule` has `redacted === true` | on write | reject export of unredacted matched content (NFR-DATA-1) |
| CAP-I6 | no artifact leaves `.surface/captures/` except via explicit user action | always | block transmission (NFR-DATA-1, NFR-SEC-1) — release blocker if defaulted on |

## Domain events

| Event | Trigger | Payload (minimum) | Consumers |
|---|---|---|---|
| `CaptureRequested` | a `Target` is submitted for observation | `{ captureId, target, requestedAt }` | Project State (progress) |
| `CaptureCompleted` | all requested artifacts produced | `{ captureId, backend, artifactTypes }` | Evaluation |
| `CaptureDegraded` | some artifacts could not be produced | `{ captureId, backend, degradation }` | Evaluation, Reporting (surfaces what wasn't checked) |
| `CaptureAuthFailed` | injected `AuthState` invalid/expired | `{ captureId, reason }` | Interfaces (non-zero exit, US-002) |

## Backend selection policy (domain service)

`selectBackend(available, target): CaptureBackend` — a stateless rule (FR-CAP-3, NFR-PORT-1):
1. If neither Playwright nor agent-browser is installed → `static` (+ `DegradationReport`).
2. If exactly one is installed → that one.
3. If both are installed → choose **deterministically** (documented preference: agent-browser
   for its stable `@e` element refs, FR-CAP-7) and **record** the choice on the `Capture`
   (US-001: "records which backend was used"). The choice must be reproducible — same inputs,
   same backend (feeds NFR-DET-1 downstream).

## Bounded-context interface (what Capture exposes / consumes)

- **Exposes (published language):** `Capture` read model + its `DegradationReport`. Downstream
  (Evaluation) reads artifacts and degradation; it never asks Capture to re-observe.
- **Consumes:** `SurfaceConfig` (redaction rules, viewport matrix, allowlist) and `AuthState`
  from Project State / Interfaces. `CaptureBackend` availability from the environment.
- **Commands handled:** `surface capture <target>` (US-001), `--auth-state` injection (US-002),
  static/context ingestion (US-003).

## Cross-context flow (sequence)

```
Interfaces           Capture                         Evaluation        Project State
   │  capture(target)   │                               │                 │
   ├───────────────────►│ selectBackend()               │                 │
   │                    ├── observe artifacts ──┐        │                 │
   │                    │  apply RedactionRules  │        │                 │
   │                    │◄───────────────────────┘        │                 │
   │                    ├── CaptureCompleted/Degraded ───────────────────► (progress recorded)
   │                    ├───────────────────────────────►│ (reads Capture) │
```

`CaptureAuthFailed` short-circuits this flow with a non-zero exit at the Interfaces edge and
**no** Evaluation hand-off (US-002).
