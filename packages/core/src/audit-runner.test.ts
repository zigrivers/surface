import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok } from "./errors.js";
import type { FindingDraft } from "./findings.js";
import type {
  Capture,
  PersistArtifactIntent,
  KnowledgeEntry,
  KnowledgeSource,
  Lens,
  ModelProvider,
} from "./interfaces.js";
import type { LensRegistration } from "./lens-registry.js";
import type { MmrAuditFallback } from "./mmr-audit-fallback.js";
import type { ReconciliationService } from "./reconciliation.js";
import { createAuditRunner, resolveModelExecutionPlan } from "./audit-runner.js";

const capture = {
  id: "cap_audit",
  target: { kind: "url", ref: "https://example.test" },
  backend: "playwright",
  artifacts: [
    { id: "dom", type: "dom-snapshot", path: ".surface/dom.html", redacted: false },
    { id: "styles", type: "computed-styles", path: ".surface/styles.json", redacted: false },
  ],
  capturedAt: "2026-06-08T00:00:00.000Z",
  status: "completed",
} satisfies Capture;

const knowledge: KnowledgeSource = {
  query: () => ok([]),
  resolve: (id) =>
    ok({
      id,
      summary: "Test knowledge.",
      title: "Test knowledge",
    } satisfies KnowledgeEntry),
};

