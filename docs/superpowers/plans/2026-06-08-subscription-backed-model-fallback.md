# Subscription-Backed Model Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional judged synthesis through BYO/local providers, direct subscription CLIs, and
compatible MMR fallback while preserving Surface's local-only default and auditable egress policy.

**Architecture:** Resolve model config and hard egress policy centrally, then run the real audit
pipeline through capture, lens selection, local lenses, model-required lenses, scoring,
reconciliation, backlog synthesis, state persistence, and CLI output. Direct subscription CLIs run
only through pure-completion subprocess adapters with no tools, no shell, no host/workspace or
persistent session writes, neutral cwd, minimal env, safe prompt delivery, and explicit consent. MMR
remains unsupported until a compatible Surface audit capability exists.

**Tech Stack:** TypeScript, Node.js 22, zod, execa, Vitest, commander, existing Surface
Result/SurfaceError conventions, Beads issue `surface-669`.

---

## File Structure

- Modify `packages/core/src/config.ts`: add model config layers, direct-channel schemas, defaults,
  effective policy/channel resolution, and depth.
- Modify `packages/core/src/config.test.ts`: config precedence, hard egress, channel filtering,
  partial layers, BYO suppression, and runtime narrowing tests.
- Modify `packages/core/src/model-provider.ts`: widen provider metadata, preserve existing
  `MaybePromise` boundary, add optional `responseFormat`.
- Modify `packages/core/src/model-provider.test.ts`: subscription metadata and existing BYO
  compatibility tests.
- Create `packages/core/src/model-egress.ts`: artifact eligibility, channel permission checks, and
  egress ledger helpers.
- Create `packages/core/src/model-egress.test.ts`: policy matrix, channel allow/deny, screenshot
  redaction metadata, and no-secret ledger tests.
- Create `packages/core/src/subscription-cli-provider.ts`: internal no-artifact capability probe,
  discovery, safe subprocess runner, prompt delivery, direct provider adapter, and
  `resolveDirectProviders()`.
- Create `packages/core/src/subscription-cli-provider.test.ts`: discovery, sandbox, prompt delivery,
  timeout, non-zero, parse failure, cleanup warning, and no prompt leakage tests.
- Create `packages/core/src/mmr-audit-fallback.ts`: no-artifact MMR probe stub that always reports
  unsupported until a runnable Surface audit contract exists.
- Create `packages/core/src/mmr-audit-fallback.test.ts`: MMR probe does not send artifacts and run
  returns `model_unavailable` with `details.reason = "unsupported-capability"`.
- Modify `packages/core/src/reconciliation.ts`: allow successful channels with zero findings and
  preserve detailed unavailable reasons.
- Modify `packages/core/src/reconciliation.test.ts`: zero-finding channel and detailed unavailable
  reason coverage.
- Create `packages/core/src/audit-runner.ts`: real audit orchestration.
- Create `packages/core/src/audit-runner.test.ts`: no consent, local judged lenses, BYO precedence,
  hard policy blocks, channel policy blocks, subscription fallback, and no fixture findings.
- Modify `packages/core/src/interfaces.ts`: shared artifact redaction metadata schema,
  `CaptureArtifactSchema.redaction`, and `ProjectStateSnapshot.modelEgress`.
- Modify `packages/core/src/composition-factory.ts`: expose audit runner dependencies and injected
  process runner/provider wiring.
- Modify `packages/core/src/composition-factory.test.ts`: dependency injection, process runner
  propagation, audit runner closure, and BYO precedence.
- Modify `packages/core/src/index.ts`: export new modules.
- Modify `packages/cli/src/index.ts`: flags/env mapping, direct provider discovery,
  MMR fallback injection, real audit runner call, state persistence, and output disclosure. BYO/local
  execution remains injectable core behavior unless the CLI grows a real adapter.
- Modify `packages/cli/src/index.test.ts`: CLI config mapping, injected env/runner, discovery
  degradation, output redaction, and no seeded fixture path.
- Modify `.env.example`, `docs/dev-setup.md`, `package.json`.
- Create `tests/evals/model-cli-smoke.test.ts`: opt-in local smoke gate.

## Task 1: Config Schema And Policy

**Files:** `packages/core/src/config.ts`, `packages/core/src/config.test.ts`

- [ ] **Step 1: Add failing config tests**

Cover these exact cases:

- Defaults: `model.fallback.mode = "off"`, `providerOrder = ["claude","codex","gemini"]`, `depth = 3`, `fallbackToMmr = true`, `egressPolicy.mode = "off"`, `screenshots = "blocked"`, `effectiveChannels = []`.
- Partial project layer `{ model: { fallback: { mode: "direct" }, egressPolicy: { mode: "text" } } }` fills required arrays and defaults.
- User hard `mode: "off"` plus CLI `mode: "text-and-screenshots"` yields effective mode `off`.
  Project-only `screenshots: "redacted-only"` does not supply screenshot consent; effective
  screenshots stay `blocked` unless CLI/env or explicit user/global config opts in.
