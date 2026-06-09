# Subscription-Backed Model Fallback Design

## Status

Approved for implementation planning after MMR review `mmr-4a59a4cb8502`.

## Context

Surface v0.1.1 can capture useful UI artifacts, but automated judged findings currently depend on
a configured model path. In this environment, Surface produced no findings from its own synthesis
step because no model provider was wired for the CLI run; manual review of captured screenshots
and accessibility artifacts found the issues instead.

The repository already has the core concepts needed for this direction:

- `packages/core/src/model-provider.ts` resolves optional BYO API-key and local endpoint model
  providers.
- `packages/core/src/reconciliation.ts` reconciles multi-channel judged findings and records
  unavailable channels.
- `docs/adrs/ADR-006-byo-key-model-access.md` accepts optional CLI-based multi-model
  reconciliation.
- `docs/tech-stack.md` names installed `codex`, `claude`, `gemini`, and optional `mmr` as the
  intended CLI model layer.

The current CLI audit path still captures and persists prototype fixture findings rather than
executing the full lens registry with model-provider orchestration. This design treats
subscription fallback as part of that missing orchestration, not as a separate shortcut.

## Goals

- Let users reuse existing Claude Code, Codex, Gemini, Grok, Antigravity, and compatible MMR
  subscriptions for Surface judged findings.
- Preserve Surface's local-only default: installing or authenticating a CLI is not consent to
  send captured UI artifacts to it.
- Prefer direct CLI providers for normal judged synthesis, with MMR as a conditional fallback
  when direct orchestration is unavailable and MMR exposes a compatible audit capability.
- Support text artifacts and screenshot redaction metadata, with screenshots requiring a separate
  opt-in. Binary redacted image delivery is deferred until a vision-capable provider contract is
  designed and tested.
- Record enough run metadata to audit which external channels saw which classes of artifacts
  without storing prompt text, raw model text beyond normalized findings, screenshots, or secrets.

## Non-Goals

- Surface will not bundle, proxy, or bill for inference.
- Surface will not silently enable subscription-backed model egress from CLI detection alone.
- Surface will not require MMR as a hard runtime dependency.
- Surface will not fake UI captures as code diffs to force-fit `mmr review`.
- Surface will not treat judged findings as gate-failing mandates; measured-wins and human-gate
  rules remain unchanged.

## User Decisions

- Config lives in both user and project scopes.
- Project config takes precedence for project defaults and may restrict egress for a repository.
- User/global config remains a security boundary: a project can restrict but never expand a user's
  global hard egress limits.
- Direct CLI providers are preferred first; MMR is fallback only when its capability probe confirms
  a compatible UI-audit input/output contract.
- Depth 1-3 uses one selected direct provider, trying the next provider on availability or execution
  failure. Depth 4-5 runs multiple direct providers and reconciles.
- Screenshot support is included as verified redaction metadata only. Raw and redacted binary
  screenshots are never sent to third-party subscription CLIs in this revision.
- Screenshot egress requires a second explicit opt-in beyond enabling model fallback.
- Run metadata records channel, artifact classes, redaction status, and run id, but not prompt
  contents or secrets.

## Architecture

Add a subscription-backed provider layer beside the existing BYO-key/local provider layer. The
implementation should first wire normal CLI audit execution through capture, lens selection, model
availability, lens evaluation, scoring, reconciliation, backlog synthesis, and state persistence.
Subscription fallback then plugs into the same model-provider boundary.

Provider selection order:

1. BYO API key or local endpoint, when configured.
2. Direct subscription CLIs: Claude and Gemini initially; Codex, Grok, and Antigravity remain
   host-injected/MMR channels until vetted no-shell direct contracts exist.
3. Compatible MMR audit fallback when direct providers are unavailable or cannot handle the
   requested audit.
4. Measured-only degradation.

Fallback mode gates are exact:

- `off`: no direct subscription or MMR fallback providers are invoked; explicitly configured
  BYO/local providers remain governed by provider-agnostic egress policy.
