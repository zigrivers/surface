import type { SurfaceConfig } from "./config.js";
import { getAppTypeOverlay, type AppTypeOverlay } from "./app-type-overlays.js";
import type { Capture, CaptureArtifactType } from "./interfaces.js";
import type { ModelAvailability } from "./model-provider.js";

export type LensRegistration = {
  readonly id: string;
  readonly method: "measured" | "judged";
  readonly requiresModel: boolean;
  readonly requiresLiveDom: boolean;
  readonly presets: readonly SurfaceConfig["evaluation"]["preset"][];
};

export type LensSkipReason = "model_unavailable" | "live_dom_unavailable";

export type LensExecutionSkip = {
  readonly lensId: string;
  readonly reason: LensSkipReason;
  readonly message: string;
};

export type LensExecutionPlan = {
  readonly overlay: Readonly<AppTypeOverlay>;
  readonly preset: SurfaceConfig["evaluation"]["preset"];
  readonly selected: readonly LensRegistration[];
  readonly skipped: readonly LensExecutionSkip[];
};

export type SelectLensExecutionPlanInput = {
  readonly config: SurfaceConfig;
  readonly capture?: Capture;
  readonly modelAvailability?: ModelAvailability;
  readonly registry?: readonly LensRegistration[];
};

export type SynthesisDecision = {
  readonly factKey: string;
  readonly sourceOfTruth: "measured" | "judged";
  readonly reason: string;
  readonly measuredSource: string;
  readonly measuredValue: string;
  readonly judgedSource: string;
  readonly judgedValue: string;
};

export type SynthesizeMeasuredWinsInput = {
  readonly factKey: string;
  readonly measuredSource: string;
  readonly measuredValue: string;
  readonly judgedSource: string;
  readonly judgedValue: string;
};

export const BUILT_IN_LENS_REGISTRY = [
  {
    id: "accessibility",
    method: "measured",
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["quick", "mvp", "standard", "deep", "accessibility-first", "agent-ready"],
  },
  {
    id: "usability",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["quick", "mvp", "standard", "deep", "agent-ready"],
  },
  {
    id: "visual-hierarchy",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["mvp", "standard", "deep", "accessibility-first", "design-system-focused"],
  },
  {
    id: "content",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep"],
  },
  {
    id: "responsiveness",
    method: "measured",
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["mvp", "standard", "deep", "accessibility-first", "conversion-focused"],
  },
  {
    id: "conversion",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["conversion-focused", "deep", "agent-ready"],
  },
  {
    id: "message-clarity",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep", "conversion-focused"],
  },
  {
    id: "task-completion",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep", "agent-ready"],
  },
  {
    id: "data-density",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep"],
  },
  {
    id: "trust-and-control",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep", "agent-ready"],
  },
  {
    id: "trust-and-credibility",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["standard", "deep", "conversion-focused"],
  },
] as const satisfies readonly LensRegistration[];

export function selectLensExecutionPlan(input: SelectLensExecutionPlanInput): LensExecutionPlan {
  const overlay = getAppTypeOverlay(input.config.evaluation.appType);
  const preset = input.config.evaluation.preset;
  const overlayLensIds = new Set(Object.keys(overlay.lensCriteria));
  const selected: LensRegistration[] = [];
  const skipped: LensExecutionSkip[] = [];

  for (const lens of input.registry ?? BUILT_IN_LENS_REGISTRY) {
    if (!overlayLensIds.has(lens.id) || !lens.presets.includes(preset)) {
      continue;
    }

    const skip = skipForLens(lens, input);

    if (skip === undefined) {
      selected.push(lens);
    } else {
      skipped.push(skip);
    }
  }

  return { overlay, preset, selected, skipped };
}

export function synthesizeMeasuredWinsDecision(
  input: SynthesizeMeasuredWinsInput,
): SynthesisDecision {
  return {
    ...input,
    sourceOfTruth: "measured",
    reason:
      input.measuredValue === input.judgedValue
        ? "Measured evidence is the canonical source for this fact."
        : "Measured evidence overrides the judged interpretation for the same fact.",
  };
}

function skipForLens(
  lens: LensRegistration,
  input: SelectLensExecutionPlanInput,
): LensExecutionSkip | undefined {
  if (lens.requiresModel && input.modelAvailability?.available !== true) {
    return {
      lensId: lens.id,
      reason: "model_unavailable",
      message: input.modelAvailability?.message ?? "Model availability was not provided.",
    };
  }

  if (lens.requiresLiveDom && !hasCaptureArtifact(input.capture, "dom-snapshot")) {
    return {
      lensId: lens.id,
      reason: "live_dom_unavailable",
      message: liveDomUnavailableMessage(input.capture),
    };
  }

  return undefined;
}

function hasCaptureArtifact(
  capture: Capture | undefined,
  artifactType: CaptureArtifactType,
): boolean {
  return capture?.artifacts.some((artifact) => artifact.type === artifactType) ?? false;
}

function liveDomUnavailableMessage(capture: Capture | undefined): string {
  return capture === undefined
    ? "Lens requires a live DOM snapshot, but no capture was provided."
    : "Lens requires a live DOM snapshot, but this capture did not produce one.";
}
