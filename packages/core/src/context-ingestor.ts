import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import { FindingDraftSchema, type FindingDraft } from "./findings.js";
import type { ComponentMap, FrameworkAdapter, SourceFileRef, Target } from "./interfaces.js";

const CSS_SCAN_MAX_BYTES = 256_000;
const CSS_CONTRADICTION_TOOL = "context-ingestor";
const CSS_TOKEN_CONTRADICTION_RULE = "css-custom-property-contradiction";
const TEXT_INPUT_MAX_BYTES = 2 * 1024 * 1024;
const staticCaptureRefs = new WeakMap<SourceFileRef, string>();

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

const TextInputSchema = z
  .object({
    path: nonEmptyStringSchema.optional(),
    contents: z.string().optional(),
  })
  .strict()
  .refine((input) => input.path !== undefined || input.contents !== undefined, {
    message: "text input requires path or contents",
  });
export type TextInput = z.infer<typeof TextInputSchema>;

const DesignTokenSchema = z
  .object({
    name: nonEmptyStringSchema,
    value: nonEmptyStringSchema,
  })
  .strict();
export type DesignToken = z.infer<typeof DesignTokenSchema>;

const PersonaSchema = z
  .object({
    goals: z.array(nonEmptyStringSchema).default([]),
    id: nonEmptyStringSchema,
    priorKnowledge: z.enum(["first-time", "returning", "expert"]).default("first-time"),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;

const TaskDefinitionSchema = z
  .object({
    conversionCritical: z.boolean().default(false),
    id: nonEmptyStringSchema,
    personaId: nonEmptyStringSchema.optional(),
    steps: z.array(nonEmptyStringSchema).default([]),
  })
  .strict();
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

const ContextIngestionInputSchema = z
  .object({
    component: nonEmptyStringSchema.optional(),
    designTokens: z.array(DesignTokenSchema).default([]),
    dom: TextInputSchema.optional(),
    personas: z.array(PersonaSchema).default([]),
    scaffoldDocs: z.array(TextInputSchema).default([]),
    screenshot: TextInputSchema.optional(),
    source: TextInputSchema.optional(),
    sources: z.array(TextInputSchema).default([]),
    tasks: z.array(TaskDefinitionSchema).default([]),
    tokenDocuments: z.array(TextInputSchema).default([]),
  })
  .strict();
export type ContextIngestionInput = z.input<typeof ContextIngestionInputSchema>;

export type ContextInputKind =
  | "component"
  | "source"
  | "dom"
  | "screenshot"
  | "design-tokens"
  | "scaffold-docs"
  | "persona"
  | "task";

export interface InputProvenance {
  readonly kind: ContextInputKind;
  readonly ref: string;
  readonly present: true;
  readonly recordedAt: string;
  readonly sha256?: string;
}

export interface IngestedContext {
  readonly designTokens: readonly DesignToken[];
  readonly dom?: SourceFileRef;
  readonly personas: readonly Persona[];
  readonly scaffoldDocs: readonly SourceFileRef[];
  readonly screenshot?: SourceFileRef;
  readonly sources: readonly SourceFileRef[];
  readonly tasks: readonly TaskDefinition[];
}

export interface ContextIngestion {
  readonly componentMap: ComponentMap;
  readonly context: IngestedContext;
  readonly findings: readonly FindingDraft[];
  readonly provenance: readonly InputProvenance[];
  readonly target: Target;
}

export type ContextIngestorClock = () => string;

export interface ContextIngestorOptions {
  readonly adapters?: readonly FrameworkAdapter[];
  readonly clock?: ContextIngestorClock;
  readonly projectRoot?: string;
}

export interface ContextIngestor {
  ingest(input: ContextIngestionInput): Promise<Result<ContextIngestion, SurfaceError>>;
}

interface CssCustomProperty {
  readonly name: string;
  readonly value: string;
  readonly selector: string;
  readonly elementRef: string;
}

class ContextInputError extends Error {
  readonly surfaceError: SurfaceError;

  constructor(surfaceError: SurfaceError) {
    super(surfaceError.message);
    this.name = "ContextInputError";
    this.surfaceError = surfaceError;
  }
}

/**
 * Creates a static/context ingestion service that constructs a stable Target and provenance.
 */
export function createContextIngestor(options: ContextIngestorOptions = {}): ContextIngestor {
  const adapters = options.adapters ?? [];
  const clock = options.clock ?? (() => new Date().toISOString());
  const projectRoot = options.projectRoot ?? process.cwd();

  return {
    async ingest(rawInput) {
      const parsed = ContextIngestionInputSchema.safeParse(rawInput);

      if (!parsed.success) {
        return err(
          createSurfaceError("config_invalid", "Context ingestion input is invalid.", {
            details: { issues: parsed.error.issues },
          }),
        );
      }

      try {
        const normalized = parsed.data;
        const loadedSourceInputs = prependOptional(normalized.source, normalized.sources);
        const sources = await Promise.all(
          loadedSourceInputs.map((source) =>
            loadSourceFile(source, projectRoot, { materializeInline: true }),
          ),
        );
        const dom = await loadOptionalSourceFile(normalized.dom, projectRoot, {
          materializeInline: true,
          materializationPrefix: "dom",
        });
        const screenshot = await loadOptionalScreenshotFile(normalized.screenshot, projectRoot);
        const scaffoldDocs = await Promise.all(
          normalized.scaffoldDocs.map((document) => loadSourceFile(document, projectRoot)),
        );
        const tokenDocuments = await Promise.all(
          normalized.tokenDocuments.map((document) => loadSourceFile(document, projectRoot)),
        );
        const tokenDocumentTokensResult = designTokensFromDocuments(tokenDocuments);

        if (!tokenDocumentTokensResult.ok) {
          return tokenDocumentTokensResult;
        }

        const tokenDocumentTokens = tokenDocumentTokensResult.value;
        const taskPersonaValidationResult = validateTaskPersonas(
          normalized.personas,
          normalized.tasks,
        );

        if (!taskPersonaValidationResult.ok) {
          return taskPersonaValidationResult;
        }

        const designTokensResult = normalizeDesignTokens([
          ...normalized.designTokens,
          ...tokenDocumentTokens,
        ]);

        if (!designTokensResult.ok) {
          return designTokensResult;
        }

        const designTokens = designTokensResult.value;
        const target = constructTarget(normalized.component, dom, screenshot, sources);

        if (target === undefined) {
          return err(
            createSurfaceError(
              "no_target",
              "Context ingestion requires component, dom, screenshot, or source input.",
              {
                details: {
                  next: "Provide component, dom, screenshot, or source input before running audit.",
                },
              },
            ),
          );
        }

        const componentMapResult = await buildComponentMap(normalized.component, sources, adapters);

        if (!componentMapResult.ok) {
          return componentMapResult;
        }

        const context = contextWithOptionals({
          designTokens,
          dom,
          personas: normalized.personas,
          scaffoldDocs,
          screenshot,
          sources,
          tasks: normalized.tasks,
        });

        return ok({
          componentMap: componentMapResult.value,
          context,
          findings: tokenContradictionFindings(designTokens, dom, sources),
          provenance: provenanceFor(
            normalized,
            sources,
            dom,
            screenshot,
            scaffoldDocs,
            tokenDocuments,
            designTokens,
            clock,
          ),
          target,
        });
      } catch (cause) {
        if (isContextInputError(cause)) {
          return err(cause.surfaceError);
        }

        return err(
          createSurfaceError("step_failed", "Context ingestion failed.", {
            cause,
          }),
        );
      }
    },
  };
}

function prependOptional<T>(first: T | undefined, rest: readonly T[]): readonly T[] {
  return first === undefined ? rest : [first, ...rest];
}

async function loadOptionalSourceFile(
  input: TextInput | undefined,
  projectRoot: string,
  options: { readonly materializationPrefix?: string; readonly materializeInline?: boolean } = {},
): Promise<SourceFileRef | undefined> {
  if (input === undefined) {
    return undefined;
  }

  return loadSourceFile(input, projectRoot, options);
}

async function loadOptionalScreenshotFile(
  input: TextInput | undefined,
  projectRoot: string,
): Promise<SourceFileRef | undefined> {
  if (input === undefined) {
    return undefined;
  }

  return loadScreenshotFile(input, projectRoot);
}

async function loadSourceFile(
  input: TextInput,
  projectRoot: string,
  options: { readonly materializationPrefix?: string; readonly materializeInline?: boolean } = {},
): Promise<SourceFileRef> {
  const path = input.path === undefined ? undefined : normalizeTextInputPath(input.path);
  const loaded =
    input.contents === undefined
      ? await readTextInputPath(path ?? "", projectRoot)
      : { contents: input.contents, resolvedPath: undefined };
  const contents = loaded.contents;

  if (input.contents !== undefined) {
    assertTextInputSize(contents, path);
  }

  const source = { contents, path: path ?? `inline:${sha256(contents).slice(0, 12)}` };

  if (loaded.resolvedPath !== undefined) {
    staticCaptureRefs.set(source, loaded.resolvedPath);
  } else if (options.materializeInline === true) {
    staticCaptureRefs.set(
      source,
      await materializeInlineTextInput(
        contents,
        projectRoot,
        options.materializationPrefix ?? "source",
        path,
      ),
    );
  }

  return source;
}

async function loadScreenshotFile(input: TextInput, projectRoot: string): Promise<SourceFileRef> {
  const path = input.path === undefined ? undefined : normalizeTextInputPath(input.path);

  if (input.contents !== undefined) {
    assertTextInputSize(input.contents, path);

    const materializedPath = await materializeInlineScreenshot(input.contents, projectRoot);

    return {
      contents: input.contents,
      path: materializedPath,
    };
  }

  if (path !== undefined) {
    const resolvedPath = await resolveInputPathInsideProject(path, projectRoot);

    return { contents: "", path: resolvedPath };
  }

  return { contents: "", path: path ?? `inline:${sha256("").slice(0, 12)}` };
}

async function materializeInlineScreenshot(
  contents: string,
  projectRootPath: string,
): Promise<string> {
  return materializeContextInputBuffer(
    inlineScreenshotContentsToBuffer(contents),
    projectRootPath,
    `screenshot-${sha256(contents).slice(0, 12)}.png`,
  );
}

async function materializeInlineTextInput(
  contents: string,
  projectRootPath: string,
  prefix: string,
  path: string | undefined,
): Promise<string> {
  const extension = textInputMaterializationExtension(path);

  return materializeContextInputBuffer(
    Buffer.from(contents, "utf8"),
    projectRootPath,
    `${prefix}-${sha256(contents).slice(0, 12)}${extension}`,
  );
}

async function materializeContextInputBuffer(
  contents: Buffer,
  projectRootPath: string,
  fileName: string,
): Promise<string> {
  const projectRoot = await realpath(projectRootPath);
  const outputRoot = resolve(projectRoot, ".surface", "context-inputs");
  await mkdir(outputRoot, { recursive: true });

  const realOutputRoot = await realpath(outputRoot);

  if (!isPathInsideOrSame(realOutputRoot, projectRoot)) {
    throw new ContextInputError(relativePathSurfaceError(outputRoot));
  }

  const outputPath = resolve(realOutputRoot, fileName);

  if (!isPathInsideOrSame(outputPath, projectRoot)) {
    throw new ContextInputError(relativePathSurfaceError(outputPath));
  }

  try {
    await writeFile(outputPath, contents, { flag: "wx" });
  } catch (cause) {
    if (!isFileSystemError(cause, "EEXIST")) {
      throw cause;
    }

    const existingRealPath = await realpath(outputPath).catch(() => undefined);
    const existingStats = await lstat(outputPath).catch(() => undefined);

    if (
      existingRealPath === undefined ||
      existingStats === undefined ||
      existingStats.isSymbolicLink() ||
      !existingStats.isFile() ||
      !isPathInsideOrSame(existingRealPath, projectRoot)
    ) {
      throw new ContextInputError(relativePathSurfaceError(outputPath));
    }

    const existingContents = await readFile(existingRealPath);

    if (!existingContents.equals(contents)) {
      throw new ContextInputError(
        createSurfaceError("config_invalid", "Context input materialized file already exists.", {
          details: { path: outputPath },
        }),
      );
    }
  }

  return outputPath;
}

function textInputMaterializationExtension(path: string | undefined): string {
  if (path === undefined) {
    return ".html";
  }

  const dotIndex = path.lastIndexOf(".");

  if (dotIndex === -1 || dotIndex === path.length - 1 || path.slice(dotIndex).includes(sep)) {
    return ".html";
  }

  return path.slice(dotIndex);
}

function inlineScreenshotContentsToBuffer(contents: string): Buffer {
  const trimmed = contents.trim();
  const dataUrlMatch = /^data:image\/png;base64,(?<base64>[A-Za-z0-9+/=\s]+)$/u.exec(trimmed);

  if (dataUrlMatch?.groups?.base64 !== undefined) {
    return Buffer.from(dataUrlMatch.groups.base64.replace(/\s+/gu, ""), "base64");
  }

  const compact = trimmed.replace(/\s+/gu, "");

  if (compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
    return Buffer.from(compact, "base64");
  }

  return Buffer.from(contents, "utf8");
}

async function readTextInputPath(
  path: string,
  projectRoot: string,
): Promise<{ readonly contents: string; readonly resolvedPath: string }> {
  const normalizedPath = normalizeTextInputPath(path);

  try {
    const resolvedPath = await resolveInputPathInsideProject(normalizedPath, projectRoot);
    const stats = await stat(resolvedPath);

    if (stats.size > TEXT_INPUT_MAX_BYTES) {
      throw new ContextInputError(oversizedTextInputSurfaceError(path));
    }

    const contents = await readFile(resolvedPath, "utf8");

    return { contents, resolvedPath };
  } catch (cause) {
    if (isContextInputError(cause)) {
      throw cause;
    }

    throw new ContextInputError(
      createSurfaceError("config_invalid", "Context input file could not be read.", {
        cause,
        details: { path },
      }),
    );
  }
}

async function resolveInputPathInsideProject(
  path: string,
  projectRootPath: string,
): Promise<string> {
  try {
    const projectRoot = await realpath(projectRootPath);
    const resolvedPath = await realpath(resolve(projectRoot, path));

    if (!isPathInsideOrSame(resolvedPath, projectRoot)) {
      throw new ContextInputError(relativePathSurfaceError(path));
    }

    return resolvedPath;
  } catch (cause) {
    if (isContextInputError(cause)) {
      throw cause;
    }

    throw new ContextInputError(unreadableTextInputSurfaceError(path, cause));
  }
}

function normalizeTextInputPath(path: string): string {
  const normalizedPath = normalize(path);

  if (
    path.trim().length === 0 ||
    isAbsolute(normalizedPath) ||
    normalizedPath === ".." ||
    normalizedPath.startsWith(`..${sep}`)
  ) {
    throw new ContextInputError(relativePathSurfaceError(path));
  }

  return normalizedPath;
}

function assertTextInputSize(contents: string, path: string | undefined): void {
  if (Buffer.byteLength(contents, "utf8") <= TEXT_INPUT_MAX_BYTES) {
    return;
  }

  throw new ContextInputError(oversizedTextInputSurfaceError(path));
}

function relativePathSurfaceError(path: string): SurfaceError {
  return createSurfaceError(
    "config_invalid",
    "Context input paths must be relative paths inside the project.",
    {
      details: { path },
    },
  );
}

function oversizedTextInputSurfaceError(path: string | undefined): SurfaceError {
  return createSurfaceError("config_invalid", "Context input file is too large.", {
    details: {
      maxBytes: TEXT_INPUT_MAX_BYTES,
      ...(path !== undefined ? { path } : {}),
    },
  });
}

function unreadableTextInputSurfaceError(path: string, cause: unknown): SurfaceError {
  return createSurfaceError("config_invalid", "Context input file could not be read.", {
    cause,
    details: { path },
  });
}

function isPathInsideOrSame(path: string, root: string): boolean {
  const relativePath = relative(root, path);

  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

function designTokensFromDocuments(
  documents: readonly SourceFileRef[],
): Result<readonly DesignToken[], SurfaceError> {
  const tokens: DesignToken[] = [];

  for (const document of documents) {
    const result = designTokensFromDocument(document);

    if (!result.ok) {
      return result;
    }

    tokens.push(...result.value);
  }

  return ok(tokens);
}

function designTokensFromDocument(
  document: SourceFileRef,
): Result<readonly DesignToken[], SurfaceError> {
  try {
    const parsed = JSON.parse(document.contents) as unknown;
    const records = flattenTokenDocument(parsed);

    return ok(records.map(([name, value]) => DesignTokenSchema.parse({ name, value })));
  } catch (cause) {
    return err(
      createSurfaceError(
        "config_invalid",
        "Design token document must be valid JSON with string or numeric token values.",
        {
          cause,
          details: { path: document.path },
        },
      ),
    );
  }
}

function flattenTokenDocument(value: unknown, prefix = ""): readonly [string, string][] {
  if (typeof value === "string" || typeof value === "number") {
    return prefix.length === 0 ? [] : [[prefix, String(value)]];
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const entries: Array<[string, string]> = [];

  for (const [key, nestedValue] of Object.entries(value)) {
    const name = prefix.length === 0 ? key : `${prefix}.${key}`;

    entries.push(...flattenTokenDocument(nestedValue, name));
  }

  return entries;
}

function validateTaskPersonas(
  personas: readonly Persona[],
  tasks: readonly TaskDefinition[],
): Result<void, SurfaceError> {
  const personaIds = new Set(personas.map((persona) => persona.id));
  const unknownPersonaId = tasks.find(
    (task) => task.personaId !== undefined && !personaIds.has(task.personaId),
  )?.personaId;

  if (unknownPersonaId === undefined) {
    return ok(undefined);
  }

  return err(
    createSurfaceError("config_invalid", "Task personaId must match a supplied persona.", {
      details: { personaId: unknownPersonaId },
    }),
  );
}

function normalizeDesignTokens(
  tokens: readonly DesignToken[],
): Result<readonly DesignToken[], SurfaceError> {
  const tokensByName = new Map<string, DesignToken>();

  for (const token of tokens) {
    const existing = tokensByName.get(token.name);

    if (existing === undefined) {
      tokensByName.set(token.name, token);
      continue;
    }

    if (existing.value !== token.value) {
      return err(
        createSurfaceError(
          "config_invalid",
          "Design token values conflict for the same token name.",
          {
            details: {
              existingValue: existing.value,
              name: token.name,
              value: token.value,
            },
          },
        ),
      );
    }
  }

  return ok([...tokensByName.values()]);
}

function constructTarget(
  component: string | undefined,
  dom: SourceFileRef | undefined,
  screenshot: SourceFileRef | undefined,
  sources: readonly SourceFileRef[],
): Target | undefined {
  if (screenshot !== undefined) {
    return { kind: "screenshot", ref: screenshot.path };
  }

  if (dom !== undefined) {
    return { kind: "dom", ref: staticCaptureRefFor(dom) };
  }

  const firstSource = sources[0];

  if (firstSource !== undefined) {
    return { kind: "component", ref: staticCaptureRefFor(firstSource) };
  }

  if (component !== undefined) {
    return { kind: "component", ref: component };
  }

  return undefined;
}

function staticCaptureRefFor(source: SourceFileRef): string {
  return staticCaptureRefs.get(source) ?? source.path;
}

async function buildComponentMap(
  component: string | undefined,
  sources: readonly SourceFileRef[],
  adapters: readonly FrameworkAdapter[],
): Promise<Result<ComponentMap, SurfaceError>> {
  const entries = [];

  for (const source of sources) {
    const adapter = adapters.find((candidate) => candidate.supports(source.path));
    const result =
      adapter === undefined
        ? fallbackComponentMap(source, component)
        : await adapter.introspect(source);

    if (!result.ok) {
      return result;
    }

    entries.push(...result.value.entries);
  }

  return ok({ entries });
}

function fallbackComponentMap(
  source: SourceFileRef,
  component: string | undefined,
): Result<ComponentMap, SurfaceError> {
  if (component === undefined) {
    return ok({ entries: [] });
  }

  const selector = selectorForComponent(source.contents, component);

  return ok({
    entries: [
      {
        component,
        file: source.path,
        selectors: selector === undefined ? [] : [selector],
      },
    ],
  });
}

function selectorForComponent(contents: string, component: string): string | undefined {
  const attributePattern = /\b(data-component|data-surface-component)=["']([^"']*)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(contents)) !== null) {
    const attribute = match[1];
    const value = match[2];

    if (attribute !== undefined && value === component) {
      return `[${attribute}="${escapeCssString(value)}"]`;
    }
  }

  return undefined;
}

function contextWithOptionals(input: {
  readonly designTokens: readonly DesignToken[];
  readonly dom: SourceFileRef | undefined;
  readonly personas: readonly Persona[];
  readonly scaffoldDocs: readonly SourceFileRef[];
  readonly screenshot: SourceFileRef | undefined;
  readonly sources: readonly SourceFileRef[];
  readonly tasks: readonly TaskDefinition[];
}): IngestedContext {
  return {
    designTokens: input.designTokens,
    ...(input.dom !== undefined ? { dom: input.dom } : {}),
    personas: input.personas,
    scaffoldDocs: input.scaffoldDocs,
    ...(input.screenshot !== undefined ? { screenshot: input.screenshot } : {}),
    sources: input.sources,
    tasks: input.tasks,
  };
}

function provenanceFor(
  input: z.infer<typeof ContextIngestionInputSchema>,
  sources: readonly SourceFileRef[],
  dom: SourceFileRef | undefined,
  screenshot: SourceFileRef | undefined,
  scaffoldDocs: readonly SourceFileRef[],
  tokenDocuments: readonly SourceFileRef[],
  designTokens: readonly DesignToken[],
  clock: ContextIngestorClock,
): readonly InputProvenance[] {
  const recordedAt = clock();
  const entries: InputProvenance[] = [];

  if (input.component !== undefined) {
    entries.push(provenanceEntry("component", input.component, recordedAt));
  }

  entries.push(...sources.map((source) => sourceProvenanceEntry("source", source, recordedAt)));

  if (dom !== undefined) {
    entries.push(sourceProvenanceEntry("dom", dom, recordedAt));
  }

  if (screenshot !== undefined) {
    entries.push(screenshotProvenanceEntry(screenshot, recordedAt));
  }

  if (designTokens.length > 0) {
    const canonicalTokens = canonicalDesignTokens(designTokens);

    entries.push(
      provenanceEntry(
        "design-tokens",
        canonicalTokens.map((token) => token.name).join(","),
        recordedAt,
        sha256(JSON.stringify(canonicalTokens)),
      ),
    );
  }

  entries.push(
    ...scaffoldDocs.map((document) => sourceProvenanceEntry("scaffold-docs", document, recordedAt)),
  );
  entries.push(
    ...tokenDocuments.map((document) =>
      sourceProvenanceEntry("design-tokens", document, recordedAt),
    ),
  );
  entries.push(
    ...input.personas.map((persona) => provenanceEntry("persona", persona.id, recordedAt)),
  );
  entries.push(...input.tasks.map((task) => provenanceEntry("task", task.id, recordedAt)));

  return entries;
}

function sourceProvenanceEntry(
  kind: ContextInputKind,
  source: SourceFileRef,
  recordedAt: string,
): InputProvenance {
  return provenanceEntry(kind, source.path, recordedAt, sha256(source.contents));
}

function screenshotProvenanceEntry(screenshot: SourceFileRef, recordedAt: string): InputProvenance {
  return provenanceEntry(
    "screenshot",
    screenshot.path,
    recordedAt,
    screenshot.contents.length > 0 ? sha256(screenshot.contents) : undefined,
  );
}

function provenanceEntry(
  kind: ContextInputKind,
  ref: string,
  recordedAt: string,
  sha?: string,
): InputProvenance {
  return {
    kind,
    present: true,
    recordedAt,
    ref,
    ...(sha !== undefined ? { sha256: sha } : {}),
  };
}

function tokenContradictionFindings(
  tokens: readonly DesignToken[],
  dom: SourceFileRef | undefined,
  sources: readonly SourceFileRef[],
): readonly FindingDraft[] {
  const htmlSources = prependOptional(dom, sources.filter(isStyleBearingSource));
  const properties = new Map<string, CssCustomProperty[]>();

  for (const source of htmlSources) {
    for (const property of cssCustomProperties(source)) {
      const existing = properties.get(property.name) ?? [];

      properties.set(property.name, [...existing, property]);
    }
  }

  return tokens.flatMap((token) => {
    const propertyName = cssPropertyNameForToken(token.name);
    const property = properties
      .get(propertyName)
      ?.find((candidate) => normalizeCssValue(candidate.value) !== normalizeCssValue(token.value));

    if (property === undefined) {
      return [];
    }

    return [tokenContradictionFinding(token, property)];
  });
}

function canonicalDesignTokens(tokens: readonly DesignToken[]): readonly DesignToken[] {
  return [...tokens].sort((left, right) => {
    const nameComparison = left.name.localeCompare(right.name);

    return nameComparison === 0 ? left.value.localeCompare(right.value) : nameComparison;
  });
}

function isStyleBearingSource(source: SourceFileRef): boolean {
  const boundedContents = source.contents.slice(0, CSS_SCAN_MAX_BYTES);

  return (
    /\.(?:css|html?|xhtml)$/i.test(source.path) ||
    /<style\b[^>]*>[\s\S]*?<\/style>/i.test(boundedContents)
  );
}

function cssCustomProperties(source: SourceFileRef): readonly CssCustomProperty[] {
  const boundedContents = source.contents.slice(0, CSS_SCAN_MAX_BYTES);
  const styleBlocks = Array.from(
    boundedContents.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi),
  ).map((match) => match[1] ?? "");
  const cssSources =
    styleBlocks.length > 0 ? styleBlocks : isCssSourcePath(source.path) ? [boundedContents] : [];
  const properties: CssCustomProperty[] = [];

  for (const cssSource of cssSources) {
    const uncommentedCssSource = stripCssComments(cssSource);

    properties.push(...cssCustomPropertiesFromCss(uncommentedCssSource));
  }

  return properties;
}

// This measured-tool scanner intentionally supports only CSS custom-property
// declarations in .css files and <style> blocks. Selectors are best-effort
// source context for evidence, not a complete CSS source-location model.
function isCssSourcePath(path: string): boolean {
  return /\.css$/i.test(path);
}

function stripCssComments(cssSource: string): string {
  let stripped = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let index = 0; index < cssSource.length; index += 1) {
    const character = cssSource[index];
    const nextCharacter = cssSource[index + 1];

    if (character === undefined) {
      break;
    }

    if (quote !== undefined) {
      stripped += character;

      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      stripped += character;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const commentEnd = cssSource.indexOf("*/", index + 2);

      if (commentEnd === -1) {
        break;
      }

      index = commentEnd + 1;
      continue;
    }

    stripped += character;
  }

  return stripped;
}

function cssCustomPropertiesFromCss(cssSource: string): readonly CssCustomProperty[] {
  const properties: CssCustomProperty[] = [];
  const propertyPattern = /(--[A-Za-z0-9_-]+)\s*:/g;
  let match: RegExpExecArray | null;

  while ((match = propertyPattern.exec(cssSource)) !== null) {
    const name = match[1];
    const valueStart = propertyPattern.lastIndex;

    if (name === undefined) {
      continue;
    }

    if (!isCssDeclarationName(cssSource, match.index)) {
      continue;
    }

    const { end, value } = readCssDeclarationValue(cssSource, valueStart);
    propertyPattern.lastIndex = end;

    if (value.length === 0) {
      continue;
    }

    properties.push({
      elementRef: `CSS custom property ${name}`,
      name,
      selector: selectorBeforeDeclaration(cssSource, match.index),
      value,
    });
  }

  return properties;
}

function isCssDeclarationName(cssSource: string, nameIndex: number): boolean {
  const state = cssStateAt(cssSource, nameIndex);

  if (state.quote !== undefined || state.parenthesisDepth > 0) {
    return false;
  }

  const previous = previousNonWhitespace(cssSource, nameIndex - 1);

  return (
    previous === undefined ||
    previous === "{" ||
    previous === "}" ||
    previous === ";" ||
    previous === "\n"
  );
}

function cssStateAt(
  cssSource: string,
  end: number,
): { readonly parenthesisDepth: number; readonly quote: '"' | "'" | undefined } {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let parenthesisDepth = 0;

  for (let index = 0; index < Math.min(end, cssSource.length); index += 1) {
    const character = cssSource[index];

    if (character === undefined) {
      break;
    }

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "(") {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    }
  }

  return { parenthesisDepth, quote };
}

function previousNonWhitespace(cssSource: string, start: number): string | undefined {
  for (let index = start; index >= 0; index -= 1) {
    const character = cssSource[index];

    if (character === undefined) {
      return undefined;
    }

    if (character !== " " && character !== "\t" && character !== "\r") {
      return character;
    }
  }

  return undefined;
}

function readCssDeclarationValue(
  cssSource: string,
  start: number,
): { readonly end: number; readonly value: string } {
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let parenthesisDepth = 0;
  let end = start;

  for (let index = start; index < cssSource.length; index += 1) {
    const character = cssSource[index];

    if (character === undefined) {
      break;
    }

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }

      end = index + 1;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      end = index + 1;
      continue;
    }

    if (character === "(") {
      parenthesisDepth += 1;
      end = index + 1;
      continue;
    }

    if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
      end = index + 1;
      continue;
    }

    if (parenthesisDepth === 0 && (character === ";" || character === "}")) {
      break;
    }

    end = index + 1;
  }

  return {
    end,
    value: cssSource
      .slice(start, end)
      .trim()
      .replace(/\s*!important\s*$/i, ""),
  };
}

