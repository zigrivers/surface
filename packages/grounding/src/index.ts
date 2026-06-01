import { ESLint, type Linter } from "eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

import { createSurfaceError, type Result, type SurfaceError } from "@surface/core";
import type { Capture, GroundingTool, SourceFileRef, ToolResult } from "@surface/core/interfaces";

export const AXE_GROUNDING_ID = "axe";
export const JSX_A11Y_GROUNDING_ID = "eslint-jsx-a11y";
export const LIGHTHOUSE_GROUNDING_ID = "lighthouse";
const AXE_WCAG_AA_THRESHOLD = "WCAG 2.2 AA";
const JSX_A11Y_THRESHOLD = "eslint-plugin-jsx-a11y recommended";
const JSX_A11Y_RULE_PREFIX = "jsx-a11y/";
const LIGHTHOUSE_AUDIT_THRESHOLD = "Lighthouse audit score 1";
const LIGHTHOUSE_GROUNDING_CATEGORIES = ["accessibility", "performance"] as const;
const HTTP_URL_SCHEME_PATTERN = /^https?:\/\//iu;
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

export interface LighthouseRunnerResult {
  readonly lhr?: LighthouseResult;
}

export interface LighthouseResult {
  readonly audits?: Readonly<Record<string, unknown>>;
  readonly categories?: Readonly<Record<string, unknown>>;
}

export interface LighthouseGroundingTool extends GroundingTool {
  readonly id: typeof LIGHTHOUSE_GROUNDING_ID;
}

export interface LighthouseGroundingOptions {
  readonly runLighthouse?: (capture: Capture) => MaybePromise<LighthouseRunnerResult | undefined>;
  readonly chromeLaunchOptions?: Readonly<Record<string, unknown>>;
  readonly importLighthouse?: () => Promise<LighthouseModule>;
  readonly importChromeLauncher?: () => Promise<ChromeLauncherModule>;
  readonly lighthouseOptions?: Readonly<Record<string, unknown>>;
}

interface ChromeLauncherModule {
  readonly launch?: (options?: Readonly<Record<string, unknown>>) => Promise<ChromeInstance>;
}

interface ChromeInstance {
  readonly port: number;
  kill(): MaybePromise<void>;
}

interface LighthouseModule {
  readonly default?: LighthouseRunner;
  readonly lighthouse?: LighthouseRunner;
}

type LighthouseRunner = (
  url: string,
  options?: Readonly<Record<string, unknown>>,
) => MaybePromise<LighthouseRunnerResult | undefined>;

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

