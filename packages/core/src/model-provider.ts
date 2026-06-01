import { z } from "zod";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";

/**
 * Optional BYO-key model-provider boundary for judged lenses.
 *
 * Core resolves configuration and validates request/response contracts, but provider SDK calls
 * stay behind injected adapters so surface ships no credentials and no bundled inference.
 */

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

/** Built-in provider ids that core can resolve from environment configuration. */
const ModelProviderIdSchema = z.enum(["anthropic", "openai", "local"]);
export type ModelProviderId = z.infer<typeof ModelProviderIdSchema>;

/** Runtime-safe provider configuration; credentialRef names an env var and never stores secrets. */
export const ModelProviderConfigSchema = z
  .object({
    provider: ModelProviderIdSchema,
    model: nonEmptyStringSchema,
    credentialRef: nonEmptyStringSchema.optional(),
    baseUrl: nonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.provider === "local" && config.baseUrl === undefined) {
      context.addIssue({
        code: "custom",
        message: "local model providers require baseUrl",
        path: ["baseUrl"],
      });
    }

    if (
      config.provider !== "local" &&
      config.credentialRef === undefined &&
      config.baseUrl === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "remote model providers require credentialRef or baseUrl",
        path: ["credentialRef"],
      });
    }
  });
export type ModelProviderConfig = z.infer<typeof ModelProviderConfigSchema>;

/** Prompt/input boundary that judged lenses send to a model adapter. */
export const ModelPromptSchema = z
  .object({
    instructions: nonEmptyStringSchema,
    input: z.unknown(),
    system: nonEmptyStringSchema.optional(),
  })
  .strict();
export type ModelPrompt = z.infer<typeof ModelPromptSchema>;

/** Model completion request with bounded generation controls. */
export const ModelRequestSchema = z
  .object({
    prompt: ModelPromptSchema,
    maxOutputTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();
export type ModelRequest = z.infer<typeof ModelRequestSchema>;

/** Normalized text response returned by a provider adapter. */
export const ModelResponseSchema = z
  .object({
    provider: ModelProviderIdSchema,
    model: nonEmptyStringSchema,
    text: z.string(),
  })
  .passthrough();
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

/** Availability result used to skip judged lenses without failing measured coverage. */
export const ModelAvailabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(true),
      provider: ModelProviderIdSchema,
      model: nonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      available: z.literal(false),
      reason: z.enum([
        "no-model-configured",
        "missing-credential",
        "missing-base-url",
        "invalid-provider",
        "invalid-config",
      ]),
      message: nonEmptyStringSchema,
    })
    .strict(),
]);
export type ModelAvailability = z.infer<typeof ModelAvailabilitySchema>;
type UnavailableReason = Extract<ModelAvailability, { available: false }>["reason"];

/** Per-lens skip metadata reported when judged coverage is unavailable. */
export const ModelLensSkipSchema = z
  .object({
    lensId: nonEmptyStringSchema,
    reason: z.literal("model_unavailable"),
    message: nonEmptyStringSchema,
  })
  .strict();
export type ModelLensSkip = z.infer<typeof ModelLensSkipSchema>;

type MaybePromise<T> = T | Promise<T>;

/** Interface judged lenses call; implementations must return Result values instead of throwing. */
export interface ModelProvider {
  readonly id?: ModelProviderId;
  availability(): MaybePromise<Result<ModelAvailability, SurfaceError>>;
  complete(request: ModelRequest): MaybePromise<Result<ModelResponse, SurfaceError>>;
}

/** Inputs accepted by the resolver; env defaults to process.env when available. */
export type ModelProviderConfigInput = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly provider?: string;
  readonly model?: string;
  readonly baseUrl?: string;
};

/** Result of resolving BYO model configuration from explicit inputs and environment. */
export type ModelProviderResolution =
  | {
      readonly configured: true;
      readonly config: ModelProviderConfig;
    }
  | {
      readonly configured: false;
      readonly availability: ModelAvailability;
    };