describe("audit runner", () => {
  it("resolves model execution plans without provider side effects", () => {
    expect(
      resolveModelExecutionPlan(resolveSurfaceConfig(), {
        hasMmrFallback: false,
        primaryProviderConfigured: false,
      }),
    ).toEqual({
      egressEnabled: false,
      useDirectSubscriptions: false,
      useMmr: false,
    });
    expect(
      resolveModelExecutionPlan(
        resolveSurfaceConfig({
          cli: {
            model: {
              egressPolicy: { mode: "text" },
              fallback: { mode: "direct", providerOrder: ["codex"] },
            },
          },
        }),
        { hasMmrFallback: true, primaryProviderConfigured: false },
      ),
    ).toEqual({
      egressEnabled: true,
      useDirectSubscriptions: true,
      useMmr: false,
    });
    expect(
      resolveModelExecutionPlan(
        resolveSurfaceConfig({
          cli: {
            model: {
              egressPolicy: { mode: "text" },
              fallback: { fallbackToMmr: false, mode: "mmr" },
            },
          },
        }),
        { hasMmrFallback: true, primaryProviderConfigured: false },
      ),
    ).toEqual({
      egressEnabled: true,
      useDirectSubscriptions: false,
      useMmr: true,
    });
    expect(
      resolveModelExecutionPlan(
        resolveSurfaceConfig({
          cli: {
            model: {
              egressPolicy: { mode: "text" },
              fallback: { mode: "auto", providerOrder: ["codex"] },
            },
          },
        }),
        { hasMmrFallback: true, primaryProviderConfigured: true },
      ),
    ).toEqual({
      egressEnabled: true,
      useDirectSubscriptions: false,
      useMmr: false,
    });
  });

  it("runs measured and local judged lenses without model consent or subscription discovery", async () => {
    let resolverCalls = 0;
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration("accessibility", false, measuredLens("accessibility")),
        lensRegistration("visual-hierarchy", false, judgedLocalLens("visual-hierarchy")),
        lensRegistration("usability", true, modelLens("usability")),
      ],
      resolveSubscriptionProviders: () => {
        resolverCalls += 1;
        return { discoveryUnavailableChannels: [], subscriptionProviders: [] };
      },
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig(),
      runId: "run_no_consent",
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(result.value.findings.map((finding) => finding.lens)).toEqual([
      "accessibility",
      "visual-hierarchy",
    ]);
    expect(result.value.findings.map((finding) => finding.id)).not.toContain("seeded_low_contrast");
    expect(resolverCalls).toBe(0);
    expect(result.value.modelEgress).toMatchObject([
      {
        artifactClassesSent: [],
        blockedReasons: ["model_egress_blocked_by_policy"],
        redactionStatus: "none",
      },
    ]);
  });

  it("does not resolve provider factories when model egress is hard off", async () => {
    let factoryCalls = 0;
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProviderFactory: () => {
        factoryCalls += 1;
        return modelProvider("openai").provider;
      },
      resolveSubscriptionProviders: () => {
        throw new Error("subscription discovery should not run");
      },
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "off" } } },
      }),
      runId: "run_hard_off_factory",
    });

    expect(isOk(result)).toBe(true);
    expect(factoryCalls).toBe(0);
    expect(isOk(result) ? result.value.blockedReasons : []).toContain(
      "model_egress_blocked_by_policy",
    );
  });

  it("uses BYO/local providers before subscription fallback", async () => {
    let resolverCalls = 0;
    const provider = modelProvider("openai");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProvider: provider.provider,
      resolveSubscriptionProviders: () => {
        resolverCalls += 1;
        return {
          discoveryUnavailableChannels: [],
          subscriptionProviders: [modelProvider("codex").provider],
        };
      },
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_byo",
    });

    expect(isOk(result)).toBe(true);
    expect(provider.completeCalls).toBe(1);
    expect(resolverCalls).toBe(0);
  });

  it("accepts injected subscription providers whose canonical channel comes from availability", async () => {
    let completeCalls = 0;
    const provider: ModelProvider = {
      availability: () =>
        ok({
          available: true,
          channelId: "gemini",
          model: "gemini-test",
          provider: "gemini",
          sourceKind: "subscription-cli",
        }),
      complete: () => {
        completeCalls += 1;

        return ok({
          channelId: "gemini",
          model: "gemini-test",
          provider: "gemini",
          sourceKind: "subscription-cli",
          text: "[]",
        });
      },
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      subscriptionProviders: [provider],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            fallback: { mode: "direct", providerOrder: ["gemini"] },
          },
        },
      }),
      runId: "run_idless_subscription_provider",
    });

    expect(isOk(result)).toBe(true);
    expect(completeCalls).toBe(1);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["gemini"],
        completedChannels: ["gemini"],
      },
    ]);
  });

  it("hard egress off and channel deny block model providers before completion", async () => {
    let resolverCalls = 0;
    const hardBlocked = modelProvider("openai");
    const denied = modelProvider("openai");
    const mmr = fakeMmr();
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      resolveSubscriptionProviders: () => {
        resolverCalls += 1;
        return {
          discoveryUnavailableChannels: [],
          subscriptionProviders: [modelProvider("codex").provider],
        };
      },
    });

    const hardResult = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
        user: { model: { egressPolicy: { mode: "off" } } },
      }),
      modelProvider: hardBlocked.provider,
      runId: "run_hard_off",
    });
    const deniedResult = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text", deniedChannels: ["openai", "mmr"] },
            fallback: { mode: "mmr" },
          },
        },
      }),
      mmrFallback: mmr,
      modelProvider: denied.provider,
      runId: "run_denied",
    });

    expect(isOk(hardResult)).toBe(true);
    expect(isOk(deniedResult)).toBe(true);
    expect(resolverCalls).toBe(0);
    expect(hardBlocked.completeCalls).toBe(0);
    expect(denied.completeCalls).toBe(0);
    expect(mmr.availabilityCalls).toBe(0);
    expect(isOk(deniedResult) ? deniedResult.value.blockedReasons : []).toContain(
      "channel_denied_by_policy",
    );
  });

  it("applies cross-layer channel restrictions to BYO and MMR providers", async () => {
    const byo = modelProvider("openai");
    const mmr = fakeMmr();
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      mmrFallback: mmr,
    });

    const byoResult = await runner({
      capture,
      config: resolveSurfaceConfig({
        user: {
          model: { egressPolicy: { allowedChannels: ["codex"] } },
        },
        cli: {
          model: { egressPolicy: { allowedChannels: ["openai"], mode: "text" } },
        },
      }),
      modelProvider: byo.provider,
      runId: "run_cross_layer_byo",
    });
    const mmrResult = await runner({
      capture,
      config: resolveSurfaceConfig({
        user: {
          model: { egressPolicy: { deniedChannels: ["mmr"] } },
        },
        cli: {
          model: {
            egressPolicy: { allowedChannels: ["mmr"], mode: "text" },
            fallback: { mode: "mmr" },
          },
        },
      }),
      runId: "run_cross_layer_mmr",
    });

    expect(isOk(byoResult)).toBe(true);
    expect(isOk(mmrResult)).toBe(true);
    expect(byo.completeCalls).toBe(0);
    expect(mmr.availabilityCalls).toBe(0);
    expect(isOk(byoResult) ? byoResult.value.blockedReasons : []).toContain(
      "channel_not_allowed_by_policy",
    );
    expect(isOk(byoResult) ? byoResult.value.modelEgress : []).toMatchObject([
      {
        blockedReasons: ["channel_not_allowed_by_policy"],
        unavailableChannels: [],
      },
    ]);
    expect(JSON.stringify(isOk(byoResult) ? byoResult.value.modelEgress : [])).not.toContain(
      "unsupported-capability",
    );
    expect(isOk(mmrResult) ? mmrResult.value.blockedReasons : []).toContain(
      "channel_denied_by_policy",
    );
  });

  it("blocks providers missing canonical metadata before artifact egress", async () => {
    let completeCalls = 0;
    const missingMetadataProvider = {
      id: "openai",
      availability: () => ok({ available: true, provider: "openai", model: "gpt-test" }),
      complete: () => {
        completeCalls += 1;
        return ok({
          channelId: "openai",
          model: "gpt-test",
          provider: "openai",
          sourceKind: "api",
          text: "[]",
        });
      },
    } as ModelProvider;
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      modelProvider: missingMetadataProvider,
      runId: "run_missing_metadata",
    });

    expect(isOk(result)).toBe(true);
    expect(completeCalls).toBe(0);
    expect(isOk(result) ? result.value.blockedReasons : []).toContain("channel_metadata_missing");
  });

  it("uses subscription fallback lazily and propagates discovery unavailable records", async () => {
    let resolverCalls = 0;
    const subscription = modelProvider("codex");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      resolveSubscriptionProviders: () => {
        resolverCalls += 1;
        return {
          discoveryUnavailableChannels: [
            {
              available: false,
              channelId: "gemini",
              message: "gemini unavailable",
              reason: "auth-unavailable",
              sourceKind: "subscription-cli",
            },
          ],
          subscriptionProviders: [subscription.provider],
        };
      },
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["codex", "gemini"] },
          },
        },
      }),
      runId: "run_subscription",
    });

    expect(isOk(result)).toBe(true);
    expect(resolverCalls).toBe(1);
    expect(subscription.completeCalls).toBe(1);
    expect(isOk(result) ? result.value.unavailableChannels : []).toMatchObject([
      { id: "gemini", reason: "auth-unavailable" },
    ]);
  });

  it("filters resolver-returned subscription providers to effective fallback channels", async () => {
    const codex = modelProvider("codex");
    const gemini = modelProvider("gemini");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      resolveSubscriptionProviders: () => ({
        discoveryUnavailableChannels: [],
        subscriptionProviders: [gemini.provider, codex.provider],
      }),
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["codex", "gemini"] },
          },
        },
      }),
      runId: "run_filtered_subscription_resolver",
    });

    expect(isOk(result)).toBe(true);
    expect(codex.completeCalls).toBe(1);
    expect(gemini.completeCalls).toBe(0);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["codex"],
        completedChannels: ["codex"],
      },
    ]);
  });

  it("reports direct fallback channels filtered by policy before discovery", async () => {
    let resolverCalls = 0;
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      resolveSubscriptionProviders: () => {
        resolverCalls += 1;
        return {
          discoveryUnavailableChannels: [],
          subscriptionProviders: [],
        };
      },
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        user: {
          model: { egressPolicy: { allowedChannels: ["claude"] } },
        },
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["gemini"] },
          },
        },
      }),
      runId: "run_policy_filtered_subscription",
    });

    expect(isOk(result)).toBe(true);
    expect(resolverCalls).toBe(0);
    expect(isOk(result) ? result.value.blockedReasons : []).toContain(
      "channel_not_allowed_by_policy",
    );
    expect(isOk(result) ? result.value.unavailableChannels : []).toMatchObject([
      {
        id: "gemini",
        reason: "channel_not_allowed_by_policy",
      },
    ]);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["gemini"],
        blockedReasons: ["channel_not_allowed_by_policy"],
        completedChannels: [],
      },
    ]);
  });

  it("does not report direct fallback policy blocks when a primary provider is configured", async () => {
    const primary = modelProvider("openai");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProvider: primary.provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { deniedChannels: ["gemini"], mode: "text" },
            fallback: { mode: "direct", providerOrder: ["gemini"] },
          },
        },
      }),
      runId: "run_primary_ignores_direct_policy_blocks",
    });

    expect(isOk(result)).toBe(true);
    expect(primary.completeCalls).toBe(1);
    expect(JSON.stringify(isOk(result) ? result.value : {})).not.toMatch(
      /gemini|channel_denied_by_policy/,
    );
  });

  it("records subscription source kind when discovery fails before providers are available", async () => {
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      resolveSubscriptionProviders: () => ({
        discoveryUnavailableChannels: [
          {
            available: false,
            channelId: "codex",
            message: "codex login unavailable",
            reason: "auth-unavailable",
            sourceKind: "subscription-cli",
          },
        ],
        subscriptionProviders: [],
      }),
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["codex"] },
          },
        },
      }),
      runId: "run_subscription_discovery_only",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        artifactClassesSent: [],
        attemptedChannels: ["codex"],
        redactionStatus: "none",
        sourceKind: "subscription-cli",
      },
    ]);
  });

  it("records canonical availability channels when a provider has no id", async () => {
    const provider: ModelProvider = {
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: () =>
        ok({
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
          text: "[]",
        }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_provider_without_id",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["openai"],
        completedChannels: ["openai"],
        sourceKind: "api",
      },
    ]);
  });

  it("does not mark focused model lenses evaluated when no provider can run", async () => {
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      lensId: "usability",
      runId: "run_focused_no_model",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.evaluatedLenses : []).toEqual([]);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "usability", reason: "model_unavailable" },
    ]);
  });

  it("requires direct fallback consent before using injected subscription providers", async () => {
    const subscription = modelProvider("codex");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      subscriptionProviders: [subscription.provider],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_injected_without_direct_consent",
    });

    expect(isOk(result)).toBe(true);
    expect(subscription.completeCalls).toBe(0);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "usability", reason: "model_unavailable" },
    ]);
  });

  it("does not fall back to subscription providers after a BYO completion failure", async () => {
    let primaryCalls = 0;
    const subscription = modelProvider("codex");
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProvider: {
        id: "openai",
        availability: () =>
          ok({
            available: true,
            channelId: "openai",
            model: "openai-model",
            provider: "openai",
            sourceKind: "api",
          }),
        complete: () => {
          primaryCalls += 1;
          return err(createSurfaceError("model_request_failed", "primary failed"));
        },
      },
      resolveSubscriptionProviders: () => ({
        discoveryUnavailableChannels: [],
        subscriptionProviders: [subscription.provider],
      }),
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "direct", providerOrder: ["codex"] },
          },
        },
      }),
      runId: "run_primary_then_subscription",
    });

    expect(isOk(result)).toBe(true);
    expect(primaryCalls).toBe(1);
    expect(subscription.completeCalls).toBe(0);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "usability", reason: "model_unavailable" },
    ]);
    expect(isOk(result) ? result.value.blockedReasons : []).toContain(
      "primary_provider_failed_no_fallback",
    );
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        blockedReasons: ["primary_provider_failed_no_fallback"],
      },
    ]);
  });

  it("filters blocked artifacts and masks prompt text before model egress", async () => {
    const requests: unknown[] = [];
    const seenArtifactTypes: string[][] = [];
    const provider = recordingProvider("openai", requests);
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration(
          "usability",
          true,
          leakingModelLens("usability", seenArtifactTypes, {
            artifactText: '<input value="hunter-two" type="password"><p>ada@example.test</p>',
            secretKey: "api_key_abcdef1234567890",
            secretValue: "api_key_1234567890abcdef",
          }),
        ),
      ],
      modelProvider: provider,
    });

    const result = await runner({
      capture: {
        ...capture,
        artifacts: [
          { id: "dom", type: "dom-snapshot", path: ".surface/dom.html", redacted: false },
          { id: "screen", type: "screenshot", path: ".surface/screen.png", redacted: false },
        ],
      },
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_privacy",
    });

    expect(isOk(result)).toBe(true);
    expect(seenArtifactTypes).toEqual([["dom-snapshot"]]);
    expect(JSON.stringify(requests)).not.toMatch(
      /hunter-two|ada@example\.test|api_key_1234567890abcdef|api_key_abcdef1234567890|screenshot/,
    );
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        artifactClassesSent: ["dom-snapshot"],
        blockedReasons: ["screenshot_blocked_by_policy"],
      },
    ]);
  });

  it("bounds recursive prompt sanitization before model egress", async () => {
    const requests: unknown[] = [];
    const provider = recordingProvider("openai", requests);
    const circular: Record<string, unknown> = {
      api_key_abcdef1234567890: "sk-live-circular-secret",
    };
    circular.self = circular;
    let deepPrompt: Record<string, unknown> = {
      terminal: "sk-live-too-deep",
    };

    for (let index = 0; index < 64; index += 1) {
      deepPrompt = { child: deepPrompt };
    }

    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration("usability", true, {
          id: "usability",
          method: "judged",
          requiresLiveDom: false,
          requiresModel: true,
          evaluate: async (context) => {
            if (context.model === undefined) {
              return err(createSurfaceError("model_unavailable", "model unavailable"));
            }

            const completion = await context.model.complete({
              prompt: {
                instructions: "Return JSON findings.",
                input: {
                  circular,
                  deepPrompt,
                },
              },
              responseFormat: { type: "json" },
            });

            if (!isOk(completion)) {
              return err(completion.error);
            }

            return ok([draft("usability", "judged")]);
          },
        }),
      ],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_deep_prompt_privacy",
    });
    const serializedRequest = JSON.stringify(requests[0]) ?? "";

    expect(isOk(result)).toBe(true);
    expect(serializedRequest).toContain("[masked-circular-prompt]");
    expect(serializedRequest).toContain("[masked-nested-prompt]");
    expect(serializedRequest).not.toMatch(
      /api_key_abcdef1234567890|sk-live-circular-secret|sk-live-too-deep/,
    );
  });

  it("passes generated sanitized text artifact paths to model lenses", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-model-artifacts-"));

    try {
      const rawDomPath = join(root, "captures", "dom.html");
      await mkdir(join(root, "captures"), { recursive: true });
      await writeFile(
        rawDomPath,
        "<main><textarea>Leave at 123 Private Lane</textarea><p>sk-live-secret</p></main>",
      );

      const requests: unknown[] = [];
      const writes: PersistArtifactIntent[] = [];
      const seenArtifactTypes: string[][] = [];
      const provider = recordingProvider("openai", requests);
      const runner = createAuditRunner({
        artifactWriter: {
          writeArtifact: (intent) => {
            writes.push(intent);

            return ok({ path: join(root, intent.relativePath), sha256: "sha256:sanitized" });
          },
        },
        knowledgeSource: knowledge,
        lensFactoryOptions: { projectRoot: root },
        lensRegistry: [
          lensRegistration("usability", true, {
            ...leakingModelLens("usability", seenArtifactTypes, {
              artifactText: "safe checkout text",
            }),
            requiresLiveDom: true,
          }),
        ],
        modelProvider: provider,
      });

      const result = await runner({
        capture: {
          ...capture,
          artifacts: [{ id: "dom", type: "dom-snapshot", path: rawDomPath, redacted: false }],
        },
        config: resolveSurfaceConfig({
          cli: { model: { egressPolicy: { mode: "text" } } },
        }),
        runId: "run_sanitized_artifacts",
      });

      const serializedRequests = JSON.stringify(requests);
      const generatedText = new TextDecoder().decode(writes[0]?.bytes ?? new Uint8Array());

      expect(isOk(result)).toBe(true);
      expect(seenArtifactTypes).toEqual([["dom-snapshot"]]);
      expect(writes[0]?.relativePath).toBe("model-egress/run_sanitized_artifacts/dom.txt");
      expect(serializedRequests).not.toContain(rawDomPath);
      expect(serializedRequests).not.toContain("dom.html");
      expect(generatedText).not.toMatch(/Leave at 123 Private Lane|sk-live-secret/);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects readable model artifact paths outside the project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-model-artifact-root-"));
    const outside = await mkdtemp(join(tmpdir(), "surface-model-artifact-outside-"));

    try {
      const outsidePath = join(outside, "secret-dom.html");
      await writeFile(outsidePath, "<main>api_key_outside123456</main>");

      const requests: unknown[] = [];
      const writes: PersistArtifactIntent[] = [];
      const provider = recordingProvider("openai", requests);
      const runner = createAuditRunner({
        artifactWriter: {
          writeArtifact: (intent) => {
            writes.push(intent);

            return ok({ path: join(root, intent.relativePath), sha256: "sha256:sanitized" });
          },
        },
        knowledgeSource: knowledge,
        lensFactoryOptions: { projectRoot: root },
        lensRegistry: [lensRegistration("usability", true, liveDomModelLens("usability"))],
        modelProvider: provider,
      });

      const result = await runner({
        capture: {
          ...capture,
          artifacts: [{ id: "dom", type: "dom-snapshot", path: outsidePath, redacted: false }],
        },
        config: resolveSurfaceConfig({
          cli: { model: { egressPolicy: { mode: "text" } } },
        }),
        runId: "run_outside_model_artifact",
      });

      expect(isOk(result)).toBe(false);
      expect(result).toMatchObject({
        error: {
          code: "capture_failed",
          message: "Model artifact path is outside the project root.",
        },
      });
      expect(requests).toEqual([]);
      expect(writes).toEqual([]);
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]);
    }
  });

  it("requires an artifact writer for live-DOM model artifact paths", async () => {
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, liveDomModelLens("usability"))],
      modelProvider: modelProvider("openai").provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_live_dom_requires_writer",
    });

    expect(isOk(result)).toBe(false);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Model artifact egress requires an artifact writer for readable text artifacts.",
      },
    });
  });

  it("masks provider response text before lenses can persist it", async () => {
    const provider: ModelProvider = {
      id: "openai",
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: () =>
        ok({
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          rawStdout: "debug stream sk-live-extra-secret",
          sourceKind: "api",
          text: "model echoed sk-live-secret and ada@example.test",
        }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, responseEnvelopeEchoLens("usability"))],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_response_mask",
    });

    expect(isOk(result)).toBe(true);
    expect(JSON.stringify(isOk(result) ? result.value.findings : [])).not.toMatch(
      /sk-live-secret|sk-live-extra-secret|rawStdout|ada@example\.test/,
    );
  });

  it("keeps HTML-like provider response text literal while masking plain secrets", async () => {
    const provider: ModelProvider = {
      id: "openai",
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: () =>
        ok({
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
          text: 'CTA copy "<button>Pay now</button>" echoed sk-live-secret.',
        }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, responseEchoLens("usability"))],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_response_plain_text_mask",
    });

    expect(isOk(result)).toBe(true);
    const findings = isOk(result) ? result.value.findings : [];
    expect(findings[0]?.rationale).toContain('CTA copy "<button>Pay now</button>"');
    expect(JSON.stringify(findings)).not.toContain("sk-live-secret");
  });

  it("keeps redacted screenshot paths out of model lens capture", async () => {
    const requests: unknown[] = [];
    const seenArtifactTypes: string[][] = [];
    const provider = recordingProvider("openai", requests);
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration(
          "usability",
          true,
          leakingModelLens("usability", seenArtifactTypes, {
            artifactText: "safe checkout text",
          }),
        ),
      ],
      modelProvider: provider,
    });

    const result = await runner({
      capture: {
        ...capture,
        artifacts: [
          { id: "dom", type: "dom-snapshot", path: ".surface/dom.html", redacted: false },
          {
            id: "screen",
            path: ".surface/screen.png",
            redacted: true,
            redaction: {
              boundingBoxesVerified: true,
              maskedClasses: ["token"],
              safeNoSensitiveRegions: false,
              status: "redacted",
              unsafeRegions: [],
            },
            type: "screenshot",
          },
        ],
      },
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text-and-screenshots", screenshots: "redacted-only" },
          },
        },
      }),
      runId: "run_screenshot_metadata",
    });

    expect(isOk(result)).toBe(true);
    expect(seenArtifactTypes).toEqual([["dom-snapshot", "screenshot"]]);
    expect(JSON.stringify(requests)).not.toContain("screen.png");
    expect(JSON.stringify(requests)).toContain("[redacted-screenshot-metadata-only]");
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        artifactClassesSent: ["dom-snapshot", "screenshot"],
        redactionStatus: "redacted-screenshots",
      },
    ]);
  });

  it("degrades model request failures to unavailable judged coverage", async () => {
    const provider: ModelProvider = {
      id: "openai",
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: () =>
        err(
          createSurfaceError("model_request_failed", "model command failed", {
            details: { reason: "parse-failed" },
          }),
        ),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration("accessibility", false, measuredLens("accessibility")),
        lensRegistration("usability", true, modelLens("usability")),
      ],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_model_request_failed",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.findings.map((finding) => finding.lens) : []).toEqual([
      "accessibility",
    ]);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "usability", reason: "model_unavailable" },
    ]);
    expect(isOk(result) ? result.value.unavailableChannels : []).toMatchObject([
      { id: "openai", reason: "parse-failed" },
    ]);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        unavailableChannels: [{ channelId: "openai", reason: "parse-failed" }],
      },
    ]);
  });

  it("passes unavailable channels into depth-four reconciliation", async () => {
    let reconciliationChannels: Parameters<ReconciliationService["reconcile"]>[0]["channels"] = [];
    const failingCodex: ModelProvider = {
      id: "codex",
      availability: () =>
        ok({
          available: true,
          channelId: "codex",
          model: "codex-model",
          provider: "codex",
          sourceKind: "subscription-cli",
        }),
      complete: () =>
        err(
          createSurfaceError("model_request_failed", "codex command failed", {
            details: { reason: "command-failed" },
          }),
        ),
    };
    const successfulGemini: ModelProvider = {
      id: "gemini",
      availability: () =>
        ok({
          available: true,
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
        }),
      complete: () =>
        ok({
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
          text: "[]",
        }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      reconciliation: {
        reconcile: (input) => {
          reconciliationChannels = input.channels;
          const available = input.channels.find((channel) => channel.status === "available");

          return ok({
            participatedChannels:
              available === undefined || available.status !== "available" ? [] : [available.id],
            unavailableChannels: input.channels
              .filter((channel) => channel.status === "unavailable")
              .map((channel) => ({
                id: channel.id,
                message: channel.message,
                reason: channel.reason,
              })),
            findings:
              available === undefined || available.status !== "available"
                ? []
                : available.findings.map((finding) => ({
                    canonicalFindingId: finding.id,
                    confidence: finding.dimensions.confidence,
                    finding,
                    severityBand: finding.severityBand,
                    sourceFindingIds: [finding.id],
                    supportingChannels: [available.id],
                  })),
            questions: [],
          });
        },
      },
      resolveSubscriptionProviders: () => ({
        discoveryUnavailableChannels: [],
        subscriptionProviders: [failingCodex, successfulGemini],
      }),
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { depth: 4, mode: "direct", providerOrder: ["codex", "gemini"] },
          },
        },
      }),
      runId: "run_depth_four_reconcile",
    });

    expect(isOk(result)).toBe(true);
    expect(reconciliationChannels).toMatchObject([
      { id: "gemini", status: "available" },
      { id: "codex", reason: "channel_unavailable", status: "unavailable" },
    ]);
  });

  it("exposes depth-four reconciliation questions when channels diverge", async () => {
    const codex = modelProvider("codex").provider;
    const gemini: ModelProvider = {
      id: "gemini",
      availability: () =>
        ok({
          available: true,
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
        }),
      complete: () =>
        ok({
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
          text: "[]",
        }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      reconciliation: {
        reconcile: () =>
          ok({
            findings: [],
            participatedChannels: ["codex", "gemini"],
            questions: [
              {
                channelIds: ["codex", "gemini"],
                findingIds: ["finding_codex", "finding_gemini"],
                groupKey: "checkout#button",
                kind: "severity-divergence",
                prompt: "Codex and Gemini disagree on severity.",
                severityBands: ["P1", "P3"],
              },
            ],
            unavailableChannels: [],
          }),
      },
      subscriptionProviders: [codex, gemini],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { depth: 4, mode: "direct" },
          },
        },
      }),
      runId: "run_reconciliation_question",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.findings : []).toEqual([]);
    expect(isOk(result) ? result.value.reconciliationQuestions : []).toMatchObject([
      {
        groupKey: "checkout#button",
        kind: "severity-divergence",
      },
    ]);
  });

  it("skips only the model lens whose own provider call failed", async () => {
    const provider: ModelProvider = {
      id: "openai",
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: (request) =>
        JSON.stringify(request.prompt.input).includes("data-density")
          ? err(createSurfaceError("model_request_failed", "data model command failed"))
          : ok({
              channelId: "openai",
              model: "openai-model",
              provider: "openai",
              sourceKind: "api",
              text: "[]",
            }),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration("task-completion", true, modelLens("task-completion")),
        lensRegistration("data-density", true, modelLens("data-density")),
      ],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          evaluation: { appType: "saas-dashboard" },
          model: { egressPolicy: { mode: "text" } },
        },
      }),
      runId: "run_partial_model_failure",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.findings.map((finding) => finding.lens) : []).toEqual([
      "task-completion",
    ]);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "data-density", reason: "model_unavailable" },
    ]);
  });

  it("sanitizes provider boundary errors before unavailable and skipped-lens output", async () => {
    const provider: ModelProvider = {
      id: "openai",
      availability: () =>
        ok({
          available: true,
          channelId: "openai",
          model: "openai-model",
          provider: "openai",
          sourceKind: "api",
        }),
      complete: () =>
        err(
          createSurfaceError(
            "model_request_failed",
            "provider stderr contained sk-live-secret for ada@example.test",
          ),
        ),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      modelProvider: provider,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: { model: { egressPolicy: { mode: "text" } } },
      }),
      runId: "run_sanitized_provider_error",
    });

    expect(isOk(result)).toBe(true);
    expect(JSON.stringify(isOk(result) ? result.value.unavailableChannels : [])).not.toMatch(
      /sk-live-secret|ada@example\.test/,
    );
    expect(JSON.stringify(isOk(result) ? result.value.skippedLenses : [])).not.toMatch(
      /sk-live-secret|ada@example\.test/,
    );
  });

  it("restarts direct provider order per model lens below reconciliation depth", async () => {
    const calls: string[] = [];
    const codex: ModelProvider = {
      id: "codex",
      availability: () =>
        ok({
          available: true,
          channelId: "codex",
          model: "codex-model",
          provider: "codex",
          sourceKind: "subscription-cli",
        }),
      complete: (request) => {
        const lensId = JSON.stringify(request.prompt.input).includes("data-density")
          ? "data-density"
          : "task-completion";
        calls.push(`codex:${lensId}`);

        return lensId === "data-density"
          ? err(createSurfaceError("model_request_failed", "codex failed for data density"))
          : ok({
              channelId: "codex",
              model: "codex-model",
              provider: "codex",
              sourceKind: "subscription-cli",
              text: "[]",
            });
      },
    };
    const gemini: ModelProvider = {
      id: "gemini",
      availability: () =>
        ok({
          available: true,
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
        }),
      complete: (request) => {
        const lensId = JSON.stringify(request.prompt.input).includes("data-density")
          ? "data-density"
          : "task-completion";
        calls.push(`gemini:${lensId}`);

        return ok({
          channelId: "gemini",
          model: "gemini-model",
          provider: "gemini",
          sourceKind: "subscription-cli",
          text: "[]",
        });
      },
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        lensRegistration("task-completion", true, modelLens("task-completion")),
        lensRegistration("data-density", true, modelLens("data-density")),
      ],
      subscriptionProviders: [codex, gemini],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          evaluation: { appType: "saas-dashboard" },
          model: {
            egressPolicy: { mode: "text" },
            fallback: { depth: 2, mode: "direct", providerOrder: ["codex", "gemini"] },
          },
        },
      }),
      runId: "run_per_lens_provider_restart",
    });

    expect(isOk(result)).toBe(true);
    expect(calls).toEqual(["codex:task-completion", "codex:data-density", "gemini:data-density"]);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["codex", "gemini"],
        completedChannels: ["codex", "gemini"],
      },
    ]);
  });

  it("reports targeted registered lenses without implementations as skipped", async () => {
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [
        {
          id: "data-density",
          method: "judged",
          presets: ["standard"],
          requiresLiveDom: false,
          requiresModel: true,
        },
      ],
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          evaluation: { appType: "saas-dashboard" },
          model: { egressPolicy: { mode: "text" } },
        },
      }),
      lensId: "data-density",
      runId: "run_unimplemented_lens",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.evaluatedLenses : []).toEqual([]);
    expect(isOk(result) ? result.value.findings : []).toEqual([]);
    expect(isOk(result) ? result.value.modelEgress : []).toEqual([]);
    expect(isOk(result) ? result.value.skippedLenses : []).toMatchObject([
      { lensId: "data-density", reason: "not_implemented" },
    ]);
  });

  it("runs MMR fallback when explicitly configured and no direct provider produces findings", async () => {
    const mmr = fakeAvailableMmr();
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      mmrFallback: mmr,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { fallbackToMmr: false, mode: "mmr" },
          },
        },
      }),
      runId: "run_mmr",
    });

    expect(isOk(result)).toBe(true);
    expect(mmr.availabilityCalls).toBe(1);
    expect(mmr.runCalls).toBe(1);
    expect(isOk(result) ? result.value.findings.map((finding) => finding.lens) : []).toEqual([
      "usability",
    ]);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        attemptedChannels: ["mmr"],
        completedChannels: ["mmr"],
        sourceKind: "mmr",
      },
    ]);
  });

  it("does not record artifact classes for unavailable MMR availability probes", async () => {
    const mmr = fakeMmr();
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      mmrFallback: mmr,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "mmr" },
          },
        },
      }),
      runId: "run_mmr_unavailable_probe",
    });

    expect(isOk(result)).toBe(true);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        artifactClassesSent: [],
        attemptedChannels: ["mmr"],
        completedChannels: [],
        redactionStatus: "none",
        unavailableChannels: [{ channelId: "mmr", reason: "unsupported-capability" }],
      },
    ]);
  });

  it("does not materialize readable artifacts before unavailable MMR probes", async () => {
    const mmr = fakeMmr();
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, liveDomModelLens("usability"))],
      mmrFallback: mmr,
    });

    const result = await runner({
      capture: {
        ...capture,
        artifacts: [
          {
            id: "dom",
            type: "dom-snapshot",
            path: "/missing/surface/dom.html",
            redacted: false,
          },
        ],
      },
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "mmr" },
          },
        },
      }),
      runId: "run_mmr_unavailable_no_materialize",
    });

    expect(isOk(result)).toBe(true);
    expect(mmr.availabilityCalls).toBe(1);
    expect(isOk(result) ? result.value.modelEgress : []).toMatchObject([
      {
        artifactClassesSent: [],
        completedChannels: [],
        redactionStatus: "none",
        unavailableChannels: [{ channelId: "mmr", reason: "unsupported-capability" }],
      },
    ]);
  });

  it("propagates non-boundary MMR fallback errors", async () => {
    const mmr: MmrAuditFallback = {
      id: "mmr",
      availability: () =>
        ok({
          available: true,
          channelId: "mmr",
          model: "mmr-review",
          provider: "mmr",
          sourceKind: "mmr",
        }),
      run: () => err(createSurfaceError("config_invalid", "MMR config file is unreadable")),
    };
    const runner = createAuditRunner({
      knowledgeSource: knowledge,
      lensRegistry: [lensRegistration("usability", true, modelLens("usability"))],
      mmrFallback: mmr,
    });

    const result = await runner({
      capture,
      config: resolveSurfaceConfig({
        cli: {
          model: {
            egressPolicy: { mode: "text" },
            fallback: { mode: "mmr" },
          },
        },
      }),
      runId: "run_mmr_non_boundary_error",
    });

    expect(isOk(result)).toBe(false);
    expect(result).toMatchObject({ error: { code: "config_invalid" } });
  });
});

