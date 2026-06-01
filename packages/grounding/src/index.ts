import { ESLint, type Linter } from "eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

import { createSurfaceError, type Result, type SurfaceError } from "@surface/core";
import type { GroundingTool, SourceFileRef, ToolResult } from "@surface/core/interfaces";

export const JSX_A11Y_GROUNDING_ID = "eslint-jsx-a11y";
const JSX_A11Y_THRESHOLD = "eslint-plugin-jsx-a11y recommended";
const JSX_A11Y_RULE_PREFIX = "jsx-a11y/";
const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"] as const;

type LintResult = Awaited<ReturnType<ESLint["lintText"]>>[number];
type LintMessageWithRule = LintResult["messages"][number] & { readonly ruleId: string };

export interface JsxA11yGroundingTool extends GroundingTool {
  readonly id: typeof JSX_A11Y_GROUNDING_ID;
}

export interface JsxA11yGroundingOptions {
  readonly sources: readonly SourceFileRef[];
}

export function createJsxA11yGroundingTool(options: JsxA11yGroundingOptions): JsxA11yGroundingTool {
  const sources = [...options.sources];

  return {
    id: JSX_A11Y_GROUNDING_ID,
    run: (): Promise<Result<ToolResult[], SurfaceError>> => runJsxA11yStaticPass(sources),
  };
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

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
