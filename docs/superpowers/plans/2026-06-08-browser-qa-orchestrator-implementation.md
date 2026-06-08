# Browser QA Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Surface's browser QA orchestrator so `agent-browser` becomes the primary agent-led QA path for deterministic flows, bounded exploration, replay, evidence, reports, gates, and MCP access.

**Architecture:** Add a browser QA domain under `packages/core/src/browser-qa/` with typed schemas, sidecar state stores, action policy enforcement, a secret-safe `agent-browser` driver, flow execution, exploration, replay, promotion, evidence, and reporting. Keep CLI and MCP layers thin: they parse inputs, call core orchestrators, and return existing Surface JSON envelopes without changing current capture, audit, run, validate, or gate contracts. Persist QA data under `.surface/qa/` using immutable run/evidence sidecars and content-addressed artifacts, with only short shared-index commits going through the existing `StateStore` lock.

**Tech Stack:** TypeScript, Zod, `yaml`, Commander, Vitest, Node child processes, existing Surface `StateStore`, existing report/gate/tracked-finding primitives, `agent-browser` CLI.

---

## Source Spec

- Design spec: `docs/superpowers/specs/2026-06-08-browser-qa-orchestrator-design.md`
- Parent Bead: `surface-55p`

## Cross-Cutting Constraints

- Preserve existing command meanings: `surface run` remains pipeline execution; `surface flow run` becomes browser-action flow execution.
- Keep existing `capture`, `audit`, `run`, `validate`, `gate`, and MCP tool contracts backward compatible.
- Store QA state in `.surface/qa/` sidecars. Do not append QA run arrays into top-level `.surface/state.json`.
- Never pass resolved secrets through CLI arguments, persisted JSON, logs, traces, or files below the project directory.
- Treat screenshots and videos as sensitive references. Reports and MCP tools expose refs, metadata, summaries, and redacted thumbnails only when policy allows.
- Under `--ci`, mutating flows without a valid reset, fixture account, or teardown contract fail closed before browser actions run.
- Target flags are mutually exclusive. `--localhost` is a strict boolean resolving to `http://localhost:3000`; custom ports use `--url` or `--target`.
- Git operations follow the active repository policy. Commit commands in this plan are execution checkpoints only when the current user or orchestrator has granted commit authority.

## File Map

### Create

- `packages/core/src/browser-qa/schemas.ts` - Zod schemas and exported types for QA runs, flow runs, flow files, candidates, policies, evidence, reports, and CLI/MCP envelopes.
- `packages/core/src/browser-qa/state-store.ts` - `QaRunStore`, candidate store, flow sidecar store, exact-id fallback resolution, shared-index updates, and retention tombstones.
- `packages/core/src/browser-qa/action-policy.ts` - built-in safe policy, policy loading, target binding, destructive-action classification, fixture/reset validation, and degradation construction.
- `packages/core/src/browser-qa/agent-browser-driver.ts` - `BrowserQaDriver` interface, CLI-backed adapter, process/session lifecycle, cleanup records, command redaction, and secret-safe environment handling.
- `packages/core/src/browser-qa/flow-parser.ts` - YAML parser, target precedence resolver, flow validation, input/fixture/secret reference resolution, and legacy route-flow importer.
- `packages/core/src/browser-qa/evidence-store.ts` - immutable evidence manifests, content-addressed artifact writes, redaction checks, mcp-readable metadata, and exact-id artifact read fallback.
- `packages/core/src/browser-qa/flow-runner.ts` - deterministic step runner, wait/assertion evaluation, teardown execution, ref refresh, and flow-run summaries. Frame-scoped step execution is out of v1 until the driver has a real frame contract.
- `packages/core/src/browser-qa/replay-promoter.ts` - candidate replay, promotion rules, tracked-finding creation, verdict promotion bridge, and promotion sidecars.
- `packages/core/src/browser-qa/explorer.ts` - bounded autonomous exploration loop, state hashing, policy-aware action queueing, candidate finding generation, and candidate flow generation.
- `packages/core/src/browser-qa/orchestrator.ts` - top-level `runQa`, `runExplore`, `runFlow`, `replayQaTarget`, and cleanup composition.
- `packages/core/src/browser-qa/reporting.ts` - QA report renderers, manifest report builder, gate flow-result adapter, and redacted summaries.
- `packages/core/src/browser-qa/index.ts` - public browser QA exports.
- `packages/core/src/browser-qa/*.test.ts` - focused Vitest suites for each browser QA module.
- `packages/cli/src/browser-qa-commands.ts` - Commander command registration for `qa`, `explore`, `flow`, `evidence`, `replay`, `report qa`, and `qa cleanup`.
- `packages/cli/src/browser-qa-commands.test.ts` - CLI parser, envelope, and exit-code tests for new commands.
- `packages/mcp/src/browser-qa-tools.ts` - MCP schemas and handlers for QA tools and bounded artifact reads.
- `packages/mcp/src/browser-qa-tools.test.ts` - MCP schema, handler, and redaction tests.
- `fixtures/browser-qa/seeded-app/package.json` - deterministic local QA fixture app dependencies and scripts.
- `fixtures/browser-qa/seeded-app/src/*` - small seeded browser app with checkout, settings, billing, console, network, modal, iframe, and auth-drift states.
- `fixtures/browser-qa/flows/*.yml` - reviewed source-controlled flows for the seeded app.
- `fixtures/browser-qa/action-policy.json` - least-privilege policy used by seeded flow and exploration tests.
- `tests/e2e/browser-qa.e2e.test.ts` - end-to-end CLI tests over the seeded fixture.

### Modify

- `packages/core/src/index.ts` - export browser QA domain entry points without changing existing exports.
- `packages/core/src/errors.ts` - add QA error codes: `qa_unavailable`, `target_not_allowed`, `action_policy_denied`, `flow_invalid`, `flow_step_failed`, `evidence_unavailable`, `replay_failed`, and `promotion_rejected`.
- `packages/core/src/interfaces.ts` - add narrow QA-facing interfaces where cross-domain contracts are needed, especially report and gate inputs.
- `packages/core/src/composition-factory.ts` - wire default QA orchestrator factories and allow test injection of the driver.
- `packages/core/src/report-renderers.ts` - expose QA report rendering entry points without altering existing finding renderers.
- `packages/core/src/gate-evaluator.ts` - add optional flow-aware gate evaluation while preserving existing measured-finding behavior.
- `packages/core/package.json` - confirm the existing `yaml` dependency remains available to core tests and builds.
- `packages/cli/src/index.ts` - import and register browser QA commands; adjust target parsing so `--localhost` is strict boolean for new QA commands.
- `packages/mcp/src/index.ts` - register browser QA tools in tool order and output schemas.
- `packages/cli/package.json` and `packages/mcp/package.json` - add dependencies only if command code needs package-local runtime access beyond core exports.
- `tests/e2e/cli-smoke.e2e.test.ts` - add smoke coverage that old commands still parse and run.

## Beads Mapping

The Beads child issues created from this plan use the stable labels `BQA-001` through `BQA-012`. The parent epic is `surface-55p`.

| Label | Bead | Title | Depends On |
| --- | --- | --- | --- |
| `BQA-001` | `surface-55p.1` | QA domain schemas and sidecar state | none |
| `BQA-002` | `surface-55p.2` | Action policy and destructive classifier | `surface-55p.1` |
| `BQA-003` | `surface-55p.3` | Secret-safe agent-browser driver | `surface-55p.1`, `surface-55p.2` |
| `BQA-004` | `surface-55p.4` | Flow YAML parser and target resolution | `surface-55p.1`, `surface-55p.2` |
| `BQA-005` | `surface-55p.5` | QA evidence store and artifact-read fallback | `surface-55p.1`, `surface-55p.2` |
| `BQA-006` | `surface-55p.6` | Deterministic flow runner and `surface flow` | `surface-55p.3`, `surface-55p.4`, `surface-55p.5` |
| `BQA-007` | `surface-55p.7` | Replay, candidate promotion, and tracked findings | `surface-55p.5`, `surface-55p.6` |
| `BQA-008` | `surface-55p.8` | Bounded explorer and candidate flow generation | `surface-55p.2`, `surface-55p.3`, `surface-55p.5` |
| `BQA-009` | `surface-55p.9` | `surface qa`, `surface explore`, evidence, replay, and cleanup CLI | `surface-55p.6`, `surface-55p.7`, `surface-55p.8` |
| `BQA-010` | `surface-55p.10` | QA reports and flow-aware gates | `surface-55p.5`, `surface-55p.7`, `surface-55p.9` |
| `BQA-011` | `surface-55p.11` | MCP QA tools and redacted artifact reads | `surface-55p.9`, `surface-55p.10` |
| `BQA-012` | `surface-55p.12` | Seeded fixtures, e2e coverage, and compatibility gates | `surface-55p.6`, `surface-55p.8`, `surface-55p.9`, `surface-55p.10`, `surface-55p.11` |