- Project-only config `{ model: { fallback: { mode: "auto" }, egressPolicy: { mode: "text" } } }`
  with no explicit user/global allow and no CLI/env runtime consent keeps
  `effectiveEgressPolicy.mode = "off"` and `effectiveChannels = []`.
- Project-only `screenshots: "redacted-only"` plus CLI/env fallback consent keeps screenshot
  metadata blocked unless CLI/env or explicit user/global screenshot consent is present.
- Project-only fallback defaults plus `--model-screenshots=redacted-only` or
  `SURFACE_MODEL_SCREENSHOTS=redacted-only` keep subscription fallback disabled; screenshot consent
  is not fallback/model-provider consent.
- Default `model.fallback.mode = "off"` plus injected BYO/local provider config permits that
  provider's own text egress, while keeping direct subscription channels empty.
- User/project hard allowlists intersect; `undefined` allowlists mean all channels for that layer.
- Env/CLI denied channels narrow effective channels.
- `providerOrder` rejects `anthropic`, `openai`, `local`, and `mmr`.
- `effectiveChannels` is typed and parsed as `DirectSubscriptionChannelId[]`.

- [ ] **Step 2: Implement schemas**

Add `ModelChannelIdSchema` for all channels and `DirectSubscriptionChannelIdSchema` only for
configured direct CLI ids: `claude`, `codex`, and `gemini`; Codex currently resolves unavailable
until a no-shell mode exists. `ModelFallbackConfigSchema.providerOrder`,
`ModelFallbackConfigSchema.allowedChannels`, and `effectiveChannels` must use
`DirectSubscriptionChannelIdSchema`; egress allow/deny policy may use `ModelChannelIdSchema`.

Add `ModelFallbackModeSchema`, `ModelEgressModeSchema`, and `ScreenshotEgressPolicySchema`.
`ModelFallbackConfigSchema` includes `mode`, `providerOrder`, `allowedChannels`, `fallbackToMmr`,
`timeoutMs`, and `depth`. `ModelConfigSchema` keeps both configured `egressPolicy` and enforced
`effectiveEgressPolicy`.

- [ ] **Step 3: Implement resolution**

Normal defaults resolve CLI > env > project > user > defaults. Consent resolution is source-aware:
project config can set defaults and restrictions, but project config never supplies model egress
consent. Model egress consent may come only from explicit CLI flags, env vars, or explicit
user/global config. With no such consent source, effective mode remains `off` and effective direct
channels remain empty even if project config sets fallback or egress to `text`.

Hard policy is computed from explicit user/project egress values before defaults are filled.
Default user/global `egressPolicy.mode = "off"` is a hard security boundary against project-only
egress enablement. Project config may restrict egress but cannot expand it. Use explicit ranks:

```ts
const egressModeRank = { off: 0, text: 1, "text-and-screenshots": 2 } as const;
const screenshotRank = { blocked: 0, "redacted-only": 1 } as const;
```

CLI/env may narrow but cannot expand hard user/project limits. Denylists union. Allowlists
intersect, treating `undefined` as all channels.

When CLI/env sets `model.fallback.mode` to `direct`, `mmr`, or `auto`, effective egress for that
run is at least `text` for fallback channels unless an explicit harder user/project or runtime
`off` blocks it. `model.fallback.mode = "off"` disables direct subscription and MMR fallback only;
it must not disable explicitly configured BYO/local model providers. Explicit CLI/env or
user/global BYO/local configuration is text egress consent for that provider's own channel unless
hard user/project policy blocks it. Project-only BYO/local configuration is not consent.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/config.test.ts
git add packages/core/src/config.ts packages/core/src/config.test.ts
git commit -m "[surface-669] feat(core): add model egress config policy"
```

Expected: tests pass.

## Task 2: Model Provider Metadata

**Files:** `packages/core/src/model-provider.ts`, `packages/core/src/model-provider.test.ts`

- [ ] **Step 1: Add failing metadata tests**

Test `ModelResponseSchema` accepts `provider: "codex"`, `channelId: "codex"`,
`sourceKind: "subscription-cli"`. Test `ModelAvailabilitySchema` accepts an available subscription
provider and an unavailable provider with required `reason` and sanitized `message`. Test legacy BYO
responses still normalize.

- [ ] **Step 2: Implement metadata**

Preserve the current `MaybePromise<Result<...>>` `ModelProvider` boundary. Keep `ModelProvider.id`
optional so no-model providers do not invent a channel. Add `ModelSourceKindSchema` with `api`,
`local`, `subscription-cli`, `mmr`.

Add `ModelRequestSchema.responseFormat` while preserving existing `maxOutputTokens` and
`temperature`. Type public provider inputs as `z.input<typeof ModelRequestSchema>` or an explicit
interface where `responseFormat` is optional. Normalize adapter responses into `ModelResponseSchema`
only after filling `channelId`, `provider`, and `sourceKind`.

`ModelAvailabilitySchema` must remain a discriminated union:

- `available: true` requires `model`, `provider`, `channelId`, and `sourceKind` for every provider
  that can receive model egress.
- `available: false` requires `reason` and sanitized `message`, with optional channel metadata.
  `reason` is the single canonical unavailable reason field.

Audit runner invocation must fail closed before artifact egress if an injected, BYO/local,
subscription, or MMR provider lacks canonical `channelId` or `sourceKind`; record a sanitized
degradation instead of invoking the provider.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/model-provider.test.ts
git add packages/core/src/model-provider.ts packages/core/src/model-provider.test.ts
git commit -m "[surface-669] feat(core): support model channel metadata"
```

