import { ESLint, type Linter } from "eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

import { createSurfaceError, type Result, type SurfaceError } from "@surface/core";
import type { Capture, GroundingTool, SourceFileRef, ToolResult } from "@surface/core/interfaces";

export const AXE_GROUNDING_ID = "axe";
export const JSX_A11Y_GROUNDING_ID = "eslint-jsx-a11y";
const AXE_WCAG_AA_THRESHOLD = "WCAG 2.2 AA";
const JSX_A11Y_THRESHOLD = "eslint-plugin-jsx-a11y recommended";
const JSX_A11Y_RULE_PREFIX = "jsx-a11y/";
const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"] as const;
const CONTRAST_MEASURED_PATTERN = /color contrast of\s+(\d+(?:\.\d+)?)/iu;
const CONTRAST_THRESHOLD_PATTERN = /expected contrast ratio of\s+(\d+(?:\.\d+)?)\s*:1/iu;
const CONTRAST_RATIO_PATTERN = /(\d+(?:\.\d+)?)\s*:1/gu;

type LintResult = Awaited<ReturnType<ESLint["lintText"]>>[number];
type LintMessageWithRule = LintResult["messages"][number] & { readonly ruleId: string };
type MaybePromise<T> = T | Promise<T>;

export interface AxeNodeResult {
  readonly target?: readonly string[];
  readonly failureSummary?: string;
  readonly any?: readonly AxeCheckResult[];
  readonly all?: readonly AxeCheckResult[];
  readonly none?: readonly AxeCheckResult[];
}

export interface AxeCheckResult {
  readonly message?: string;
}

export interface AxeViolation {
  readonly id: string;
  readonly tags?: readonly string[];
  readonly help?: string;
  readonly description?: string;
  readonly nodes?: readonly AxeNodeResult[];
}

export interface AxeRunResult {
  readonly violations?: readonly AxeViolation[];
}

export interface AxeGroundingTool extends GroundingTool {
  readonly id: typeof AXE_GROUNDING_ID;
}

export interface AxeGroundingOptions {
  readonly runAxe: (capture: Capture) => MaybePromise<AxeRunResult>;
}

export interface JsxA11yGroundingTool extends GroundingTool {
  readonly id: typeof JSX_A11Y_GROUNDING_ID;
}

export interface JsxA11yGroundingOptions {
  readonly sources: readonly SourceFileRef[];
}

export function createAxeGroundingTool(options: AxeGroundingOptions): AxeGroundingTool {
  return {
    id: AXE_GROUNDING_ID,
    async run(capture: Capture): Promise<Result<ToolResult[], SurfaceError>> {
      try {
        return { ok: true, value: axeResultToToolResults(await options.runAxe(capture)) };
      } catch (cause) {
        return {
          ok: false,
          error: createSurfaceError("step_failed", "Failed to run axe grounding.", { cause }),
        };
      }
    },
  };
}

export function axeResultToToolResults(result: AxeRunResult | null | undefined): ToolResult[] {
  const evidence = axeViolations(result)
    .flatMap((violation) => evidenceForAxeViolation(violation))
    .map((item, index) => ({ index, item }))
    .sort(
      (left, right) =>
        compareStableStrings(
          `${left.item.rule}\0${left.item.measuredValue}`,
          `${right.item.rule}\0${right.item.measuredValue}`,
        ) || left.index - right.index,
    )
    .map(({ item }) => item);

  return evidence.length === 0 ? [] : [{ tool: AXE_GROUNDING_ID, evidence }];
}

export function createJsxA11yGroundingTool(options: JsxA11yGroundingOptions): JsxA11yGroundingTool {
  const sources = [...options.sources];

  return {
    id: JSX_A11Y_GROUNDING_ID,
    run: (): Promise<Result<ToolResult[], SurfaceError>> => runJsxA11yStaticPass(sources),
  };
}

function evidenceForAxeViolation(violation: AxeViolation): ToolResult["evidence"] {
  return axeNodes(violation).map((node) => {
    const selector = selectorForAxeNode(node);
    const summary = summaryForAxeNode(violation, node);
    const contrast = contrastResult(summary);
    const threshold =
      violation.id === "color-contrast" && contrast.threshold !== undefined
        ? `${contrast.threshold}:1 (${AXE_WCAG_AA_THRESHOLD})`
        : undefined;

    return {
      kind: "tool-result" as const,
      tool: AXE_GROUNDING_ID,
      rule: violation.id,
      measuredValue:
        violation.id === "color-contrast" && contrast.measured !== undefined
          ? `${selector}: ${contrast.measured}:1`
          : `${selector}: ${summary}`,
      ...(threshold === undefined ? {} : { threshold }),
    };
  });
}