## Implementation Tasks

### Task BQA-001: QA Domain Schemas And Sidecar State

**Files:**

- Create: `packages/core/src/browser-qa/schemas.ts`
- Create: `packages/core/src/browser-qa/state-store.ts`
- Create: `packages/core/src/browser-qa/schemas.test.ts`
- Create: `packages/core/src/browser-qa/state-store.test.ts`
- Create: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/interfaces.ts`

**Acceptance Criteria:**

- QA ids validate by prefix: `qa_`, `flowrun_`, `qfc_`, `qflow_`, and `ev_`.
- `QaRunStore.writeRun()` atomically commits `.surface/qa/runs/<qaRunId>/manifest.json` through a same-filesystem temp path.
- Shared refs and indexes are updated through short `StateStore`-coordinated writes, but an exact run id remains readable from the unique manifest if the shared index is missing.
- Candidate, flow, evidence, and promoted-finding sidecars have exact-id fallback paths and cross-verification fields.
- Top-level `.surface/state.json` does not receive embedded QA run records.

- [ ] **Step 1: Add failing schema tests**

  Add tests in `packages/core/src/browser-qa/schemas.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import {
    CandidateFindingSchema,
    EvidenceBundleSchema,
    FlowRunSchema,
    QaRunSchema,
  } from "./schemas.js";

  describe("browser QA schemas", () => {
    it("accepts valid QA ids and rejects wrong prefixes", () => {
      expect(QaRunSchema.safeParse(makeQaRun({ id: "qa_seed" })).success).toBe(true);
      expect(QaRunSchema.safeParse(makeQaRun({ id: "run_seed" })).success).toBe(false);
      expect(FlowRunSchema.safeParse(makeFlowRun({ id: "flowrun_seed" })).success).toBe(true);
      expect(CandidateFindingSchema.safeParse(makeCandidate({ id: "qfc_seed" })).success).toBe(
        true,
      );
      expect(EvidenceBundleSchema.safeParse(makeEvidence({ id: "ev_seed" })).success).toBe(true);
    });

    it("requires fallback verification refs on unique sidecars", () => {
      const parsed = CandidateFindingSchema.safeParse(
        makeCandidate({
          id: "qfc_seed",
          qaRunId: "qa_seed",
          evidenceBundleId: "ev_seed",
          sourceRunManifestDigest: "sha256:abc",
        }),
      );

      expect(parsed.success).toBe(true);
    });
  });
  ```

  Add local `makeQaRun`, `makeFlowRun`, `makeCandidate`, and `makeEvidence` fixtures in the same test file with complete valid objects.

- [ ] **Step 2: Add failing state-store tests**

  Add tests in `packages/core/src/browser-qa/state-store.test.ts`:

  ```ts
  import { mkdtemp, readFile } from "node:fs/promises";
  import os from "node:os";
  import path from "node:path";
  import { describe, expect, it } from "vitest";

  import { createFileStateStore } from "../state-store.js";
  import { createFileQaRunStore } from "./state-store.js";

  describe("QaRunStore", () => {
    it("commits run manifests under .surface/qa without embedding QA arrays in state.json", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-qa-state-"));
      const stateStore = createFileStateStore({ projectRoot });
      const qaStore = createFileQaRunStore({ projectRoot, stateStore });

      await expect(qaStore.writeRun(makeQaRun({ id: "qa_state" }))).resolves.toMatchObject({
        ok: true,
      });

      const manifest = JSON.parse(
        await readFile(
          path.join(projectRoot, ".surface", "qa", "runs", "qa_state", "manifest.json"),
          "utf8",
        ),
      );
      expect(manifest.id).toBe("qa_state");

      const state = await stateStore.readState();
      expect(state.ok).toBe(true);
      if (state.ok) {
        expect(state.value).not.toHaveProperty("qaRuns");
      }
    });

    it("reads an exact run manifest when shared indexes are absent", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-qa-state-"));
      const qaStore = createFileQaRunStore({
        projectRoot,
        stateStore: createFileStateStore({ projectRoot }),
      });

      await qaStore.writeRun(makeQaRun({ id: "qa_exact" }));
      const result = await qaStore.readRun("qa_exact");

      expect(result).toMatchObject({ ok: true, value: { id: "qa_exact" } });
    });
  });
  ```

- [ ] **Step 3: Implement schemas and exported types**

  In `packages/core/src/browser-qa/schemas.ts`, define Zod schemas and `z.infer` types for the spec data model. Include:

  ```ts
  export const QaRunIdSchema = z.string().regex(/^qa_[A-Za-z0-9_-]+$/);
  export const FlowRunIdSchema = z.string().regex(/^flowrun_[A-Za-z0-9_-]+$/);
  export const CandidateFindingIdSchema = z.string().regex(/^qfc_[A-Za-z0-9_-]+$/);
  export const CandidateFlowIdSchema = z.string().regex(/^qflow_[A-Za-z0-9_-]+$/);
  export const EvidenceBundleIdSchema = z.string().regex(/^ev_[A-Za-z0-9_-]+$/);
  export const QaSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
  export const QaStatusSchema = z.enum(["completed", "degraded", "failed"]);
  ```

  Export schemas for `Target`, `QaDegradation`, `BrowserAction`, `FlowStepResult`, `FlowRun`, `QaRun`, `ExplorationState`, `CandidateFinding`, `CandidateFlow`, `EvidenceBundle`, `QaEvidenceArtifact`, and exact fallback sidecars.

- [ ] **Step 4: Implement the file-backed QA store**

  In `packages/core/src/browser-qa/state-store.ts`, implement:

  ```ts
  export function createFileQaRunStore(options: FileQaRunStoreOptions): QaRunStore {
    return new FileQaRunStore(options);
  }
  ```

  The store writes JSON through a temp directory below `.surface/tmp/qa/<qaRunId>/`, fsyncs the manifest file and containing directory, then renames into `.surface/qa/runs/<qaRunId>/manifest.json`. Shared `latest.json`, promoted-finding refs, and indexes use the provided `StateStore` for lock coordination. Exact-id readers validate ids, reject path traversal, parse with the matching schema, and verify referenced digests before returning records.

- [ ] **Step 5: Export the browser QA module**

  Add `packages/core/src/browser-qa/index.ts` exports and re-export them from `packages/core/src/index.ts`:

  ```ts
  export * from "./schemas.js";
  export * from "./state-store.js";
  ```

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/schemas.test.ts browser-qa/state-store.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: the two new suites and core typecheck pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa packages/core/src/index.ts packages/core/src/interfaces.ts
  git commit -m "feat(core): add browser qa state model"
  ```

### Task BQA-002: Action Policy And Destructive Classifier

**Files:**

- Create: `packages/core/src/browser-qa/action-policy.ts`
- Create: `packages/core/src/browser-qa/action-policy.test.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/errors.ts`

**Acceptance Criteria:**

- Built-in safe policy allows navigation and reveal-only interactions.
- Submit, save, delete, clear, upload, payment, account, externally visible, and persistent mutations are denied unless an explicit target-bound policy authorizes them.
- `--base-url` and `--target` effective origins are used for allowed domains and destructive rules instead of YAML defaults.
- Fixture paths reject absolute paths, `..` segments, and symlink escapes.
- Mutating CI flows without reset, teardown, or fixture-account contracts return `flow_invalid` before driver launch.