Expected: tests pass.

## Task 3: Egress Policy And Ledger

**Files:** `packages/core/src/model-egress.ts`, `packages/core/src/model-egress.test.ts`,
`packages/core/src/interfaces.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Add failing tests**

Cover text-only artifacts, screenshot policy blocked, missing redacted screenshot, verified
redacted screenshot, mixed verified/unverified screenshots, empty capture, BYO/local/direct/MMR
allow/deny policy, unavailable channel ledger entries, and no prompt/raw model text/secret leakage.

- [ ] **Step 2: Add shared redaction metadata**

In `interfaces.ts`, add `ArtifactRedactionMetadataSchema` with `status: "redacted"`,
`maskedClasses`, `safeNoSensitiveRegions`, `unsafeRegions`, and verification evidence for either
positional masking (`boundingBoxesVerified`) or structural masking (`selectorsVerified` and
`textRangesVerified`). Extend `CaptureArtifactSchema` with
`redaction: ArtifactRedactionMetadataSchema.optional()`. Add round-trip tests for screenshot and DOM
artifacts with metadata.

Screenshot redaction metadata is eligible only when at least one screenshot artifact exists and
every screenshot artifact has `status === "redacted"`, `boundingBoxesVerified === true`,
`unsafeRegions.length === 0`, and either `maskedClasses.length > 0` or
`safeNoSensitiveRegions === true`. Otherwise record `screenshot_blocked_no_verified_redaction` or
`screenshot_blocked_no_redacted_artifact`.

- [ ] **Step 3: Add egress helpers**

Implement `isModelChannelPermitted(policy, metadata)` where metadata includes `channelId` and
`sourceKind`, returning `permitted` or sanitized reasons `model_egress_blocked_by_policy`,
`channel_metadata_missing`, `channel_denied_by_policy`, or `channel_not_allowed_by_policy`.

`ModelEgressLedgerEntrySchema` includes run id, source kind, attempted channels, completed
channels, unavailable channels with reasons/messages, blocked reasons, artifact classes sent, and
redaction status. It never stores prompts, raw model response strings, raw screenshots, auth output,
or secrets. Parsed/normalized findings may be stored through the normal findings path.

Before provider adapters receive DOM, accessibility tree, or computed-style excerpts, run a
text-masking transformer that uses sensitive DOM regions, selectors, and text ranges to replace
sensitive values with opaque placeholders. Tests must prove masked DOM/accessibility excerpts omit
emails, tokens, passwords, session text, and user free-text while preserving enough structure for
the lens prompt. Tests must also cover computed-style excerpts, including sensitive URLs, CSS
`content` values, tokens, emails, and user-provided text; these values are masked or the artifact is
blocked. Add explicit regression coverage for long hex-like secrets and path-like target refs in
DOM, accessibility, and computed-style artifacts so model prompts cannot carry bearer tokens,
session ids, local artifact paths, or sensitive URL path segments after redaction.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/model-egress.test.ts
git add packages/core/src/model-egress.ts packages/core/src/model-egress.test.ts packages/core/src/interfaces.ts packages/core/src/index.ts
git commit -m "[surface-669] feat(core): add model egress ledger"
```

Expected: tests pass.

## Task 4: Subscription CLI Provider