- `direct`: direct subscription providers only; MMR is not probed.
- `mmr`: direct providers are skipped; MMR is probed only when egress policy permits `mmr`.
- `auto`: direct providers run first; compatible MMR is tried only after direct failure when
  `fallbackToMmr` is true and policy permits `mmr`.

BYO/local providers take precedence. If a BYO key or local endpoint is configured, subscription
fallback is not used for that run unless a future explicit `fallbackOnPrimaryFailure` setting is
added and reviewed. This keeps user cost and egress expectations predictable.

`model.fallback.mode = "off"` disables direct subscription and MMR fallback. It does not disable an
explicitly configured BYO API-key or local model provider; that explicit CLI/env or user/global
configuration is consent for the provider's own text egress unless hard user/project policy blocks
it. Project-only BYO/local configuration is not consent.

At depth 1-3, Surface walks the ordered direct-provider list and uses the first available channel
that can complete the request. Availability failures, timeout, non-zero exit, and parse failures
fall through to the next allowed provider. A successful provider that returns zero findings is a
valid result and does not trigger the next provider. If no direct provider succeeds and policy
allows compatible MMR fallback, Surface tries MMR; otherwise the run degrades to measured-only
judged coverage unavailable.

At depth 4-5, Surface runs all allowed available direct channels. Unavailable or failed channels
are recorded in reconciliation input. If at least one direct channel succeeds, Surface reconciles
those results and does not invoke MMR. If no direct channel succeeds and policy allows compatible
MMR fallback, Surface tries MMR; otherwise the run degrades to measured-only judged coverage
unavailable.

## Config Resolution

Config resolution has two tracks.

Default values resolve in the existing order:

1. CLI flags for the current run.
2. Environment variables.
3. Project config.
4. User config.
5. Defaults.

Hard egress restrictions resolve by maximum restrictiveness across user/global and project policy,
then CLI/env can only narrow further. Default user/global `model.egressPolicy.mode: off` is a hard
security boundary against project-only egress enablement. Project config may restrict egress but
cannot enable it by itself. CLI/env may provide one-run consent, or user/global config may provide
an explicit allow, where no hard user or project restriction blocks it; neither can override a hard
`off`, `blocked`, or denylisted-channel policy.

Examples:

- User config has `model.egressPolicy.mode: off`; project config has fallback `mode: auto`.
  Effective mode is `off`.
- Project config alone sets fallback `mode: auto` and egress `mode: text`; user/global config has
  no explicit allow. Effective mode remains `off`.
- User config allows fallback; project config has `model.egressPolicy.screenshots: blocked`.
  Effective screenshots policy is `blocked`, even with `--model-screenshots=redacted-only`.
- Project config alone sets `model.egressPolicy.screenshots: redacted-only`. Effective screenshots
  policy remains `blocked` unless CLI/env or explicit user/global screenshot consent opts in.
- User config allows fallback and project config has no hard restriction. `surface audit
  --model-fallback=auto` enables fallback for one run.
- Project config sets fallback `mode: auto`; the user passes only `--model-screenshots=redacted-only` or
  `SURFACE_MODEL_SCREENSHOTS=redacted-only`. Screenshot metadata may be eligible, but subscription
  fallback remains disabled because screenshot consent is not fallback/model-provider consent.
- Project config sets fallback default `providerOrder: [codex, gemini]`; CLI passes
  `--model-channels claude`. Effective runtime order is `[claude]` only if hard policy allows
  `claude`.
- If `SURFACE_MODEL_CHANNELS=claude,codex`, it replaces the provider order for that run rather than
  appending to the project list.

Arrays such as `providerOrder` and `allowedChannels` replace lower-precedence arrays. They do not
append. `providerOrder` controls priority; `allowedChannels` is a filter. The effective direct
channel list is:

1. provider order from the highest-precedence default layer that sets it,
2. filtered by `allowedChannels` from the highest-precedence default layer that sets it,
3. filtered again by hard user/project egress policy,
4. filtered by runtime capability probes.