- [ ] **Step 1: Add failing action-policy tests**

  Add `packages/core/src/browser-qa/action-policy.test.ts`:

  ```ts
  import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
  import os from "node:os";
  import path from "node:path";
  import { describe, expect, it } from "vitest";

  import {
    classifyBrowserAction,
    createBuiltInSafeActionPolicy,
    resolveActionPolicy,
    validateFlowIsolationPolicy,
  } from "./action-policy.js";

  describe("browser QA action policy", () => {
    it("denies form submit without an explicit target-bound rule", () => {
      const policy = createBuiltInSafeActionPolicy();
      const decision = classifyBrowserAction({
        action: { action: "click", locator: { role: "button", name: "Pay now" } },
        effectiveTarget: { kind: "url", ref: "https://app.example.test/checkout" },
        policy,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.code).toBe("action_policy_denied");
    });

    it("evaluates destructive rules against the effective base-url origin", () => {
      const decision = classifyBrowserAction({
        action: { action: "click", locator: { role: "button", name: "Delete account" } },
        effectiveTarget: { kind: "url", ref: "https://preview.example.test/settings" },
        policy: makePolicyAllowingOrigin("https://app.example.test"),
      });

      expect(decision.allowed).toBe(false);
    });

    it("rejects fixture symlink escapes", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-qa-policy-"));
      await mkdir(path.join(projectRoot, ".surface", "qa"), { recursive: true });
      await mkdir(path.join(projectRoot, "fixtures"), { recursive: true });
      await writeFile(path.join(projectRoot, "outside.json"), "{}");
      await symlink(
        path.join(projectRoot, "outside.json"),
        path.join(projectRoot, "fixtures", "fixture.json"),
      );
      await writeFile(
        path.join(projectRoot, ".surface", "qa", "action-policy.json"),
        JSON.stringify({
          fixtureAccounts: [{ fixtureRef: "fixtures/fixture.json", id: "checkoutUser" }],
        }),
      );

      const result = await resolveActionPolicy({
        projectRoot,
        policyRef: ".surface/qa/action-policy.json",
        fixtureRoots: ["fixtures"],
      });

      expect(result.ok).toBe(false);
    });

    it("fails mutating CI flows without reset contracts", () => {
      const result = validateFlowIsolationPolicy({
        ci: true,
        flow: makeFlow({ isolation: { mutatesState: true, resetRequired: true } }),
        policy: createBuiltInSafeActionPolicy(),
      });

      expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
    });
  });
  ```

- [ ] **Step 2: Extend schemas for action policy**

  Add `ActionPolicySchema`, `ActionPolicyRuleSchema`, `ResetEndpointSchema`, `FixtureAccountSchema`, `EnvironmentGroupSchema`, and `ActionPolicyDecisionSchema` in `schemas.ts`.

- [ ] **Step 3: Implement built-in safe policy and classifier**

  Implement these exports in `action-policy.ts`:

  ```ts
  export function createBuiltInSafeActionPolicy(): ActionPolicy;
  export function classifyBrowserAction(input: ClassifyBrowserActionInput): ActionPolicyDecision;
  export function validateFlowIsolationPolicy(
    input: ValidateFlowIsolationPolicyInput,
  ): Result<FlowIsolationPolicyValidation, SurfaceError>;
  ```

  Use semantic hints from action type, role/name text, URL path, form metadata, upload fields, and flow isolation metadata. Record denied actions as coverage entries when called by exploration.

- [ ] **Step 4: Implement secure policy and fixture loading**

  Implement:

  ```ts
  export async function resolveActionPolicy(
    input: ResolveActionPolicyInput,
  ): Promise<Result<ResolvedActionPolicy, SurfaceError>>;
  ```

  Resolution order is CLI path, flow `actionPolicy.ref`, `.surface/qa/action-policy.json`, project config, built-in safe policy. Reject absolute paths and `..` segments before resolution, then `realpath` and verify project-root or configured fixture-root containment.

- [ ] **Step 5: Export action policy helpers**

  Add exports to `packages/core/src/browser-qa/index.ts`.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/action-policy.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: action-policy suite and core typecheck pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/action-policy.ts packages/core/src/browser-qa/action-policy.test.ts packages/core/src/browser-qa/schemas.ts packages/core/src/browser-qa/index.ts
  git commit -m "feat(core): add browser qa action policy"
  ```

### Task BQA-003: Secret-Safe Agent Browser Driver

**Files:**

- Create: `packages/core/src/browser-qa/agent-browser-driver.ts`
- Create: `packages/core/src/browser-qa/agent-browser-driver.test.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/errors.ts`

**Acceptance Criteria:**

- Driver availability check returns `qa_unavailable` when `agent-browser` cannot be executed.
- Resolved secrets are passed only through in-memory payloads, not command arguments or persisted temp files.
- Child process environment uses an allowlist and rejects sensitive names such as `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, `COOKIE`, and `AUTH`.
- Session manifests contain Surface-owned session tokens, process-group records, lockfile paths, browser profile directories, executable signatures, and start times when available.
- Cleanup validates Surface ownership before signaling and never acts on PID alone.

- [ ] **Step 1: Add failing driver tests with a fake process runner**

  Add `packages/core/src/browser-qa/agent-browser-driver.test.ts`:

  ```ts
  import { describe, expect, it, vi } from "vitest";

  import {
    createAgentBrowserCliDriver,
    createAgentBrowserEnvironment,
    redactAgentBrowserCommand,
  } from "./agent-browser-driver.js";

  describe("agent-browser driver", () => {
    it("keeps secrets out of command arguments and child env", async () => {
      const run = vi.fn().mockResolvedValue(makeCommandResult({ stdout: "{}" }));
      const driver = createAgentBrowserCliDriver({ runCommand: run });

      await driver.fill({
        locator: { label: "Password" },
        valueRef: { kind: "secret", name: "testPassword", value: "super-secret" },
      });

      expect(run.mock.calls[0][0].args).not.toContain("super-secret");
      expect(run.mock.calls[0][0].env).not.toHaveProperty("SURFACE_QA_TEST_PASSWORD");
    });

    it("builds an allowlisted child environment", () => {
      const env = createAgentBrowserEnvironment({
        baseEnv: {
          PATH: "/usr/bin",
          SURFACE_QA_TEST_PASSWORD: "secret",
          API_TOKEN: "token",
          api_token: "lowercase-token",
          password: "lowercase-password",
          CI: "1",
        },
      });

      expect(env).toEqual({ PATH: "/usr/bin", CI: "1" });
    });

    it("redacts commands before logging", () => {
      expect(
        redactAgentBrowserCommand(["agent-browser", "fill", "--value", "super-secret"], [
          "super-secret",
        ]),
      ).toEqual(["agent-browser", "fill", "--value", "[REDACTED]"]);
    });
  });
  ```

- [ ] **Step 2: Define the driver interface**

  In `agent-browser-driver.ts`, define `BrowserQaDriver` methods for `startSession`, `stopSession`, `navigate`, `click`, `fill`, `type`, `press`, `hover`, `select`, `upload`, `scroll`, `wait`, `captureState`, `getConsoleSummary`, `getNetworkSummary`, `getReactDiagnostics`, `getVitals`, and `cleanupStaleSessions`.

- [ ] **Step 3: Implement the CLI-backed adapter**

  Implement `createAgentBrowserCliDriver()` around an injectable command runner. Construct commands with non-secret flags only. Send sensitive action values through stdin or an injected private payload channel. Return structured driver results parsed through Zod schemas.

- [ ] **Step 4: Implement session lifecycle and cleanup guards**

  Write session records under `.surface/tmp/qa/<qaRunId>/sessions/` before browser launch. `cleanupStaleSessions()` validates session token, process group, executable path or command signature, start time when available, and Surface-owned lockfile before signaling.