**Files:** `packages/core/src/subscription-cli-provider.ts`,
`packages/core/src/subscription-cli-provider.test.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Add failing tests**

Cover:

- Discovery accepts only `DirectSubscriptionChannelId`.
- Grok and Antigravity are not built-in direct fallback channels until vetted
  no-artifact/no-tools/no-shell/no-persistent-writes probes exist.
- Codex built-in direct discovery returns `unsupported-capability` until Codex exposes a no-shell
  completion mode; `codex exec --help` is diagnostic-only and never used as a safety decision.
- Empty/malformed capability evidence returns `unsupported-capability`.
- Missing binary returns `not-installed`; auth failure returns `auth-unavailable`.
- Completion command uses supported read-only/no-tools controls from the CLI contract,
  no host/workspace writes, no persistent session writes, and structured output parsing.
- Injected runner is used for discovery and completion.
- Timeout yields `model_request_failed` with `details.reason = "timeout"`.
- Non-zero exit yields `model_request_failed` with `details.reason = "command-failed"`.
- Malformed structured output yields `model_request_failed` with `details.reason = "parse-failed"`.
- Prompt cleanup failure returns `model_request_failed` with `details.reason =
  "prompt-cleanup-failed"` and does not persist prompt contents or a normal success ledger entry.
- `availability()` on an unavailable subscription provider returns `available: false`, `reason`,
  sanitized `message`, `channelId`, and `sourceKind`.

- [ ] **Step 2: Implement runner**

`defaultProcessRunner` creates a fresh temp cwd, `chmod(0700)`, uses `extendEnv: false`, and passes
only a minimal env allowlist plus explicit command env. Pre-resolve CLI executable paths outside the
workspace or use a trusted sanitized `PATH` that preserves common package-manager locations such as
Homebrew, Volta, NVM, and npm global prefixes while filtering relative, workspace, and writable
project paths. Canonicalize every `PATH` segment with `fs.realpathSync` before overlap checks, and
normalize `PATH`/`Path`/`path` casing on Windows. Missing or unreadable `PATH` segments must be
skipped or rejected through `existsSync`/`try...catch`, not allowed to crash the runner. Add tests
for nonexistent path entries, symlinked workspace paths, relative paths, case-insensitive Windows
env keys, and PATH poisoning. Set `TMPDIR`, `TEMP`, and `TMP` to a per-run `0700` temp directory,
not host temp paths. On startup, prune stale Surface-owned runner temp directories asynchronously or
in a deferred maintenance task by age, prefix, and PID/lock-file checks. Use a conservative
threshold such as older than 24 hours so SIGKILL or host crashes cannot accumulate unbounded orphan
directories without deleting active concurrent runs. The inherited base allowlist is
`USER`, `LOGNAME`, `USERNAME`, `LANG`, `LC_ALL`, and `TERM`; on Windows also inherit `SystemRoot`, `windir`,
`SystemDrive`, and `PATHEXT`. Do not inherit `HOME` or `USERPROFILE`. `HOME`, `USERPROFILE`,
`XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, `APPDATA`, and
`LOCALAPPDATA` must point at isolated temp directories or read-only channel-specific auth mirrors,
or be unset when the provider does not need them; they must not inherit project/user locations. If a
channel cannot authenticate without persistent prompt/session writes, mark it
`unsupported-capability`. It catches ENOENT as exit 127, catches timeouts as exit 124, always
attempts cwd and isolated env cleanup through `try...finally`, and registers best-effort process
exit handling for normal `exit` plus asynchronous interrupts such as SIGINT/SIGTERM/SIGHUP/SIGQUIT
where the current platform supports them. Use a shared cleanup registry with one listener per
process signal; runner invocations register/unregister cleanup tasks in `finally` on normal
completion or error so concurrent providers do not accumulate global listeners. Signal handlers
must wrap each registered cleanup task in its own `try...catch` so one runner's cleanup failure
cannot block the remaining cleanup tasks. Signal handlers must not swallow termination: after
cleanup, restore the default behavior and re-send the signal or exit with the conventional code such
as 130 for SIGINT and 143 for SIGTERM. Failed cleanup roots remain tracked, are made read-only as
damage control, and are left with the Surface temp-prefix metadata needed for startup pruning to
retry them by age. Asynchronous pruning errors must be caught and converted to sanitized debug
diagnostics so unhandled promise rejections cannot crash the CLI.

