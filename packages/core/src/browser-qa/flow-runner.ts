import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isMap, isSeq, parseDocument, stringify as stringifyYaml } from "yaml";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { isSameOrChildPath } from "../path-safety.js";
import {
  classifyBrowserAction,
  createBuiltInSafeActionPolicy,
  effectiveTargetForAction,
  resolveActionPolicy,
  validateFlowIsolationPolicy,
} from "./action-policy.js";
import type {
  BrowserQaDriver,
  BrowserQaDriverActionInput,
  BrowserQaDriverValueRef,
} from "./agent-browser-driver.js";
import type { QaEvidenceStore } from "./evidence-store.js";
import {
  parseBrowserQaFlow,
  resolveFlowTarget,
  validateFlowTargetCli,
  type FlowTargetCliOptions,
} from "./flow-parser.js";
import type { QaRunStore } from "./state-store.js";
import type {
  ActionPolicy,
  BrowserAction,
  BrowserLocator,
  BrowserQaFlow,
  BrowserQaFlowStep,
  EvidenceBundle,
  FlowRun,
  FlowRunSummary,
  FlowStepResult,
  QaDegradation,
  QaRun,
  QaSeverity,
  QaTarget,
} from "./schemas.js";

export type FlowRunnerDriver = BrowserQaDriver;

export type FlowRunnerRunContext = {
  readonly actionPolicy?: ActionPolicy;
  readonly actionPolicyRef?: string;
  readonly ci?: boolean;
  readonly qaRunId: string;
  readonly source?: FlowRun["source"];
  readonly target: QaTarget;
};

export type FlowRunnerResult = FlowRun & {
  readonly degradation: readonly QaDegradation[];
};

export type FlowRunner = {
  runFlow(
    flow: BrowserQaFlow,
    context: FlowRunnerRunContext,
  ): Promise<Result<FlowRunnerResult, SurfaceError>>;
};

export type FlowRunnerOptions = {
  readonly actionPolicy?: ActionPolicy;
  readonly driver: FlowRunnerDriver;
  readonly evidenceStore: Pick<QaEvidenceStore, "writeBundle">;
  readonly now?: () => string;
  readonly qaStore: Pick<QaRunStore, "writeFlowRun">;
};

export type BrowserQaFlowServiceRunInput = {
  readonly actionPolicyRef?: string;
  readonly allowedDomains?: readonly string[];
  readonly ci?: boolean;
  readonly flowPath: string;
  readonly qaRunId?: string;
  readonly targetCli?: FlowTargetCliOptions;
  readonly writeRun?: boolean;
};

export type BrowserQaFlowServiceRunOutput = {
  readonly flowRun: FlowRunnerResult;
  readonly qaRunId: string;
};

export type BrowserQaFlowService = {
  runFlowFile(
    input: BrowserQaFlowServiceRunInput,
  ): Promise<Result<BrowserQaFlowServiceRunOutput, SurfaceError>>;
  listFlows(input?: {
    readonly candidates?: boolean;
  }): Promise<Result<{ readonly flows: readonly unknown[] }, SurfaceError>>;
  showFlow(id: string): Promise<Result<{ readonly flow: unknown }, SurfaceError>>;
  promoteFlow(input: { readonly candidateFlowId: string; readonly outPath: string }): Promise<
    Result<
      {
        readonly candidateFlowId: string;
        readonly outPath: string;
        readonly status: "written";
      },
      SurfaceError
    >
  >;
  updateFlowRefs(input: {
    readonly flowPath: string;
  }): Promise<Result<{ readonly flowId: string; readonly updatedRefs: number }, SurfaceError>>;
};

export type BrowserQaFlowServiceOptions = {
  readonly flowRunner: FlowRunner;
  readonly projectRoot?: string;
  readonly qaStore: Pick<
    QaRunStore,
    "listFlowRuns" | "readCandidateFlow" | "readFlowRun" | "writeRun"
  >;
  readonly stateDir?: string;
};

type StepExecution = {
  readonly evidenceBundleIds: readonly string[];
  readonly result: FlowStepResult;
};

type ExecuteStepInput = {
  readonly actionPath: readonly ExecutedReproAction[];
  readonly flow: BrowserQaFlow;
  readonly phase: "flow" | "teardown";
  readonly policy: ActionPolicy;
  readonly qaRunId: string;
  readonly step: BrowserQaFlowStep;
  readonly target: QaTarget;
};

type ExecutedReproAction = {
  readonly action: BrowserAction;
  readonly label: string;
};

type ResolvedStepValue = {
  readonly value?: string;
  readonly valueRef?: BrowserQaDriverValueRef;
};

const SEVERITY_RANK: Record<QaSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

class DeterministicFlowRunner implements FlowRunner {
  readonly #actionPolicy: ActionPolicy | undefined;
  readonly #driver: FlowRunnerDriver;
  readonly #evidenceStore: Pick<QaEvidenceStore, "writeBundle">;
  readonly #now: () => string;
  readonly #qaStore: Pick<QaRunStore, "writeFlowRun">;