export function createLighthouseGroundingTool(
  options: LighthouseGroundingOptions = {},
): LighthouseGroundingTool {
  return {
    id: LIGHTHOUSE_GROUNDING_ID,
    async run(capture: Capture): Promise<Result<ToolResult[], SurfaceError>> {
      try {
        const result =
          options.runLighthouse === undefined
            ? await runLighthouseCapture(capture, options)
            : await options.runLighthouse(capture);

        return { ok: true, value: lighthouseResultToToolResults(result) };
      } catch (cause) {
        return {
          ok: false,
          error: createSurfaceError("step_failed", "Failed to run lighthouse grounding.", {
            cause,
          }),
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

export function lighthouseResultToToolResults(
  result: LighthouseRunnerResult | null | undefined,
): ToolResult[] {
  const lhr = isRecord(result?.lhr) ? result.lhr : undefined;
  const audits = recordOrUndefined(lhr?.audits);
  if (lhr === undefined || audits === undefined) {
    return [];
  }

  const evidence = lighthouseAuditIds(lhr)
    .flatMap((id) => {
      const audit = recordOrUndefined(audits[id]);
      return audit === undefined ? [] : evidenceForLighthouseAudit(id, audit);
    })
    .map((item, index) => ({ index, item }))
    .sort(
      (left, right) =>
        compareStableStrings(
          `${left.item.rule}\0${left.item.measuredValue}`,
          `${right.item.rule}\0${right.item.measuredValue}`,
        ) || left.index - right.index,
    )
    .map(({ item }) => item);

  return evidence.length === 0 ? [] : [{ tool: LIGHTHOUSE_GROUNDING_ID, evidence }];
}

export function createJsxA11yGroundingTool(options: JsxA11yGroundingOptions): JsxA11yGroundingTool {
  const sources = [...options.sources];

  return {
    id: JSX_A11Y_GROUNDING_ID,
    run: (): Promise<Result<ToolResult[], SurfaceError>> => runJsxA11yStaticPass(sources),
  };
}

async function runLighthouseCapture(
  capture: Capture,
  options: LighthouseGroundingOptions,
): Promise<LighthouseRunnerResult | undefined> {
  const url = lighthouseUrlForCapture(capture);
  if (url === undefined) {
    throw new Error("Lighthouse grounding requires an HTTP(S) URL or localhost capture target.");
  }

  const module = await (options.importLighthouse ?? defaultImportLighthouse)();
  const lighthouse = module.default ?? module.lighthouse;
  if (typeof lighthouse !== "function") {
    throw new Error("lighthouse module did not expose a callable runner.");
  }

  const chromeLauncher = await (options.importChromeLauncher ?? defaultImportChromeLauncher)();
  if (typeof chromeLauncher.launch !== "function") {
    throw new Error("chrome-launcher module did not expose a launch function.");
  }

  const chrome = await chromeLauncher.launch(options.chromeLaunchOptions);
  try {
    return await lighthouse(url, { ...options.lighthouseOptions, port: chrome.port });
  } finally {
    await killChromeSafely(chrome);
  }
}

async function defaultImportLighthouse(): Promise<LighthouseModule> {
  return (await importOptionalModule("lighthouse")) as LighthouseModule;
}

async function defaultImportChromeLauncher(): Promise<ChromeLauncherModule> {
  return (await importOptionalModule("chrome-launcher")) as ChromeLauncherModule;
}

async function importOptionalModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

async function killChromeSafely(chrome: ChromeInstance): Promise<void> {
  try {
    await chrome.kill();
  } catch {
    // Do not discard a successful Lighthouse result because best-effort cleanup failed.
  }
}

function lighthouseUrlForCapture(capture: Capture): string | undefined {
  if (capture.target.kind === "url") {
    return HTTP_URL_SCHEME_PATTERN.test(capture.target.ref) ? capture.target.ref : undefined;
  }

  if (capture.target.kind === "localhost") {
    return HTTP_URL_SCHEME_PATTERN.test(capture.target.ref)
      ? capture.target.ref
      : `http://${capture.target.ref}`;
  }

  return undefined;
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

function evidenceForLighthouseAudit(
  id: string,
  audit: Readonly<Record<string, unknown>>,
): ToolResult["evidence"] {
  const score = lighthouseAuditScore(audit);
  if (score === undefined || score >= 1) {
    return [];
  }

  const measured = lighthouseAuditMeasuredValue(id, audit, score);

  return lighthouseAuditAnchors(id, audit).map((anchor) => ({
    kind: "tool-result" as const,
    tool: LIGHTHOUSE_GROUNDING_ID,
    rule: id,
    measuredValue: `${anchor}: ${measured}`,
    threshold: LIGHTHOUSE_AUDIT_THRESHOLD,
  }));
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

function lighthouseAuditIds(lhr: LighthouseResult): readonly string[] {
  const categories = recordOrUndefined(lhr.categories);
  const fromCategories =
    categories === undefined
      ? []
      : LIGHTHOUSE_GROUNDING_CATEGORIES.flatMap((categoryId) => {
          const category = recordOrUndefined(categories[categoryId]);
          const auditRefs = arrayOrEmpty(category?.["auditRefs"]);

          return auditRefs
            .map((auditRef) => stringOrUndefined(recordOrUndefined(auditRef)?.["id"]))
            .filter(isString);
        });

  if (fromCategories.length > 0) {
    return uniqueStrings(fromCategories);
  }

  return Object.keys(recordOrUndefined(lhr.audits) ?? {});
}

function lighthouseAuditScore(audit: Readonly<Record<string, unknown>>): number | undefined {
  const score = audit["score"];

  return typeof score === "number" && Number.isFinite(score) ? score : undefined;
}

function lighthouseAuditAnchors(id: string, audit: Readonly<Record<string, unknown>>): string[] {
  const details = recordOrUndefined(audit["details"]);
  const items = arrayOrEmpty(details?.["items"]);
  const selectors = items.map(anchorForLighthouseDetailItem).filter(isNonEmptyString);

  return selectors.length === 0 ? [id] : uniqueStrings(selectors);
}

function anchorForLighthouseDetailItem(item: unknown): string | undefined {
  const itemRecord = recordOrUndefined(item);
  const node = recordOrUndefined(itemRecord?.["node"]) ?? itemRecord;

  return (
    stringOrUndefined(node?.["selector"]) ??
    stringOrUndefined(node?.["path"]) ??
    stringOrUndefined(node?.["snippet"]) ??
    stringOrUndefined(node?.["nodeLabel"]) ??
    rectAnchor(recordOrUndefined(node?.["boundingRect"]))
  );
}

function rectAnchor(rect: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (rect === undefined) {
    return undefined;
  }

  const x = finiteNumberOrUndefined(rect["left"] ?? rect["x"]);
  const y = finiteNumberOrUndefined(rect["top"] ?? rect["y"]);
  const width = finiteNumberOrUndefined(rect["width"]);
  const height = finiteNumberOrUndefined(rect["height"]);

  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : `rect(${formatLighthouseScore(x)},${formatLighthouseScore(y)} ${formatLighthouseScore(width)}x${formatLighthouseScore(height)})`;
}

function lighthouseAuditMeasuredValue(
  id: string,
  audit: Readonly<Record<string, unknown>>,
  score: number,
): string {
  const display =
    stringOrUndefined(audit["displayValue"]) ?? stringOrUndefined(audit["title"]) ?? id;

  return `${normalizeWhitespace(display)} (score ${formatLighthouseScore(score)})`;
}

function formatLighthouseScore(score: number): string {
  return Number.isInteger(score)
    ? String(score)
    : score.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

function recordOrUndefined(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined;
}

function arrayOrEmpty(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