Add an auth-mirror contract per channel. The runner may read original HOME/XDG locations only before
execution to locate channel-specific credential files, copy them into the isolated HOME/XDG tree
with child-visible non-writable permissions such as read-only files inside non-writable directories,
and remove the mirror after execution. Mirror copying must validate every source path and descendant
with symlink-safe checks before copy, reject symlinked credential roots or descendants, preserve
credential timestamps, and fail closed on any insecure or uninspectable source. Same-UID
permissions and pre/post snapshots are not an isolation boundary. Direct subscription completion is
supported only when an enforceable filesystem isolation mechanism is active, such as a container,
separate UID, OS sandbox, or read-only mount setup that denies access to the real HOME and workspace
while exposing only the copied auth mirror and isolated temp/cache tree. If that boundary is
unavailable for a channel, mark the channel
`unsupported-capability` before discovery or completion and emit a sanitized warning/setup hint. Do
not add a bypass flag; local development can use BYO/local providers or install/configure an
enforced sandbox. Do not use bind mounts to expose real HOME/XDG paths. Within the enforced
boundary, isolated per-run temp/cache directories may be mutated by the provider but must stay
outside the workspace and real HOME/XDG paths and must be cleaned after the run. If a CLI mutates,
chmods, renames, creates, or deletes files inside the credential mirror, or escapes into
workspace/real HOME paths, mark the channel `unsupported-capability` or return sanitized
`model_request_failed`, and do not record a normal successful egress ledger entry.
If a CLI cannot authenticate without writing persistent session state, mark the channel
`unsupported-capability`.
Successful provider completion requires successful deletion of every credential mirror copy and
directory. Chmod or making copies unreadable is only best-effort damage control after deletion
failure; deletion failure still returns a sanitized `model_request_failed` degradation and does not
record a normal successful egress ledger entry. It must never mount or pass the real HOME/XDG path to
the provider. Fake filesystem tests must prove discovery uses the mirror, does not write to real
HOME, rejects write-requiring auth, allows writes only in isolated per-run temp/cache directories,
detects credential-mirror chmod/new-file/rename/content mutation during auth and completion, detects
workspace/real-HOME escape, deletes the mirror before success, fails closed when deletion fails even
if chmod succeeds, records no success ledger entry on mirror cleanup failure, and fails closed when
credentials cannot be mirrored safely.

- [ ] **Step 3: Implement discovery**

`probeSubscriptionCapability()` is internal. It performs provider-specific no-artifact auth/version
checks through the injected `ProcessRunner`, then uses strict schema-based or version-based
capability mappings. Do not use loose help-text substring parsing as a safety decision. It emits
canonical capability JSON internally and fails closed unless it can prove:

- structured JSON output,
- no memory/session,
- no shell,
- no tools,
- no host/workspace or persistent session writes,
- safe prompt transport through stdin or prompt file.

Successful `SubscriptionChannelAvailability` carries parsed capability. Unavailable records carry
only sanitized reason/message, never raw stdout/stderr. Per-channel env allowlists are constants:
`claude` may use isolated home vars plus `PATH`; `gemini` may use isolated home vars plus `PATH`
and `NO_BROWSER`; `codex`, `grok`, and `antigravity` remain host-injected or MMR-review channels
until sandboxed no-shell direct probes are vetted.

Concrete initial probes are no-artifact and non-interactive:

- Claude: run `claude --version`, map only explicit supported semver ranges to a capability record
  that includes `--print`, `--output-format json`, `--input-format text`, and `--disallowedTools`.
  Then, only inside the enforced filesystem sandbox, run a fixed schema probe through
  `claude --print --output-format json --input-format text --disallowedTools "*" <fixed-prompt>`
  with a short timeout. Parse only the JSON response schema. Help output is diagnostic-only.
- Codex: mark built-in direct fallback unsupported until Codex exposes a no-shell/no-tools
  completion mode. Keep Codex available through host-injected/MMR review channels.
- Gemini: run `NO_BROWSER=true gemini --version`, map only explicit supported semver ranges to a
  capability record that includes a fixed bridge prompt through `--prompt`, `--output-format json`,
  `--approval-mode plan`, and `--sandbox`. Then, only inside the enforced filesystem sandbox, run a
  fixed schema probe through
  `NO_BROWSER=true gemini --prompt "Read the JSON request appended on stdin and answer according to that request." --output-format json --approval-mode plan --sandbox`
  with the fixed probe JSON request on stdin and a short timeout. Parse only the JSON response
  schema. Help output is diagnostic-only.

Add tests that unknown Claude/Gemini versions fail closed, supported Claude/Gemini versions pass
only through the explicit capability mapping, Codex direct discovery returns
`unsupported-capability`, interactive/browser prompts time out as `auth-unavailable`, and help text
is never parsed for safety decisions.

- [ ] **Step 4: Implement completion**

