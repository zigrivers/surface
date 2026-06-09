import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  DirectSubscriptionChannelIdSchema,
  type DirectSubscriptionChannelPolicyBlock,
  type SurfaceConfig,
} from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { scoreFinding, type Evidence, type Finding, type FindingDraft } from "./findings.js";
import type {
  ArtifactWriter,
  Capture,
  CaptureArtifact,
  KnowledgeSource,
  Lens,
  ModelProvider,
  Target,
} from "./interfaces.js";
import {
  instantiateLensExecutionPlan,
  selectLensExecutionPlan,
  type LensExecutionSkip,
  type LensFactoryOptions,
  type LensRegistration,
} from "./lens-registry.js";
import {
  createModelEgressLedgerEntry,
  evaluateModelArtifactEgress,
  isModelChannelPermitted,
  maskModelArtifactText,
  maskModelPlainText,
  type ModelEgressBlockedReason,
  type ModelArtifactEgressDecision,
  type ModelEgressLedgerEntry,
} from "./model-egress.js";
import {
  ModelAvailabilitySchema,
  ModelUnavailableReasonSchema,
  type ModelAvailability,
  type ModelRequest,
  type ModelResponse,
  type ModelSourceKind,
} from "./model-provider.js";
import type { MmrAuditFallback } from "./mmr-audit-fallback.js";
import {
  createReconciliationService,
  type ReconciliationChannel,
  type ReconciliationQuestion,
  type ReconciliationService,
} from "./reconciliation.js";
import type { ResolveDirectProvidersResult } from "./subscription-cli-provider.js";

// The audit runner resolves model providers lazily after local lenses run and
// only when effective policy grants consent. It passes a model-scoped capture
// containing masked text artifacts plus screenshot metadata; raw screenshots and
// raw provider output stay outside prompts and are represented only in ledgers.

type MaybePromise<T> = T | Promise<T>;

export type ModelProviderFactory = () => MaybePromise<ModelProvider | undefined>;
export type ResolveSubscriptionProviders = (
  config: SurfaceConfig,
) => MaybePromise<ResolveDirectProvidersResult>;

export type AuditRunnerDependencies = {
  readonly artifactWriter?: ArtifactWriter;
  readonly knowledgeSource: KnowledgeSource;
  readonly lensFactoryOptions?: LensFactoryOptions;
  readonly lensRegistry: readonly LensRegistration[];
  readonly mmrFallback?: MmrAuditFallback;
  readonly modelProvider?: ModelProvider;
  readonly modelProviderFactory?: ModelProviderFactory;
  readonly reconciliation?: ReconciliationService;
  readonly resolveSubscriptionProviders?: ResolveSubscriptionProviders;
  readonly subscriptionProviders?: readonly ModelProvider[];
};

export type AuditRunnerInput = {
  readonly capture: Capture;
  readonly config: SurfaceConfig;
  readonly discoveryUnavailableChannels?: readonly Extract<
    ModelAvailability,
    { available: false }
  >[];
  readonly evidence?: readonly Evidence[];
  readonly lensId?: string;
  readonly mmrFallback?: MmrAuditFallback;
  readonly modelProvider?: ModelProvider;
  readonly modelProviderFactory?: ModelProviderFactory;
  readonly resolveSubscriptionProviders?: ResolveSubscriptionProviders;
  readonly runId: string;
  readonly subscriptionProviders?: readonly ModelProvider[];
};

export type AuditRunnerUnavailableChannel = {
  readonly id: string;
  readonly reason: string;
  readonly message: string;
};

export type AuditRunnerResult = {
  readonly blockedReasons: readonly ModelEgressBlockedReason[];
  readonly evaluatedLenses: readonly string[];
  readonly findings: readonly Finding[];
  readonly modelEgress: readonly ModelEgressLedgerEntry[];
  readonly reconciliationQuestions?: readonly ReconciliationQuestion[];
  readonly skippedLenses: readonly LensExecutionSkip[];
  readonly unavailableChannels: readonly AuditRunnerUnavailableChannel[];
};

export type AuditRunner = (
  input: AuditRunnerInput,
) => MaybePromise<Result<AuditRunnerResult, SurfaceError>>;

export type ModelExecutionPlan = {
  readonly egressEnabled: boolean;
  readonly useDirectSubscriptions: boolean;
  readonly useMmr: boolean;
};

const AVAILABLE_MODEL_PLACEHOLDER = {
  available: true,
  channelId: "local",
  model: "surface-audit-placeholder",
  provider: "local",
  sourceKind: "local",
} as const satisfies ModelAvailability;
const MAX_MODEL_PROMPT_SANITIZE_DEPTH = 32;