function lensRegistration(
  id: LensRegistration["id"],
  requiresModel: boolean,
  lens: Lens,
): LensRegistration {
  return {
    id,
    method: lens.method,
    presets: ["standard"],
    requiresLiveDom: false,
    requiresModel,
    create: () => lens,
  };
}

function measuredLens(id: string): Lens {
  return {
    id,
    method: "measured",
    requiresLiveDom: false,
    requiresModel: false,
    evaluate: () => ok([draft(id, "measured")]),
  };
}

function judgedLocalLens(id: string): Lens {
  return {
    id,
    method: "judged",
    requiresLiveDom: false,
    requiresModel: false,
    evaluate: () => ok([draft(id, "judged")]),
  };
}

function modelLens(id: string): Lens {
  return {
    id,
    method: "judged",
    requiresLiveDom: false,
    requiresModel: true,
    evaluate: async (context) => {
      if (context.model === undefined) {
        return err(createSurfaceError("model_unavailable", "model unavailable"));
      }

      const completion = await context.model.complete({
        prompt: { instructions: "Return JSON findings.", input: { lensId: id } },
        responseFormat: { type: "json" },
      });

      if (!isOk(completion)) {
        return err(completion.error);
      }

      return ok([draft(id, "judged")]);
    },
  };
}

function liveDomModelLens(id: string): Lens {
  return {
    ...modelLens(id),
    requiresLiveDom: true,
  };
}