function selectorForAxeNode(node: AxeNodeResult): string {
  return Array.isArray(node.target) && node.target.length > 0 && node.target.every(isString)
    ? node.target.join(" ")
    : "unknown-target";
}

function summaryForAxeNode(violation: AxeViolation, node: AxeNodeResult): string {
  return normalizeWhitespace(
    stringOrUndefined(node.failureSummary) ??
      firstCheckMessage(node.any) ??
      firstCheckMessage(node.all) ??
      firstCheckMessage(node.none) ??
      stringOrUndefined(violation.help) ??
      stringOrUndefined(violation.description) ??
      violation.id,
  );
}

function firstCheckMessage(checks: unknown): string | undefined {
  if (!Array.isArray(checks)) {
    return undefined;
  }

  for (const check of checks as readonly unknown[]) {
    if (isRecord(check)) {
      const message = check["message"];
      if (typeof message === "string") {
        return message;
      }
    }
  }

  return undefined;
}

function contrastResult(value: string): {
  readonly measured: string | undefined;
  readonly threshold: string | undefined;
} {
  const measured = value.match(CONTRAST_MEASURED_PATTERN)?.[1];
  const threshold = value.match(CONTRAST_THRESHOLD_PATTERN)?.[1];

  if (measured !== undefined || threshold !== undefined) {
    return { measured, threshold };
  }

  const ratios = [...value.matchAll(CONTRAST_RATIO_PATTERN)]
    .map((match) => match[1])
    .filter(isString);

  return { measured: ratios[0], threshold: ratios[1] };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export async function runJsxA11yStaticPass(
  sources: readonly SourceFileRef[],
): Promise<Result<ToolResult[], SurfaceError>> {
  if (!sources.every(isSourceFileRef)) {
    return {
      ok: false,
      error: createSurfaceError("step_failed", "SourceFileRef requires string path and contents."),
    };
  }

  try {
    const eslint = createEslint();
    const evidence = (
      await Promise.all(
        sources
          .filter((source) => supportsSource(source.path))
          .map(async (source) => {
            const [result] = await eslint.lintText(source.contents, { filePath: source.path });

            return result === undefined ? [] : evidenceForResult(result);
          }),
      )
    )
      .flat()
      .sort((left, right) =>
        compareStableStrings(
          `${left.rule}\0${left.measuredValue}`,
          `${right.rule}\0${right.measuredValue}`,
        ),
      );

    return {
      ok: true,
      value: evidence.length === 0 ? [] : [{ tool: JSX_A11Y_GROUNDING_ID, evidence }],
    };
  } catch (cause) {
    return {
      ok: false,
      error: createSurfaceError("step_failed", "Failed to run eslint-jsx-a11y grounding.", {
        cause,
      }),
    };
  }
}

function createEslint(): ESLint {
  const plugin: ESLint.Plugin = jsxA11y;
  const rules: Linter.RulesRecord = jsxA11y.configs.recommended.rules;

  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{js,jsx,mjs,cjs}"],
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { "jsx-a11y": plugin },
        rules,
      },
      {
        files: ["**/*.{ts,tsx,mts,cts}"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
          ecmaVersion: "latest",
          sourceType: "module",
        },
        plugins: { "jsx-a11y": plugin },
        rules,
      },
    ],
  });
}

function evidenceForResult(result: LintResult): ToolResult["evidence"] {
  return result.messages
    .filter(
      (message): message is LintMessageWithRule =>
        message.ruleId?.startsWith(JSX_A11Y_RULE_PREFIX) === true,
    )
    .map((message) => ({
      kind: "tool-result" as const,
      tool: JSX_A11Y_GROUNDING_ID,
      rule: message.ruleId,
      measuredValue: `${result.filePath}:${message.line}:${message.column} ${message.message}`,
      threshold: JSX_A11Y_THRESHOLD,
    }));
}

function supportsSource(path: string): boolean {
  const lowerPath = path.toLowerCase();

  return SOURCE_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

function isSourceFileRef(source: unknown): source is SourceFileRef {
  if (typeof source !== "object" || source === null) {
    return false;
  }

  const candidate = source as { readonly path?: unknown; readonly contents?: unknown };

  return typeof candidate.path === "string" && typeof candidate.contents === "string";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function axeViolations(result: AxeRunResult | null | undefined): readonly AxeViolation[] {
  if (!isRecord(result) || !Array.isArray(result.violations)) {
    return [];
  }

  return result.violations.filter(isAxeViolation);
}

function axeNodes(violation: AxeViolation): readonly AxeNodeResult[] {
  return Array.isArray(violation.nodes) ? violation.nodes.filter(isRecord) : [];
}

function isAxeViolation(value: unknown): value is AxeViolation {
  return isRecord(value) && typeof value.id === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