export function createAuditRunner(dependencies: AuditRunnerDependencies): AuditRunner {
  return async (input) => {
    const registry =
      input.lensId === undefined
        ? dependencies.lensRegistry
        : dependencies.lensRegistry.filter((registration) => registration.id === input.lensId);
    const plan = selectLensExecutionPlan({
      capture: input.capture,
      config: input.config,
      modelAvailability: AVAILABLE_MODEL_PLACEHOLDER,
      registry,
    });
    const instantiated = instantiateLensExecutionPlan(plan, dependencies.lensFactoryOptions ?? {});
    const executionSkipped = unimplementedLensSkips(plan.selected);
    const localFindings = await runLocalLenses(instantiated, dependencies, input);

    if (!isOk(localFindings)) {
      return err(localFindings.error);
    }

    const modelLenses = instantiated.filter((entry) => entry.registration.requiresModel);

    if (modelLenses.length === 0) {
      return ok({
        blockedReasons: [],
        evaluatedLenses: localEvaluatedLensIds(instantiated),
        findings: localFindings.value,
        modelEgress: [],
        reconciliationQuestions: [],
        skippedLenses: [...plan.skipped, ...executionSkipped],
        unavailableChannels: [],
      });
    }

    const modelContext = await resolveModelContext(dependencies, input);

    if (!isOk(modelContext)) {
      return err(modelContext.error);
    }

    const artifactDecision = evaluateModelArtifactEgress(
      input.capture,
      input.config.model.effectiveEgressPolicy,
    );
    const modelFindings = await runModelLenses(
      modelLenses,
      dependencies,
      input,
      modelContext.value,
      artifactDecision,
    );

    if (!isOk(modelFindings)) {
      return err(modelFindings.error);
    }

    const unavailableChannels = [
      ...modelContext.value.unavailableChannels,
      ...modelFindings.value.unavailableChannels,
    ];
    const blockedReasons = uniqueBlockedReasons([
      ...modelContext.value.blockedReasons,
      ...artifactDecision.blockedReasons,
      ...modelFindings.value.blockedReasons,
    ]);
    const ledger = modelLedgerFor(
      input,
      modelContext.value,
      artifactDecision,
      modelFindings.value.attemptedChannels,
      modelFindings.value.completedChannels,
      unavailableChannels,
      blockedReasons,
    );

    return ok({
      blockedReasons,
      evaluatedLenses: [
        ...new Set([
          ...localEvaluatedLensIds(instantiated),
          ...modelFindings.value.evaluatedLenses,
        ]),
      ],
      findings: [...localFindings.value, ...modelFindings.value.findings],
      modelEgress: ledger === undefined ? [] : [ledger],
      reconciliationQuestions: modelFindings.value.reconciliationQuestions,
      skippedLenses: [...plan.skipped, ...executionSkipped, ...modelFindings.value.skippedLenses],
      unavailableChannels,
    });
  };
}

export function resolveModelExecutionPlan(
  config: SurfaceConfig,
  input: {
    readonly hasMmrFallback: boolean;
    readonly primaryProviderConfigured: boolean;
  },
): ModelExecutionPlan {
  const egressEnabled = config.model.effectiveEgressPolicy.mode !== "off";
  const directFallbackEnabled =
    config.model.fallback.mode === "direct" || config.model.fallback.mode === "auto";
  const mmrFallbackEnabled =
    config.model.fallback.mode === "mmr" ||
    (config.model.fallback.mode === "auto" && config.model.fallback.fallbackToMmr);

  return {
    egressEnabled,
    useDirectSubscriptions:
      !input.primaryProviderConfigured &&
      egressEnabled &&
      directFallbackEnabled &&
      config.model.fallback.effectiveChannels.length > 0,
    useMmr:
      !input.primaryProviderConfigured &&
      input.hasMmrFallback &&
      egressEnabled &&
      mmrFallbackEnabled,
  };
}

function shouldReportPolicyBlockedDirectChannels(
  config: SurfaceConfig,
  executionPlan: ModelExecutionPlan,
  primaryProviderConfigured: boolean,
): boolean {
  return (
    !primaryProviderConfigured &&
    executionPlan.egressEnabled &&
    (config.model.fallback.mode === "direct" || config.model.fallback.mode === "auto") &&
    config.model.fallback.policyBlockedChannels.length > 0
  );
}

function unimplementedLensSkips(
  selected: readonly LensRegistration[],
): readonly LensExecutionSkip[] {
  return selected
    .filter((registration) => registration.create === undefined)
    .map((registration) => ({
      lensId: registration.id,
      reason: "not_implemented",
      message: "Lens is registered but does not have an executable implementation.",
    }));
}

function localEvaluatedLensIds(
  instantiated: readonly { readonly lens: Lens; readonly registration: LensRegistration }[],
): string[] {
  return instantiated
    .filter((entry) => !entry.registration.requiresModel)
    .map((entry) => entry.registration.id);
}

async function runLocalLenses(
  instantiated: readonly { readonly lens: Lens; readonly registration: LensRegistration }[],
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
): Promise<Result<Finding[], SurfaceError>> {
  const findings: Finding[] = [];

  for (const entry of instantiated) {
    if (entry.registration.requiresModel) {
      continue;
    }

    const result = await entry.lens.evaluate({
      capture: input.capture,
      config: input.config,
      evidence: [...(input.evidence ?? [])],
      knowledge: dependencies.knowledgeSource,
    });

    if (!isOk(result)) {
      return err(result.error);
    }

    const scored = scoreDrafts(result.value, input.config);

    if (!isOk(scored)) {
      return err(scored.error);
    }

    findings.push(...scored.value);
  }

  return ok(findings);
}

type ModelContext = {
  readonly blockedReasons: readonly ModelEgressBlockedReason[];
  readonly mmrFallback?: MmrAuditFallback;
  readonly primaryProviderConfigured: boolean;
  readonly providers: readonly ModelProvider[];
  readonly unavailableChannels: readonly AuditRunnerUnavailableChannel[];
};
type ModelLensEntry = { readonly lens: Lens; readonly registration: LensRegistration };
type ResolveModelCapture = (entry: ModelLensEntry) => Promise<Result<Capture, SurfaceError>>;