- [ ] **Step 5: Add error codes and exports**

  Add `qa_unavailable` and driver-specific usages of `flow_step_failed` to `packages/core/src/errors.ts`, then export driver helpers from `browser-qa/index.ts`.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/agent-browser-driver.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: driver suite and typecheck pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/agent-browser-driver.ts packages/core/src/browser-qa/agent-browser-driver.test.ts packages/core/src/browser-qa/schemas.ts packages/core/src/browser-qa/index.ts packages/core/src/errors.ts
  git commit -m "feat(core): add agent-browser qa driver"
  ```

### Task BQA-004: Flow YAML Parser And Target Resolution

**Files:**

- Create: `packages/core/src/browser-qa/flow-parser.ts`
- Create: `packages/core/src/browser-qa/flow-parser.test.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/errors.ts`
- Modify: `packages/core/package.json`

**Acceptance Criteria:**

- Versioned YAML flow files parse through Zod and reject inline secret literals.
- Target precedence is `--target` or `--url`, then `--base-url` origin substitution, then flow target, then config, then built-in defaults when available.
- `--localhost` accepts no value in QA command parsers and maps to `http://localhost:3000`.
- Flow `refHint` is stored as a hint only; semantic locator fields remain the authoritative action intent.
- Legacy route-target task-flow recipes import to `open` plus `capture` browser-action flows and include a warning that interaction semantics were not inferred.

- [ ] **Step 1: Add failing parser tests**

  Add `packages/core/src/browser-qa/flow-parser.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import {
    importLegacyRouteFlow,
    parseBrowserQaFlow,
    resolveFlowTarget,
  } from "./flow-parser.js";

  describe("browser QA flow parser", () => {
    it("parses a checkout flow with semantic locators and secret refs", () => {
      const result = parseBrowserQaFlow(checkoutYaml, { sourcePath: "surface-flows/checkout.yml" });

      expect(result).toMatchObject({
        ok: true,
        value: {
          id: "checkout",
          steps: [
            { id: "open-cart", action: "open" },
            { id: "start-checkout", locator: { role: "button", name: "Checkout" } },
          ],
        },
      });
    });

    it("rejects inline secret literals", () => {
      const result = parseBrowserQaFlow(secretLiteralYaml, { sourcePath: "bad.yml" });

      expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
    });

    it("uses base-url origin substitution before action policy binding", () => {
      const target = resolveFlowTarget({
        cli: { baseUrl: "https://preview.example.test" },
        flowTarget: { kind: "url", ref: "https://app.example.test/cart" },
      });

      expect(target).toEqual({ kind: "url", ref: "https://preview.example.test/cart" });
    });

    it("imports legacy route flows as open and capture steps", () => {
      const imported = importLegacyRouteFlow({
        id: "legacy",
        targets: ["/cart", "/checkout"],
      });

      expect(imported.steps.map((step) => step.action)).toEqual(["open", "capture", "open", "capture"]);
      expect(imported.degradation[0].code).toBe("legacy_flow_imported_without_interactions");
    });
  });
  ```

- [ ] **Step 2: Extend flow schemas**

  Add schemas for flow files, flow steps, locators, waits, assertions, capture options, input refs, secret refs, fixture refs, generated values, viewport, theme, and teardown. Do not accept frame-scoped steps in v1.

- [ ] **Step 3: Implement YAML parsing**

  Use `yaml` from core dependencies:

  ```ts
  import { parse as parseYaml } from "yaml";
  ```

  Parse unknown YAML, validate with `BrowserQaFlowSchema`, and return `Result<BrowserQaFlow, SurfaceError>`. Reject secret values unless each secret entry is a reference such as `{ fromEnv: "SURFACE_QA_TEST_PASSWORD" }`.

- [ ] **Step 4: Implement target and option resolution**

  Implement `resolveFlowTarget()` and `resolveQaOptions()` with precedence from the spec. When `--base-url` is present, replace only the origin for relative or absolute flow URLs and recompute allowed domains from the effective origin.

- [ ] **Step 5: Implement legacy importer**

  Add `importLegacyRouteFlow()` for existing route-target task-flow recipes. It emits alternating `open` and `capture` steps and attaches a degradation warning that no browser interactions were inferred.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/flow-parser.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: parser suite and typecheck pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/flow-parser.ts packages/core/src/browser-qa/flow-parser.test.ts packages/core/src/browser-qa/schemas.ts packages/core/src/browser-qa/index.ts packages/core/package.json
  git commit -m "feat(core): parse browser qa flows"
  ```

### Task BQA-005: QA Evidence Store And Artifact Read Fallback

**Files:**

- Create: `packages/core/src/browser-qa/evidence-store.ts`
- Create: `packages/core/src/browser-qa/evidence-store.test.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/browser-qa/state-store.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/errors.ts`

**Acceptance Criteria:**

- Evidence bundles are immutable after commit and record manifest digest, artifact digests, sizes, media types, sensitivity flags, and owning QA refs.
- Artifact bytes are sanitized before persistence, content-addressed by digest, and checksum verified on read.
- `surface_artifact_read` core helper accepts registered ids only; rejects raw paths, absolute paths, symlinks, `..`, and unregistered content-addressed blobs.
- Raw HAR bodies, cookies, auth state, local storage, headers, unredacted screenshots/videos, and `sensitiveRaw` artifacts are never MCP-readable.
- Missing shared indexes do not prevent exact evidence id fallback reads when sidecars cross-verify.

- [ ] **Step 1: Add failing evidence-store tests**

  Add `packages/core/src/browser-qa/evidence-store.test.ts`:

  ```ts
  import { mkdtemp } from "node:fs/promises";
  import os from "node:os";
  import path from "node:path";
  import { describe, expect, it } from "vitest";

  import { createFileStateStore } from "../state-store.js";
  import { createFileQaEvidenceStore } from "./evidence-store.js";

  describe("QaEvidenceStore", () => {
    it("writes sanitized bytes to content-addressed storage and verifies digest on read", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-qa-evidence-"));
      const store = createFileQaEvidenceStore({
        projectRoot,
        stateStore: createFileStateStore({ projectRoot }),
      });

      const committed = await store.writeBundle({
        bundle: makeEvidence({ id: "ev_digest", qaRunId: "qa_digest" }),
        artifacts: [
          {
            bytes: Buffer.from("Authorization: [REDACTED]\nGET /checkout"),
            id: "art_network",
            mediaType: "text/plain",
            qaKind: "network-summary",
          },
        ],
      });

      expect(committed.ok).toBe(true);
      const read = await store.readArtifactByRegisteredRef({
        refId: "ev_digest",
        artifactId: "art_network",
        maxBytes: 1024,
      });
      expect(read).toMatchObject({ ok: true, value: { text: expect.stringContaining("/checkout") } });
    });

    it("rejects raw paths and sensitive raw artifacts", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-qa-evidence-"));
      const store = createFileQaEvidenceStore({
        projectRoot,
        stateStore: createFileStateStore({ projectRoot }),
      });

      await store.writeBundle(makeSensitiveEvidenceBundleInput());

      await expect(
        store.readArtifactByRegisteredRef({
          refId: "../ev_sensitive",
          artifactId: "art_har",
          maxBytes: 1024,
        }),
      ).resolves.toMatchObject({ ok: false });
      await expect(
        store.readArtifactByRegisteredRef({
          refId: "ev_sensitive",
          artifactId: "../art_har",
          maxBytes: 1024,
        }),
      ).resolves.toMatchObject({ ok: false });
      await expect(
        store.readArtifactByRegisteredRef({
          refId: "ev_sensitive",
          artifactId: "art_har",
          maxBytes: 1024,
        }),
      ).resolves.toMatchObject({ ok: false, error: { code: "evidence_unavailable" } });
    });
  });
  ```

- [ ] **Step 2: Implement immutable bundle writes**

  Add `createFileQaEvidenceStore()` with `writeBundle()`, `readBundle()`, `readArtifactByRegisteredRef()`, and retention metadata APIs. Reuse the existing state artifact path validation helpers where accessible; otherwise introduce narrow shared helpers in `state-store.ts` without weakening existing checks.

- [ ] **Step 3: Implement redaction and sensitivity gates**

  Drop or mask `Authorization`, `Cookie`, `Set-Cookie`, CSRF tokens, local storage values, auth headers, query strings where configured, request/response bodies, and configured secret patterns before writing bytes. Mark screenshots/videos sensitive by default and expose only metadata through read helpers.

- [ ] **Step 4: Implement exact-id fallback reads**

  Resolve `ev_*`, `qa_*`, `qfc_*`, `qflow_*`, and `f_*` through unique sidecars. Recompute manifest digest, artifact digest, and sidecar digest, then verify ownership fields before reading a blob.

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/evidence-store.test.ts browser-qa/state-store.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: evidence and state suites pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/evidence-store.ts packages/core/src/browser-qa/evidence-store.test.ts packages/core/src/browser-qa/schemas.ts packages/core/src/browser-qa/state-store.ts packages/core/src/browser-qa/index.ts
  git commit -m "feat(core): persist browser qa evidence"
  ```