function responseEchoLens(id: string): Lens {
  return {
    id,
    method: "judged",
    requiresLiveDom: false,
    requiresModel: true,
    evaluate: async (context) => {
      if (context.model === undefined) {
        return err(createSurfaceError("model_unavailable", "model unavailable"));
      }

      const completion = await context.model.complete({
        prompt: { instructions: "Return text.", input: { lensId: id } },
      });

      if (!isOk(completion)) {
        return err(completion.error);
      }

      return ok([
        {
          ...draft(id, "judged"),
          rationale: completion.value.text,
        },
      ]);
    },
  };
}

function responseEnvelopeEchoLens(id: string): Lens {
  return {
    ...responseEchoLens(id),
    evaluate: async (context) => {
      if (context.model === undefined) {
        return err(createSurfaceError("model_unavailable", "model unavailable"));
      }

      const completion = await context.model.complete({
        prompt: { instructions: "Return text.", input: { lensId: id } },
      });

      if (!isOk(completion)) {
        return err(completion.error);
      }

      return ok([
        {
          ...draft(id, "judged"),
          rationale: JSON.stringify(completion.value),
        },
      ]);
    },
  };
}

function leakingModelLens(
  id: string,
  seenArtifactTypes: string[][],
  input: {
    readonly artifactText: string;
    readonly secretKey?: string;
    readonly secretValue?: string;
  },
): Lens {
  return {
    id,
    method: "judged",
    requiresLiveDom: false,
    requiresModel: true,
    evaluate: async (context) => {
      if (context.model === undefined) {
        return err(createSurfaceError("model_unavailable", "model unavailable"));
      }

      seenArtifactTypes.push(context.capture.artifacts.map((artifact) => artifact.type));
      const completion = await context.model.complete({
        prompt: {
          instructions: "Return JSON findings.",
          input: {
            artifactText: input.artifactText,
            artifacts: context.capture.artifacts,
            ...(input.secretKey === undefined ? {} : { [input.secretKey]: "secret-key-value" }),
            ...(input.secretValue === undefined ? {} : { secretValue: input.secretValue }),
          },
        },
        responseFormat: { type: "json" },
      });

      if (!isOk(completion)) {
        return err(completion.error);
      }

      return ok([draft(id, "judged")]);
    },
  };
}