Use discovery capability to choose stdin vs prompt-file delivery. Prompt files live in temp dirs
`0700` and files `0600`; prompt text never appears in argv. Prompt-file cleanup success requires
overwriting the actual current prompt-file size with zero bytes, including bytes appended after
creation, calling `fsync` or `fdatasync` on the file descriptor, unlinking the file, and removing the
prompt temp directory. If unlink or directory cleanup fails, return `model_request_failed` with
`details.reason = "prompt-cleanup-failed"` and do not create a normal successful egress ledger entry.
Chmod or making the file unreadable is only best-effort damage control after cleanup failure.
Expected unsupported sync errors such as `EINVAL` or `ENOTSUP` on tmpfs/overlayfs are downgraded only
when overwrite and unlink succeed; other cleanup failures mark prompt-file capability unsupported for
that channel. Add fake-filesystem tests where appended bytes are zero-filled and unlink fails but
chmod succeeds and the run still fails closed. Cleanup failure on thrown invocation still attempts
wipe/unlink and reports a combined sanitized error with
`details.cleanupFailed = true`, without prompt path or prompt content.
Document that zero-filling is best-effort only on copy-on-write filesystems and SSDs.

Raw or redacted binary screenshots are not sent in this revision. Screenshot support means
redaction metadata can be included in text prompts and ledger entries can record
`screenshot-redaction-metadata`; they must not claim binary screenshot delivery. Add future
vision-capable image delivery only with explicit image capability probes, safe temp image handling,
and tests.

- [ ] **Step 5: Add resolver helper**

Export `resolveDirectProviders(config, runner)` returning
`{ subscriptionProviders, discoveryUnavailableChannels }`. It uses the same injected runner for
discovery and provider
creation, but callers should wrap it in a lazy resolver when lens selection may prove no model is
needed.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/subscription-cli-provider.test.ts
git add packages/core/src/subscription-cli-provider.ts packages/core/src/subscription-cli-provider.test.ts packages/core/src/index.ts
git commit -m "[surface-669] feat(core): add safe subscription cli provider"
```

Expected: tests pass.

## Task 5: MMR, Reconciliation, And Audit Runner

**Files:** `packages/core/src/mmr-audit-fallback.ts`,
`packages/core/src/mmr-audit-fallback.test.ts`, `packages/core/src/reconciliation.ts`,
`packages/core/src/reconciliation.test.ts`, `packages/core/src/audit-runner.ts`,
`packages/core/src/audit-runner.test.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Add failing tests**

MMR probe tests verify no DOM/accessibility/screenshot artifacts are sent and `run()` returns
`model_unavailable` with `details.reason = "unsupported-capability"`. Audit-runner tests cover
depth 3 first-success behavior, depth 4 reconciliation, direct success skipping MMR probe,
unsupported MMR without run, and preserving detailed unavailable reasons.

Reconciliation tests cover an available channel with `findings: []` and detailed unavailable
reasons.

- [ ] **Step 2: Implement MMR stub**

Probe may inspect no-artifact MMR capability metadata, but this revision always reports
unsupported and never calls `mmr review` or sends captured artifacts.

- [ ] **Step 3: Update reconciliation and audit runner**

Remove `.min(1)` from successful reconciliation channel findings. Preserve detailed unavailable
reasons in audit-runner output and ledger even if reconciliation uses coarser internal reasons.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/mmr-audit-fallback.test.ts src/reconciliation.test.ts src/audit-runner.test.ts
git add packages/core/src/mmr-audit-fallback.ts packages/core/src/mmr-audit-fallback.test.ts packages/core/src/reconciliation.ts packages/core/src/reconciliation.test.ts packages/core/src/audit-runner.ts packages/core/src/audit-runner.test.ts packages/core/src/index.ts
git commit -m "[surface-669] feat(core): orchestrate judged model channels"
```

Expected: tests pass.

## Task 6: Real Audit Runner And Composition

**Files:** `packages/core/src/audit-runner.ts`, `packages/core/src/audit-runner.test.ts`,
`packages/core/src/composition-factory.ts`, `packages/core/src/composition-factory.test.ts`,
`packages/core/src/index.ts`

- [ ] **Step 1: Add failing audit tests**

Cover no-consent measured/local-only output, local judged lenses with `requiresModel === false`
such as visual hierarchy/content, BYO precedence, hard egress off blocking all model paths, channel
deny for BYO/MMR, injected or BYO providers missing channel metadata blocked before artifact egress,
subscription fallback, discovery unavailable propagation, and no prototype fixture findings.

- [ ] **Step 2: Implement audit runner**

Run all selected `requiresModel === false` lenses locally, regardless of measured/judged method.
Only when the selected execution plan contains at least one `requiresModel === true` lens, compute
aggregate judged availability from permitted BYO/local, permitted subscription providers, permitted
MMR fallback intent, or unavailable provider. Route only `requiresModel === true` lenses through the
selected model path.

Apply `isModelChannelPermitted()` with full provider metadata before invoking BYO/local, each
subscription provider, and MMR. Merge discovery unavailable channels into degradation and ledger.
Use depth 1-3 for first-success retry and depth 4-5 for multi-channel reconciliation.

Mode gates are exact after BYO/local primary resolution: explicit BYO/local providers may run under
the provider-agnostic egress policy even when fallback mode is `off`. For subscription fallback,
`off` runs no direct subscription providers and never probes MMR; `direct` runs direct providers
only and never probes MMR; `mmr` skips direct provider resolution and probes only MMR when egress
policy allows it; `auto` runs direct providers first and probes MMR only after direct failure when
`fallbackToMmr` is true and policy permits `mmr`. Add audit and CLI tests for explicit env/user
BYO/local config with fallback `off`.

- [ ] **Step 3: Wire composition**

`SurfaceCompositionOptions` accepts optional `modelProvider`, `modelProviderFactory`,
`subscriptionProviders`, `resolveSubscriptionProviders`, `mmrFallback`, and `processRunner`. The
returned `auditRunner` accepts call-time providers, unavailable discovery records, or a call-time
lazy `resolveSubscriptionProviders` resolver from CLI. Creation-time `processRunner` is used only
when providers were not supplied at creation or call time. Tests must prove injected runners are used
and defaults are not called in tests.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface-core test -- src/audit-runner.test.ts src/composition-factory.test.ts
git add packages/core/src/audit-runner.ts packages/core/src/audit-runner.test.ts packages/core/src/composition-factory.ts packages/core/src/composition-factory.test.ts packages/core/src/index.ts
git commit -m "[surface-669] feat(core): add real audit runner"
```