## Components

### ModelFallbackConfig

Extends Surface config with subscription fallback defaults:

- `mode`: `off`, `direct`, `mmr`, or `auto`.
- `providerOrder`: ordered built-in direct subscription CLI channel ids: `claude`, `codex`, and
  `gemini`. It does not accept BYO/local ids, `grok`, `antigravity`, or `mmr`.
- `allowedChannels`: optional allowlist.
- `timeoutMs`: per-channel timeout.
- `depth`: judged model depth from 1 to 5. Depth 1-3 uses first-success direct channel retry;
  depth 4-5 uses multi-channel reconciliation.
- `fallbackToMmr`: whether direct failures can invoke compatible MMR fallback.

Defaults keep model fallback off.

### ModelEgressPolicy

Adds provider-agnostic model egress policy applied before any model provider, including BYO API
keys, local endpoints, direct subscription CLIs, and MMR:

- `mode`: hard maximum of `off`, `text`, or `text-and-screenshots`.
- `screenshots`: `blocked` or `redacted-only`.
- `allowedChannels`: hard channel allowlist.
- `deniedChannels`: hard channel denylist.

Screenshot opt-in only enables verified screenshot redaction metadata. Third-party subscription
CLIs and remote BYO providers never receive raw or redacted binary screenshots in this revision.
A local endpoint may receive raw screenshots only if a future explicit local-only raw screenshot
policy is designed and reviewed; this design does not include that mode.

### ModelChannelMetadata

Widens the current provider metadata model instead of forcing subscription channels into the
existing `anthropic`, `openai`, and `local` enum. Use a canonical channel type across provider
responses, availability records, ledger entries, and reconciliation channels:

- API/local providers: `anthropic`, `openai`, `local`.
- Subscription/model channels: `claude`, `codex`, `gemini`, `grok`, `antigravity`; built-in direct
  fallback initially implements `claude` and `gemini`, while `codex` resolves unavailable until a
  no-shell completion mode exists.
- Fallback coordinator: `mmr`.

The public `ModelProvider` interface can remain the lens boundary, but any provider that can receive
model egress must expose canonical `sourceKind: "api" | "local" | "subscription-cli" | "mmr"` and
`channelId` metadata before invocation. Missing metadata fails closed with a sanitized degradation
and no artifact egress.

### SubscriptionCliDiscovery

Detects installed and authenticated CLIs without sending captured artifacts. It returns structured
availability records such as installed, auth ok, auth unavailable, not installed, unsupported
capability, and check timed out. Checks must be non-interactive and bounded by timeouts.

Initial channel support is capability-declared, not assumed:

| Channel | Discovery/Auth Probe | Invocation Requirement | Unsupported When |
| --- | --- | --- | --- |
| `claude` | `claude --version` plus sandboxed fixed schema probe using `claude --print --output-format json --input-format text --disallowedTools "*"`; help is diagnostic-only | Must match an explicit supported semver capability mapping for JSON output, no tools, no shell, no host/workspace or persistent session writes, no memory, neutral cwd, safe prompt transport | unknown version or probe cannot prove every required control |
| `codex` | Host-injected or MMR-review channel until Codex exposes a no-shell/no-tools direct completion mode | Not a built-in direct fallback channel | current `codex exec` remains an agent surface with model-generated shell capability |
| `gemini` | `NO_BROWSER=true gemini --version` plus sandboxed fixed schema probe using `gemini --prompt "Read the JSON request appended on stdin and answer according to that request." --output-format json --approval-mode plan --sandbox` with the fixed probe JSON request on stdin; help is diagnostic-only | Must match an explicit supported semver capability mapping for non-interactive JSON output, no tools, no shell, no host/workspace or persistent session writes, no memory, and bounded timeout. Runtime audit prompts use the same fixed bridge prompt with the sanitized JSON request on stdin. | unknown version, browser/interactive auth, or probe cannot prove every required control |
| `grok` | Host-injected or MMR-review channel until a sandboxed direct contract exists | Not a built-in direct fallback channel | direct CLI contract unavailable |
| `antigravity` | Host-injected or MMR-review channel until a sandboxed direct contract exists | Not a built-in direct fallback channel | direct CLI contract unavailable |
| `mmr` | `mmr config test` plus audit capability probe | Must support UI-audit artifact input and normalized finding JSON | only `mmr review` diff input is available |

