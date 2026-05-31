import { describe, expect, it } from "vitest";

import {
  DEFAULT_SURFACE_CONFIG,
  SurfaceConfigSchema,
  resolveSurfaceConfig,
  type SurfaceConfig,
} from "./config.js";

describe("SurfaceConfig schemas", () => {
  it("validates safe defaults for capture, evaluation, findings, and reporting", () => {
    const parsed = SurfaceConfigSchema.parse(DEFAULT_SURFACE_CONFIG);

    expect(Object.isFrozen(DEFAULT_SURFACE_CONFIG.capture)).toBe(true);
    expect(parsed.capture.allowlist).toEqual([]);
    expect(parsed.capture.captureRetention).toBe("ephemeral");
    expect(parsed.evaluation.preset).toBe("standard");
    expect(parsed.findings.confidenceCutoffs).toEqual({
      assert: 0.8,
      question: 0.5,
    });
    expect(parsed.reporting.integrations).toEqual([]);
    expect(parsed.reporting.gatePolicy.neverFailOn).toEqual(["judged", "gatedForHuman"]);
  });

  it("returns owned mutable configs without mutating frozen defaults", () => {
    const resolved = resolveSurfaceConfig();

    expect(Object.isFrozen(resolved.capture)).toBe(false);
    expect(Object.isFrozen(resolved.capture.viewports)).toBe(false);
    expect(Object.isFrozen(resolved.reporting.gatePolicy.neverFailOn)).toBe(false);

    resolved.capture.allowlist.push("https://mutated.example.com");
    expect(DEFAULT_SURFACE_CONFIG.capture.allowlist).toEqual([]);
  });

  it("merges config layers by documented precedence", () => {
    const resolved = resolveSurfaceConfig({
      user: {
        evaluation: { preset: "quick", depth: 2, stack: ["agnostic"] },
        findings: { confidenceCutoffs: { assert: 0.75 } },
      },
      project: {
        capture: {
          allowlist: ["https://app.example.com"],
          viewports: [{ width: 1280, height: 720, label: "desktop" }],
        },
        evaluation: { appType: "saas-dashboard", stack: ["react", "next"] },
      },
      env: {
        reporting: { integrations: ["github"] },
      },
      cli: {
        evaluation: { depth: 4, preset: "accessibility-first" },
        findings: { confidenceCutoffs: { question: 0.6 } },
      },
    });

    expect(resolved).toMatchObject({
      capture: {
        allowlist: ["https://app.example.com"],
        viewports: [{ width: 1280, height: 720, label: "desktop" }],
      },
      evaluation: {
        preset: "accessibility-first",
        depth: 4,
        appType: "saas-dashboard",
        stack: ["react", "next"],
      },
      findings: {
        confidenceCutoffs: {
          assert: 0.75,
          question: 0.6,
        },
      },
      reporting: {
        integrations: ["github"],
      },
    });
  });

  it("ignores explicit undefined values in higher-precedence layers", () => {
    const resolved = resolveSurfaceConfig({
      user: {
        evaluation: { preset: "quick" },
      },
      cli: {
        evaluation: { preset: undefined, depth: 4 },
      },
    });

    expect(resolved.evaluation.preset).toBe("quick");
    expect(resolved.evaluation.depth).toBe(4);
  });

  it("rejects malformed config and unsafe gate policies", () => {
    expect(() =>
      SurfaceConfigSchema.parse({
        ...DEFAULT_SURFACE_CONFIG,
        evaluation: { ...DEFAULT_SURFACE_CONFIG.evaluation, depth: 6 },
      }),
    ).toThrow();

    expect(() =>
      SurfaceConfigSchema.parse({
        ...DEFAULT_SURFACE_CONFIG,
        capture: {
          ...DEFAULT_SURFACE_CONFIG.capture,
          viewports: [{ width: 0, height: 720, label: "desktop" }],
        },
      }),
    ).toThrow();

    const unsafeGatePolicyLayer = {
      cli: {
        reporting: {
          gatePolicy: {
            neverFailOn: ["judged"],
          },
        },
      },
    } as unknown as Parameters<typeof resolveSurfaceConfig>[0];
    expect(() => resolveSurfaceConfig(unsafeGatePolicyLayer)).toThrow(/neverFailOn/);

    expect(() =>
      SurfaceConfigSchema.parse({
        ...DEFAULT_SURFACE_CONFIG,
        reporting: {
          ...DEFAULT_SURFACE_CONFIG.reporting,
          gatePolicy: {
            ...DEFAULT_SURFACE_CONFIG.reporting.gatePolicy,
            neverFailOn: ["judged", "judged"],
          },
        },
      }),
    ).toThrow(/neverFailOn/);
  });

  it("returns the canonical static type from resolved config", () => {
    const resolved: SurfaceConfig = resolveSurfaceConfig({
      cli: { evaluation: { depth: 5 } },
    });

    expect(resolved.evaluation.depth).toBe(5);
  });
});
