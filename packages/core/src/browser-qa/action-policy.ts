import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { isNodeErrorWithCode, isSameOrChildPath } from "../path-safety.js";
import {
  ActionPolicyDecisionSchema,
  ActionPolicySchema,
  BrowserActionSchema,
  type ActionPolicy,
  type ActionPolicyCategory,
  type ActionPolicyDecision,
  type ActionPolicyRule,
  type BrowserAction,
  type BrowserLocator,
  type QaTarget,
} from "./schemas.js";

export type ClassifyBrowserActionInput = {
  readonly action: BrowserAction;
  readonly effectiveTarget: QaTarget;
  readonly policy: ActionPolicy;
  readonly runTarget?: QaTarget;
};

export type ResolveActionPolicyInput = {
  readonly fixtureRoots?: readonly string[];
  readonly policyRef?: string;
  readonly projectRoot?: string;
};

export type ResolvedActionPolicy = {
  readonly policy: ActionPolicy;
  readonly source: "builtin" | "file";
  readonly sourcePath?: string;
};

export type ValidateFlowIsolationPolicyInput = {
  readonly ci: boolean;
  readonly flow: {
    readonly isolation?: {
      readonly fixtureAccountId?: string;
      readonly mutatesState?: boolean;
      readonly resetEndpointId?: string;
      readonly resetRequired?: boolean;
    };
    readonly teardown?: {
      readonly always?: readonly BrowserAction[];
    };
  };
  readonly policy: ActionPolicy;
  readonly target: QaTarget;
};

export type FlowIsolationPolicyValidation = {
  readonly gateEligible: boolean;
  readonly resetSatisfied: boolean;
};

const SAFE_ACTIONS = new Set<BrowserAction["action"]>([
  "open",
  "pushstate",
  "hover",
  "focus",
  "scroll",
  "wait",
  "capture",
  "assert",
  "setViewport",
  "setTheme",
]);
const TARGET_BOUND_ALLOW_CATEGORIES = new Set<ActionPolicyCategory>([
  "submit",
  "save",
  "delete",
  "clear",
  "upload",
  "payment",
  "account",
  "externally-visible",
  "persistent",
]);

export function createBuiltInSafeActionPolicy(): ActionPolicy {
  return ActionPolicySchema.parse({
    allowedDomains: [],
    environmentGroups: [],
    fixtureAccounts: [],
    resetEndpoints: [],
    rules: [],
  });
}

export function classifyBrowserAction(input: ClassifyBrowserActionInput): ActionPolicyDecision {
  const parsedAction = BrowserActionSchema.safeParse(input.action);
  if (!parsedAction.success) {
    return ActionPolicyDecisionSchema.parse({
      allowed: false,
      category: "unknown",
      code: "action_policy_denied",
      reason: "Browser action is invalid.",
    });
  }

  const targetOrigin = resolveTargetOrigin(input.effectiveTarget);
  if (targetOrigin === undefined) {
    return ActionPolicyDecisionSchema.parse({
      allowed: false,
      category: "unknown",
      code: "target_not_allowed",
      reason: "Effective QA target does not have an origin.",
    });
  }

  const runOrigin = resolveTargetOrigin(input.runTarget ?? input.effectiveTarget);
  if (!isAllowedDomain(targetOrigin, input.policy, runOrigin)) {
    return ActionPolicyDecisionSchema.parse({
      allowed: false,
      category: "unknown",
      code: "target_not_allowed",
      reason: "Effective QA target is outside the action policy allowed domains.",
    });
  }

  const category = classifyActionCategory(parsedAction.data);
  const matchingRules = input.policy.rules.filter((rule) =>
    ruleMatchesAction(rule, parsedAction.data, category, input.effectiveTarget),
  );
  const denyRule = matchingRules.find((rule) => rule.decision === "deny");

  if (denyRule !== undefined) {
    return ActionPolicyDecisionSchema.parse({
      allowed: false,
      category,
      code: "action_policy_denied",
      matchedRuleId: denyRule.id,
      reason: "Action policy explicitly denied the browser action.",
    });
  }

  const allowRule = matchingRules.find((rule) => rule.decision === "allow");
  if (allowRule !== undefined) {
    return ActionPolicyDecisionSchema.parse({
      allowed: true,
      category,
      matchedRuleId: allowRule.id,
      reason: "Action policy explicitly allowed the browser action.",
    });
  }

  if (isSafeWithoutExplicitRule(parsedAction.data, category)) {
    return ActionPolicyDecisionSchema.parse({
      allowed: true,
      category,
      reason: "Built-in safe policy allows read-only navigation or reveal interactions.",
    });
  }

  return ActionPolicyDecisionSchema.parse({
    allowed: false,
    category,
    code: "action_policy_denied",
    reason: "Browser action requires an explicit target-bound action policy rule.",
  });
}