A channel listed in `providerOrder` but missing a compatible capability is recorded as unavailable
and does not fail `surface audit`.

### SubscriptionModelProvider

Implements the normalized model boundary for one direct CLI channel. It converts a `ModelRequest`
into a subprocess invocation, handles prompt delivery, normalizes text output, validates JSON where
a judged lens requires structured output, and maps failures to Surface errors.

Each direct provider must run in pure-completion mode:

- no tool execution,
- no shell command execution,
- no writes to the workspace, real HOME/XDG paths, credential mirrors, or persistent session state,
- no project cwd access,
- no broad inherited environment,
- no workspace-specific memory,
- bounded timeout.

Run providers from a temporary empty cwd with a minimal allowlisted environment. The only allowed
environment variables are those required for the target CLI's authentication and non-interactive
mode. HOME/XDG locations, including `XDG_RUNTIME_DIR`, must point to isolated temp trees or be unset
when unused. If a channel cannot provide these controls, mark it unavailable.

Executable discovery must either use a pre-resolved executable path outside the workspace or a
sanitized `PATH`. Existing `PATH` entries are canonicalized before overlap checks; missing or
unreadable entries are rejected without crashing; workspace, relative, and writable project paths
are excluded. Authentication state is copied into isolated temp HOME/XDG directories with strict
permissions rather than exposing the real HOME/XDG path or using bind mounts. Surface-owned temp
roots are cleaned after each run and pruned asynchronously or by deferred maintenance using age,
prefix, and PID/lock-file checks so active concurrent runs are not deleted.
Signal cleanup handlers must run best-effort cleanup and then preserve normal termination by
re-sending the signal or exiting with the conventional signal code.
Direct subscription completion is available only when an enforceable filesystem isolation mechanism
is active, such as a container, separate UID, OS sandbox, or read-only mount setup that denies the
provider access to the real HOME and workspace while exposing only the copied auth mirror and
isolated temp/cache tree. Same-UID permissions and pre/post snapshots are not sufficient. Channels
without that boundary are unavailable. Channels that require credential/session writes are also
unavailable. Isolated per-run temp/cache directories may be mutated by the provider, but they must
not overlap the workspace or real HOME/XDG paths and must be cleaned afterward. Any chmod, content
mutation, rename, create, or delete in the credential mirror, or any sandbox escape into
workspace/real HOME paths, fails closed. If auth-mirror cleanup cannot remove credential copies and
directories, Surface records a sanitized provider failure/degradation instead of a successful egress
ledger entry. Making undeleted copies unreadable is best-effort damage control only and does not
allow success.

Large prompts and artifacts must not be placed directly in argv. The delivery contract is:

- Prefer stdin for text prompts when the channel supports it.
- Otherwise write prompt payloads to a unique temp directory created with mode `0700`.
- Create temp prompt files with mode `0600`.
- Pass temp paths as array arguments without shell interpolation.
- Never put binary screenshot content in argv.
- Remove temp files and directories after the subprocess exits.
- When wiping prompt files, overwrite the full original byte range with zero bytes and call `fsync`
  or `fdatasync` on the file descriptor before unlinking. Expected unsupported sync errors such as
  `EINVAL` or `ENOTSUP` may be tolerated only when overwrite and unlink succeed.
- Treat prompt-file wiping as best-effort damage control only: copy-on-write filesystems and SSD
  wear-leveling can retain previous blocks even after overwrite, sync, and unlink succeed.
- If prompt-file cleanup cannot be verified, return `model_request_failed` with
  `details.reason = "prompt-cleanup-failed"`, suppress the normal success ledger entry, and
  preserve only sanitized cleanup diagnostics.