  constructor(options: FlowRunnerOptions) {
    this.#actionPolicy = options.actionPolicy;
    this.#driver = options.driver;
    this.#evidenceStore = options.evidenceStore;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#qaStore = options.qaStore;
  }

  async runFlow(
    flow: BrowserQaFlow,
    context: FlowRunnerRunContext,
  ): Promise<Result<FlowRunnerResult, SurfaceError>> {
    const flowValidation = validateFlowSemantics(flow);
    if (!flowValidation.ok) {
      return flowValidation;
    }

    const policy = context.actionPolicy ?? this.#actionPolicy ?? createBuiltInSafeActionPolicy();
    const isolation = validateFlowIsolationPolicy({
      ci: context.ci === true,
      flow: {
        ...(flow.isolation === undefined
          ? {}
          : {
              isolation: {
                ...(flow.isolation.fixtureAccountId === undefined
                  ? {}
                  : { fixtureAccountId: flow.isolation.fixtureAccountId }),
                mutatesState: flow.isolation.mutatesState,
                ...(flow.isolation.resetEndpointId === undefined
                  ? {}
                  : { resetEndpointId: flow.isolation.resetEndpointId }),
                resetRequired: flow.isolation.resetRequired,
              },
            }),
        ...(flow.teardown === undefined
          ? {}
          : {
              teardown: {
                always: flow.teardown.always.map((step) =>
                  browserActionForStep(step, context.target),
                ),
              },
            }),
      },
      policy,
      target: context.target,
    });

    if (!isOk(isolation)) {
      return isolation;
    }

    const session = await this.#driver.startSession({
      qaRunId: context.qaRunId,
      target: context.target,
    });

    if (!isOk(session)) {
      return session;
    }

    const steps: FlowStepResult[] = [];
    const evidenceBundles: string[] = [];
    const degradation: QaDegradation[] = [];
    const actionPath: ExecutedReproAction[] = [];
    let currentTarget = context.target;
    let highestFailedSeverity: QaSeverity | undefined;
    let status: FlowRun["status"] = "passed";

    try {
      for (const step of flow.steps) {
        const executed = await this.#executeStep({
          actionPath,
          flow,
          phase: "flow",
          policy,
          qaRunId: context.qaRunId,
          step,
          target: currentTarget,
        });

        steps.push(executed.result);
        evidenceBundles.push(...executed.evidenceBundleIds);
        actionPath.push({ action: executed.result.action, label: step.id });
        if (
          executed.result.status !== "failed" &&
          (executed.result.action.action === "open" ||
            executed.result.action.action === "pushstate")
        ) {
          currentTarget = effectiveTargetForAction(executed.result.action, currentTarget);
        }

        if (executed.result.status === "failed") {
          status = "failed";
          highestFailedSeverity = higherSeverity(
            highestFailedSeverity,
            executed.result.severity ?? flow.severity,
          );
          break;
        }

        if (executed.result.status === "degraded") {
          status = status === "failed" ? "failed" : "degraded";
        }
      }

      for (const step of flow.teardown?.always ?? []) {
        const teardownResult = await this.#executeStep({
          actionPath,
          flow,
          phase: "teardown",
          policy,
          qaRunId: context.qaRunId,
          step,
          target: currentTarget,
        });

        if (teardownResult.result.status !== "passed") {
          degradation.push({
            code: "teardown_degraded",
            details: {
              error: teardownResult.result.error,
              stepId: step.id,
            },
            message: `Teardown step "${step.id}" did not complete.`,
            scope: "teardown",
            severity: "warning",
          });
        }

        if (
          teardownResult.result.status !== "failed" &&
          (teardownResult.result.action.action === "open" ||
            teardownResult.result.action.action === "pushstate")
        ) {
          currentTarget = effectiveTargetForAction(teardownResult.result.action, currentTarget);
        }
      }
    } finally {
      const stopped = await this.#driver.stopSession(session.value.id);
      if (!stopped.ok) {
        degradation.push({
          code: "session_cleanup_degraded",
          message: "Browser QA session cleanup did not complete.",
          scope: "session",
          severity: "warning",
        });
      }
    }

    const flowRun: FlowRun = {
      evidenceBundles,
      findingIds: [],
      flowId: flow.id,
      gateEligible: isolation.value.gateEligible,
      ...(highestFailedSeverity === undefined ? {} : { highestFailedSeverity }),
      id: flowRunIdFor(flow.id),
      isolation: {
        mode: flow.isolation?.mode ?? "isolated",
        mutatesState: flow.isolation?.mutatesState === true,
        resetSatisfied: isolation.value.resetSatisfied,
      },
      severity: flow.severity,
      source: context.source ?? { kind: "surface-state", ref: flow.id },
      status,
      steps,
      target: context.target,
      ...(context.actionPolicyRef === undefined
        ? {}
        : { actionPolicyRef: context.actionPolicyRef }),
    };
    const written = await this.#qaStore.writeFlowRun(flowRun);

    if (!isOk(written)) {
      return written;
    }

    return ok({
      ...written.value,
      degradation,
    });
  }

  async #executeStep(input: ExecuteStepInput): Promise<StepExecution> {
    const startedAt = this.#now();
    const action = browserActionForStep(input.step, input.target);
    const severity = input.step.severity ?? input.flow.severity;
    const policyDecision = classifyBrowserAction({
      action,
      effectiveTarget: effectiveTargetForAction(action, input.target),
      policy: input.policy,
      runTarget: input.target,
    });

    if (!policyDecision.allowed) {
      const result = failedStepResult({
        action,
        completedAt: this.#now(),
        error: policyDecision.reason,
        id: input.step.id,
        severity,
        startedAt,
      });
      const evidence = await this.#writeEvidence({
        actionPath: [...input.actionPath, { action, label: input.step.id }],
        error: policyDecision.reason,
        flow: input.flow,
        qaRunId: input.qaRunId,
        step: input.step,
      });

      return {
        evidenceBundleIds: evidence.ok ? [evidence.value.id] : [],
        result: {
          ...result,
          evidenceBundleIds: evidence.ok ? [evidence.value.id] : [],
        },
      };
    }

    const dispatched = await this.#dispatchStep(input.step, action, input.target, input.flow);
    const waited =
      dispatched.ok && input.step.wait !== undefined
        ? await this.#driver.wait({
            ...(action.locator === undefined ? {} : { locator: action.locator }),
            stepId: input.step.id,
            ...(input.step.timeoutMs === undefined ? {} : { timeoutMs: input.step.timeoutMs }),
            wait: input.step.wait,
          })
        : dispatched;
    const asserted =
      waited.ok && input.step.expect !== undefined && input.step.action !== "assert"
        ? await this.#runAssertion(input.step, action)
        : waited;

    if (!asserted.ok) {
      const evidence = await this.#writeEvidence({
        actionPath: [...input.actionPath, { action, label: input.step.id }],
        error: asserted.error.message,
        flow: input.flow,
        qaRunId: input.qaRunId,
        step: input.step,
      });

      return {
        evidenceBundleIds: evidence.ok ? [evidence.value.id] : [],
        result: {
          ...failedStepResult({
            action,
            completedAt: this.#now(),
            error: asserted.error.message,
            id: input.step.id,
            severity,
            startedAt,
          }),
          evidenceBundleIds: evidence.ok ? [evidence.value.id] : [],
        },
      };
    }

    const captured =
      input.step.capture === true || typeof input.step.capture === "object"
        ? await this.#writeEvidence({
            actionPath: [...input.actionPath, { action, label: input.step.id }],
            flow: input.flow,
            qaRunId: input.qaRunId,
            step: input.step,
          })
        : undefined;

    return {
      evidenceBundleIds: captured?.ok === true ? [captured.value.id] : [],
      result: {
        action,
        completedAt: this.#now(),
        evidenceBundleIds: captured?.ok === true ? [captured.value.id] : [],
        id: input.step.id,
        severity,
        startedAt,
        status: "passed",
      },
    };
  }

  #dispatchStep(
    step: BrowserQaFlowStep,
    action: BrowserAction,
    target: QaTarget,
    flow: BrowserQaFlow,
  ): Promise<Result<unknown, SurfaceError>> {
    const resolvedValue = resolveStepValue(step, flow);
    if (!resolvedValue.ok) {
      return Promise.resolve(resolvedValue);
    }

    const input = driverInputForStep(step, action, target, resolvedValue.value);

    switch (step.action) {
      case "open":
        return this.#driver.navigate(input);
      case "pushstate":
        return this.#driver.pushState(input);
      case "click":
        return this.#driver.click(input);
      case "dblclick":
        return this.#driver.dblclick(input);
      case "hover":
        return this.#driver.hover(input);
      case "focus":
        return this.#driver.focus(input);
      case "fill":
        return this.#driver.fill(input);
      case "type":
        return this.#driver.type(input);
      case "press":
        return this.#driver.press(input);
      case "check":
        return this.#driver.check(input);
      case "uncheck":
        return this.#driver.uncheck(input);
      case "select":
        return this.#driver.select(input);
      case "upload":
        return this.#driver.upload(input);
      case "scroll":
        return this.#driver.scroll(input);
      case "wait":
        return this.#driver.wait(input);
      case "capture":
        return this.#driver.captureState();
      case "assert":
        return this.#runAssertion(step, action);
      case "setViewport":
        return this.#driver.setViewport(input);
      case "setTheme":
        return this.#driver.setTheme(input);
    }
  }

  async #runAssertion(
    step: BrowserQaFlowStep,
    action: BrowserAction,
  ): Promise<Result<unknown, SurfaceError>> {
    const expectation = step.expect ?? {};
    const unsupportedKeys = Object.keys(expectation).filter(
      (key) =>
        ![
          "checked",
          "enabled",
          "noFailedNetwork",
          "noPageErrors",
          "reactRenderCount",
          "text",
          "url",
          "visible",
          "vitals",
        ].includes(key),
    );
    const attempts = retryAttempts(step);
    const delayMs = retryDelayMs(step);
    let lastFailure: SurfaceError | undefined;

    if (Object.keys(expectation).length === 0) {
      return err(createSurfaceError("flow_step_failed", "Assertion step has no expectations."));
    }

    if (unsupportedKeys.length > 0) {
      return err(
        createSurfaceError("flow_step_failed", "Assertion contains unsupported expect keys.", {
          details: { keys: unsupportedKeys },
        }),
      );
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await this.#evaluateExpectation(step, action, expectation);

      if (result.ok) {
        return result;
      }

      lastFailure = result.error;
      if (attempt < attempts - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }

    return err(
      lastFailure ??
        createSurfaceError("flow_step_failed", `Assertion step "${step.id}" did not pass.`),
    );
  }

  async #evaluateExpectation(
    step: BrowserQaFlowStep,
    action: BrowserAction,
    expectation: Readonly<Record<string, unknown>>,
  ): Promise<Result<unknown, SurfaceError>> {
    const textExpectation = stringValue(expectation, "text");

    if (textExpectation !== undefined) {
      const text = await this.#driver.assertText({
        expect: expectation,
        ...(action.locator === undefined ? {} : { locator: action.locator }),
        stepId: step.id,
        ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
        value: textExpectation,
      });

      if (!text.ok) {
        return text;
      }
    }

    for (const state of ["visible", "enabled", "checked"] as const) {
      if (expectation[state] === undefined) {
        continue;
      }

      const expected = expectation[state];
      if (typeof expected !== "boolean") {
        return err(
          createSurfaceError("flow_step_failed", `Expectation "${state}" must be a boolean.`),
        );
      }

      if (!expected) {
        return err(
          createSurfaceError(
            "flow_step_failed",
            `Expectation "${state}: false" is not supported yet; use a positive assertion.`,
          ),
        );
      }

      const result = await this.#driver.assertElementState({
        ...(action.locator === undefined ? {} : { locator: action.locator }),
        state,
        stepId: step.id,
        ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
      });

      if (!result.ok) {
        return result;
      }
    }

    const urlExpectation = stringValue(expectation, "url");
    if (urlExpectation !== undefined) {
      const state = await this.#driver.captureState();
      if (!state.ok) {
        return state;
      }

      if (!urlMatches(state.value.url, urlExpectation)) {
        return err(
          createSurfaceError("flow_step_failed", "Current browser URL did not match expect.url.", {
            details: { expected: urlExpectation, actual: state.value.url },
          }),
        );
      }
    }

    if (expectation.noPageErrors === true) {
      const consoleSummary = await this.#driver.getConsoleSummary();
      if (!consoleSummary.ok) {
        return consoleSummary;
      }

      if (hasPageErrors(consoleSummary.value)) {
        return err(
          createSurfaceError("flow_step_failed", "Page errors were present during assertion."),
        );
      }
    }

    if (expectation.noFailedNetwork === true) {
      const networkSummary = await this.#driver.getNetworkSummary();
      if (!networkSummary.ok) {
        return networkSummary;
      }

      if (hasFailedNetwork(networkSummary.value)) {
        return err(createSurfaceError("flow_step_failed", "Failed network requests were present."));
      }
    }

    if (expectation.vitals !== undefined) {
      const vitals = await this.#driver.getVitals();
      if (!vitals.ok) {
        return vitals;
      }

      if (!thresholdObjectSatisfied(vitals.value, expectation.vitals)) {
        return err(createSurfaceError("flow_step_failed", "Vitals did not satisfy expect.vitals."));
      }
    }

    if (expectation.reactRenderCount !== undefined) {
      const react = await this.#driver.getReactDiagnostics();
      if (!react.ok) {
        return react;
      }

      if (!thresholdObjectSatisfied(react.value, { renderCount: expectation.reactRenderCount })) {
        return err(
          createSurfaceError(
            "flow_step_failed",
            "React diagnostics did not satisfy expect.reactRenderCount.",
          ),
        );
      }
    }

    return ok({});
  }

  async #writeEvidence(input: {
    readonly actionPath: readonly ExecutedReproAction[];
    readonly error?: string;
    readonly flow: BrowserQaFlow;
    readonly qaRunId: string;
    readonly step: BrowserQaFlowStep;
  }): Promise<Result<EvidenceBundle, SurfaceError>> {
    const snapshot = await this.#driver.captureState();
    const evidenceId = evidenceBundleIdFor(input.flow.id, input.step.id);
    const artifactId = `${safeId(input.step.id)}_state`;
    const bundle: EvidenceBundle = {
      artifacts: [],
      checksums: {},
      containsSensitiveRaw: false,
      id: evidenceId,
      manifestPath: `.surface/qa/evidence/${evidenceId}.json`,
      qaRunId: input.qaRunId,
      redacted: true,
      reproSteps: input.actionPath.map((entry, index) => ({
        action: entry.action,
        index: index + 1,
        label: entry.label,
      })),
      sanitizedAtCapture: true,
      sourceCaptureArtifactIds: snapshot.ok ? [artifactId] : [],
      sourceRunManifestDigest: digestJson({
        error: input.error,
        flowId: input.flow.id,
        qaRunId: input.qaRunId,
        stepId: input.step.id,
      }),
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify(
        {
          ...(snapshot.ok ? { snapshot: snapshot.value } : {}),
          ...(input.error === undefined ? {} : { error: input.error }),
        },
        null,
        2,
      ),
    );

    return this.#evidenceStore.writeBundle({
      artifacts: snapshot.ok
        ? [
            {
              bytes,
              id: artifactId,
              mcpReadable: true,
              mediaType: "application/json",
              qaKind: "browser-snapshot",
            },
          ]
        : [],
      bundle,
    });
  }
}