function draft(lens: string, method: "judged" | "measured"): FindingDraft {
  return {
    citedHeuristics: ["kb_test"],
    draftId: `f_${lens}`,
    evidence:
      method === "measured"
        ? [{ kind: "tool-result", measuredValue: "0", rule: "test-rule", tool: "axe" }]
        : [{ kind: "cited-heuristic", knowledgeEntryId: "kb_test" }],
    issueType: "test-issue",
    lens,
    location: { selector: "#target" },
    method,
    rationale: "Test rationale.",
    rawDimensions: {
      agentImplementability: 0.8,
      businessImpact: 0.5,
      confidence: 0.9,
      effort: 0.2,
      evidenceQuality: 0.9,
      severity: 0.7,
      userImpact: 0.7,
    },
    title: "Test finding",
  };
}

function modelProvider(id: "codex" | "gemini" | "openai") {
  let completeCalls = 0;
  const provider: ModelProvider = {
    id,
    availability: () =>
      ok({
        available: true,
        channelId: id,
        model: `${id}-model`,
        provider: id,
        sourceKind: id === "openai" ? "api" : "subscription-cli",
      }),
    complete: () => {
      completeCalls += 1;
      return ok({
        channelId: id,
        model: `${id}-model`,
        provider: id,
        sourceKind: id === "openai" ? "api" : "subscription-cli",
        text: "[]",
      });
    },
  };

  return {
    get completeCalls() {
      return completeCalls;
    },
    provider,
  };
}

