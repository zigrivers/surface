import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import {
  classifyBrowserAction,
  createBuiltInSafeActionPolicy,
  resolveActionPolicy,
  validateFlowIsolationPolicy,
} from "./action-policy.js";
import type { ActionPolicy } from "./schemas.js";

describe("browser QA action policy", () => {
  it("allows navigation and reveal interactions with the built-in safe policy", () => {
    const policy = createBuiltInSafeActionPolicy();

    expect(
      classifyBrowserAction({
        action: { action: "open", url: "/settings" },
        effectiveTarget: { kind: "url", ref: "https://app.example.test/settings" },
        policy,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      classifyBrowserAction({
        action: { action: "hover", locator: { role: "button", name: "More options" } },
        effectiveTarget: { kind: "url", ref: "https://app.example.test/settings" },
        policy,
      }),
    ).toMatchObject({ allowed: true });
  });

  it("denies form submit without an explicit target-bound rule", () => {
    const policy = createBuiltInSafeActionPolicy();
    const decision = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Pay now" } },
      effectiveTarget: { kind: "url", ref: "https://app.example.test/checkout" },
      policy,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("action_policy_denied");
    expect(decision.category).toBe("payment");
  });

  it("evaluates destructive rules against the effective base-url origin", () => {
    const allowed = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Delete account" } },
      effectiveTarget: { kind: "url", ref: "https://app.example.test/settings" },
      policy: makePolicyAllowingOrigin("https://app.example.test"),
    });
    const denied = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Delete account" } },
      effectiveTarget: { kind: "url", ref: "https://preview.example.test/settings" },
      policy: makePolicyAllowingOrigin("https://app.example.test"),
    });

    expect(allowed).toMatchObject({ allowed: true, matchedRuleId: "allow-delete-account" });
    expect(denied).toMatchObject({ allowed: false, code: "action_policy_denied" });
  });

  it("does not allow destructive actions from origin-only allow rules", () => {
    const decision = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Pay now" } },
      effectiveTarget: { kind: "url", ref: "https://app.example.test/checkout" },
      policy: {
        ...createBuiltInSafeActionPolicy(),
        allowedDomains: ["app.example.test"],
        rules: [
          {
            actions: ["click"],
            categories: ["payment"],
            decision: "allow",
            id: "too-broad-payment",
            origins: ["https://app.example.test"],
          },
        ],
      },
    });

    expect(decision).toMatchObject({ allowed: false, code: "action_policy_denied" });
  });

  it("does not allow destructive actions from route-only allow rules", () => {
    const decision = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Pay now" } },
      effectiveTarget: { kind: "url", ref: "https://app.example.test/checkout" },
      policy: {
        ...createBuiltInSafeActionPolicy(),
        allowedDomains: ["app.example.test"],
        rules: [
          {
            actions: ["click"],
            categories: ["payment"],
            decision: "allow",
            id: "route-only-payment",
            locators: [{ name: "Pay now", role: "button" }],
            routes: ["/checkout"],
          },
        ],
      },
    });

    expect(decision).toMatchObject({ allowed: false, code: "action_policy_denied" });
  });

  it("does not treat destructive navigation URLs as built-in safe actions", () => {
    const decision = classifyBrowserAction({
      action: { action: "open", url: "/account/delete" },
      effectiveTarget: { kind: "url", ref: "https://app.example.test/account/delete" },
      policy: createBuiltInSafeActionPolicy(),
    });

    expect(decision).toMatchObject({
      allowed: false,
      category: "account",
      code: "action_policy_denied",
    });
  });

  it("requires explicit wildcard origins for dynamic localhost ports", () => {
    const denied = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Delete account" } },
      effectiveTarget: { kind: "url", ref: "http://localhost:5173/settings" },
      policy: makePolicyAllowingOrigin("http://localhost"),
    });
    const allowed = classifyBrowserAction({
      action: { action: "click", locator: { role: "button", name: "Delete account" } },
      effectiveTarget: { kind: "url", ref: "http://localhost:5173/settings" },
      policy: makePolicyAllowingOrigin("http://localhost:*"),
    });

    expect(denied).toMatchObject({ allowed: false, code: "target_not_allowed" });
    expect(allowed).toMatchObject({ allowed: true });
  });

  it("rejects fixture symlink escapes", async () => {
    const projectRoot = await makeTempRoot();
    const outsideRoot = await makeTempRoot();
    await mkdir(path.join(projectRoot, ".surface", "qa"), { recursive: true });
    await mkdir(path.join(projectRoot, "fixtures"), { recursive: true });
    await writeFile(path.join(outsideRoot, "outside.json"), "{}");
    await symlink(
      path.join(outsideRoot, "outside.json"),
      path.join(projectRoot, "fixtures", "fixture.json"),
    );
    await writeFile(
      path.join(projectRoot, ".surface", "qa", "action-policy.json"),
      `${JSON.stringify({
        fixtureAccounts: [{ fixtureRef: "fixtures/fixture.json", id: "checkoutUser" }],
      })}\n`,
    );

    const result = await resolveActionPolicy({
      fixtureRoots: ["fixtures"],
      policyRef: ".surface/qa/action-policy.json",
      projectRoot,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "policy_invalid" } });
  });

  it("loads the default project action policy before falling back to built-in safe policy", async () => {
    const projectRoot = await makeTempRoot();
    await mkdir(path.join(projectRoot, ".surface", "qa"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".surface", "qa", "action-policy.json"),
      `${JSON.stringify({
        allowedDomains: ["https://app.example.test"],
        rules: [
          {
            actions: ["click"],
            categories: ["submit"],
            decision: "allow",
            id: "allow-submit",
            origins: ["https://app.example.test"],
          },
        ],
      })}\n`,
    );

    const result = await resolveActionPolicy({ projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: "file",
        sourcePath: ".surface/qa/action-policy.json",
      },
    });
  });

  it("fails mutating CI flows without reset contracts", () => {
    const result = validateFlowIsolationPolicy({
      ci: true,
      flow: {
        isolation: { mutatesState: true, resetRequired: true },
      },
      policy: createBuiltInSafeActionPolicy(),
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("fails mutating CI flows even when resetRequired is omitted", () => {
    const result = validateFlowIsolationPolicy({
      ci: true,
      flow: {
        isolation: { mutatesState: true },
      },
      policy: createBuiltInSafeActionPolicy(),
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("does not treat resetEndpointId as satisfied until the runner executes it", () => {
    const result = validateFlowIsolationPolicy({
      ci: true,
      flow: {
        isolation: {
          mutatesState: true,
          resetEndpointId: "reset-cart",
          resetRequired: true,
        },
      },
      policy: {
        ...createBuiltInSafeActionPolicy(),
        allowedDomains: ["http://localhost:3000"],
        resetEndpoints: [
          { id: "reset-cart", method: "POST", origin: "http://localhost:3000", path: "/reset" },
        ],
      },
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("does not treat built-in-safe teardown as a CI reset contract", () => {
    const result = validateFlowIsolationPolicy({
      ci: true,
      flow: {
        isolation: { mutatesState: true, resetRequired: true },
        teardown: { always: [{ action: "open", url: "/checkout" }] },
      },
      policy: createBuiltInSafeActionPolicy(),
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("accepts policy-authorized teardown as a CI reset contract", () => {
    const result = validateFlowIsolationPolicy({
      ci: true,
      flow: {
        isolation: { mutatesState: true, resetRequired: true },
        teardown: {
          always: [
            {
              action: "click",
              locator: { name: "Reset cart", role: "button" },
            },
          ],
        },
      },
      policy: {
        ...createBuiltInSafeActionPolicy(),
        allowedDomains: ["http://localhost:3000"],
        rules: [
          {
            actions: ["click"],
            categories: ["clear"],
            decision: "allow",
            id: "allow-reset",
            locators: [{ name: "Reset cart", role: "button" }],
            origins: ["http://localhost:3000"],
            routes: ["/"],
          },
        ],
      },
      target: { kind: "url", ref: "http://localhost:3000" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { gateEligible: true, resetSatisfied: true },
    });
  });
});

function makePolicyAllowingOrigin(origin: string): ActionPolicy {
  const domainOrigin = origin.endsWith(":*") ? origin.slice(0, -2) : origin;
  const hostname = new URL(domainOrigin).hostname;

  return {
    allowedDomains:
      hostname === "localhost" || hostname === "127.0.0.1"
        ? [origin]
        : [hostname, "preview.example.test"],
    environmentGroups: [],
    fixtureAccounts: [],
    resetEndpoints: [],
    rules: [
      {
        actions: ["click"],
        categories: ["account"],
        decision: "allow",
        id: "allow-delete-account",
        locators: [{ name: "Delete account", role: "button" }],
        origins: [origin],
        routes: ["/settings"],
      },
    ],
  };
}

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-qa-policy-"));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  return root;
}
