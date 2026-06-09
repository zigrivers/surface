import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import type { Capture } from "./interfaces.js";
import type { ModelAvailability, ModelRequest, ModelResponse } from "./model-provider.js";

type MaybePromise<T> = T | Promise<T>;

export type MmrCapabilityProbeInput = {
  readonly channelId: "mmr";
  readonly sourceKind: "mmr";
};

export interface MmrAuditFallback {
  readonly id: "mmr";
  availability(input?: {
    readonly capture?: Capture;
  }): MaybePromise<Result<ModelAvailability, SurfaceError>>;
  run(input: {
    readonly capture: Capture;
    readonly request: ModelRequest;
  }): MaybePromise<Result<ModelResponse, SurfaceError>>;
}

export type MmrAuditFallbackOptions = {
  readonly probe?: (input: MmrCapabilityProbeInput) => MaybePromise<void>;
};

export function createMmrAuditFallback(options: MmrAuditFallbackOptions = {}): MmrAuditFallback {
  return {
    id: "mmr",
    availability: async () => {
      await options.probe?.({ channelId: "mmr", sourceKind: "mmr" });

      return ok(unavailableMmr());
    },
    run: () =>
      err(
        createSurfaceError("model_unavailable", unavailableMmr().message, {
          details: { reason: "unsupported-capability" },
        }),
      ),
  };
}

function unavailableMmr(): Extract<ModelAvailability, { available: false }> {
  return {
    available: false,
    channelId: "mmr",
    message: "MMR Surface audit fallback is unsupported in this revision",
    reason: "unsupported-capability",
    sourceKind: "mmr",
  };
}