### MultiChannelJudgedRunner

Coordinates judged lens execution for direct subscription providers. It implements the depth-based
selection algorithm from the Architecture section. Multi-channel results are converted into the
existing reconciliation input shape, including unavailable-channel entries.

### MmrFallbackProvider

Invokes MMR only when policy allows, direct providers cannot run, and MMR exposes a compatible
Surface audit capability. The required MMR capability is:

- capability probe command that does not send captured artifacts,
- non-diff input mode for DOM excerpts, accessibility tree excerpts, computed-style summaries, and
  screenshot redaction metadata,
- normalized JSON output that can be mapped to Surface `FindingDraft`s or `Finding`s,
- channel participation metadata,
- bounded timeout and non-interactive auth handling.

Current `mmr review` is code-review and diff-shaped. It is not a compatible Surface UI-audit
fallback by itself. Until MMR exposes the capability above, Surface records MMR as unavailable with
reason `unsupported-capability` and degrades according to the normal audit rules.

MMR, direct CLIs, and remote BYO providers must not receive raw or redacted binary screenshots in
this revision.

### ScreenshotRedaction

Screenshot metadata egress requires verified artifact redaction metadata. A screenshot is eligible
only if the capture pipeline marks the artifact redacted and the redaction metadata states which
classes were masked. Text artifacts also require active masking before model egress. The initial
acceptable redaction strategy is:

- Use DOM/source metadata to identify sensitive inputs, secrets, tokens, emails, phone numbers,
  auth/session text, and user-provided free text.
- Map sensitive DOM nodes to screenshot bounding boxes when layout metadata is available.
- Apply opaque masks before model egress.
- Apply structural text masks to DOM, accessibility tree, and computed-style excerpts before model
  egress.
- Mark screenshots as eligible only when masks were applied or the redaction metadata explicitly
  proves no sensitive regions were present.
- If bounding boxes are missing or uncertain, treat the screenshot as not safely redacted.

If no verified screenshot redaction metadata exists, providers receive text artifacts only and the
ledger records `screenshot_blocked_no_redacted_artifact` or
`screenshot_blocked_no_verified_redaction`.

### ModelEgressLedger

Persists run-level model egress metadata under `.surface/state.json` or the run record:

- run id
- selected provider mode
- channel ids attempted and completed
- unavailable channels and reasons
- artifact classes sent: DOM, accessibility tree, computed styles, screenshot-redaction-metadata
- whether sent artifacts were redacted
- whether screenshot opt-in was active
- provider source kind
- compatibility/probe versions where available

It never stores prompt text, raw model text beyond normalized findings, raw screenshots, API keys,
subscription credentials, auth probe output, or unredacted artifact excerpts.

## Data Flow

The subscription-backed model path is supported by `surface audit`. The legacy `surface run`
pipeline does not execute the audit-runner model egress, redaction, direct-provider, or MMR fallback
path; if model egress would be enabled for `surface run`, the CLI fails closed and points users to
`surface audit`.

For `surface audit`:

1. Resolve default config and hard egress policy.
2. Capture the target locally.
3. Select lenses and run all selected measured or `requiresModel === false` lenses locally.
4. Stop model resolution if no selected lens requires a model.
5. If BYO-key or local model is configured, use it and apply the provider-agnostic egress policy.
6. If no BYO/local model is configured, resolve subscription providers lazily only when explicitly
   enabled and not blocked by hard policy.
7. Discover direct CLI channels and their auth/capability state only through that lazy resolver.
8. Apply artifact policy. Text artifacts are eligible when model egress mode allows text.
   Screenshot redaction metadata is eligible only when screenshot policy allows redacted screenshot
   metadata and verified redaction metadata exists.
9. Run judged lenses that require a model through one or more model channels using the depth
   algorithm.
10. Reconcile multi-channel judged results at depth 4-5.
11. Synthesize the backlog with measured-wins rules.
12. Persist findings, backlog, tracked findings, degradation metadata, and the egress ledger.
13. Emit CLI/MCP output that discloses judged coverage source and degradation.