async function resolveModelContext(
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
): Promise<Result<ModelContext, SurfaceError>> {
  const blockedReasons: ModelEgressBlockedReason[] = [];
  const unavailableChannels: AuditRunnerUnavailableChannel[] = [];
  const providers: ModelProvider[] = [];

  if (input.config.model.effectiveEgressPolicy.mode === "off") {
    return ok({
      blockedReasons: ["model_egress_blocked_by_policy"],
      primaryProviderConfigured: false,
      providers,
      unavailableChannels,
    });
  }

  const primaryProvider = await resolvePrimaryProvider(dependencies, input);
  const primaryProviderConfigured = primaryProvider !== undefined;
  const mmr = input.mmrFallback ?? dependencies.mmrFallback;
  const executionPlan = resolveModelExecutionPlan(input.config, {
    hasMmrFallback: mmr !== undefined,
    primaryProviderConfigured,
  });

  if (
    shouldReportPolicyBlockedDirectChannels(input.config, executionPlan, primaryProviderConfigured)
  ) {
    const policyBlockedChannels = unavailableFromPolicyBlockedDirectChannels(
      input.config.model.fallback.policyBlockedChannels,
    );
    blockedReasons.push(
      ...input.config.model.fallback.policyBlockedChannels.map((channel) => channel.reason),
    );
    unavailableChannels.push(...policyBlockedChannels);
  }

  if (primaryProvider !== undefined) {
    const permitted = await permittedProvider(primaryProvider, input.config, blockedReasons);

    if (permitted.provider !== undefined) {
      providers.push(permitted.provider);
    }

    unavailableChannels.push(...permitted.unavailableChannels);
  }

  const subscriptionResolution = primaryProviderConfigured
    ? { discoveryUnavailableChannels: [], subscriptionProviders: [] }
    : await resolveSubscriptionFallback(dependencies, input, executionPlan.useDirectSubscriptions);
  unavailableChannels.push(
    ...unavailableFromAvailabilityRecords([
      ...(input.discoveryUnavailableChannels ?? []),
      ...subscriptionResolution.discoveryUnavailableChannels,
    ]),
  );

  for (const provider of subscriptionResolution.subscriptionProviders) {
    const permitted = await permittedProvider(provider, input.config, blockedReasons, {
      directChannels: input.config.model.fallback.effectiveChannels,
    });

    if (permitted.provider !== undefined) {
      providers.push(permitted.provider);
    }

    unavailableChannels.push(...permitted.unavailableChannels);
  }

  if (executionPlan.useMmr && mmr !== undefined) {
    const permission = isModelChannelPermitted(input.config.model.effectiveEgressPolicy, {
      channelId: "mmr",
      sourceKind: "mmr",
    });

    if (permission.permitted) {
      return ok({
        blockedReasons: uniqueBlockedReasons(blockedReasons),
        mmrFallback: mmr,
        primaryProviderConfigured,
        providers,
        unavailableChannels,
      });
    } else {
      blockedReasons.push(permission.reason);
    }
  }

  return ok({
    blockedReasons: uniqueBlockedReasons(blockedReasons),
    primaryProviderConfigured,
    providers,
    unavailableChannels,
  });
}

async function resolvePrimaryProvider(
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
): Promise<ModelProvider | undefined> {
  if (input.modelProvider !== undefined) {
    return input.modelProvider;
  }

  if (dependencies.modelProvider !== undefined) {
    return dependencies.modelProvider;
  }

  const factory = input.modelProviderFactory ?? dependencies.modelProviderFactory;
  return factory === undefined ? undefined : await factory();
}

async function resolveSubscriptionFallback(
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
  shouldResolve: boolean,
): Promise<ResolveDirectProvidersResult> {
  if (!shouldResolve) {
    return {
      discoveryUnavailableChannels: [],
      subscriptionProviders: [],
    };
  }

  const suppliedProviders = input.subscriptionProviders ?? dependencies.subscriptionProviders;

  if (suppliedProviders !== undefined) {
    return {
      discoveryUnavailableChannels: [],
      subscriptionProviders: filterSubscriptionProviders(suppliedProviders, input.config),
    };
  }

  const resolver = input.resolveSubscriptionProviders ?? dependencies.resolveSubscriptionProviders;

  if (resolver === undefined) {
    return {
      discoveryUnavailableChannels: [],
      subscriptionProviders: [],
    };
  }

  const resolved = await resolver(input.config);

  return {
    discoveryUnavailableChannels: resolved.discoveryUnavailableChannels,
    subscriptionProviders: filterSubscriptionProviders(
      resolved.subscriptionProviders,
      input.config,
    ),
  };
}

function unavailableFromPolicyBlockedDirectChannels(
  channels: readonly DirectSubscriptionChannelPolicyBlock[],
): AuditRunnerUnavailableChannel[] {
  return channels.map((channel) => ({
    id: channel.channelId,
    reason: channel.reason,
    message:
      channel.reason === "channel_denied_by_policy"
        ? `model channel ${channel.channelId} is denied by effective policy`
        : `model channel ${channel.channelId} is not allowed by effective policy`,
  }));
}

