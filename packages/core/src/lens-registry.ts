import type { SurfaceConfig } from "./config.js";
import { createAccessibilityLens } from "./accessibility-lens.js";
import { getAppTypeOverlay, type AppTypeOverlay } from "./app-type-overlays.js";
import { createContentMicrocopyLens } from "./content-lens.js";
import { createConversionLens, createTaskCompletionLens } from "./flow-lenses.js";
import type { Capture, CaptureArtifactType, Lens } from "./interfaces.js";
import type { ModelAvailability } from "./model-provider.js";
import { createResponsivenessStatesLens } from "./responsiveness-states-lens.js";
import { createUsabilityHeuristicLens } from "./usability-heuristic-lens.js";
import { createVisualHierarchyLens } from "./visual-hierarchy-lens.js";

export type LensFactoryOptions = {
  readonly maxDomChars?: number;
  readonly projectRoot?: string;
};

export type LensRegistration = {
  readonly id: string;
  readonly method: "measured" | "judged";
  readonly requiresModel: boolean;
  readonly requiresLiveDom: boolean;
  readonly requiredArtifacts?: readonly CaptureArtifactType[];
  readonly presets: readonly SurfaceConfig["evaluation"]["preset"][];
  readonly create?: (options?: LensFactoryOptions) => Lens;
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

export type InstantiatedLens = {
  readonly lens: Lens;
  readonly registration: LensRegistration;
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
    create: () => createAccessibilityLens(),
  },
  {
    id: "usability",
    method: "judged",
    requiresModel: true,
    requiredArtifacts: ["dom-snapshot"],
    requiresLiveDom: true,
    presets: ["quick", "mvp", "standard", "deep", "agent-ready"],
    create: (options) => createUsabilityHeuristicLens(options),
  },
  {
    id: "visual-hierarchy",
    method: "judged",
    requiredArtifacts: ["dom-snapshot", "computed-styles"],
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["mvp", "standard", "deep", "accessibility-first", "design-system-focused"],
    create: (options) => createVisualHierarchyLens(options),
  },
  {
    id: "content",
    method: "judged",
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["standard", "deep"],
    create: (options) => createContentMicrocopyLens(options),
  },
  {
    id: "responsiveness",
    method: "measured",
    requiresModel: false,
    requiresLiveDom: true,
    presets: ["mvp", "standard", "deep", "accessibility-first", "conversion-focused"],
    create: (options) => createResponsivenessStatesLens(options),
  },
  {
    id: "conversion",
    method: "judged",
    requiredArtifacts: ["dom-snapshot"],
    requiresModel: true,
    requiresLiveDom: true,
    presets: ["conversion-focused", "deep", "agent-ready"],
    create: (options) => createConversionLens(options),
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
    requiredArtifacts: ["dom-snapshot"],
    requiresModel: true,
    requiresLiveDom: true,
    presets: ["standard", "deep", "agent-ready"],
    create: (options) => createTaskCompletionLens(options),
  },
  {
    id: "agent-implementation",
    method: "judged",
    requiresModel: true,
    requiresLiveDom: false,
    presets: ["deep", "agent-ready"],
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
  const registry: readonly LensRegistration[] = input.registry ?? BUILT_IN_LENS_REGISTRY;
  const selected: LensRegistration[] = [];
  const skipped: LensExecutionSkip[] = [];

  for (const lens of registry) {
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

export function instantiateLensExecutionPlan(
  plan: LensExecutionPlan,
  options: LensFactoryOptions = {},
): readonly InstantiatedLens[] {
  return plan.selected.flatMap((registration) =>
    registration.create === undefined ? [] : [{ lens: registration.create(options), registration }],
  );
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

  if (lens.requiresLiveDom) {
    const missingArtifact = (lens.requiredArtifacts ?? ["dom-snapshot"]).find(
      (artifactType) => !hasCaptureArtifact(input.capture, artifactType),
    );

    if (missingArtifact !== undefined) {
      return {
        lensId: lens.id,
        reason: "live_dom_unavailable",
        message: liveDomUnavailableMessage(input.capture, missingArtifact),
      };
    }
  }

  return undefined;
}

function hasCaptureArtifact(
  capture: Capture | undefined,
  artifactType: CaptureArtifactType,
): boolean {
  return capture?.artifacts.some((artifact) => artifact.type === artifactType) ?? false;
}

function liveDomUnavailableMessage(
  capture: Capture | undefined,
  missingArtifact: CaptureArtifactType,
): string {
  if (missingArtifact === "computed-styles") {
    return capture === undefined
      ? "Lens requires computed styles, but no capture was provided."
      : "Lens requires computed styles, but this capture did not produce them.";
  }

  return capture === undefined
    ? "Lens requires a live DOM snapshot, but no capture was provided."
    : "Lens requires a live DOM snapshot, but this capture did not produce one.";
}