export async function resolveActionPolicy(
  input: ResolveActionPolicyInput,
): Promise<Result<ResolvedActionPolicy, SurfaceError>> {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const policyRef = input.policyRef ?? ".surface/qa/action-policy.json";

  if (input.policyRef === undefined) {
    const defaultPolicy = await readActionPolicyFile({ ...input, policyRef, projectRoot });

    if (defaultPolicy.ok || defaultPolicy.error.message !== "Action policy file was not found.") {
      return defaultPolicy;
    }

    return ok({ policy: createBuiltInSafeActionPolicy(), source: "builtin" });
  }

  return readActionPolicyFile({ ...input, policyRef, projectRoot });
}

async function readActionPolicyFile(
  input: ResolveActionPolicyInput & { readonly policyRef: string; readonly projectRoot: string },
): Promise<Result<ResolvedActionPolicy, SurfaceError>> {
  if (path.isAbsolute(input.policyRef) || hasTraversalSegment(input.policyRef)) {
    return err(createPolicyInvalidError("Action policy path must be project-relative."));
  }

  const policyPath = path.resolve(input.projectRoot, input.policyRef);
  if (!isSameOrChildPath(policyPath, input.projectRoot)) {
    return err(createPolicyInvalidError("Action policy path must stay inside the project root."));
  }

  try {
    const realPolicyPath = await realpath(policyPath);
    const realProjectRoot = await realpath(input.projectRoot);

    if (!isSameOrChildPath(realPolicyPath, realProjectRoot)) {
      return err(createPolicyInvalidError("Action policy path escaped the project root."));
    }

    const policyJson = JSON.parse(await readFile(realPolicyPath, "utf8")) as unknown;
    const parsedPolicy = ActionPolicySchema.safeParse(policyJson);

    if (!parsedPolicy.success) {
      return err(createPolicyInvalidError("Action policy file is invalid.", parsedPolicy.error));
    }

    const fixtureValidation = await validateFixtureRefs({
      fixtureRoots: input.fixtureRoots ?? [],
      policy: parsedPolicy.data,
      projectRoot: input.projectRoot,
    });

    if (!fixtureValidation.ok) {
      return fixtureValidation;
    }

    return ok({
      policy: parsedPolicy.data,
      source: "file",
      sourcePath: toPosixPath(input.policyRef),
    });
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return err(createPolicyInvalidError("Action policy file was not found.", error));
    }

    return err(createPolicyInvalidError("Failed to read action policy file.", error));
  }
}

export function validateFlowIsolationPolicy(
  input: ValidateFlowIsolationPolicyInput,
): Result<FlowIsolationPolicyValidation, SurfaceError> {
  const isolation = input.flow.isolation;
  const mutatesState = isolation?.mutatesState === true;

  if (!mutatesState) {
    return ok({ gateEligible: true, resetSatisfied: false });
  }

  const resetSatisfied =
    hasPolicyFixtureAccount(input.policy, isolation?.fixtureAccountId, input.target) ||
    hasPolicyAuthorizedTeardown(input.policy, input.flow.teardown?.always, input.target);

  if (!resetSatisfied && input.ci) {
    return err(
      createSurfaceError(
        "flow_invalid",
        "Mutating browser QA flows require a fixture account or authorized teardown before CI execution.",
      ),
    );
  }

  return ok({ gateEligible: resetSatisfied, resetSatisfied });
}