function filterSubscriptionProviders(
  providers: readonly ModelProvider[],
  config: SurfaceConfig,
): ModelProvider[] {
  const providersByChannel = new Map<string, ModelProvider[]>();
  const providersWithoutIds: ModelProvider[] = [];

  for (const provider of providers) {
    if (provider.id === undefined) {
      providersWithoutIds.push(provider);
      continue;
    }

    const parsedId = DirectSubscriptionChannelIdSchema.safeParse(provider.id);

    if (
      parsedId?.success !== true ||
      !config.model.fallback.effectiveChannels.includes(parsedId.data)
    ) {
      continue;
    }

    providersByChannel.set(parsedId.data, [
      ...(providersByChannel.get(parsedId.data) ?? []),
      provider,
    ]);
  }

  return [
    ...config.model.fallback.effectiveChannels.flatMap(
      (channelId) => providersByChannel.get(channelId) ?? [],
    ),
    ...providersWithoutIds,
  ];
}

type PermittedProviderResult = {
  readonly provider?: ModelProvider;
  readonly unavailableChannels: readonly AuditRunnerUnavailableChannel[];
};

async function permittedProvider(
  provider: ModelProvider,
  config: SurfaceConfig,
  blockedReasons: ModelEgressBlockedReason[],
  options: { readonly directChannels?: readonly string[] } = {},
): Promise<PermittedProviderResult> {
  const availabilityResult = await provider.availability();

  if (!isOk(availabilityResult)) {
    return {
      unavailableChannels: [
        unavailableFromError(provider.id ?? "unknown", availabilityResult.error),
      ],
    };
  }

  const parsedAvailability = ModelAvailabilitySchema.safeParse(availabilityResult.value);

  if (!parsedAvailability.success) {
    blockedReasons.push("channel_metadata_missing");
    return {
      unavailableChannels: [
        {
          id: provider.id ?? "unknown",
          reason: "channel_metadata_missing",
          message: "model provider is missing canonical channel metadata",
        },
      ],
    };
  }

  if (!parsedAvailability.data.available) {
    return {
      unavailableChannels: [unavailableFromAvailability(provider.id, parsedAvailability.data)],
    };
  }

  if (
    options.directChannels !== undefined &&
    !options.directChannels.includes(parsedAvailability.data.channelId)
  ) {
    return {
      unavailableChannels: [
        {
          id: parsedAvailability.data.channelId,
          reason: "channel_not_allowed_by_policy",
          message: `model channel ${parsedAvailability.data.channelId} is not enabled for direct fallback`,
        },
      ],
    };
  }

  const permission = isModelChannelPermitted(config.model.effectiveEgressPolicy, {
    channelId: parsedAvailability.data.channelId,
    sourceKind: parsedAvailability.data.sourceKind,
  });

  if (!permission.permitted) {
    blockedReasons.push(permission.reason);
    return {
      unavailableChannels: [
        {
          id: parsedAvailability.data.channelId,
          reason: permission.reason,
          message: permission.message,
        },
      ],
    };
  }

  return {
    provider: {
      ...provider,
      id: parsedAvailability.data.channelId,
      availability: () => ok(parsedAvailability.data),
    },
    unavailableChannels: [],
  };
}

async function runModelLenses(
  modelLenses: readonly ModelLensEntry[],
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
  modelContext: ModelContext,
  artifactDecision: ModelArtifactEgressDecision,
): Promise<
  Result<
    {
      readonly attemptedChannels: readonly string[];
      readonly blockedReasons: readonly ModelEgressBlockedReason[];
      readonly completedChannels: readonly string[];
      readonly evaluatedLenses: readonly string[];
      readonly findings: Finding[];
      readonly reconciliationQuestions: readonly ReconciliationQuestion[];
      readonly skippedLenses: LensExecutionSkip[];
      readonly unavailableChannels: readonly AuditRunnerUnavailableChannel[];
    },
    SurfaceError
  >