### Task BQA-006: Deterministic Flow Runner And `surface flow`

**Files:**

- Create: `packages/core/src/browser-qa/flow-runner.ts`
- Create: `packages/core/src/browser-qa/flow-runner.test.ts`
- Create: `packages/cli/src/browser-qa-commands.ts`
- Create: `packages/cli/src/browser-qa-commands.test.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/core/src/composition-factory.ts`
- Modify: `packages/cli/src/index.ts`

**Acceptance Criteria:**

- `FlowRunner` executes supported action types with semantic locator resolution, waits, assertions, capture options, teardown, and idempotent assertion retries.
- `refHint` is used only after role/name or other semantic identity validation.
- Failed steps record highest failed severity, evidence bundle ids, repro steps, and `flow_step_failed`.
- `surface flow run`, `surface flow list`, `surface flow show`, `surface flow promote`, and `surface flow update-refs` parse and return Surface JSON envelopes.
- `surface flow run --target`, `--url`, `--localhost`, and `--base-url` follow spec precedence and usage errors exit with code 2.

- [ ] **Step 1: Add failing core flow-runner tests**

  Add `packages/core/src/browser-qa/flow-runner.test.ts` with a fake driver:

  ```ts
  import { describe, expect, it, vi } from "vitest";

  import { createFlowRunner } from "./flow-runner.js";

  describe("FlowRunner", () => {
    it("executes steps in order and captures failed assertion evidence", async () => {
      const driver = makeFakeDriver({
        assertText: vi.fn().mockResolvedValue({ ok: false, error: "missing text" }),
      });
      const evidenceStore = makeFakeEvidenceStore();
      const runner = createFlowRunner({ driver, evidenceStore, qaStore: makeFakeQaStore() });

      const result = await runner.runFlow(makeFlow({ id: "checkout" }), {
        qaRunId: "qa_flow",
        target: { kind: "url", ref: "http://localhost:3000" },
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "failed",
          highestFailedSeverity: "high",
          steps: expect.arrayContaining([
            expect.objectContaining({ id: "submit-empty-payment", status: "failed" }),
          ]),
        },
      });
      expect(evidenceStore.writeBundle).toHaveBeenCalled();
    });

    it("runs teardown without masking the original failure", async () => {
      const runner = createFlowRunner({
        driver: makeFakeDriver({ clickFails: true, teardownDenied: true }),
        evidenceStore: makeFakeEvidenceStore(),
        qaStore: makeFakeQaStore(),
      });

      const result = await runner.runFlow(makeMutatingFlowWithTeardown(), makeRunContext());

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: "failed",
          degradation: [expect.objectContaining({ scope: "teardown" })],
        },
      });
    });
  });
  ```

- [ ] **Step 2: Add failing CLI flow tests**

  Add `packages/cli/src/browser-qa-commands.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createSurfaceCli } from "./index.js";

  describe("surface flow CLI", () => {
    it("rejects --localhost values for browser QA commands", async () => {
      const result = await runCli(createSurfaceCli(), [
        "flow",
        "run",
        "surface-flows/checkout.yml",
        "--localhost=5173",
        "--json",
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("--localhost");
    });

    it("prints a JSON envelope for flow run", async () => {
      const result = await runCliWithFakeComposition([
        "flow",
        "run",
        "surface-flows/checkout.yml",
        "--url",
        "http://localhost:5173",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        command: "flow run",
        schemaVersion: "1.0",
        data: { flowRunId: "flowrun_checkout" },
      });
    });
  });
  ```

- [ ] **Step 3: Implement `FlowRunner`**

  Implement action dispatch for `open`, `pushstate`, `click`, `dblclick`, `hover`, `focus`, `fill`, `type`, `press`, `check`, `uncheck`, `select`, `upload`, `scroll`, `wait`, `capture`, `assert`, `setViewport`, and `setTheme`. Every mutating action calls the action policy classifier before driver execution. Every failed step records the exact action, locator, wait/assertion signal, severity, and evidence bundle. `switchFrame` and per-step frame targeting are future work.

- [ ] **Step 4: Implement CLI flow commands**

  In `packages/cli/src/browser-qa-commands.ts`, export:

  ```ts
  export function registerBrowserQaCommands(program: Command, options: BrowserQaCliOptions): void;
  ```

  Register `surface flow run`, `list`, `show`, `promote`, and `update-refs`. Use existing CLI envelope helpers and error handling. Use Surface glob expansion for quoted flow globs.

- [ ] **Step 5: Wire composition and CLI index**

  Add browser QA factory accessors to `packages/core/src/composition-factory.ts`. Import `registerBrowserQaCommands()` in `packages/cli/src/index.ts` and pass the default composition.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/flow-runner.test.ts
  pnpm --filter @zigrivers/surface test -- browser-qa-commands.test.ts index.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  pnpm --filter @zigrivers/surface typecheck
  ```

  Expected: new core and CLI tests pass; old CLI index tests still pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/flow-runner.ts packages/core/src/browser-qa/flow-runner.test.ts packages/core/src/browser-qa/index.ts packages/core/src/composition-factory.ts packages/cli/src/browser-qa-commands.ts packages/cli/src/browser-qa-commands.test.ts packages/cli/src/index.ts
  git commit -m "feat(cli): add browser qa flow commands"
  ```

### Task BQA-007: Replay, Candidate Promotion, And Tracked Findings

**Files:**

- Create: `packages/core/src/browser-qa/replay-promoter.ts`
- Create: `packages/core/src/browser-qa/replay-promoter.test.ts`
- Modify: `packages/core/src/browser-qa/state-store.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/tracked-findings.ts`
- Modify: `packages/core/src/verdicts.ts`
- Modify: `packages/core/src/index.ts`

**Acceptance Criteria:**

- Replay promotes a candidate only when the original issue condition reproduces or a measured signal recurs.
- Clean flow pass marks the candidate `not-reproduced` and does not promote.
- Human verdict promotion can create a normal reportable finding while marking automated replay eligibility separately.
- Promoted findings store refs to candidate id, evidence bundle id, source QA run id, manifest paths, and artifact checksums.
- Stable finding identity includes route, action path, element refs, role/name, selectors, and component mapping when present.

- [ ] **Step 1: Add failing replay and promotion tests**

  Add `packages/core/src/browser-qa/replay-promoter.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createReplayPromoter } from "./replay-promoter.js";

  describe("ReplayPromoter", () => {
    it("promotes replayable candidates when the issue reproduces", async () => {
      const promoter = createReplayPromoter(makeReplayHarness({ reproduced: true }));

      const result = await promoter.replayCandidate("qfc_checkout", {
        promoteOnRepro: true,
        qaRunId: "qa_replay",
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          replayStatus: "reproduced",
          promotion: { findingId: expect.stringMatching(/^f_/) },
        },
      });
    });

    it("does not promote when replay passes cleanly", async () => {
      const promoter = createReplayPromoter(makeReplayHarness({ reproduced: false }));

      const result = await promoter.replayCandidate("qfc_checkout", {
        promoteOnRepro: true,
        qaRunId: "qa_replay_clean",
      });

      expect(result).toMatchObject({
        ok: true,
        value: { replayStatus: "not-reproduced", promotion: undefined },
      });
    });

    it("records human verdict promotion as non-automated until replay confirms", async () => {
      const promoter = createReplayPromoter(makeReplayHarness({}));

      const result = await promoter.promoteCandidateByVerdict("qfc_checkout", {
        reason: "Confirmed during manual QA",
        verdictId: "verdict_manual",
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          promotionSource: "human-verdict",
          gateEligible: true,
          replayStatus: "not-run",
        },
      });
    });
  });
  ```

- [ ] **Step 2: Implement replay orchestration**

  `ReplayPromoter.replayCandidate()` loads candidate sidecar, resolves its candidate flow or repro action path, runs `FlowRunner`, compares the reproduced condition against the original failed assertion or measured signal, and updates candidate replay status.

