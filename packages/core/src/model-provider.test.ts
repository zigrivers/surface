import { describe, expect, it } from "vitest";

import { isErr, isOk, ok } from "./errors.js";
import {
  JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
  createConfiguredModelProvider,
  createUnavailableModelProvider,
  modelSkipForLens,
  resolveModelProviderConfig,
} from "./model-provider.js";

describe("model provider abstraction", () => {
  it("reports judged lens skips when no model is configured", async () => {
    const resolution = resolveModelProviderConfig({ env: {} });
    expect(resolution).toMatchObject({
      configured: false,
      availability: {
        available: false,
        message: JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
        reason: "no-model-configured",
      },
    });

    if (resolution.configured) {
      throw new Error("expected no model configuration");
    }

    const skip = modelSkipForLens(
      { id: "visual-hierarchy", requiresModel: true },
      resolution.availability,
    );
    const measuredSkip = modelSkipForLens(
      { id: "axe", requiresModel: false },
      resolution.availability,
    );
    const unavailableProvider = createUnavailableModelProvider(resolution.availability);
    const completion = await unavailableProvider.complete({
      prompt: {
        instructions: "Judge this UI.",
        input: { title: "Dashboard" },
      },
    });

    expect(skip).toEqual({
      lensId: "visual-hierarchy",
      reason: "model_unavailable",
      message: JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
    });
    expect(measuredSkip).toBeUndefined();
    expect(isErr(completion)).toBe(true);
    expect(completion).toMatchObject({
      error: {
        code: "model_unavailable",
        details: { reason: "no-model-configured" },
      },
    });
  });

  it("resolves BYO key providers without exposing secret values", async () => {
    const resolution = resolveModelProviderConfig({
      env: {
        OPENAI_API_KEY: "sk-test",
        SURFACE_MODEL: "quality-model",
      },
    });

    expect(resolution).toMatchObject({
      configured: true,
      config: {
        credentialRef: "env:OPENAI_API_KEY",
        model: "quality-model",
        provider: "openai",
      },
    });
    expect(JSON.stringify(resolution)).not.toContain("sk-test");

    if (!resolution.configured) {
      throw new Error("expected model configuration");
    }

    const provider = createConfiguredModelProvider(resolution.config, (request, config) =>
      ok({
        provider: config.provider,
        model: config.model,
        text: `accepted:${request.prompt.instructions}`,
      }),
    );
    const availability = await provider.availability();
    const completion = await provider.complete({
      prompt: {
        instructions: "Find visual hierarchy issues.",
        input: { route: "/" },
      },
      maxOutputTokens: 100,
    });

    expect(isOk(availability)).toBe(true);
    expect(availability).toMatchObject({
      value: { available: true, provider: "openai", model: "quality-model" },
    });
    expect(isOk(completion)).toBe(true);
    expect(completion).toMatchObject({
      value: {
        model: "quality-model",
        provider: "openai",
        text: "accepted:Find visual hierarchy issues.",
      },
    });
  });

  it("checks explicit provider credentials and local endpoints", () => {
    expect(
      resolveModelProviderConfig({
        env: {},
        provider: "anthropic",
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "missing-credential",
        message: "model provider anthropic requires ANTHROPIC_API_KEY or baseUrl",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: { SURFACE_MODEL_BASE_URL: "http://127.0.0.1:11434" },
      }),
    ).toMatchObject({
      configured: true,
      config: {
        baseUrl: "http://127.0.0.1:11434",
        provider: "local",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: { OPENAI_API_KEY: "sk-test" },
        provider: "openai",
        baseUrl: "https://gateway.example.test/v1",
      }),
    ).toMatchObject({
      configured: true,
      config: {
        baseUrl: "https://gateway.example.test/v1",
        credentialRef: "env:OPENAI_API_KEY",
        provider: "openai",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: {
          OPENAI_API_KEY: "sk-test",
          SURFACE_MODEL_BASE_URL: "https://gateway-env.example.test/v1",
        },
        provider: "openai",
      }),
    ).toMatchObject({
      configured: true,
      config: {
        baseUrl: "https://gateway-env.example.test/v1",
        credentialRef: "env:OPENAI_API_KEY",
        provider: "openai",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: {},
        provider: "openai",
        baseUrl: "https://sidecar.example.test/v1",
      }),
    ).toMatchObject({
      configured: true,
      config: {
        baseUrl: "https://sidecar.example.test/v1",
        provider: "openai",
      },
    });
  });

  it("returns unavailable resolutions for malformed provider configuration", () => {
    expect(() =>
      resolveModelProviderConfig({
        env: { SURFACE_MODEL_PROVIDER: "typo" },
      }),
    ).not.toThrow();
    expect(
      resolveModelProviderConfig({
        env: { SURFACE_MODEL_PROVIDER: "typo" },
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "invalid-provider",
        message: "unsupported model provider: typo",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: { OPENAI_API_KEY: "   " },
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "no-model-configured",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: {},
        provider: "openai",
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "missing-credential",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: {
          OPENAI_API_KEY: "sk-test",
          SURFACE_MODEL_PROVIDER: "   ",
        },
      }),
    ).toMatchObject({
      configured: true,
      config: {
        credentialRef: "env:OPENAI_API_KEY",
        provider: "openai",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: {},
        provider: "local",
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "missing-base-url",
        message: "local model provider requires baseUrl or SURFACE_MODEL_BASE_URL",
      },
    });

    expect(
      resolveModelProviderConfig({
        env: { SURFACE_MODEL: "   ", SURFACE_MODEL_BASE_URL: "http://127.0.0.1:11434" },
      }),
    ).toMatchObject({
      configured: false,
      availability: {
        reason: "invalid-config",
      },
    });
  });

  it("returns Result errors for invalid requests and thrown adapters", async () => {
    const provider = createConfiguredModelProvider(
      {
        credentialRef: "env:OPENAI_API_KEY",
        model: "quality-model",
        provider: "openai",
      },
      () => {
        throw new Error("provider offline");
      },
    );

    await expect(
      provider.complete({
        prompt: {
          instructions: "   ",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      error: {
        code: "invalid_model_request",
      },
    });
    await expect(
      provider.complete({
        prompt: {
          instructions: "Judge this UI.",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      error: {
        code: "model_request_failed",
      },
    });
  });

  it("validates configured provider inputs and adapter success responses", async () => {
    expect(() =>
      createConfiguredModelProvider(
        {
          model: "",
          provider: "openai",
        } as never,
        () => ok({ provider: "openai", model: "quality-model", text: "ok" }),
      ),
    ).toThrow();

    const invalidResponseProvider = createConfiguredModelProvider(
      {
        credentialRef: "env:OPENAI_API_KEY",
        model: "quality-model",
        provider: "openai",
      },
      () => ok({ provider: "openai", model: "", text: "" }),
    );

    await expect(
      invalidResponseProvider.complete({
        prompt: {
          instructions: "Judge this UI.",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      error: {
        code: "model_request_failed",
      },
    });

    const aliasedModelProvider = createConfiguredModelProvider(
      {
        credentialRef: "env:OPENAI_API_KEY",
        model: "quality-model",
        provider: "openai",
      },
      () => ok({ provider: "openai", model: "gpt-4o", text: "" }),
    );

    await expect(
      aliasedModelProvider.complete({
        prompt: {
          instructions: "Judge this UI.",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      value: {
        model: "gpt-4o",
        provider: "openai",
        text: "",
      },
    });

    const mismatchedResponseProvider = createConfiguredModelProvider(
      {
        credentialRef: "env:OPENAI_API_KEY",
        model: "quality-model",
        provider: "openai",
      },
      () => ok({ provider: "anthropic", model: "other-model", text: "ok" }),
    );

    await expect(
      mismatchedResponseProvider.complete({
        prompt: {
          instructions: "Judge this UI.",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      error: {
        code: "model_request_failed",
        details: {
          expected: { provider: "openai" },
          received: { provider: "anthropic" },
        },
      },
    });

    const proxyResponseProvider = createConfiguredModelProvider(
      {
        baseUrl: "https://sidecar.example.test/v1",
        model: "quality-model",
        provider: "openai",
      },
      () => ok({ provider: "anthropic", model: "claude-sonnet", text: "ok" }),
    );

    await expect(
      proxyResponseProvider.complete({
        prompt: {
          instructions: "Judge this UI.",
          input: {},
        },
      }),
    ).resolves.toMatchObject({
      value: {
        model: "claude-sonnet",
        provider: "anthropic",
        text: "ok",
      },
    });
  });
});