> {
  if (modelContext.providers.length === 0 && modelContext.mmrFallback === undefined) {
    return ok({
      attemptedChannels: [],
      blockedReasons: [],
      completedChannels: [],
      evaluatedLenses: [],
      findings: [],
      reconciliationQuestions: [],
      skippedLenses: modelLenses.map((entry) => ({
        lensId: entry.registration.id,
        message: modelUnavailableMessage(modelContext),
        reason: "model_unavailable",
      })),
      unavailableChannels: [],
    });
  }

  const completedChannels: string[] = [];
  const attemptedChannels: string[] = [];
  const blockedReasons: ModelEgressBlockedReason[] = [];
  const evaluatedLenses: string[] = [];
  const findings: Finding[] = [];
  const reconciliationQuestions: ReconciliationQuestion[] = [];
  const skippedLenses: LensExecutionSkip[] = [];
  const unavailableChannels: AuditRunnerUnavailableChannel[] = [];
  const resolveModelCapture = createModelCaptureResolver(
    input.capture,
    artifactDecision,
    dependencies,
    input.runId,
  );

  for (const entry of modelLenses) {
    const channelFindings: ReconciliationChannel[] = [];
    let directSuccesses = 0;
    let lensCompleted = false;
    let lensAttempted = false;
    const lensUnavailableMessages: string[] = [];
    const lensUnavailableChannels: AuditRunnerUnavailableChannel[] = [];

    for (const provider of modelContext.providers) {
      const modelCapture = await resolveModelCapture(entry);

      if (!isOk(modelCapture)) {
        return err(modelCapture.error);
      }

      const result = await entry.lens.evaluate({
        capture: modelCapture.value,
        config: input.config,
        evidence: [...(input.evidence ?? [])],
        knowledge: dependencies.knowledgeSource,
        model: providerForModelEgress(provider),
      });
      const channelId = provider.id ?? "unknown";
      attemptedChannels.push(channelId);
      lensAttempted = true;

      if (!isOk(result)) {
        if (isModelBoundaryError(result.error)) {
          const unavailableChannel = unavailableFromError(channelId, result.error);
          if (modelContext.primaryProviderConfigured) {
            blockedReasons.push("primary_provider_failed_no_fallback");
          }
          lensUnavailableMessages.push(unavailableChannel.message);
          lensUnavailableChannels.push(unavailableChannel);
          unavailableChannels.push(unavailableChannel);
          continue;
        }

        return err(result.error);
      }

      const scored = scoreDrafts(result.value, input.config);

      if (!isOk(scored)) {
        return err(scored.error);
      }

      completedChannels.push(channelId);
      directSuccesses += 1;
      lensCompleted = true;

      if (input.config.model.fallback.depth >= 4) {
        channelFindings.push({
          id: channelId,
          status: "available",
          findings: scored.value,
        });
      } else {
        findings.push(...scored.value);
        break;
      }
    }

    if (directSuccesses === 0 && modelContext.mmrFallback !== undefined) {
      const mmrResult = await runMmrModelLens(
        entry,
        dependencies,
        input,
        resolveModelCapture,
        modelContext.mmrFallback,
      );
      lensAttempted = true;

      if (mmrResult.status === "unavailable") {
        lensUnavailableMessages.push(mmrResult.channel.message);
        lensUnavailableChannels.push(mmrResult.channel);
        unavailableChannels.push(mmrResult.channel);
      } else {
        attemptedChannels.push("mmr");

        if (isOk(mmrResult.result)) {
          const scored = scoreDrafts(mmrResult.result.value, input.config);

          if (!isOk(scored)) {
            return err(scored.error);
          }

          completedChannels.push("mmr");
          lensCompleted = true;

          if (input.config.model.fallback.depth >= 4) {
            channelFindings.push({
              id: "mmr",
              status: "available",
              findings: scored.value,
            });
          } else {
            findings.push(...scored.value);
          }
        } else {
          if (!isModelBoundaryError(mmrResult.result.error)) {
            return err(mmrResult.result.error);
          }

          const unavailableChannel = unavailableFromError("mmr", mmrResult.result.error);
          lensUnavailableMessages.push(unavailableChannel.message);
          lensUnavailableChannels.push(unavailableChannel);
          unavailableChannels.push(unavailableChannel);
        }
      }
    }

    if (input.config.model.fallback.depth >= 4 && channelFindings.length > 0) {
      const reconciliation = (
        dependencies.reconciliation ?? createReconciliationService()
      ).reconcile({
        channels: [
          ...channelFindings,
          ...lensUnavailableChannels.map(reconciliationUnavailableFromDetailed),
        ],
      });

      if (isOk(reconciliation)) {
        findings.push(...reconciliation.value.findings.map((entry) => entry.finding));
        reconciliationQuestions.push(...reconciliation.value.questions);
      } else {
        return err(reconciliation.error);
      }
    }

    if (lensCompleted) {
      evaluatedLenses.push(entry.registration.id);
    }

    if (!lensCompleted) {
      skippedLenses.push({
        lensId: entry.registration.id,
        message:
          lensUnavailableMessages[0] ??
          (lensAttempted
            ? "Judged model coverage unavailable; all attempted model channels failed."
            : "Judged model coverage unavailable; no permitted model channel was configured."),
        reason: "model_unavailable",
      });
    }
  }

  return ok({
    attemptedChannels,
    blockedReasons: uniqueBlockedReasons(blockedReasons),
    completedChannels,
    evaluatedLenses: [...new Set(evaluatedLenses)],
    findings,
    reconciliationQuestions,
    skippedLenses,
    unavailableChannels,
  });
}

function isModelBoundaryError(error: SurfaceError): boolean {
  return (
    error.kind === "ModelError" ||
    error.code === "model_unavailable" ||
    error.code === "model_request_failed"
  );
}

async function runMmrModelLens(
  entry: ModelLensEntry,
  dependencies: AuditRunnerDependencies,
  input: AuditRunnerInput,
  resolveModelCapture: ResolveModelCapture,
  mmr: MmrAuditFallback,
): Promise<
  | { readonly status: "available"; readonly result: Result<readonly FindingDraft[], SurfaceError> }
  | { readonly status: "unavailable"; readonly channel: AuditRunnerUnavailableChannel }
> {
  const availability = await mmr.availability();

  if (!isOk(availability)) {
    return {
      status: "unavailable",
      channel: unavailableFromError("mmr", availability.error),
    };
  }

  if (!availability.value.available) {
    return {
      status: "unavailable",
      channel: unavailableFromAvailability("mmr", availability.value),
    };
  }

  const capture = await resolveModelCapture(entry);

  if (!isOk(capture)) {
    return {
      status: "available",
      result: err(capture.error),
    };
  }

  return {
    status: "available",
    result: await entry.lens.evaluate({
      capture: capture.value,
      config: input.config,
      evidence: [...(input.evidence ?? [])],
      knowledge: dependencies.knowledgeSource,
      model: providerForModelEgress({
        id: "mmr",
        availability: () => ok(availability.value),
        complete: (request) =>
          mmr.run({
            capture: sanitizeMmrCapture(capture.value),
            request,
          }),
      }),
    }),
  };
}