class FileBackedBrowserQaFlowService implements BrowserQaFlowService {
  readonly #flowRunner: FlowRunner;
  readonly #projectRoot: string;
  readonly #qaStore: Pick<
    QaRunStore,
    "listFlowRuns" | "readCandidateFlow" | "readFlowRun" | "writeRun"
  >;

  constructor(options: BrowserQaFlowServiceOptions) {
    this.#flowRunner = options.flowRunner;
    this.#projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.#qaStore = options.qaStore;
  }

  async runFlowFile(
    input: BrowserQaFlowServiceRunInput,
  ): Promise<Result<BrowserQaFlowServiceRunOutput, SurfaceError>> {
    const flowPath = path.resolve(this.#projectRoot, input.flowPath);
    let contents: string;

    try {
      contents = await readFile(flowPath, "utf8");
    } catch (cause) {
      return err(
        createSurfaceError("flow_invalid", "Browser QA flow file could not be read.", {
          cause,
          details: { flowPath: input.flowPath },
        }),
      );
    }

    const parsed = parseBrowserQaFlow(contents, {
      sourcePath: projectRelativePath(this.#projectRoot, flowPath),
    });

    if (!isOk(parsed)) {
      return parsed;
    }

    const targetCliValidation = validateFlowTargetCli(input.targetCli);
    if (!isOk(targetCliValidation)) {
      return targetCliValidation;
    }

    const target = resolveFlowTarget({
      ...(input.targetCli === undefined ? {} : { cli: input.targetCli }),
      ...(parsed.value.target === undefined ? {} : { flowTarget: parsed.value.target }),
    });

    if (target === undefined) {
      return err(
        createSurfaceError(
          "target_not_allowed",
          "No browser QA target given. Pass --target, --url, --localhost, or set target in the flow file.",
        ),
      );
    }

    const policyRef = input.actionPolicyRef ?? parsed.value.actionPolicy?.ref;
    const actionPolicy = await resolveActionPolicy({
      ...(policyRef === undefined ? {} : { policyRef }),
      projectRoot: this.#projectRoot,
    });

    if (!isOk(actionPolicy)) {
      return actionPolicy;
    }

    const qaRunId = input.qaRunId ?? qaRunIdFor(parsed.value.id);
    const flowRun = await this.#flowRunner.runFlow(parsed.value, {
      actionPolicy:
        input.allowedDomains === undefined || input.allowedDomains.length === 0
          ? actionPolicy.value.policy
          : {
              ...actionPolicy.value.policy,
              allowedDomains: [
                ...new Set([...actionPolicy.value.policy.allowedDomains, ...input.allowedDomains]),
              ],
            },
      ...(actionPolicy.value.sourcePath === undefined
        ? {}
        : { actionPolicyRef: actionPolicy.value.sourcePath }),
      ...(input.ci === undefined ? {} : { ci: input.ci }),
      qaRunId,
      source: { kind: "file", ref: projectRelativePath(this.#projectRoot, flowPath) },
      target,
    });

    if (!isOk(flowRun)) {
      return flowRun;
    }

    if (input.writeRun !== false) {
      const qaRun = await this.#qaStore.writeRun(qaRunForFlowRun(flowRun.value, qaRunId));
      if (!isOk(qaRun)) {
        return qaRun;
      }
    }

    return ok({ flowRun: flowRun.value, qaRunId });
  }

  async listFlows(): Promise<Result<{ readonly flows: readonly FlowRunSummary[] }, SurfaceError>> {
    const runs = await this.#qaStore.listFlowRuns();

    if (!isOk(runs)) {
      return runs;
    }

    return ok({
      flows: runs.value.map(flowRunSummaryFor),
    });
  }

  async showFlow(id: string): Promise<Result<{ readonly flow: unknown }, SurfaceError>> {
    if (id.startsWith("flowrun_")) {
      const run = await this.#qaStore.readFlowRun(id);
      return isOk(run) ? ok({ flow: run.value }) : run;
    }

    const runs = await this.#qaStore.listFlowRuns();
    if (!isOk(runs)) {
      return runs;
    }

    const matched = runs.value.find((run) => run.flowId === id || run.id === id);
    if (matched !== undefined) {
      return ok({ flow: matched });
    }

    return err(
      createSurfaceError("run_not_found", "No browser QA flow matched the requested id.", {
        details: { id },
      }),
    );
  }

  async promoteFlow(input: { readonly candidateFlowId: string; readonly outPath: string }): Promise<
    Result<
      {
        readonly candidateFlowId: string;
        readonly outPath: string;
        readonly status: "written";
      },
      SurfaceError
    >
  > {
    const candidate = await this.#qaStore.readCandidateFlow(input.candidateFlowId);
    if (!isOk(candidate)) {
      return candidate;
    }

    const outPath = await resolvePromotedFlowOutPath(this.#projectRoot, input.outPath);
    if (!outPath.ok) {
      return outPath;
    }

    const flowYaml = stringifyYaml({
      schemaVersion: "1.0",
      id: safeId(candidate.value.title),
      title: candidate.value.title,
      steps: candidate.value.steps.map((step, index) => ({
        id: `step-${index + 1}`,
        ...step,
      })),
    });

    try {
      await writeAtomicTextFile(outPath.value, flowYaml);

      return ok({
        candidateFlowId: input.candidateFlowId,
        outPath: projectRelativePath(this.#projectRoot, outPath.value),
        status: "written",
      });
    } catch (cause) {
      return err(
        createSurfaceError("state_write_failed", "Promoted browser QA flow could not be written.", {
          cause,
          details: { outPath: input.outPath },
        }),
      );
    }
  }

  async updateFlowRefs(input: {
    readonly flowPath: string;
  }): Promise<Result<{ readonly flowId: string; readonly updatedRefs: number }, SurfaceError>> {
    const flowPath = path.resolve(this.#projectRoot, input.flowPath);
    let contents: string;

    try {
      contents = await readFile(flowPath, "utf8");
    } catch (cause) {
      return err(
        createSurfaceError("flow_invalid", "Browser QA flow file could not be read.", {
          cause,
          details: { flowPath: input.flowPath },
        }),
      );
    }

    const parsed = parseBrowserQaFlow(contents, {
      sourcePath: projectRelativePath(this.#projectRoot, flowPath),
    });

    if (!isOk(parsed)) {
      return parsed;
    }

    const updated = removeVolatileRefHints(contents);

    if (updated.updatedRefs > 0) {
      try {
        await writeAtomicTextFile(flowPath, updated.contents);
      } catch (cause) {
        return err(
          createSurfaceError("state_write_failed", "Browser QA flow refs could not be updated.", {
            cause,
            details: { flowPath: input.flowPath },
          }),
        );
      }
    }

    return ok({
      flowId: parsed.value.id,
      updatedRefs: updated.updatedRefs,
    });
  }
}

export function createFlowRunner(options: FlowRunnerOptions): FlowRunner {
  return new DeterministicFlowRunner(options);
}

export function createBrowserQaFlowService(
  options: BrowserQaFlowServiceOptions,
): BrowserQaFlowService {
  return new FileBackedBrowserQaFlowService(options);
}

function browserActionForStep(step: BrowserQaFlowStep, target: QaTarget): BrowserAction {
  return {
    action: step.action,
    ...(step.locator === undefined ? {} : { locator: step.locator }),
    ...(step.url === undefined ? {} : { url: resolveActionUrl(step.url, target) }),
    ...(step.value === undefined ? {} : { value: step.value }),
  };
}

function driverInputForStep(
  step: BrowserQaFlowStep,
  action: BrowserAction,
  target: QaTarget,
  resolvedValue: ResolvedStepValue,
): BrowserQaDriverActionInput {
  return {
    ...(action.locator === undefined ? {} : { locator: action.locator }),
    ...(step.expect === undefined ? {} : { expect: step.expect }),
    stepId: step.id,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(action.url === undefined ? {} : { url: resolveActionUrl(action.url, target) }),
    ...(resolvedValue.value === undefined ? {} : { value: resolvedValue.value }),
    ...(resolvedValue.valueRef === undefined ? {} : { valueRef: resolvedValue.valueRef }),
    ...(step.wait === undefined ? {} : { wait: step.wait }),
  };
}

function failedStepResult(input: {
  readonly action: BrowserAction;
  readonly completedAt: string;
  readonly error: string;
  readonly id: string;
  readonly severity: QaSeverity;
  readonly startedAt: string;
}): FlowStepResult {
  return {
    action: input.action,
    completedAt: input.completedAt,
    error: input.error,
    evidenceBundleIds: [],
    id: input.id,
    severity: input.severity,
    startedAt: input.startedAt,
    status: "failed",
  };
}

function validateFlowSemantics(flow: BrowserQaFlow): Result<undefined, SurfaceError> {
  for (const step of [...flow.steps, ...(flow.teardown?.always ?? [])]) {
    if (step.locator?.refHint !== undefined && !hasLocatorIdentity(step.locator)) {
      return err(
        createSurfaceError(
          "flow_invalid",
          "Browser QA flow refHint must be paired with a semantic locator identity.",
          { details: { stepId: step.id } },
        ),
      );
    }
  }

  return ok(undefined);
}

function hasLocatorIdentity(locator: BrowserLocator): boolean {
  return (
    locator.label !== undefined ||
    locator.name !== undefined ||
    locator.placeholder !== undefined ||
    locator.role !== undefined ||
    locator.selector !== undefined ||
    locator.testId !== undefined ||
    locator.text !== undefined
  );
}

function resolveActionUrl(url: string, target: QaTarget): string {
  if (!url.startsWith("/")) {
    return url;
  }

  if (target.kind !== "url" && target.kind !== "localhost") {
    return url;
  }

  try {
    return new URL(url, target.ref).toString();
  } catch {
    return url;
  }
}

function resolveStepValue(
  step: BrowserQaFlowStep,
  flow: BrowserQaFlow,
): Result<ResolvedStepValue, SurfaceError> {
  if (step.value === undefined) {
    return ok({});
  }

  if (looksLikeSecretLiteral(step.value)) {
    return err(
      createSurfaceError("flow_invalid", "Browser QA step value looks like a literal secret.", {
        details: { stepId: step.id },
      }),
    );
  }

  const secretOnly = step.value.match(/^\{\{\s*secrets\.([A-Za-z0-9_-]+)\s*\}\}$/u);
  if (secretOnly !== null) {
    const secretName = secretOnly[1];
    if (secretName === undefined) {
      return err(createSurfaceError("flow_invalid", "Browser QA secret reference is invalid."));
    }

    const envName = flow.secrets[secretName]?.fromEnv;
    if (envName === undefined) {
      return err(
        createSurfaceError("flow_invalid", "Browser QA step references an unknown secret.", {
          details: { secretName, stepId: step.id },
        }),
      );
    }

    const secretValue = process.env[envName];
    if (secretValue === undefined) {
      return err(
        createSurfaceError("flow_invalid", "Browser QA secret environment variable is not set.", {
          details: { envName, secretName, stepId: step.id },
        }),
      );
    }

    return ok({ valueRef: { kind: "secret", name: secretName, value: secretValue } });
  }

  if (/\{\{\s*secrets\./u.test(step.value)) {
    return err(
      createSurfaceError("flow_invalid", "Browser QA secrets must occupy the entire step value.", {
        details: { stepId: step.id },
      }),
    );
  }

  return ok({
    value: step.value
      .replace(/\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/gu, (_match, key: string) =>
        stringFromTemplateValue(flow.inputs[key]),
      )
      .replace(/\{\{\s*\$uuid\s*\}\}/gu, () => randomUUID()),
  });
}

function looksLikeSecretLiteral(value: string): boolean {
  return (
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/u.test(value) ||
    /\b(password|secret|token|api[-_]?key|session)\s*[:=]\s*\S+/iu.test(value)
  );
}

function stringFromTemplateValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function urlMatches(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") {
    return false;
  }

  if (expected.includes("*")) {
    const escaped = expected.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
    return new RegExp(`^${escaped}$`, "u").test(actual);
  }

  return actual === expected || actual.endsWith(expected);
}

function hasPageErrors(summary: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(summary).toLowerCase();
  const errors = [
    arrayLengthAt(summary, "pageErrors"),
    arrayLengthAt(summary, "errors"),
    arrayLengthAt(summary, "exceptions"),
  ];

  return errors.some((count) => count > 0) || /\b(error|exception|uncaught)\b/u.test(serialized);
}

function hasFailedNetwork(summary: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(summary).toLowerCase();
  return /\b(status|statuscode)["']?\s*:\s*(4[0-9]{2}|5[0-9]{2})/u.test(serialized);
}

function arrayLengthAt(summary: Record<string, unknown>, key: string): number {
  const value = summary[key];
  return Array.isArray(value) ? value.length : 0;
}

function thresholdObjectSatisfied(actual: Record<string, unknown>, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected)) {
    return false;
  }

  for (const [key, threshold] of Object.entries(expected)) {
    if (typeof threshold !== "number") {
      continue;
    }

    const actualValue = numericValueAt(actual, key);
    if (actualValue === undefined || actualValue > threshold) {
      return false;
    }
  }

  return true;
}

function numericValueAt(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if (key in value && typeof (value as Record<string, unknown>)[key] === "number") {
    return (value as Record<string, number>)[key];
  }

  for (const child of Object.values(value)) {
    const nested = numericValueAt(child, key);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function stringValue(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function retryAttempts(step: BrowserQaFlowStep): number {
  const value = step.retry?.attempts;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function retryDelayMs(step: BrowserQaFlowStep): number {
  const value = step.retry?.delayMs ?? step.retry?.intervalMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 100;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function higherSeverity(current: QaSeverity | undefined, candidate: QaSeverity): QaSeverity {
  if (current === undefined) {
    return candidate;
  }

  const candidateRank = SEVERITY_RANK[candidate] ?? 0;
  const currentRank = SEVERITY_RANK[current] ?? 0;

  return candidateRank > currentRank ? candidate : current;
}

function flowRunIdFor(flowId: string): string {
  return `flowrun_${safeId(flowId)}_${randomSuffix()}`;
}

function qaRunIdFor(flowId: string): string {
  return `qa_${safeId(flowId)}_${randomSuffix()}`;
}

function evidenceBundleIdFor(flowId: string, stepId: string): string {
  return `ev_${safeId(flowId)}_${safeId(stepId)}_${randomSuffix()}`;
}

function safeId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/giu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized.length > 0 ? normalized : "item";
}

function digestJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function randomSuffix(): string {
  return randomUUID().slice(0, 8);
}

function flowRunSummaryFor(run: FlowRun): FlowRunSummary {
  return {
    findingIds: run.findingIds,
    flowId: run.flowId,
    gateEligible: run.gateEligible,
    id: run.id,
    status: run.status,
  };
}

function qaRunForFlowRun(flowRun: FlowRunnerResult, qaRunId: string): QaRun {
  const now = new Date().toISOString();

  return {
    candidateFindings: [],
    candidateFlows: [],
    completedAt: now,
    degradation: [...flowRun.degradation],
    evidenceBundles: [...flowRun.evidenceBundles],
    findings: [...flowRun.findingIds],
    flowRuns: [flowRunSummaryFor(flowRun)],
    id: qaRunId,
    manifestPath: `.surface/qa/runs/${qaRunId}/manifest.json`,
    mode: "flow",
    startedAt: now,
    status:
      flowRun.status === "failed"
        ? "failed"
        : flowRun.degradation.length > 0
          ? "degraded"
          : "completed",
    target: flowRun.target,
  };
}

function removeVolatileRefHints(contents: string): {
  readonly contents: string;
  readonly updatedRefs: number;
} {
  const document = parseDocument(contents);
  let updatedRefs = 0;

  const stripSteps = (steps: unknown): void => {
    if (!isSeq(steps)) {
      return;
    }

    for (const step of steps.items) {
      if (!isMap(step)) {
        continue;
      }

      const locator = step.get("locator", true);
      if (isMap(locator) && locator.delete("refHint")) {
        updatedRefs += 1;
      }
    }
  };

  stripSteps(document.get("steps", true));

  const teardown = document.get("teardown", true);
  if (isMap(teardown)) {
    stripSteps(teardown.get("always", true));
  }

  return {
    contents: String(document),
    updatedRefs,
  };
}

function projectRelativePath(projectRoot: string, value: string): string {
  const relative = path.relative(projectRoot, value);
  return relative.startsWith("..") ? value : relative.split(path.sep).join(path.posix.sep);
}

async function resolvePromotedFlowOutPath(
  projectRoot: string,
  outPath: string,
): Promise<Result<string, SurfaceError>> {
  if (path.isAbsolute(outPath) || outPath.split(/[\\/]+/u).includes("..")) {
    return err(
      createSurfaceError(
        "flow_invalid",
        "Promoted browser QA flow output must be a relative path.",
        {
          details: { outPath },
        },
      ),
    );
  }

  const normalized = outPath.split(path.sep).join(path.posix.sep);
  if (!normalized.startsWith("surface-flows/")) {
    return err(
      createSurfaceError(
        "flow_invalid",
        "Promoted browser QA flows must be written under surface-flows/.",
        {
          details: { outPath },
        },
      ),
    );
  }

  const resolved = path.resolve(projectRoot, outPath);
  const flowRoot = path.resolve(projectRoot, "surface-flows");
  const parent = path.dirname(resolved);

  await mkdir(parent, { recursive: true });
  const [realFlowRoot, realParent] = await Promise.all([realpath(flowRoot), realpath(parent)]);
  if (!isSameOrChildPath(realParent, realFlowRoot)) {
    return err(
      createSurfaceError(
        "flow_invalid",
        "Promoted browser QA flow output escaped surface-flows/.",
        {
          details: { outPath },
        },
      ),
    );
  }

  return ok(resolved);
}

async function writeAtomicTextFile(finalPath: string, contents: string): Promise<void> {
  const tempPath = path.join(path.dirname(finalPath), `.surface-flow-${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, finalPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function isOk<T>(
  result: Result<T, SurfaceError>,
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}
