import { describe, expect, it } from "vitest";

import {
  DEFAULT_SURFACE_CONFIG,
  DirectSubscriptionChannelIdSchema,
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

  it("validates default model fallback and egress policy", () => {
    const resolved = resolveSurfaceConfig();

    expect(resolved.model).toMatchObject({
      fallback: {
        mode: "off",
        providerOrder: ["claude", "codex", "gemini"],
        depth: 3,
        fallbackToMmr: true,
        effectiveChannels: [],
      },
      egressPolicy: {
        mode: "off",
        screenshots: "blocked",
      },
      effectiveEgressPolicy: {
        mode: "off",
        screenshots: "blocked",
      },
    });
  });

  it("treats project model fallback and egress config as defaults without consent", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          fallback: { mode: "auto" },
          egressPolicy: { mode: "text" },
        },
      },
    });

    expect(resolved.model.fallback.mode).toBe("auto");
    expect(resolved.model.egressPolicy.mode).toBe("text");
    expect(resolved.model.effectiveEgressPolicy.mode).toBe("off");
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("requires explicit screenshot consent beyond project screenshot policy", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          fallback: { mode: "auto" },
          egressPolicy: { screenshots: "redacted-only" },
        },
      },
      cli: {
        model: {
          fallback: { mode: "auto" },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy.mode).toBe("text");
    expect(resolved.model.effectiveEgressPolicy.screenshots).toBe("blocked");
  });

  it("does not treat screenshot opt-in as subscription fallback consent", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          fallback: { mode: "auto" },
        },
      },
      cli: {
        model: {
          egressPolicy: { screenshots: "redacted-only" },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "text-and-screenshots",
      screenshots: "redacted-only",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("lets higher-precedence screenshot blocks revoke lower screenshot consent", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          egressPolicy: { screenshots: "redacted-only" },
        },
      },
      cli: {
        model: {
          egressPolicy: { screenshots: "blocked" },
          fallback: { mode: "auto" },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "text",
      screenshots: "blocked",
    });
  });

  it("does not treat provider channels as fallback consent when fallback mode is off", () => {
    const resolved = resolveSurfaceConfig({
      cli: {
        model: {
          fallback: {
            allowedChannels: ["codex"],
            mode: "off",
            providerOrder: ["codex"],
          },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "off",
      screenshots: "blocked",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("lets a higher-precedence fallback mode off revoke lower-layer fallback consent", () => {
    const resolved = resolveSurfaceConfig({
      env: {
        model: {
          fallback: {
            allowedChannels: ["gemini"],
            mode: "direct",
            providerOrder: ["gemini"],
          },
        },
      },
      cli: {
        model: {
          fallback: { mode: "off" },
        },
      },
    });

    expect(resolved.model.fallback.mode).toBe("off");
    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "off",
      screenshots: "blocked",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("keeps project provider order and screenshot-only runtime opt-in from enabling direct channels", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          fallback: { providerOrder: ["gemini", "codex"] },
        },
      },
      cli: {
        model: {
          egressPolicy: { deniedChannels: ["codex"], screenshots: "redacted-only" },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "text-and-screenshots",
      screenshots: "redacted-only",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("treats runtime channel selection as consent when project fallback mode is enabled", () => {
    const resolved = resolveSurfaceConfig({
      project: {
        model: {
          fallback: { mode: "direct", providerOrder: ["gemini", "codex"] },
        },
      },
      env: {
        model: {
          fallback: { allowedChannels: ["codex"], providerOrder: ["codex"] },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "text",
      screenshots: "blocked",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual(["codex"]);
  });

  it("lets user hard egress policy block runtime expansion", () => {
    const resolved = resolveSurfaceConfig({
      user: {
        model: {
          egressPolicy: { mode: "off" },
        },
      },
      cli: {
        model: {
          fallback: { mode: "auto" },
          egressPolicy: { mode: "text-and-screenshots", screenshots: "redacted-only" },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      mode: "off",
      screenshots: "blocked",
    });
    expect(resolved.model.fallback.effectiveChannels).toEqual([]);
  });

  it("narrows direct channels by allowlists and denylists", () => {
    const resolved = resolveSurfaceConfig({
      user: {
        model: {
          fallback: { allowedChannels: ["claude", "codex", "gemini"] },
          egressPolicy: { mode: "text", allowedChannels: ["claude", "codex"] },
        },
      },
      project: {
        model: {
          fallback: { providerOrder: ["gemini", "codex", "claude"] },
          egressPolicy: { deniedChannels: ["claude"] },
        },
      },
      cli: {
        model: {
          fallback: { mode: "direct" },
          egressPolicy: { deniedChannels: ["gemini"] },
        },
      },
    });

    expect(resolved.model.fallback.effectiveChannels).toEqual(["codex"]);
    expect(resolved.model.fallback.policyBlockedChannels).toEqual([
      { channelId: "gemini", reason: "channel_denied_by_policy" },
      { channelId: "claude", reason: "channel_denied_by_policy" },
    ]);
  });

  it("narrows effective model egress channels across all configured layers", () => {
    const resolved = resolveSurfaceConfig({
      user: {
        model: {
          egressPolicy: {
            allowedChannels: ["openai", "codex", "mmr"],
            deniedChannels: ["mmr"],
            mode: "text",
          },
        },
      },
      project: {
        model: {
          egressPolicy: {
            allowedChannels: ["openai", "codex", "local"],
            deniedChannels: ["local"],
          },
        },
      },
      cli: {
        model: {
          egressPolicy: {
            deniedChannels: ["openai"],
          },
        },
      },
    });

    expect(resolved.model.effectiveEgressPolicy).toMatchObject({
      allowedChannels: ["openai", "codex"],
      deniedChannels: ["mmr", "local", "openai"],
      mode: "text",
    });
  });

  it("rejects non-direct subscription channels in direct fallback order", () => {
    expect(() =>
      resolveSurfaceConfig({
        cli: {
          model: {
            fallback: {
              providerOrder: ["anthropic"],
            },
          },
        },
      } as unknown as Parameters<typeof resolveSurfaceConfig>[0]),
    ).toThrow();

    expect(() => DirectSubscriptionChannelIdSchema.parse("antigravity")).toThrow();
    expect(() => DirectSubscriptionChannelIdSchema.parse("grok")).toThrow();
    expect(() => DirectSubscriptionChannelIdSchema.parse("mmr")).toThrow();
  });
});