function scoreDrafts(
  drafts: readonly FindingDraft[],
  config: SurfaceConfig,
): Result<Finding[], SurfaceError> {
  const findings: Finding[] = [];

  for (const draft of drafts) {
    const scored = scoreFinding(draft, config.findings);

    if (!isOk(scored)) {
      return err(scored.error);
    }

    findings.push(scored.value);
  }

  return ok(findings);
}

function modelLedgerFor(
  input: AuditRunnerInput,
  context: ModelContext,
  artifactDecision: ModelArtifactEgressDecision,
  attemptedChannelIds: readonly string[],
  completedChannels: readonly string[],
  unavailableChannels: readonly AuditRunnerUnavailableChannel[],
  blockedReasons: readonly ModelEgressBlockedReason[],
): ModelEgressLedgerEntry | undefined {
  if (
    attemptedChannelIds.length === 0 &&
    unavailableChannels.length === 0 &&
    blockedReasons.length === 0
  ) {
    return undefined;
  }

  const ledgerUnavailableChannels = unavailableChannels.flatMap((channel) => {
    const reason = reasonForLedger(channel.reason);

    if (reason === undefined) {
      return [];
    }

    return [
      {
        message: channel.message,
        reason,
        ...(isModelChannelId(channel.id) ? { channelId: channel.id } : {}),
      },
    ];
  });
  const unavailableChannelIds = unavailableChannels
    .map((channel) => channel.id)
    .filter(isModelChannelId);
  const attemptedChannels = [
    ...attemptedChannelIds,
    ...unavailableChannelIds,
    ...ledgerUnavailableChannels.flatMap((channel) =>
      channel.channelId === undefined ? [] : [channel.channelId],
    ),
  ].filter(isModelChannelId);

  return createModelEgressLedgerEntry({
    runId: input.runId,
    sourceKind: sourceKindForLedger(context.providers, attemptedChannels),
    attemptedChannels: [...new Set(attemptedChannels)],
    completedChannels: [...new Set(completedChannels.filter(isModelChannelId))],
    unavailableChannels: ledgerUnavailableChannels,
    blockedReasons: [...blockedReasons],
    artifactClassesSent:
      attemptedChannelIds.length === 0 ? [] : [...artifactDecision.artifactClassesSent],
    redactionStatus: attemptedChannelIds.length === 0 ? "none" : artifactDecision.redactionStatus,
  });
}

function createModelCaptureResolver(
  capture: Capture,
  artifactDecision: ModelArtifactEgressDecision,
  dependencies: AuditRunnerDependencies,
  runId: string,
): ResolveModelCapture {
  let materializedCapture: Result<Capture, SurfaceError> | undefined;
  let metadataCapture: Result<Capture, SurfaceError> | undefined;

  return async (entry) => {
    if (modelLensNeedsReadableArtifacts(entry)) {
      if (materializedCapture === undefined) {
        materializedCapture = await materializeModelArtifacts(
          capture,
          artifactDecision.artifactsToSend,
          dependencies,
          runId,
        );
      }

      return materializedCapture;
    }

    if (metadataCapture === undefined) {
      metadataCapture = modelArtifactMetadataCapture(capture, artifactDecision.artifactsToSend);
    }

    return metadataCapture;
  };
}

function modelLensNeedsReadableArtifacts(entry: ModelLensEntry): boolean {
  return (
    entry.lens.requiresLiveDom ||
    entry.registration.requiresLiveDom ||
    (entry.registration.requiredArtifacts?.some((artifactType) =>
      MODEL_TEXT_ARTIFACT_TYPES.has(artifactType),
    ) ??
      false)
  );
}

function modelArtifactMetadataCapture(
  capture: Capture,
  artifacts: readonly CaptureArtifact[],
): Result<Capture, SurfaceError> {
  return ok({
    ...capture,
    artifacts: artifacts.map((artifact) =>
      isModelTextArtifact(artifact)
        ? {
            ...artifact,
            path: `surface://model-egress/redacted/${safeArtifactPathSegment(artifact.id)}.txt`,
            redacted: true,
          }
        : { ...artifact },
    ),
  });
}

function sanitizeMmrCapture(capture: Capture): Capture {
  return {
    ...capture,
    artifacts: capture.artifacts.map(sanitizeMmrArtifact),
    ...(capture.degradation === undefined
      ? {}
      : {
          degradation: {
            ...capture.degradation,
            skippedReason: maskModelPlainText(capture.degradation.skippedReason),
          },
        }),
    target: sanitizeMmrTarget(capture.target),
    ...(capture.verification === undefined
      ? {}
      : {
          verification: {
            ...capture.verification,
            landedUrl: maskModelPlainText(capture.verification.landedUrl),
            requestedUrl: maskModelPlainText(capture.verification.requestedUrl),
          },
        }),
  };
}

function sanitizeMmrTarget(target: Target): Target {
  if (target.kind === "dom") {
    return { ...target, ref: "[redacted-inline-dom]" };
  }

  return {
    ...target,
    ref: maskModelPlainText(target.ref),
  };
}