Expected: tests pass.

## Task 7: CLI Audit Integration

**Files:** `packages/cli/src/index.ts`, `packages/cli/src/index.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Cover `--model-fallback direct|mmr|auto` mapping to text egress consent, `--model-fallback off`,
`--model-depth`, `--model-channels`, `--model-screenshots`, injected env rather than ambient
`process.env`, injected `processRunner`, BYO configured suppressing fallback even when blocked,
discovery unavailable reasons in output, no prompt/raw model output leakage, and no seeded fixture
path.

- [ ] **Step 2: Implement flags/env**

Add `--model-fallback`, `--model-channels`, `--model-depth`, and `--model-screenshots`. Keep
`--model-channel` as a repeatable alias for `--model-channels` for ergonomics. Thread
`RunSurfaceCliOptions.env`, `processRunner`, `modelProvider`, and `modelProviderFactory` through
program creation into `auditTarget()` as `cliRuntime`.
Implementation note: the CLI normalizes comma-separated `--model-channels` and repeated
`--model-channel` values through one parser before config validation, so the aliases share the same
project/env precedence path.

`--model-screenshots=blocked|redacted-only` maps to runtime screenshot policy. Bare
`--model-screenshots` is accepted as shorthand for `redacted-only`; `--model-screenshots=blocked`
explicitly blocks screenshot metadata for the run. The `redacted-only` value maps to runtime
`model.egressPolicy.screenshots = "redacted-only"` and
`model.egressPolicy.mode = "text-and-screenshots"` unless a harder policy blocks it.
`SURFACE_MODEL_SCREENSHOTS=redacted-only` mirrors the same one-run opt-in by setting runtime
`screenshots = "redacted-only"` and `mode = "text-and-screenshots"` unless a harder policy blocks
it. Add config and CLI tests for both flag and env mappings.

- [ ] **Step 3: Resolve providers**

Do not auto-create a stock CLI BYO provider from raw API-key env vars unless a real completion
adapter exists. Explicit BYO/local execution is supported through injected `modelProviderFactory` or
injected `modelProvider`, and those injected providers are checked against effective egress policy
before artifact egress. Project-only BYO/local config is not consent.

Create a lazy `resolveSubscriptionProviders` thunk only when an explicit fallback consent source is
present, effective egress is not off, and fallback mode is `direct` or `auto`. Explicit fallback
consent may come from CLI/env fallback controls, CLI/env channel
selection, or explicit user/global fallback config; project-only fallback config,
`--model-screenshots=redacted-only`, bare `--model-screenshots`, and
`SURFACE_MODEL_SCREENSHOTS=redacted-only` are not fallback consent. Do not invoke the thunk in CLI
setup. The audit runner invokes it only after lens selection confirms at least one selected lens has
`requiresModel === true` and subscription fallback is still eligible. Preserve the injected
composition; do not create a new composition inside `auditTarget()`. Add CLI/audit tests with
fallback enabled and only `requiresModel === false` lenses proving the injected `processRunner` is
never called, and with project-only fallback plus screenshot flag/env staying measured-only.

- [ ] **Step 4: Replace seeded audit path**

Call `composition.auditRunner({ capture, config, modelProvider, resolveSubscriptionProviders,
mmrFallback, runId })`. Persist findings, backlog, tracked findings, run records, and model egress
from the result. Remove normal use of `findingsForSeededFixture()`.

- [ ] **Step 5: Output disclosure**

JSON and human output expose judged coverage source, completed channels, degraded channels with
reasons, artifact classes actually sent, and blocked reasons. They never include prompts, raw model
text, auth output, secrets, raw screenshots, or unredacted excerpts.

- [ ] **Step 6: Verify and commit**

Run:

```bash
pnpm --filter @zigrivers/surface test -- src/index.test.ts
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "[surface-669] feat(cli): wire audit model fallback controls"
```

Expected: tests pass.

## Task 8: Docs And Smoke Gate

**Files:** `.env.example`, `docs/dev-setup.md`, `package.json`,
`tests/evals/model-cli-smoke.test.ts`

- [ ] **Step 1: Add docs**

Document `SURFACE_MODEL_FALLBACK=off|direct|mmr|auto`,
`SURFACE_MODEL_CHANNELS=claude,gemini` for this release, with Codex reserved until a no-shell
direct mode exists,
`SURFACE_MODEL_DEPTH=3`, and `SURFACE_MODEL_SCREENSHOTS=blocked|redacted-only`. State that normal
tests use fake runners and real subscription CLIs are never invoked in CI. Document that
`SURFACE_MODEL_SCREENSHOTS=redacted-only` also raises runtime model egress mode to
`text-and-screenshots` unless blocked by hard policy.

- [ ] **Step 2: Add opt-in smoke script**

Add:

```json
"test:model-cli-smoke": "SURFACE_MODEL_CLI_SMOKE=1 vitest run tests/evals/model-cli-smoke.test.ts"
```

The smoke test uses `describe.skipIf(process.env.SURFACE_MODEL_CLI_SMOKE !== "1")` and starts with
a no-op assertion. Add real CLI compatibility checks only after sanitized fixtures exist.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm exec prettier --check .env.example docs/dev-setup.md tests/evals/model-cli-smoke.test.ts package.json
pnpm run test:model-cli-smoke
git add .env.example docs/dev-setup.md package.json tests/evals/model-cli-smoke.test.ts
git commit -m "[surface-669] docs: document subscription model fallback"
```