function classifyActionCategory(action: BrowserAction): ActionPolicyCategory {
  if (action.action === "upload") {
    return "upload";
  }

  if (["fill", "type", "select", "check", "uncheck"].includes(action.action)) {
    return "persistent";
  }

  const text = [
    action.locator?.label,
    action.locator?.name,
    action.locator?.placeholder,
    action.locator?.role,
    action.locator?.selector,
    action.locator?.testId,
    action.locator?.text,
    action.url,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

  if (/\b(account|profile|user)\b/.test(text) && /\b(delete|remove|deactivate)\b/.test(text)) {
    return "account";
  }

  if (/\b(pay|payment|billing|card|checkout|purchase)\b/.test(text)) {
    return "payment";
  }

  if (/\b(delete|remove|destroy)\b/.test(text)) {
    return "delete";
  }

  if (/\b(clear|reset)\b/.test(text)) {
    return "clear";
  }

  if (/\b(save|update|publish)\b/.test(text)) {
    return "save";
  }

  if (/\b(submit|send|confirm)\b/.test(text)) {
    return "submit";
  }

  if (action.action === "open" || action.action === "pushstate") {
    return "navigation";
  }

  if (SAFE_ACTIONS.has(action.action)) {
    return "reveal";
  }

  return action.action === "click" || action.action === "dblclick" || action.action === "press"
    ? "unknown"
    : "form";
}

function isSafeWithoutExplicitRule(action: BrowserAction, category: ActionPolicyCategory): boolean {
  return SAFE_ACTIONS.has(action.action) && (category === "navigation" || category === "reveal");
}

function ruleMatchesAction(
  rule: ActionPolicyRule,
  action: BrowserAction,
  category: ActionPolicyCategory,
  target: QaTarget,
): boolean {
  const targetUrl = urlForTarget(target);
  if (targetUrl === undefined) {
    return false;
  }

  const actionMatches = rule.actions === undefined || rule.actions.includes(action.action);
  const categoryMatches = rule.categories === undefined || rule.categories.includes(category);
  const targetBoundOriginMatches =
    rule.origins !== undefined &&
    rule.origins.some((origin) => ruleOriginMatches(origin, targetUrl.origin));
  const originMatches = rule.origins === undefined || targetBoundOriginMatches;
  const routeMatches =
    rule.routes === undefined ||
    rule.routes.some((routePattern) => routePatternMatches(routePattern, targetUrl));
  const locatorMatches =
    rule.locators === undefined ||
    rule.locators.some((locator) => locatorConstraintMatches(locator, action.locator));
  const specificityMatches =
    rule.decision === "deny" ||
    isSafeWithoutExplicitRule(action, category) ||
    rule.routes !== undefined ||
    rule.locators !== undefined;
  const targetBindingMatches =
    rule.decision !== "allow" ||
    !TARGET_BOUND_ALLOW_CATEGORIES.has(category) ||
    targetBoundOriginMatches;

  return (
    actionMatches &&
    categoryMatches &&
    originMatches &&
    routeMatches &&
    locatorMatches &&
    specificityMatches &&
    targetBindingMatches
  );
}

function ruleOriginMatches(ruleOrigin: string, targetOrigin: string): boolean {
  if (ruleOrigin === targetOrigin) {
    return true;
  }

  if (!ruleOrigin.endsWith(":*")) {
    return false;
  }

  try {
    const ruleUrl = new URL(ruleOrigin.slice(0, -2));
    const targetUrl = new URL(targetOrigin);

    return ruleUrl.protocol === targetUrl.protocol && ruleUrl.hostname === targetUrl.hostname;
  } catch {
    return false;
  }
}

function resolveTargetOrigin(target: QaTarget): string | undefined {
  return urlForTarget(target)?.origin;
}

function isAllowedDomain(
  origin: string,
  policy: ActionPolicy,
  runOrigin: string | undefined,
): boolean {
  if (policy.allowedDomains.length === 0) {
    return runOrigin !== undefined && origin === runOrigin;
  }

  return policy.allowedDomains.some((allowedDomain) => allowedDomainMatches(allowedDomain, origin));
}

function allowedDomainMatches(allowedDomain: string, origin: string): boolean {
  if (allowedDomain.includes("://")) {
    return ruleOriginMatches(allowedDomain, origin);
  }

  const url = new URL(origin);
  if (isLocalOrPrivateHost(url.hostname)) {
    return false;
  }

  return url.hostname === allowedDomain;
}

function urlForTarget(target: QaTarget): URL | undefined {
  if (target.kind !== "url" && target.kind !== "localhost") {
    return undefined;
  }

  try {
    return new URL(target.ref);
  } catch {
    return undefined;
  }
}

function routePatternMatches(pattern: string, targetUrl: URL): boolean {
  const route = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  const normalizedPattern = pattern.startsWith("/") ? pattern : `/${pattern}`;

  return wildcardMatches(normalizedPattern, route);
}

function locatorConstraintMatches(
  expected: BrowserLocator,
  actual: BrowserAction["locator"],
): boolean {
  if (actual === undefined) {
    return false;
  }

  return Object.entries(expected).every(([key, value]) => {
    if (value === undefined || key === "refHint") {
      return true;
    }

    const actualValue = actual[key as keyof typeof actual];
    return (
      typeof actualValue === "string" &&
      normalizeLocatorText(actualValue) === normalizeLocatorText(value)
    );
  });
}

function normalizeLocatorText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function wildcardMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*");

  return new RegExp(`^${escaped}$`, "u").test(value);
}

function isLocalOrPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./u.test(hostname)
  );
}

async function validateFixtureRefs({
  fixtureRoots,
  policy,
  projectRoot,
}: {
  readonly fixtureRoots: readonly string[];
  readonly policy: ActionPolicy;
  readonly projectRoot: string;
}): Promise<Result<undefined, SurfaceError>> {
  const roots = fixtureRoots.length > 0 ? fixtureRoots : ["."];
  const realRoots: string[] = [];

  for (const root of roots) {
    if (path.isAbsolute(root) || hasTraversalSegment(root)) {
      return err(createPolicyInvalidError("Fixture root must be project-relative."));
    }

    try {
      realRoots.push(await realpath(path.resolve(projectRoot, root)));
    } catch (error) {
      return err(createPolicyInvalidError("Failed to validate fixture root.", error));
    }
  }

  for (const account of policy.fixtureAccounts) {
    if (account.fixtureRef === undefined) {
      continue;
    }

    if (path.isAbsolute(account.fixtureRef) || hasTraversalSegment(account.fixtureRef)) {
      return err(createPolicyInvalidError("Fixture refs must be project-relative."));
    }

    try {
      const realFixture = await realpath(path.resolve(projectRoot, account.fixtureRef));
      const insideFixtureRoot = realRoots.some((root) => isSameOrChildPath(realFixture, root));

      if (!insideFixtureRoot) {
        return err(
          createPolicyInvalidError("Fixture ref must stay inside a configured fixture root."),
        );
      }
    } catch (error) {
      return err(createPolicyInvalidError("Failed to validate fixture ref.", error));
    }
  }

  return ok(undefined);
}

function hasPolicyFixtureAccount(
  policy: ActionPolicy,
  id: string | undefined,
  target: QaTarget,
): boolean {
  const targetOrigin = resolveTargetOrigin(target);

  return (
    id !== undefined &&
    targetOrigin !== undefined &&
    isAllowedDomain(targetOrigin, policy, targetOrigin) &&
    policy.fixtureAccounts.some((account) => account.id === id)
  );
}

function hasPolicyAuthorizedTeardown(
  policy: ActionPolicy,
  teardown: readonly BrowserAction[] | undefined,
  target: QaTarget,
): boolean {
  return (
    teardown !== undefined &&
    teardown.length > 0 &&
    teardown.every((action) => {
      const decision = classifyBrowserAction({
        action,
        effectiveTarget: effectiveTargetForAction(action, target),
        policy,
        runTarget: target,
      });

      return (
        decision.allowed && decision.category === "clear" && decision.matchedRuleId !== undefined
      );
    })
  );
}

export function effectiveTargetForAction(action: BrowserAction, fallback: QaTarget): QaTarget {
  if ((action.action !== "open" && action.action !== "pushstate") || action.url === undefined) {
    return fallback;
  }

  return {
    ...fallback,
    ref: resolveActionUrl(action.url, fallback),
  };
}

function resolveActionUrl(url: string, target: QaTarget): string {
  if (!url.startsWith("/") || (target.kind !== "url" && target.kind !== "localhost")) {
    return url;
  }

  try {
    return new URL(url, target.ref).toString();
  } catch {
    return url;
  }
}

function createPolicyInvalidError(message: string, cause?: unknown): SurfaceError {
  return createSurfaceError("policy_invalid", message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function hasTraversalSegment(value: string): boolean {
  return value.split(/[\\/]/u).includes("..");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