function sanitizeMmrArtifact(artifact: CaptureArtifact): CaptureArtifact {
  if (artifact.type === "screenshot") {
    return {
      ...artifact,
      path: "[redacted-screenshot-metadata-only]",
      redacted: true,
    };
  }

  return {
    ...artifact,
    path: `surface://model-egress/redacted/${safeArtifactPathSegment(artifact.id)}.txt`,
    redacted: true,
  };
}

type ModelTextArtifactType = "accessibility-tree" | "computed-styles" | "dom-snapshot";

const MODEL_TEXT_ARTIFACT_TYPES = new Set<CaptureArtifact["type"]>([
  "accessibility-tree",
  "computed-styles",
  "dom-snapshot",
]);

async function materializeModelArtifacts(
  capture: Capture,
  artifacts: readonly CaptureArtifact[],
  dependencies: AuditRunnerDependencies,
  runId: string,
): Promise<Result<Capture, SurfaceError>> {
  const modelArtifacts: CaptureArtifact[] = [];

  for (const artifact of artifacts) {
    if (!isModelTextArtifact(artifact)) {
      modelArtifacts.push({ ...artifact });
      continue;
    }

    const materialized = await materializeSanitizedTextArtifact(artifact, dependencies, runId);

    if (!isOk(materialized)) {
      return materialized;
    }

    modelArtifacts.push(materialized.value);
  }

  return ok({
    ...capture,
    artifacts: modelArtifacts,
  });
}

async function materializeSanitizedTextArtifact(
  artifact: CaptureArtifact & { readonly type: ModelTextArtifactType },
  dependencies: AuditRunnerDependencies,
  runId: string,
): Promise<Result<CaptureArtifact, SurfaceError>> {
  const artifactWriter = dependencies.artifactWriter;

  if (artifactWriter === undefined) {
    return err(
      createSurfaceError(
        "config_invalid",
        "Model artifact egress requires an artifact writer for readable text artifacts.",
        {
          details: { artifactId: artifact.id, artifactType: artifact.type },
        },
      ),
    );
  }

  const rawText = await readCaptureArtifactText(
    artifact,
    dependencies.lensFactoryOptions?.projectRoot,
  );

  if (!isOk(rawText)) {
    return rawText;
  }

  const masked = maskModelArtifactText({
    artifactType: artifact.type,
    text: rawText.value,
    ...(artifact.redaction === undefined ? {} : { redaction: artifact.redaction }),
  });
  const written = await artifactWriter.writeArtifact({
    bytes: new TextEncoder().encode(masked.text),
    kind: "generated",
    relativePath: `model-egress/${safeArtifactPathSegment(runId)}/${safeArtifactPathSegment(
      artifact.id,
    )}.txt`,
  });

  if (!isOk(written)) {
    return written;
  }

  return ok({
    ...artifact,
    path: written.value.path,
    redacted: true,
  });
}

async function readCaptureArtifactText(
  artifact: CaptureArtifact,
  projectRoot: string | undefined,
): Promise<Result<string, SurfaceError>> {
  const artifactPath = await resolveReadableModelArtifactPath(artifact, projectRoot);

  if (!isOk(artifactPath)) {
    return artifactPath;
  }

  try {
    return ok(await readFile(artifactPath.value, "utf8"));
  } catch (error) {
    return err(
      createSurfaceError("capture_failed", "Model artifact text could not be sanitized.", {
        cause: error,
        details: { artifactId: artifact.id, path: artifact.path },
      }),
    );
  }
}

async function resolveReadableModelArtifactPath(
  artifact: CaptureArtifact,
  projectRoot: string | undefined,
): Promise<Result<string, SurfaceError>> {
  if (projectRoot === undefined) {
    return err(
      createSurfaceError(
        "config_invalid",
        "Model artifact egress requires a project root for readable text artifacts.",
        {
          details: { artifactId: artifact.id },
        },
      ),
    );
  }

  try {
    const root = await realpath(path.resolve(projectRoot));
    const candidate = path.isAbsolute(artifact.path)
      ? path.resolve(artifact.path)
      : path.resolve(root, artifact.path);
    const realCandidate = await realpath(candidate);
    const relative = path.relative(root, realCandidate);
    const insideRoot =
      relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));

    if (!insideRoot) {
      return err(
        createSurfaceError("capture_failed", "Model artifact path is outside the project root.", {
          details: { artifactId: artifact.id, path: artifact.path },
        }),
      );
    }

    return ok(realCandidate);
  } catch (error) {
    return err(
      createSurfaceError("capture_failed", "Model artifact path could not be resolved.", {
        cause: error,
        details: { artifactId: artifact.id, path: artifact.path },
      }),
    );
  }
}

function isModelTextArtifact(
  artifact: CaptureArtifact,
): artifact is CaptureArtifact & { readonly type: ModelTextArtifactType } {
  return MODEL_TEXT_ARTIFACT_TYPES.has(artifact.type);
}

function safeArtifactPathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/giu, "_").replace(/^_+|_+$/gu, "") || "artifact";
}

function providerForModelEgress(provider: ModelProvider): ModelProvider {
  return {
    ...provider,
    complete: async (request) => {
      const result = await provider.complete(sanitizeModelRequest(request));

      if (!isOk(result)) {
        return result;
      }

      return ok(sanitizeModelResponse(result.value));
    },
  };
}