Expected: Prettier and smoke gate pass.

## Task 9: Full Verification And MMR

**Files:** no new files.

- [ ] **Step 1: Run focused package tests**

```bash
pnpm --filter @zigrivers/surface-core test
pnpm --filter @zigrivers/surface test
```

Expected: all tests pass.

- [ ] **Step 2: Run full local gate**

```bash
pnpm run check
```

Expected: format, lint, typecheck, tests, smoke build, e2e, benchmark, and release tests pass.

- [ ] **Step 3: Run MMR on implementation diff**

```bash
mmr review --sync --format markdown --base main --channels claude --channels codex --channels gemini --channels grok --channels antigravity --timeout 420 --focus "Review the Surface subscription-backed model fallback implementation for privacy, consent, subprocess sandboxing, model egress leakage, config precedence, MMR capability gating, and test coverage."
```

Expected: no P0/P1/P2 findings. Fix all P0/P1/P2 findings before proceeding.

- [ ] **Step 4: Commit review fixes when needed**

```bash
git status --short
git add packages/core/src/config.ts packages/core/src/config.test.ts
git add packages/core/src/model-provider.ts packages/core/src/model-provider.test.ts
git add packages/core/src/model-egress.ts packages/core/src/model-egress.test.ts
git add packages/core/src/subscription-cli-provider.ts packages/core/src/subscription-cli-provider.test.ts
git add packages/core/src/mmr-audit-fallback.ts packages/core/src/mmr-audit-fallback.test.ts
git add packages/core/src/reconciliation.ts packages/core/src/reconciliation.test.ts
git add packages/core/src/audit-runner.ts packages/core/src/audit-runner.test.ts
git add packages/core/src/interfaces.ts packages/core/src/composition-factory.ts packages/core/src/composition-factory.test.ts
git add packages/core/src/index.ts packages/cli/src/index.ts packages/cli/src/index.test.ts
git add .env.example docs/dev-setup.md package.json tests/evals/model-cli-smoke.test.ts
git commit -m "[surface-669] fix(core): address model fallback review findings"
```

Expected: commit only if MMR required changes.

- [ ] **Step 5: Close Beads issue after implementation**

```bash
bd update surface-669 --notes="Implemented subscription-backed model fallback with direct CLI providers, hard model egress policy, redacted screenshot handling, compatible MMR fallback gating, audit-runner wiring, and tests."
bd close surface-669 --reason="Implemented and verified"
git status --short
```

Expected: clean worktree after implementation branch completion.