- [ ] **Step 3: Implement promotion sidecars**

  Write `.surface/qa/refs/promoted-findings/<findingId>.json` with source candidate, run, evidence, manifest digest, artifact checksums, promotion source, reason, and timestamp. Cross-verify with normal tracked finding creation.

- [ ] **Step 4: Extend verdict promotion bridge**

  Update verdict code so `surface verdict 'qfc_*' --promote` calls the promotion bridge and preserves replay eligibility fields. Existing finding verdict behavior remains unchanged.

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/replay-promoter.test.ts verdicts.test.ts tracked-findings.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: replay, verdict, tracked-finding, and typecheck suites pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/replay-promoter.ts packages/core/src/browser-qa/replay-promoter.test.ts packages/core/src/browser-qa/state-store.ts packages/core/src/browser-qa/schemas.ts packages/core/src/tracked-findings.ts packages/core/src/verdicts.ts packages/core/src/index.ts
  git commit -m "feat(core): promote replayed browser qa candidates"
  ```

### Task BQA-008: Bounded Explorer And Candidate Flow Generation

**Files:**

- Create: `packages/core/src/browser-qa/explorer.ts`
- Create: `packages/core/src/browser-qa/explorer.test.ts`
- Modify: `packages/core/src/browser-qa/action-policy.ts`
- Modify: `packages/core/src/browser-qa/evidence-store.ts`
- Modify: `packages/core/src/browser-qa/state-store.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`
- Modify: `packages/core/src/browser-qa/index.ts`

**Acceptance Criteria:**

- Explorer honors `maxDepth`, `maxActions`, and `maxStates`, including policy-denied actions counted as attempted coverage.
- State ids include URL, title, viewport, theme, dialog state, frame path, auth status, and snapshot anchors where available.
- Safe interactions are prioritized by task and scope text, but natural-language text never directly executes browser actions.
- Candidate findings are not gate eligible until replay, measured confirmation, or human promotion.
- Candidate flows are persisted under `.surface/qa/flows/<qflowId>.json` with source run and evidence refs.

- [ ] **Step 1: Add failing explorer tests**

  Add `packages/core/src/browser-qa/explorer.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createBrowserQaExplorer } from "./explorer.js";

  describe("BrowserQaExplorer", () => {
    it("stops at configured exploration bounds and records degradation", async () => {
      const explorer = createBrowserQaExplorer(makeExplorerHarness({ states: 5 }));

      const result = await explorer.explore({
        qaRunId: "qa_explore",
        target: { kind: "url", ref: "http://localhost:3000" },
        maxDepth: 1,
        maxActions: 3,
        maxStates: 2,
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          visitedStates: 2,
          degradation: [expect.objectContaining({ code: "exploration_degraded" })],
        },
      });
    });

    it("records policy-denied actions as coverage without executing them", async () => {
      const harness = makeExplorerHarness({ deniedActionName: "Delete account" });
      const explorer = createBrowserQaExplorer(harness);

      const result = await explorer.explore(makeExploreInput());

      expect(harness.driver.click).not.toHaveBeenCalledWith(
        expect.objectContaining({ locator: expect.objectContaining({ name: "Delete account" }) }),
      );
      expect(result).toMatchObject({
        ok: true,
        value: { deniedActions: 1 },
      });
    });

    it("persists candidate flows as non-gate-eligible working memory", async () => {
      const explorer = createBrowserQaExplorer(makeExplorerHarness({ candidateFlow: true }));

      const result = await explorer.explore(makeExploreInput());

      expect(result).toMatchObject({
        ok: true,
        value: {
          candidateFlows: [expect.objectContaining({ id: expect.stringMatching(/^qflow_/) })],
          candidateFindings: [
            expect.objectContaining({ gateEligible: false, replayStatus: "not-run" }),
          ],
        },
      });
    });
  });
  ```

- [ ] **Step 2: Implement state capture and hashing**

  Derive `stateId` from URL, title, viewport, theme, dialog state, frame path, auth status, snapshot refs, and discovered semantic elements. Keep action path hashes stable across volatile `@eN` changes when role/name/test ids match.

- [ ] **Step 3: Implement bounded action queue**

  Build candidate actions from agent-browser snapshots and accessibility roles. Prioritize reveal/navigation actions before form submits. Use task and scope text as deterministic scoring inputs for candidate ordering and names, not as executable instructions.

- [ ] **Step 4: Generate candidates and flows**

  Persist candidate findings to `.surface/qa/candidates/<qfcId>.json` and candidate flows to `.surface/qa/flows/<qflowId>.json`. Attach evidence bundle refs, repro action paths, identity confidence, and replayability.

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/explorer.test.ts browser-qa/action-policy.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  ```

  Expected: explorer, policy, and typecheck suites pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/explorer.ts packages/core/src/browser-qa/explorer.test.ts packages/core/src/browser-qa/action-policy.ts packages/core/src/browser-qa/evidence-store.ts packages/core/src/browser-qa/state-store.ts packages/core/src/browser-qa/schemas.ts packages/core/src/browser-qa/index.ts
  git commit -m "feat(core): add bounded browser qa exploration"
  ```

### Task BQA-009: `surface qa`, `surface explore`, Evidence, Replay, And Cleanup CLI

**Files:**

- Create: `packages/core/src/browser-qa/orchestrator.ts`
- Create: `packages/core/src/browser-qa/orchestrator.test.ts`
- Modify: `packages/cli/src/browser-qa-commands.ts`
- Modify: `packages/cli/src/browser-qa-commands.test.ts`
- Modify: `packages/core/src/composition-factory.ts`
- Modify: `packages/core/src/browser-qa/index.ts`
- Modify: `packages/cli/src/index.ts`

**Acceptance Criteria:**

- `surface qa` runs reviewed flows first, explores when requested or when no flow coverage exists, and returns the specified QA JSON data.
- `surface explore` returns candidate-first output and accepts target, evidence, action-policy, session-mode, bounds, and lock-timeout options.
- `surface evidence` prints local refs, checksums, sizes, media types, redacted summaries, and never raw secrets.
- `surface replay` replays findings or candidates and supports `--promote-on-repro`.
- `surface qa cleanup` only targets validated Surface-owned stale sessions and supports `--dry-run --json`.

- [ ] **Step 1: Add failing orchestrator tests**

  Add `packages/core/src/browser-qa/orchestrator.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createBrowserQaOrchestrator } from "./orchestrator.js";

  describe("BrowserQaOrchestrator", () => {
    it("runs provided flows before exploration in hybrid mode", async () => {
      const harness = makeOrchestratorHarness();
      const orchestrator = createBrowserQaOrchestrator(harness);

      const result = await orchestrator.runQa({
        target: { kind: "url", ref: "http://localhost:3000" },
        flows: ["surface-flows/checkout.yml"],
        explore: true,
      });

      expect(harness.calls).toEqual(["flow:checkout", "explore"]);
      expect(result).toMatchObject({
        ok: true,
        value: {
          mode: "hybrid",
          flowRuns: [expect.objectContaining({ flowId: "checkout" })],
          exploration: expect.objectContaining({ visitedStates: expect.any(Number) }),
        },
      });
    });

    it("degrades unmatched flow globs when exploration is enabled", async () => {
      const result = await createBrowserQaOrchestrator(makeOrchestratorHarness()).runQa({
        target: { kind: "url", ref: "http://localhost:3000" },
        flows: ["surface-flows/missing-*.yml"],
        explore: true,
      });

      expect(result).toMatchObject({
        ok: true,
        value: { degradation: [expect.objectContaining({ code: "flow_glob_unmatched" })] },
      });
    });
  });
  ```

- [ ] **Step 2: Add failing CLI orchestration tests**

  Extend `packages/cli/src/browser-qa-commands.test.ts`:

  ```ts
  describe("surface qa CLI", () => {
    it("prints the QA JSON envelope", async () => {
      const result = await runCliWithFakeComposition([
        "qa",
        "--url",
        "http://localhost:3000",
        "--explore",
        "--json",
      ]);

      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        command: "qa",
        schemaVersion: "1.0",
        data: {
          qaRunId: expect.stringMatching(/^qa_/),
          candidateFindings: expect.any(Array),
          candidateFlows: expect.any(Array),
        },
      });
    });

    it("rejects multiple target flags with usage exit code", async () => {
      const result = await runCliWithFakeComposition([
        "qa",
        "--url",
        "http://localhost:3000",
        "--localhost",
        "--json",
      ]);

      expect(result.exitCode).toBe(2);
    });
  });
  ```

- [ ] **Step 3: Implement top-level orchestrator**

  `createBrowserQaOrchestrator()` composes `FlowRunner`, `BrowserQaExplorer`, `ReplayPromoter`, `QaRunStore`, `QaEvidenceStore`, and `BrowserQaDriver`. It manages run ids, status, degradation, session mode, lock timeout, run manifest commits, and stale-session checks before launch.

- [ ] **Step 4: Complete CLI command registration**

  Add `qa`, `explore`, `evidence`, `replay`, `report qa`, and `qa cleanup` to `browser-qa-commands.ts`. All JSON outputs use:

  ```json
  {
    "ok": true,
    "command": "qa",
    "schemaVersion": "1.0",
    "data": {}
  }
  ```

  Error paths use existing Surface error envelopes and exit codes 1 or 2 according to the spec.

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/orchestrator.test.ts
  pnpm --filter @zigrivers/surface test -- browser-qa-commands.test.ts index.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  pnpm --filter @zigrivers/surface typecheck
  ```

  Expected: orchestrator and CLI suites pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/orchestrator.ts packages/core/src/browser-qa/orchestrator.test.ts packages/core/src/browser-qa/index.ts packages/core/src/composition-factory.ts packages/cli/src/browser-qa-commands.ts packages/cli/src/browser-qa-commands.test.ts packages/cli/src/index.ts
  git commit -m "feat(cli): add browser qa orchestration commands"
  ```

### Task BQA-010: QA Reports And Flow-Aware Gates

**Files:**

- Create: `packages/core/src/browser-qa/reporting.ts`
- Create: `packages/core/src/browser-qa/reporting.test.ts`
- Modify: `packages/core/src/report-renderers.ts`
- Modify: `packages/core/src/report-renderers.test.ts`
- Modify: `packages/core/src/gate-evaluator.ts`
- Modify: `packages/core/src/gate-evaluator.test.ts`
- Modify: `packages/cli/src/browser-qa-commands.ts`
- Modify: `packages/cli/src/browser-qa-commands.test.ts`

**Acceptance Criteria:**

- `surface report qa --format md|json|manifest` renders redacted summaries, local refs, checksums, media types, and degradation.
- Reports never embed raw HAR bodies, cookies, local storage, auth headers, unredacted screenshots, or videos.
- `surface gate --with-flows` fails on configured flow failures and measured regressions, not on unverified exploratory candidates.
- In CI, gate self-heals required shared indexes from unique run manifests or fails closed.
- Existing measured-finding gate behavior is unchanged when `--with-flows` is absent.

- [ ] **Step 1: Add failing report tests**

  Add `packages/core/src/browser-qa/reporting.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createQaMarkdownReport, createQaReportManifest } from "./reporting.js";

  describe("browser QA reporting", () => {
    it("renders redacted QA markdown with artifact refs only", () => {
      const markdown = createQaMarkdownReport(makeQaReportInputWithSensitiveArtifacts());

      expect(markdown).toContain("qa_report");
      expect(markdown).toContain("ev_checkout");
      expect(markdown).not.toContain("Set-Cookie");
      expect(markdown).not.toContain("Authorization");
      expect(markdown).not.toContain("data:video");
    });

    it("renders manifest output with checksums and media types", () => {
      const manifest = createQaReportManifest(makeQaReportInput());

      expect(manifest.evidenceBundles[0]).toMatchObject({
        id: "ev_checkout",
        artifacts: [
          expect.objectContaining({
            checksum: expect.stringMatching(/^sha256:/),
            mediaType: "image/png",
          }),
        ],
      });
    });
  });
  ```

- [ ] **Step 2: Add failing gate tests**

  Extend `packages/core/src/gate-evaluator.test.ts`:

  ```ts
  it("fails with flows when reviewed high-severity flow failures exist", () => {
    const result = evaluateGateWithQaFlows({
      findings: [],
      policy: makeGatePolicy({ failOnFlowSeverityAtOrAbove: "high" }),
      qaFlowRuns: [
        {
          id: "flowrun_checkout",
          flowId: "checkout",
          status: "failed",
          highestFailedSeverity: "high",
          gateEligible: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: { passed: false, failingFlowRunIds: ["flowrun_checkout"] },
    });
  });

  it("does not fail gates on unverified exploratory candidates", () => {
    const result = evaluateGateWithQaFlows({
      findings: [],
      policy: makeGatePolicy({ failOnFlowSeverityAtOrAbove: "high" }),
      candidateFindings: [{ id: "qfc_candidate", gateEligible: false, severity: "critical" }],
    });

    expect(result).toMatchObject({ ok: true, value: { passed: true } });
  });
  ```

- [ ] **Step 3: Implement QA report renderers**

  Add markdown, JSON, and manifest renderers in `reporting.ts`. Reuse redaction helpers from `report-renderers.ts` and `export-redaction.ts`. Keep media bytes out of report strings.

- [ ] **Step 4: Add flow-aware gate adapter**

  Add an optional `qaFlowRuns` and `candidateFindings` context path to gate evaluation without changing default behavior. Map QA severities to gate thresholds explicitly.

- [ ] **Step 5: Wire CLI commands**

  Complete `surface report qa` and `surface gate --with-flows` options. `--with-flows` with a glob runs or loads flow results according to command arguments, then evaluates gate policy with verified flow runs.

- [ ] **Step 6: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-core test -- browser-qa/reporting.test.ts report-renderers.test.ts gate-evaluator.test.ts
  pnpm --filter @zigrivers/surface test -- browser-qa-commands.test.ts
  pnpm --filter @zigrivers/surface-core typecheck
  pnpm --filter @zigrivers/surface typecheck
  ```

  Expected: report, gate, CLI, and typecheck suites pass.

- [ ] **Step 7: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/core/src/browser-qa/reporting.ts packages/core/src/browser-qa/reporting.test.ts packages/core/src/report-renderers.ts packages/core/src/report-renderers.test.ts packages/core/src/gate-evaluator.ts packages/core/src/gate-evaluator.test.ts packages/cli/src/browser-qa-commands.ts packages/cli/src/browser-qa-commands.test.ts
  git commit -m "feat(core): add browser qa reports and gates"
  ```

### Task BQA-011: MCP QA Tools And Redacted Artifact Reads

**Files:**

- Create: `packages/mcp/src/browser-qa-tools.ts`
- Create: `packages/mcp/src/browser-qa-tools.test.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`
- Modify: `packages/core/src/browser-qa/evidence-store.ts`
- Modify: `packages/core/src/browser-qa/schemas.ts`

**Acceptance Criteria:**

- MCP registers `surface_qa`, `surface_explore`, `surface_flow_run`, `surface_flow_list`, `surface_flow_promote`, `surface_evidence`, `surface_replay`, `surface_report_qa`, `surface_verdict`, and `surface_artifact_read`.
- Tool schemas mirror CLI inputs and return structured data without shell-specific syntax.
- `surface_artifact_read` rejects raw paths, absolute paths, `..`, symlinks, unregistered CAS blobs, sensitive raw artifacts, and oversized default reads.
- Remote clients receive refs, summaries, dimensions, hashes, and policy-approved redacted thumbnails rather than raw local path traversal authority.
- Existing MCP analytical tools keep their order and schema behavior.

- [ ] **Step 1: Add failing MCP QA tool tests**

  Add `packages/mcp/src/browser-qa-tools.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";

  import { createBrowserQaMcpTools } from "./browser-qa-tools.js";

  describe("browser QA MCP tools", () => {
    it("registers agent-facing QA tools", () => {
      const tools = createBrowserQaMcpTools(makeFakeQaHandlers());

      expect(tools.map((tool) => tool.name)).toEqual([
        "surface_qa",
        "surface_explore",
        "surface_flow_run",
        "surface_flow_list",
        "surface_flow_promote",
        "surface_evidence",
        "surface_replay",
        "surface_report_qa",
        "surface_verdict",
        "surface_artifact_read",
      ]);
    });

    it("returns bounded redacted artifact summaries", async () => {
      const [artifactRead] = createBrowserQaMcpTools(makeFakeArtifactReadHandler()).filter(
        (tool) => tool.name === "surface_artifact_read",
      );

      const result = await artifactRead.handler({
        refId: "ev_checkout",
        artifactId: "art_console",
        maxBytes: 8192,
      });

      expect(result).toMatchObject({
        content: [
          {
            type: "text",
            text: expect.stringContaining("redacted"),
          },
        ],
      });
    });

    it("rejects caller-supplied paths", async () => {
      const [artifactRead] = createBrowserQaMcpTools(makeFakeArtifactReadHandler()).filter(
        (tool) => tool.name === "surface_artifact_read",
      );

      await expect(
        artifactRead.handler({ refId: "/tmp/secret", artifactId: "art_console" }),
      ).resolves.toMatchObject({ isError: true });
    });
  });
  ```

- [ ] **Step 2: Implement MCP tool definitions**

  In `browser-qa-tools.ts`, export `createBrowserQaMcpTools()` returning tool descriptors with Zod schemas and handlers. Map inputs directly to core orchestrator methods.

- [ ] **Step 3: Wire MCP index**

  Import the browser QA tools in `packages/mcp/src/index.ts`, append them to `TOOL_ORDER`, and add output schemas. Existing tool order remains stable before the new QA entries.

- [ ] **Step 4: Harden artifact read handler**

  Ensure MCP artifact reads call the exact-id evidence-store helper from Task BQA-005. The handler enforces default 8 KB summaries, explicit byte ranges, `mcpReadable: true`, redaction, and media-type-specific metadata.

- [ ] **Step 5: Run focused verification**

  Run:

  ```bash
  pnpm --filter @zigrivers/surface-mcp test -- browser-qa-tools.test.ts index.test.ts
  pnpm --filter @zigrivers/surface-mcp typecheck
  pnpm --filter @zigrivers/surface-core test -- browser-qa/evidence-store.test.ts
  ```

  Expected: MCP, MCP typecheck, and evidence tests pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add packages/mcp/src/browser-qa-tools.ts packages/mcp/src/browser-qa-tools.test.ts packages/mcp/src/index.ts packages/mcp/src/index.test.ts packages/core/src/browser-qa/evidence-store.ts packages/core/src/browser-qa/schemas.ts
  git commit -m "feat(mcp): expose browser qa tools"
  ```

### Task BQA-012: Seeded Fixtures, End-To-End Coverage, And Compatibility Gates

**Files:**

- Create: `fixtures/browser-qa/seeded-app/package.json`
- Create: `fixtures/browser-qa/seeded-app/src/App.tsx`
- Create: `fixtures/browser-qa/seeded-app/src/main.tsx`
- Create: `fixtures/browser-qa/seeded-app/src/server.ts`
- Create: `fixtures/browser-qa/flows/checkout.yml`
- Create: `fixtures/browser-qa/flows/settings-profile.yml`
- Create: `fixtures/browser-qa/action-policy.json`
- Create: `tests/e2e/browser-qa.e2e.test.ts`
- Modify: `tests/e2e/cli-smoke.e2e.test.ts`
- Modify: `package.json`
- Modify: package filter scripts only if the seeded fixture needs a workspace script.

**Acceptance Criteria:**

- Seeded app exposes deterministic checkout validation, settings save, billing denial, console error, failed network, modal, iframe, and auth-drift states.
- E2E tests exercise `surface flow run`, `surface explore`, `surface qa`, `surface evidence`, `surface replay`, `surface report qa`, `surface gate --with-flows`, and MCP artifact read where practical.
- Tests skip with a clear reason only when the real `agent-browser` binary is unavailable; core and CLI mock-driver tests still run unconditionally.
- Old CLI smoke tests prove existing commands still work.
- Full local quality gate passes or reports the exact failing command and failure.

- [ ] **Step 1: Add seeded fixture app**

  Create a small Vite/React or plain Node fixture that serves:

  - `/cart` with a `Checkout` button.
  - `/checkout` with email input and `Pay now` button.
  - `/checkout` empty payment assertion text: `Card number is required`.
  - `/settings/profile` with a profile-name form and policy-protected save.
  - `/billing` with `Delete account` and `Pay now` controls that policy denies by default.
  - `/console-error` that emits one known console error.
  - `/network-failure` that returns a known 500 response.
  - `/modal` with a reveal interaction.
  - `/iframe` with a titled payment frame.
  - `/auth-drift` that simulates logged-out state.

- [ ] **Step 2: Add reviewed fixture flows and policy**

  Add `fixtures/browser-qa/flows/checkout.yml` and `settings-profile.yml` using the schema from Task BQA-004. Add `fixtures/browser-qa/action-policy.json` that permits only the seeded reset endpoints, fixture account, and specific safe test mutations.

- [ ] **Step 3: Add E2E test harness**

  Add `tests/e2e/browser-qa.e2e.test.ts`:

  ```ts
  import { spawn } from "node:child_process";
  import { beforeAll, describe, expect, it } from "vitest";

  describe("browser QA CLI e2e", () => {
    beforeAll(async () => {
      await ensureAgentBrowserOrSkip();
      await startSeededBrowserQaFixture();
    });

    it("runs a reviewed checkout flow and writes evidence on failure", async () => {
      const result = await runSurface([
        "flow",
        "run",
        "fixtures/browser-qa/flows/checkout.yml",
        "--url",
        seededFixtureUrl(),
        "--evidence",
        "failures",
        "--json",
      ]);

      const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({
        ok: true,
        command: "flow run",
        data: {
          flowRunId: expect.stringMatching(/^flowrun_/),
          evidenceBundles: expect.any(Array),
        },
      });
    });

    it("runs hybrid QA and does not gate on unverified exploratory candidates", async () => {
      const qa = await runSurface([
        "qa",
        "--url",
        seededFixtureUrl(),
        "--flows",
        "fixtures/browser-qa/flows/*.yml",
        "--explore",
        "--json",
      ]);
      expect(JSON.parse(qa.stdout).data.candidateFindings).toBeInstanceOf(Array);

      const gate = await runSurface(["gate", "--with-flows", "--ci", "--json"]);
      expect([0, 1]).toContain(gate.exitCode);
    });
  });
  ```

- [ ] **Step 4: Add compatibility smoke coverage**

  Extend `tests/e2e/cli-smoke.e2e.test.ts` so existing `capture`, `audit`, `run`, `validate`, `gate`, and `status` commands still parse and return their pre-QA envelope shapes.

- [ ] **Step 5: Run full verification**

  Run:

  ```bash
  pnpm run format:check
  pnpm run lint
  pnpm run typecheck
  pnpm run test
  pnpm run test:e2e
  pnpm run benchmark:sc6
  pnpm run test:release
  ```

  Expected: all checks pass. If `agent-browser` is unavailable, `tests/e2e/browser-qa.e2e.test.ts` reports skipped real-browser cases while core and CLI tests still pass.

- [ ] **Step 6: Git checkpoint**

  If commit authority is active:

  ```bash
  git add fixtures/browser-qa tests/e2e/browser-qa.e2e.test.ts tests/e2e/cli-smoke.e2e.test.ts package.json
  git commit -m "test(e2e): add browser qa fixture coverage"
  ```

## Final Verification For The Whole Feature

Run these commands after all tasks land:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:e2e
pnpm run benchmark:sc6
pnpm run test:release
```

Expected: all checks pass. If any command fails, fix the failing slice before closing the related Bead.

## Rollout Notes

- Ship the mock-driver unit and CLI coverage before relying on a real browser binary in CI.
- Gate `agent-browser`-required E2E tests behind a clear availability check until CI installs the binary.
- Keep `surface qa` as the primary new user-facing experience while retaining `surface flow` for deterministic replay and `surface explore` for focused discovery.
- Use `.surface/qa` sidecars as the durable QA memory, and source-controlled `surface-flows/*.yml` as the reviewed regression contract.