function selectorBeforeDeclaration(cssSource: string, declarationIndex: number): string {
  const bracePositions = structuralCssBracePositions(cssSource, declarationIndex);
  const openingBrace = bracePositions.findLast((position) => position.character === "{");

  if (openingBrace === undefined) {
    return ":root";
  }

  const boundary = bracePositions.findLast((position) => position.index < openingBrace.index);
  const selector = cssSource.slice((boundary?.index ?? -1) + 1, openingBrace.index).trim();

  if (selector.length === 0 || selector.startsWith("@")) {
    return ":root";
  }

  return selector;
}

function structuralCssBracePositions(
  cssSource: string,
  end: number,
): Array<{ readonly character: "{" | "}"; readonly index: number }> {
  const positions: Array<{ readonly character: "{" | "}"; readonly index: number }> = [];
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let parenthesisDepth = 0;

  for (let index = 0; index < Math.min(end, cssSource.length); index += 1) {
    const character = cssSource[index];

    if (character === undefined) {
      break;
    }

    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === "(") {
      parenthesisDepth += 1;
      continue;
    }

    if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
      continue;
    }

    if (parenthesisDepth === 0 && (character === "{" || character === "}")) {
      positions.push({ character, index });
    }
  }

  return positions;
}

function isContextInputError(value: unknown): value is ContextInputError {
  return value instanceof ContextInputError;
}