function sanitizeModelResponse(response: ModelResponse): ModelResponse {
  return {
    channelId: response.channelId,
    model: response.model,
    provider: response.provider,
    sourceKind: response.sourceKind,
    text: maskModelPlainText(response.text),
  };
}

function sanitizeModelRequest(request: ModelRequest): ModelRequest {
  return {
    ...request,
    prompt: {
      ...request.prompt,
      input: sanitizeModelPromptValue(request.prompt.input, 0, new WeakSet<object>()),
      instructions: maskModelPlainText(request.prompt.instructions),
      ...(request.prompt.system === undefined
        ? {}
        : { system: maskModelPlainText(request.prompt.system) }),
    },
  };
}

function sanitizeModelPromptValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return maskModelPlainText(value);
  }

  if (depth >= MAX_MODEL_PROMPT_SANITIZE_DEPTH) {
    return "[masked-nested-prompt]";
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[masked-circular-prompt]";
    }

    seen.add(value);

    try {
      return value.map((child) => sanitizeModelPromptValue(child, depth + 1, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      return "[masked-circular-prompt]";
    }

    seen.add(value);

    try {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          maskModelPlainText(key),
          sanitizeModelPromptValue(child, depth + 1, seen),
        ]),
      );
    } finally {
      seen.delete(value);
    }
  }

  return value;
}

function modelUnavailableMessage(context: ModelContext): string {
  if (context.unavailableChannels[0] !== undefined) {
    return context.unavailableChannels[0].message;
  }

  if (context.blockedReasons.length > 0) {
    return `Judged model coverage blocked by policy: ${context.blockedReasons.join(", ")}.`;
  }

  return "Judged model coverage unavailable; no permitted model channel was configured.";
}

function unavailableFromAvailability(
  fallbackId: string | undefined,
  availability: ModelAvailability,
): AuditRunnerUnavailableChannel {
  if (availability.available) {
    return {
      id: availability.channelId,
      message: "channel is available",
      reason: "available",
    };
  }

  return {
    id: availability.channelId ?? fallbackId ?? "unknown",
    message: sanitizeUnavailableMessage(availability.message),
    reason: availability.reason,
  };
}

function unavailableFromAvailabilityRecords(
  records: readonly Extract<ModelAvailability, { available: false }>[],
): AuditRunnerUnavailableChannel[] {
  return records.map((record) => unavailableFromAvailability(record.channelId, record));
}

function uniqueBlockedReasons(
  reasons: readonly ModelEgressBlockedReason[],
): ModelEgressBlockedReason[] {
  return [...new Set(reasons)];
}

function sourceKindForLedger(
  providers: readonly ModelProvider[],
  attemptedChannels: readonly ModelEgressLedgerEntry["attemptedChannels"][number][],
): ModelSourceKind {
  const [firstProvider] = providers;

  if (firstProvider === undefined && attemptedChannels.includes("mmr")) {
    return "mmr";
  }

  if (
    attemptedChannels.some(
      (channelId) =>
        channelId === "claude" ||
        channelId === "codex" ||
        channelId === "gemini" ||
        channelId === "grok" ||
        channelId === "antigravity",
    )
  ) {
    return "subscription-cli";
  }

  if (firstProvider?.id === "local") {
    return "local";
  }

  if (
    firstProvider?.id === "claude" ||
    firstProvider?.id === "codex" ||
    firstProvider?.id === "gemini" ||
    firstProvider?.id === "grok" ||
    firstProvider?.id === "antigravity"
  ) {
    return "subscription-cli";
  }

  return "api";
}

function reasonForLedger(
  reason: string,
): Extract<ModelAvailability, { available: false }>["reason"] | undefined {
  switch (reason) {
    case "auth-unavailable":
    case "invalid-config":
    case "invalid-provider":
    case "missing-base-url":
    case "missing-credential":
    case "no-model-configured":
    case "not-installed":
    case "timeout":
    case "command-failed":
    case "parse-failed":
    case "prompt-cleanup-failed":
    case "unsupported-capability":
      return reason;
    default:
      return undefined;
  }
}

function unavailableFromError(
  channelId: string,
  error: SurfaceError,
): AuditRunnerUnavailableChannel {
  const parsedReason =
    typeof error.details?.reason === "string"
      ? ModelUnavailableReasonSchema.safeParse(error.details.reason)
      : undefined;

  return {
    id: channelId,
    message: sanitizeUnavailableMessage(error.message),
    reason: parsedReason?.success === true ? parsedReason.data : error.code,
  };
}

function sanitizeUnavailableMessage(message: string): string {
  return maskModelPlainText(message);
}

function reconciliationUnavailableFromDetailed(
  channel: AuditRunnerUnavailableChannel,
): ReconciliationChannel {
  return {
    id: channel.id,
    status: "unavailable",
    reason: channel.reason === "model_unavailable" ? "model_unavailable" : "channel_unavailable",
    message: channel.message,
  };
}

function isModelChannelId(
  value: string,
): value is ModelEgressLedgerEntry["attemptedChannels"][number] {
  return (
    value === "anthropic" ||
    value === "openai" ||
    value === "local" ||
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "grok" ||
    value === "antigravity" ||
    value === "mmr"
  );
}
