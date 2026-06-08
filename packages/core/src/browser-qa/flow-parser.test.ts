import { describe, expect, it } from "vitest";

import {
  importLegacyRouteFlow,
  parseBrowserQaFlow,
  resolveFlowTarget,
  validateFlowTargetCli,
} from "./flow-parser.js";

describe("browser QA flow parser", () => {
  it("parses a checkout flow with semantic locators and secret refs", () => {
    const result = parseBrowserQaFlow(checkoutYaml, {
      sourcePath: "surface-flows/checkout.yml",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "checkout",
        secrets: { testPassword: { fromEnv: "SURFACE_QA_TEST_PASSWORD" } },
        steps: [
          { action: "open", id: "open-cart" },
          {
            action: "click",
            id: "start-checkout",
            locator: { name: "Checkout", role: "button" },
          },
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

  it("applies base-url origin substitution to config fallback targets", () => {
    const target = resolveFlowTarget({
      cli: { baseUrl: "https://preview.example.test" },
      configTarget: { kind: "url", ref: "https://app.example.test/cart" },
    });

    expect(target).toEqual({ kind: "url", ref: "https://preview.example.test/cart" });
  });

  it("rebases unrelated absolute target origins with base-url", () => {
    const target = resolveFlowTarget({
      cli: { baseUrl: "https://preview.example.test" },
      flowTarget: { kind: "url", ref: "https://oauth.vendor.test/login" },
    });

    expect(target).toEqual({ kind: "url", ref: "https://preview.example.test/login" });
  });

  it("rejects invalid base-url values before flow execution", () => {
    const result = validateFlowTargetCli({ baseUrl: "localhost:5173" });

    expect(result).toMatchObject({ ok: false, error: { code: "flow_invalid" } });
  });

  it("uses target and url overrides before base-url and flow defaults", () => {
    expect(
      resolveFlowTarget({
        cli: { baseUrl: "https://preview.example.test", target: "https://ci.example.test" },
        flowTarget: { kind: "url", ref: "https://app.example.test/cart" },
      }),
    ).toEqual({ kind: "url", ref: "https://ci.example.test" });
    expect(
      resolveFlowTarget({
        cli: { url: "https://url.example.test" },
        flowTarget: { kind: "url", ref: "https://app.example.test/cart" },
      }),
    ).toEqual({ kind: "url", ref: "https://url.example.test" });
  });

  it("imports legacy route flows as open and capture steps", () => {
    const imported = importLegacyRouteFlow({
      id: "legacy",
      targets: ["/cart", "/checkout"],
    });

    expect(imported).toMatchObject({ ok: true });
    expect(imported.ok ? imported.value.steps.map((step) => step.action) : []).toEqual([
      "open",
      "capture",
      "open",
      "capture",
    ]);
    expect(imported.ok ? imported.value.degradation[0] : undefined).toMatchObject({
      code: "legacy_flow_imported_without_interactions",
    });
  });

  it("rejects legacy route flows without targets", () => {
    const imported = importLegacyRouteFlow({
      id: "empty",
      targets: [],
    });

    expect(imported).toMatchObject({
      error: { code: "flow_invalid" },
      ok: false,
    });
  });
});

const checkoutYaml = `
schemaVersion: "1.0"
id: checkout
title: Checkout validation flow
severity: high
target:
  kind: url
  ref: https://app.example.test/cart
secrets:
  testPassword:
    fromEnv: SURFACE_QA_TEST_PASSWORD
steps:
  - id: open-cart
    action: open
    url: /cart
    capture: true
  - id: start-checkout
    action: click
    locator:
      role: button
      name: Checkout
      refHint: "@e12"
    wait:
      url: "**/checkout"
`;

const secretLiteralYaml = `
schemaVersion: "1.0"
id: bad
title: Bad flow
secrets:
  testPassword: "super-secret"
steps:
  - id: open-cart
    action: open
    url: /cart
`;