/** Adapter implemented by SDK/CLI integrations behind the core provider boundary. */
export type ModelCompletionAdapter = (
  request: ModelRequest,
  config: ModelProviderConfig,
) => MaybePromise<Result<ModelResponse, SurfaceError>>;

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: "surface-byo-anthropic",
  openai: "surface-byo-openai",
  local: "surface-local-model",
} as const satisfies Record<ModelProviderId, string>;

const CREDENTIAL_ENV_BY_PROVIDER = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
} as const satisfies Record<Exclude<ModelProviderId, "local">, string>;

/** Canonical no-model degradation message for US-012 reporting. */
export const JUDGED_COVERAGE_UNAVAILABLE_MESSAGE =
  "judged coverage unavailable - no model configured";

/**
 * Resolve provider configuration from explicit input and env.
 *
 * Explicit provider wins; otherwise autodetection prefers Anthropic, then OpenAI, then local
 * endpoints. Invalid or incomplete runtime input returns configured:false instead of throwing.
 */
export function resolveModelProviderConfig(
  input: ModelProviderConfigInput = {},
): ModelProviderResolution {
  const env = input.env ?? defaultEnv();
  const selectedProvider = selectProvider(input, env);

  if (!selectedProvider.ok) {
    return { configured: false, availability: selectedProvider.availability };
  }

  const provider = selectedProvider.provider;

  if (provider === undefined) {
    return {
      configured: false,
      availability: unavailable("no-model-configured", JUDGED_COVERAGE_UNAVAILABLE_MESSAGE),
    };
  }

  if (provider === "local") {
    const baseUrl = modelBaseUrl(input, env);

    if (!hasText(baseUrl)) {
      return {
        configured: false,
        availability: unavailable(
          "missing-base-url",
          "local model provider requires baseUrl or SURFACE_MODEL_BASE_URL",
        ),
      };
    }

    return configured({
      provider,
      model: modelForProvider(provider, input, env),
      baseUrl,
    });
  }

  const credentialEnv = CREDENTIAL_ENV_BY_PROVIDER[provider];
  const baseUrl = modelBaseUrl(input, env);

  if (!hasText(env[credentialEnv]) && !hasText(baseUrl)) {
    return {
      configured: false,
      availability: unavailable(
        "missing-credential",
        `model provider ${provider} requires ${credentialEnv} or baseUrl`,
      ),
    };
  }

  return configured({
    provider,
    model: modelForProvider(provider, input, env),
    ...(hasText(env[credentialEnv]) ? { credentialRef: `env:${credentialEnv}` } : {}),
    ...(hasText(baseUrl) ? { baseUrl } : {}),
  });
}

/**
 * Create a configured provider from validated config and an injected adapter.
 *
 * Invalid requests and invalid success responses from adapters are mapped to ModelError Results;
 * adapter-provided errors are returned as-is.
 */
export function createConfiguredModelProvider(
  config: ModelProviderConfig,
  complete: ModelCompletionAdapter,
): ModelProvider {
  const parsedConfig = ModelProviderConfigSchema.parse(config);

  return {
    id: parsedConfig.provider,
    availability: () =>
      ok({
        available: true,
        provider: parsedConfig.provider,
        model: parsedConfig.model,
      }),
    complete: async (request) => {
      const parsedRequest = ModelRequestSchema.safeParse(request);

      if (!parsedRequest.success) {
        return err(
          createSurfaceError("invalid_model_request", "Model request is invalid.", {
            cause: parsedRequest.error,
          }),
        );
      }

      try {
        const adapterResult = await complete(parsedRequest.data, parsedConfig);

        if (!isOk(adapterResult)) {
          return adapterResult;
        }

        const parsedResponse = ModelResponseSchema.safeParse(adapterResult.value);

        if (!parsedResponse.success) {
          return err(
            createSurfaceError("model_request_failed", "Model adapter returned invalid response.", {
              cause: parsedResponse.error,
            }),
          );
        }

        if (
          parsedResponse.data.provider !== parsedConfig.provider &&
          parsedConfig.baseUrl === undefined
        ) {
          return err(
            createSurfaceError(
              "model_request_failed",
              "Model adapter returned mismatched provider.",
              {
                details: {
                  expected: { provider: parsedConfig.provider },
                  received: { provider: parsedResponse.data.provider },
                },
              },
            ),
          );
        }

        return ok(parsedResponse.data);
      } catch (error) {
        return err(
          createSurfaceError("model_request_failed", "Model request failed.", { cause: error }),
        );
      }
    },
  };
}

