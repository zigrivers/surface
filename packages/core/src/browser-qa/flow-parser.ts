import { parse as parseYaml } from "yaml";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import {
  BrowserQaFlowSchema,
  type BrowserQaFlow,
  type BrowserQaFlowStep,
  type QaDegradation,
  type QaTarget,
} from "./schemas.js";

export type ParseBrowserQaFlowOptions = {
  readonly sourcePath: string;
};

export type FlowTargetCliOptions = {
  readonly baseUrl?: string;
  readonly localhost?: boolean;
  readonly target?: string;
  readonly url?: string;
};

export type ResolveFlowTargetInput = {
  readonly cli?: FlowTargetCliOptions;
  readonly configTarget?: QaTarget;
  readonly defaultTarget?: QaTarget;
  readonly flowTarget?: QaTarget;
};

export type LegacyRouteFlowInput = {
  readonly id: string;
  readonly targets: readonly string[];
};

export type ImportedLegacyRouteFlow = BrowserQaFlow & {
  readonly degradation: readonly QaDegradation[];
};

export function parseBrowserQaFlow(
  source: string,
  options: ParseBrowserQaFlowOptions,
): Result<BrowserQaFlow, SurfaceError> {
  try {
    const parsedYaml = parseYaml(source) as unknown;
    const parsedFlow = BrowserQaFlowSchema.safeParse(parsedYaml);

    if (!parsedFlow.success) {
      return err(
        createSurfaceError("flow_invalid", "Browser QA flow file is invalid.", {
          cause: parsedFlow.error,
          details: { sourcePath: options.sourcePath },
        }),
      );
    }

    return ok(parsedFlow.data);
  } catch (error) {
    return err(
      createSurfaceError("flow_invalid", "Failed to parse browser QA flow YAML.", {
        cause: error,
        details: { sourcePath: options.sourcePath },
      }),
    );
  }
}

export function resolveFlowTarget(input: ResolveFlowTargetInput): QaTarget | undefined {
  if (input.cli?.target !== undefined) {
    return { kind: "url", ref: input.cli.target };
  }

  if (input.cli?.url !== undefined) {
    return { kind: "url", ref: input.cli.url };
  }

  if (input.cli?.localhost === true) {
    return { kind: "localhost", ref: "http://localhost:3000" };
  }

  const resolvedTarget = input.flowTarget ?? input.configTarget ?? input.defaultTarget;

  if (input.cli?.baseUrl !== undefined && resolvedTarget !== undefined) {
    return {
      ...resolvedTarget,
      ref: replaceTargetOrigin(resolvedTarget.ref, input.cli.baseUrl),
    };
  }

  return resolvedTarget;
}

export function validateFlowTargetCli(
  cli: FlowTargetCliOptions | undefined,
): Result<undefined, SurfaceError> {
  if (cli?.baseUrl !== undefined && !isAbsoluteUrl(cli.baseUrl)) {
    return err(
      createSurfaceError("flow_invalid", "Browser QA --base-url must be an absolute URL.", {
        details: { baseUrl: cli.baseUrl },
      }),
    );
  }

  return ok(undefined);
}

export function importLegacyRouteFlow(
  input: LegacyRouteFlowInput,
): Result<ImportedLegacyRouteFlow, SurfaceError> {
  if (input.targets.length === 0) {
    return err(
      createSurfaceError("flow_invalid", "Legacy route flow must include at least one target.", {
        details: { flowId: input.id },
      }),
    );
  }

  const steps = input.targets.flatMap((target, index): BrowserQaFlowStep[] => [
    {
      action: "open",
      id: `open-${index + 1}`,
      url: target,
    },
    {
      action: "capture",
      id: `capture-${index + 1}`,
    },
  ]);

  return ok({
    defaults: {},
    degradation: [
      {
        code: "legacy_flow_imported_without_interactions",
        message:
          "Legacy route flow imported as open/capture steps; interaction semantics were not inferred.",
        scope: "flow-import",
        severity: "warning",
      },
    ],
    fixtures: [],
    id: input.id,
    inputs: {},
    schemaVersion: "1.0",
    secrets: {},
    severity: "medium",
    steps,
    title: input.id,
  });
}

function replaceTargetOrigin(targetRef: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    const current = new URL(targetRef, base);

    return `${base.origin}${current.pathname}${current.search}${current.hash}`;
  } catch {
    return targetRef;
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