After the real audit path is wired, the seeded fixture-only audit path must be removed or limited
to explicit tests. A no-consent audit should produce measured-only output from real measured lenses,
not prototype fixture findings.

## Consent And Privacy

Default behavior remains measured-only. Surface may auto-detect subscription CLIs and report that
they are available, but it must not invoke them with captured artifacts unless model egress is
explicitly enabled by config, env, or CLI flag and not blocked by hard user/project policy.

Screenshot egress is separate from text model consent. Enabling text-based model egress does not
authorize screenshot metadata transmission. In this revision providers receive only screenshot
redaction metadata, not binary screenshots, and only when current run policy allows redacted
screenshot metadata and verified redaction metadata is available.

Prompts must continue to treat DOM, screenshots, accessibility trees, and computed styles as
untrusted page content. Provider adapters must use array-argument subprocess execution and avoid
shell interpolation for prompt text and artifact paths. Provider adapters must also disable tools,
shell execution, file writes, project cwd access, and inherited secrets, or mark the channel
unavailable.

## CLI And Config UX

Suggested run flags:

- `--model-fallback=off|direct|mmr|auto`
- `--model-channels <channels>` comma-separated, with repeatable `--model-channel <channel>` alias
- `--model-depth=1..5`
- `--model-screenshots=blocked|redacted-only`, with bare `--model-screenshots` as shorthand for
  `redacted-only`

Suggested env vars:

- `SURFACE_MODEL_FALLBACK=off|direct|mmr|auto`
- `SURFACE_MODEL_CHANNELS=claude,codex,gemini`
- `SURFACE_MODEL_DEPTH=3`
- `SURFACE_MODEL_SCREENSHOTS=redacted-only`

`SURFACE_MODEL_SCREENSHOTS=redacted-only` mirrors `--model-screenshots=redacted-only`: it sets
runtime screenshot policy to `redacted-only` and runtime model egress mode to
`text-and-screenshots` unless hard policy blocks that expansion. It does not consent to direct
subscription or MMR fallback by itself.

Suggested config shape:

```yaml
model:
  provider: anthropic
  model: claude-sonnet
  fallback:
    mode: auto
    providerOrder:
      - claude
      - codex
      - gemini
      - grok
      - antigravity
    allowedChannels:
      - claude
      - codex
      - gemini
    fallbackToMmr: true
    depth: 3
    timeoutMs: 120000
  egressPolicy:
    mode: text
    screenshots: blocked
    deniedChannels:
      - antigravity
```

Existing BYO environment variables keep their current meaning. When a BYO key or local endpoint is
present, fallback settings are discovered and reported but not used unless a future explicit primary
failure fallback policy is added.

Project config can force `mode: off`, `screenshots: blocked`, or deny channels through
`model.egressPolicy`. User config can also force those restrictions globally. CLI/env can narrow
these policies for one run, but cannot expand past the hard user/project boundary.

## Error Handling

On `surface audit`, model fallback failures are degradations, not hard failures, as long as
measured findings still run. Degradation records should distinguish:

- no model egress consent
- hard egress policy blocked model use
- channel not installed
- channel auth unavailable
- channel unsupported capability
- channel timed out
- channel returned non-zero
- channel output parse failed
- channel sandbox controls unavailable
- prompt delivery failed
- temp prompt cleanup failed
- screenshots blocked by policy
- `screenshot_blocked_no_redacted_artifact`
- `screenshot_blocked_no_verified_redaction`
- MMR unavailable
- MMR lacks a compatible audit capability

Commands whose whole purpose is judged output may treat `model_unavailable` as exit 1, matching the
existing error-contract distinction.

## Testing

Use fake process runners in normal tests. Do not call real Claude, Codex, Gemini, Grok,
Antigravity, or MMR CLIs in unit or CI tests.

Unit coverage:

- Config defaults resolve by CLI > env > project > user > defaults.
- Hard egress policy uses maximum restrictiveness across user and project.
- CLI/env cannot override user or project hard egress blocks.
- `SURFACE_MODEL_CHANNELS`, `--model-channels`, and `--model-channel` replace provider order for the run and are then
  filtered by hard policy.
- BYO present means subscription path is not taken even when fallback mode is `auto`.
- Screenshot opt-in is required separately from fallback mode.
- Redacted screenshots are required for third-party model egress.
- Discovery maps installed, auth failure, timeout, unsupported capability, and missing executable
  to structured availability.
- Channel in provider order but lacking compatible capability is treated as unavailable and does
  not fail the run.
- Direct CLI provider handles success, parse failure, timeout, non-zero exit, and sandbox controls
  unavailable.
- Fake process runner assertions verify no-tools/no-write/read-only flags, neutral cwd, minimal
  environment, safe prompt delivery, and temp cleanup.
- Egress ledger records artifact classes and channels without prompt contents.
- Persisted state and run records do not contain prompts, raw model text beyond normalized
  findings, secrets, raw screenshots, or unredacted artifact excerpts.

Integration coverage:

- Depth 3 uses the first successful direct channel and tries the next channel on availability or
  execution failure.
- Depth 5 uses multiple direct channels and reconciles.
- Failed direct channels degrade to remaining available channels.
- No direct channel available tries compatible MMR when policy allows and capability probe passes.
- MMR without compatible audit capability is recorded unavailable and does not fail `audit`.
- No fallback consent yields measured-only output with judged coverage unavailable.
- No consent after the real audit path is wired does not use prototype fixture findings.

CLI coverage:

- `surface audit --model-fallback=auto` enables subscription fallback for one run only when hard
  policy allows it.
- `surface audit --model-fallback=off` suppresses user/global fallback.
- `surface audit --model-screenshots=redacted-only` permits only verified screenshot redaction metadata egress
  and only when hard policy allows it.
- Human and JSON outputs disclose judged coverage source, artifact classes sent, and degraded
  channels.
- Human and JSON outputs do not disclose prompts, raw model text, secrets, raw screenshots, or
  unredacted artifact excerpts.

Optional local smoke coverage can be gated behind `SURFACE_MODEL_CLI_SMOKE=1` and excluded from
CI. Smoke tests may verify real CLI version compatibility and output parsing for installed
channels. Any captured stdout/stderr fixtures must be stripped of secrets before committing.

## Implementation Boundaries

Avoid adding provider-specific behavior inside lenses. Lenses should continue to depend only on
`LensContext.model` and receive normalized model responses.

Do not implement subscription fallback by calling MMR's code-review flow over synthetic diffs.
Implement MMR fallback only after a compatible MMR audit capability exists or is added.

Keep channel definitions data-driven so unsupported or newly added channels can be skipped with an
auditable unavailable reason rather than requiring code changes in the lens layer.

## Acceptance Criteria

- Surface can report available subscription-backed CLI channels without invoking them.
- Surface can run measured-only by default when no model consent exists.
- User and project hard egress policies prevent lower-precedence or runtime layers from expanding
  model egress.
- Surface can use one direct subscription CLI for judged lenses when fallback is enabled at depth
  1-3.
- Surface can use multiple direct subscription CLIs and reconcile at depth 4-5.
- Surface can try MMR fallback only when MMR exposes a compatible Surface audit capability.
- Surface records MMR as unavailable when only the current diff-shaped `mmr review` capability is
  present.
- Surface never sends screenshot metadata unless screenshot opt-in is active and the screenshot
  artifact has verified redaction metadata. Binary screenshot delivery is out of scope.
- Surface persists model egress metadata without prompt text, raw model text beyond normalized
  findings, screenshots, unredacted artifact excerpts, or secrets.
- Tests cover config precedence, hard egress policy, consent, provider discovery, direct provider
  execution, reconciliation, MMR capability fallback, safe prompt delivery, sandbox controls, and
  CLI output.
