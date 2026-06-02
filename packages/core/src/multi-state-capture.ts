import { createSurfaceError, err, isOk, ok, type Result } from "./errors.js";
import type { CaptureService } from "./capture.js";
import type { Finding } from "./findings.js";
import type { Capture, CaptureOptions, Target, Theme } from "./interfaces.js";

export type TaskFlowStep = {
  readonly id: string;
  readonly target: Target;
};

export type TaskFlowCaptureRecipe = {
  readonly id: string;
  readonly steps: readonly TaskFlowStep[];
  readonly themes?: readonly Theme[];
};

export type CaptureContext = {
  readonly stateId: string;
  readonly theme?: Theme;
};

export type TaskFlowCapturedState = CaptureContext & {
  readonly capture: Capture;
};

export type TaskFlowUnreachableStep = CaptureContext & {
  readonly reason: string;
  readonly target: Target;
};

export type TaskFlowCaptureResult = {
  readonly recipeId: string;
  readonly captures: readonly TaskFlowCapturedState[];
  readonly unreachable: readonly TaskFlowUnreachableStep[];
  readonly status: "completed" | "degraded";
};

export type RunTaskFlowCaptureInput = {
  readonly captureOptions: CaptureOptions;
  readonly recipe: TaskFlowCaptureRecipe;
  readonly service: CaptureService;
};

export type CaptureContextFinding = Finding & {
  readonly captureContext: CaptureContext;
  readonly tags: readonly string[];
};

export async function runTaskFlowCapture(
  input: RunTaskFlowCaptureInput,
): Promise<Result<TaskFlowCaptureResult>> {
  const validation = validateRecipe(input.recipe);

  if (!validation.ok) {
    return validation;
  }

  const captures: TaskFlowCapturedState[] = [];
  const unreachable: TaskFlowUnreachableStep[] = [];

  for (const step of input.recipe.steps) {
    for (const theme of themesForRecipe(input.recipe)) {
      const target = targetForTheme(step.target, theme);
      const capture = await input.service.capture(target, input.captureOptions);

      if (isOk(capture)) {
        captures.push(capturedStateFor(step.id, theme, capture.value));
        continue;
      }

      unreachable.push(unreachableStepFor(step.id, theme, target, capture.error.message));
    }
  }

  return ok({
    recipeId: input.recipe.id,
    captures,
    unreachable,
    status: unreachable.length > 0 ? "degraded" : "completed",
  });
}

export function tagFindingsWithCaptureContext(
  findings: readonly Finding[],
  context: CaptureContext,
): readonly CaptureContextFinding[] {
  return findings.map((finding) => ({
    ...finding,
    captureContext: contextFor(context),
    tags: tagsForContext(context),
  }));
}

function validateRecipe(recipe: TaskFlowCaptureRecipe): Result<TaskFlowCaptureRecipe> {
  if (recipe.id.trim().length === 0) {
    return err(createSurfaceError("capture_failed", "Task-flow recipe id must not be empty."));
  }

  if (recipe.steps.length === 0) {
    return err(
      createSurfaceError("capture_failed", "Task-flow recipe must include at least one step."),
    );
  }

  for (const step of recipe.steps) {
    if (step.id.trim().length === 0) {
      return err(createSurfaceError("capture_failed", "Task-flow step id must not be empty."));
    }
  }

  return ok(recipe);
}

function themesForRecipe(recipe: TaskFlowCaptureRecipe): readonly (Theme | undefined)[] {
  return recipe.themes === undefined || recipe.themes.length === 0 ? [undefined] : recipe.themes;
}

function targetForTheme(target: Target, theme: Theme | undefined): Target {
  return theme === undefined
    ? target
    : {
        ...target,
        theme,
      };
}

function capturedStateFor(
  stateId: string,
  theme: Theme | undefined,
  capture: Capture,
): TaskFlowCapturedState {
  return {
    stateId,
    ...(theme === undefined ? {} : { theme }),
    capture,
  };
}

function unreachableStepFor(
  stateId: string,
  theme: Theme | undefined,
  target: Target,
  reason: string,
): TaskFlowUnreachableStep {
  return {
    stateId,
    ...(theme === undefined ? {} : { theme }),
    target,
    reason,
  };
}

function contextFor(context: CaptureContext): CaptureContext {
  return {
    stateId: context.stateId,
    ...(context.theme === undefined ? {} : { theme: context.theme }),
  };
}

function tagsForContext(context: CaptureContext): readonly string[] {
  return [
    `state:${context.stateId}`,
    ...(context.theme === undefined ? [] : [`theme:${context.theme}`]),
  ];
}