function recordingProvider(id: "openai", requests: unknown[]): ModelProvider {
  return {
    id,
    availability: () =>
      ok({
        available: true,
        channelId: id,
        model: `${id}-model`,
        provider: id,
        sourceKind: "api",
      }),
    complete: (request) => {
      requests.push(request);
      return ok({
        channelId: id,
        model: `${id}-model`,
        provider: id,
        sourceKind: "api",
        text: "[]",
      });
    },
  };
}

function fakeMmr() {
  let availabilityCalls = 0;
  const fallback: MmrAuditFallback = {
    id: "mmr",
    availability: () => {
      availabilityCalls += 1;
      return ok({
        available: false,
        channelId: "mmr",
        message: "MMR unsupported",
        reason: "unsupported-capability",
        sourceKind: "mmr",
      });
    },
    run: () => err(createSurfaceError("model_unavailable", "MMR unsupported")),
  };

  return {
    get availabilityCalls() {
      return availabilityCalls;
    },
    ...fallback,
  };
}

function fakeAvailableMmr() {
  let availabilityCalls = 0;
  let runCalls = 0;
  const fallback: MmrAuditFallback = {
    id: "mmr",
    availability: () => {
      availabilityCalls += 1;
      return ok({
        available: true,
        channelId: "mmr",
        model: "mmr-review",
        provider: "mmr",
        sourceKind: "mmr",
      });
    },
    run: () => {
      runCalls += 1;
      return ok({
        channelId: "mmr",
        model: "mmr-review",
        provider: "mmr",
        sourceKind: "mmr",
        text: "[]",
      });
    },
  };

  return {
    get availabilityCalls() {
      return availabilityCalls;
    },
    get runCalls() {
      return runCalls;
    },
    ...fallback,
  };
}