function isFileSystemError(cause: unknown, code: string): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;
}

function tokenContradictionFinding(token: DesignToken, property: CssCustomProperty): FindingDraft {
  return FindingDraftSchema.parse({
    citedHeuristics: [],
    draftId: `context-token:${sanitizeId(token.name)}:${sha256(`${property.value}\0${token.value}`).slice(0, 8)}`,
    evidence: [
      {
        kind: "tool-result",
        measuredValue: property.value,
        rule: CSS_TOKEN_CONTRADICTION_RULE,
        threshold: token.value,
        tool: CSS_CONTRADICTION_TOOL,
      },
      {
        elementRef: property.elementRef,
        kind: "dom",
        selector: property.selector,
      },
    ],
    issueType: "design-token-contradiction",
    lens: "context-ingestor",
    location: { elementRef: property.elementRef },
    method: "measured",
    rationale: `The built UI defines ${property.name} as ${property.value}, but the provided ${token.name} design token is ${token.value}. surface treats built-UI contradictions of provided design-system tokens as findings.`,
    rawDimensions: {
      confidence: 0.85,
      effort: 0.4,
      evidenceQuality: 1,
      severity: 0.76,
    },
    title: `Built UI contradicts ${token.name} design token`,
  });
}

function cssPropertyNameForToken(name: string): string {
  return `--${name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "")}`;
}

function normalizeCssValue(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.length === 0 ? "token" : sanitized;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