/**
 * Create a provider that reports unavailable and returns model_unavailable for completion calls.
 */
export function createUnavailableModelProvider(
  availability: ModelAvailability = unavailable(
    "no-model-configured",
    JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
  ),
): ModelProvider {
  const parsedAvailability = ModelAvailabilitySchema.parse(availability);

  if (parsedAvailability.available) {
    throw new TypeError("createUnavailableModelProvider requires unavailable availability");
  }

  return {
    availability: () => ok(parsedAvailability),
    complete: () =>
      err(
        createSurfaceError("model_unavailable", parsedAvailability.message, {
          details: { reason: parsedAvailability.reason },
        }),
      ),
  };
}

/** Return skip metadata for model-required lenses when availability is false. */
export function modelSkipForLens(
  lens: { readonly id: string; readonly requiresModel: boolean },
  availability: ModelAvailability,
): ModelLensSkip | undefined {
  const parsedAvailability = ModelAvailabilitySchema.parse(availability);

  if (!lens.requiresModel || parsedAvailability.available) {
    return undefined;
  }

  return ModelLensSkipSchema.parse({
    lensId: lens.id,
    reason: "model_unavailable",
    message: parsedAvailability.message,
  });
}

type ProviderSelection =
  | { readonly ok: true; readonly provider?: ModelProviderId }
  | { readonly ok: false; readonly availability: ModelAvailability };

function selectProvider(
  input: ModelProviderConfigInput,
  env: Readonly<Record<string, string | undefined>>,
): ProviderSelection {
  const requestedProvider = input.provider ?? env.SURFACE_MODEL_PROVIDER;

  if (hasText(requestedProvider)) {
    const parsedProvider = ModelProviderIdSchema.safeParse(requestedProvider);

    if (!parsedProvider.success) {
      return {
        ok: false,
        availability: unavailable(
          "invalid-provider",
          `unsupported model provider: ${requestedProvider}`,
        ),
      };
    }

    return { ok: true, provider: parsedProvider.data };
  }

  if (hasText(env.ANTHROPIC_API_KEY)) {
    return { ok: true, provider: "anthropic" };
  }

  if (hasText(env.OPENAI_API_KEY)) {
    return { ok: true, provider: "openai" };
  }

  if (hasText(env.SURFACE_MODEL_BASE_URL)) {
    return { ok: true, provider: "local" };
  }

  return { ok: true };
}

function defaultEnv(): Readonly<Record<string, string | undefined>> {
  return typeof process !== "undefined" && process.env !== undefined ? process.env : {};
}

function configured(value: unknown): ModelProviderResolution {
  const parsedConfig = ModelProviderConfigSchema.safeParse(value);

  if (!parsedConfig.success) {
    return {
      configured: false,
      availability: unavailable("invalid-config", "model provider configuration is invalid"),
    };
  }

  return { configured: true, config: parsedConfig.data };
}

function modelForProvider(
  provider: ModelProviderId,
  input: ModelProviderConfigInput,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return input.model ?? env.SURFACE_MODEL ?? DEFAULT_MODEL_BY_PROVIDER[provider];
}

function modelBaseUrl(
  input: ModelProviderConfigInput,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return hasText(input.baseUrl) ? input.baseUrl : env.SURFACE_MODEL_BASE_URL;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unavailable(reason: UnavailableReason, message: string): ModelAvailability {
  return ModelAvailabilitySchema.parse({
    available: false,
    reason,
    message,
  });
}
