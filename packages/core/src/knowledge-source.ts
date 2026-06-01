import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import { z } from "zod";

import { AppTypeSchema, type AppType } from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { nonEmptyTrimmedStringSchema } from "./schemas.js";
import type {
  Citation,
  Freshness,
  FreshnessVolatility,
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeSource,
  RelevanceQuery,
} from "./interfaces.js";
import { FRESHNESS_VOLATILITIES, KNOWLEDGE_CATEGORIES } from "./interfaces.js";

const KNOWLEDGE_SECTION_NAMES = ["Summary", "Deep Guidance"] as const;

export const KnowledgeCategorySchema = z.enum([...KNOWLEDGE_CATEGORIES] satisfies readonly [
  KnowledgeCategory,
  ...KnowledgeCategory[],
]);

export const FreshnessVolatilitySchema = z.enum([...FRESHNESS_VOLATILITIES] satisfies readonly [
  FreshnessVolatility,
  ...FreshnessVolatility[],
]);

const timestampStringSchema = nonEmptyTrimmedStringSchema
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a valid date or datetime",
  })
  .transform((value) => new Date(value).toISOString());

const timestampSchema = z.preprocess((value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}, timestampStringSchema);

export const CitationSchema = z
  .object({
    source: nonEmptyTrimmedStringSchema,
    url: nonEmptyTrimmedStringSchema.optional(),
    retrievedAt: timestampSchema,
  })
  .strict();

export const FreshnessSchema = z
  .object({
    volatility: FreshnessVolatilitySchema,
    lastReviewed: timestampSchema,
  })
  .strict();

const stringListSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(nonEmptyTrimmedStringSchema),
  )
  .transform((values) => [...new Set(values)]);

const optionalStringListSchema = stringListSchema.optional().default([]);

const appTypeListSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? [value] : value),
    z.array(AppTypeSchema).min(1),
  )
  .transform((values) => [...new Set(values)] as AppType[]);

const rawKnowledgeFrontmatterSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    title: nonEmptyTrimmedStringSchema,
    category: KnowledgeCategorySchema,
    appliesToAppTypes: appTypeListSchema.optional(),
    appTypes: appTypeListSchema.optional(),
    appliesToLenses: stringListSchema.optional(),
    lensIds: stringListSchema.optional(),
    lenses: stringListSchema.optional(),
    steps: optionalStringListSchema,
    tags: optionalStringListSchema,
    draft: z.boolean().optional().default(false),
    citation: CitationSchema,
    freshness: FreshnessSchema,
  })
  .passthrough();

type RawKnowledgeFrontmatter = z.infer<typeof rawKnowledgeFrontmatterSchema>;

export type FileSystemKnowledgeSourceOptions = {
  readonly rootDir: string;
  readonly includeDrafts?: boolean;
};

type LoadedCatalog = {
  readonly entries: readonly LoadedKnowledgeEntry[];
  readonly byId: ReadonlyMap<string, LoadedKnowledgeEntry>;
};

type LoadedKnowledgeEntry = KnowledgeEntry & {
  readonly category: KnowledgeCategory;
  readonly deepGuidance: string;
  readonly citation: Citation;
  readonly freshness: Freshness;
  readonly appliesToAppTypes: readonly AppType[];
  readonly appliesToLenses: readonly string[];
  readonly steps: readonly string[];
  readonly tags: readonly string[];
  readonly draft: boolean;
};

type SectionExtractionResult =
  | {
      readonly ok: true;
      readonly value: { readonly summary: string; readonly deepGuidance: string };
    }
  | { readonly ok: false; readonly error: readonly string[] };

export function createFileSystemKnowledgeSource(
  options: FileSystemKnowledgeSourceOptions,
): KnowledgeSource {
  let catalogPromise: Promise<Result<LoadedCatalog, SurfaceError>> | undefined;

  const catalog = (): Promise<Result<LoadedCatalog, SurfaceError>> => {
    catalogPromise ??= loadKnowledgeCatalog(options);
    return catalogPromise.then((loaded) => {
      if (!isOk(loaded)) {
        catalogPromise = undefined;
      }

      return loaded;
    });
  };

  return {
    query: async (relevanceQuery) => {
      const loaded = await catalog();

      if (!isOk(loaded)) {
        return err(loaded.error);
      }

      return ok([...queryKnowledgeEntries(loaded.value.entries, relevanceQuery)]);
    },
    resolve: async (id) => {
      const loaded = await catalog();

      if (!isOk(loaded)) {
        return err(loaded.error);
      }

      const entry = loaded.value.byId.get(id);

      if (entry === undefined) {
        return err(
          createSurfaceError("config_invalid", "Knowledge entry could not be resolved.", {
            details: { id },
          }),
        );
      }

      return ok(entry);
    },
  };
}

export async function loadKnowledgeEntries(
  options: FileSystemKnowledgeSourceOptions,
): Promise<Result<readonly KnowledgeEntry[], SurfaceError>> {
  const catalog = await loadKnowledgeCatalog(options);

  if (!isOk(catalog)) {
    return err(catalog.error);
  }

  return ok(catalog.value.entries);
}

export function queryKnowledgeEntries(
  entries: readonly KnowledgeEntry[],
  relevanceQuery: RelevanceQuery,
): readonly KnowledgeEntry[] {
  return entries
    .map((entry) => ({ entry, score: scoreKnowledgeEntry(entry, relevanceQuery) }))
    .filter((scored) => scored.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .map((scored) => scored.entry);
}

async function loadKnowledgeCatalog(
  options: FileSystemKnowledgeSourceOptions,
): Promise<Result<LoadedCatalog, SurfaceError>> {
  const { rootDir, includeDrafts = false } = options;
  const files = await listMarkdownFiles(rootDir);

  if (!isOk(files)) {
    return err(files.error);
  }

  const loadedEntries = await Promise.all(
    files.value.map(async (filePath) => ({
      filePath,
      result: await loadKnowledgeEntry(rootDir, filePath),
    })),
  );
  const errors = loadedEntries.flatMap(({ filePath, result }) =>
    isOk(result)
      ? []
      : [
          {
            path: toSourcePath(rootDir, filePath),
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          },
        ],
  );

  if (errors.length > 0) {
    return err(
      createSurfaceError("config_invalid", "One or more knowledge entries are invalid.", {
        details: { errors },
      }),
    );
  }

  const entries: LoadedKnowledgeEntry[] = loadedEntries.flatMap(({ result }) => {
    if (!isOk(result)) {
      return [];
    }

    if (result.value.draft && !includeDrafts) {
      return [];
    }

    return [result.value];
  });
  const byId = new Map<string, LoadedKnowledgeEntry>();

  for (const entry of entries) {
    if (byId.has(entry.id)) {
      const existing = byId.get(entry.id);
      return err(
        createSurfaceError("config_invalid", "Knowledge entries must have unique ids.", {
          details: {
            id: entry.id,
            firstPath: existing?.sourcePath,
            duplicatePath: entry.sourcePath,
          },
        }),
      );
    }

    byId.set(entry.id, entry);
  }

  return ok({ entries, byId });
}

async function listMarkdownFiles(
  rootDir: string,
): Promise<Result<readonly string[], SurfaceError>> {
  const files: string[] = [];

  try {
    await walkDirectory(rootDir, files);
  } catch (cause) {
    return err(
      createSurfaceError("config_invalid", "Knowledge root could not be read.", {
        cause,
        details: { rootDir },
      }),
    );
  }

  return ok(files.sort((left, right) => left.localeCompare(right)));
}

async function walkDirectory(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      await walkDirectory(entryPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
}

async function loadKnowledgeEntry(
  rootDir: string,
  filePath: string,
): Promise<Result<LoadedKnowledgeEntry, SurfaceError>> {
  let parsed: matter.GrayMatterFile<string>;
  const sourcePath = toSourcePath(rootDir, filePath);

  try {
    parsed = matter(await readFile(filePath, "utf8"));
  } catch (cause) {
    return err(
      createSurfaceError("config_invalid", "Knowledge entry could not be parsed.", {
        cause,
        details: { path: sourcePath },
      }),
    );
  }

  const parsedData: unknown = parsed.data;
  const frontmatterData = isRecord(parsedData) ? parsedData : {};
  const categoryFromPath = categoryForPath(rootDir, filePath);
  const frontmatter = rawKnowledgeFrontmatterSchema.safeParse({
    ...frontmatterData,
    category: frontmatterData["category"] ?? categoryFromPath,
  });

  if (!frontmatter.success) {
    return err(
      createSurfaceError("config_invalid", "Knowledge entry frontmatter is invalid.", {
        details: { path: sourcePath, issues: frontmatter.error.issues },
      }),
    );
  }

  const normalizedFrontmatter = normalizeFrontmatter(frontmatter.data);

  if (normalizedFrontmatter.appliesToLenses.length === 0) {
    return err(
      createSurfaceError("config_invalid", "Knowledge entry must target at least one lens.", {
        details: { path: sourcePath },
      }),
    );
  }

  const sections = extractKnowledgeSections(parsed.content);

  if (!isOk(sections)) {
    return err(
      createSurfaceError("config_invalid", "Knowledge entry body is invalid.", {
        details: { path: sourcePath, missingSections: sections.error },
      }),
    );
  }

  return ok({
    id: normalizedFrontmatter.id,
    title: normalizedFrontmatter.title,
    category: normalizedFrontmatter.category,
    summary: sections.value.summary,
    deepGuidance: sections.value.deepGuidance,
    citation: normalizedFrontmatter.citation,
    freshness: normalizedFrontmatter.freshness,
    appliesToAppTypes: normalizedFrontmatter.appliesToAppTypes,
    appliesToLenses: normalizedFrontmatter.appliesToLenses,
    steps: normalizedFrontmatter.steps,
    tags: normalizedFrontmatter.tags,
    draft: normalizedFrontmatter.draft,
    sourcePath,
  });
}

function normalizeFrontmatter(frontmatter: RawKnowledgeFrontmatter): {
  readonly id: string;
  readonly title: string;
  readonly category: KnowledgeCategory;
  readonly citation: Citation;
  readonly freshness: Freshness;
  readonly appliesToAppTypes: readonly AppType[];
  readonly appliesToLenses: readonly string[];
  readonly steps: readonly string[];
  readonly tags: readonly string[];
  readonly draft: boolean;
} {
  return {
    id: frontmatter.id,
    title: frontmatter.title,
    category: frontmatter.category,
    citation: normalizeCitation(frontmatter.citation),
    freshness: frontmatter.freshness,
    appliesToAppTypes: frontmatter.appliesToAppTypes ?? frontmatter.appTypes ?? ["generic"],
    appliesToLenses: frontmatter.appliesToLenses ?? frontmatter.lensIds ?? frontmatter.lenses ?? [],
    steps: frontmatter.steps,
    tags: frontmatter.tags,
    draft: frontmatter.draft,
  };
}

function normalizeCitation(citation: z.infer<typeof CitationSchema>): Citation {
  return citation.url === undefined
    ? { source: citation.source, retrievedAt: citation.retrievedAt }
    : { source: citation.source, retrievedAt: citation.retrievedAt, url: citation.url };
}

function extractKnowledgeSections(content: string): SectionExtractionResult {
  const sections = new Map<string, string[]>();
  const targetHeadingPattern = /^##\s+(Summary|Deep Guidance)\s*$/i;
  const siblingHeadingPattern = /^#{1,2}\s+/;
  let activeSection: string | undefined;
  let fence: { readonly marker: "`" | "~"; readonly length: number } | undefined;

  for (const line of content.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    let isFenceLine = false;

    if (fenceMatch !== null) {
      isFenceLine = true;
      const marker = fenceMatch[1]?.[0] === "~" ? "~" : "`";
      const length = fenceMatch[1]?.length ?? 0;

      if (fence === undefined) {
        fence = { marker, length };
      } else if (marker === fence.marker && length >= fence.length) {
        fence = undefined;
      }
    }

    const headingMatch =
      fence === undefined && !isFenceLine ? line.match(targetHeadingPattern) : null;

    if (headingMatch?.[1] !== undefined) {
      activeSection = headingMatch[1].toLowerCase();

      if (sections.has(activeSection)) {
        return sectionErr([`Duplicate ${headingMatch[1]} section`]);
      }

      sections.set(activeSection, []);
      continue;
    }

    if (fence === undefined && siblingHeadingPattern.test(line)) {
      activeSection = undefined;
      continue;
    }

    if (activeSection !== undefined) {
      sections.get(activeSection)?.push(line);
    }
  }

  const summary = sections.get("summary")?.join("\n").trim();
  const deepGuidance = sections.get("deep guidance")?.join("\n").trim();
  const missingSections = KNOWLEDGE_SECTION_NAMES.filter((name) => {
    const value = sections.get(name.toLowerCase())?.join("\n").trim();
    return value === undefined || value.length === 0;
  });

  if (
    summary === undefined ||
    summary.length === 0 ||
    deepGuidance === undefined ||
    deepGuidance.length === 0 ||
    missingSections.length > 0
  ) {
    return sectionErr(missingSections);
  }

  return sectionOk({ summary, deepGuidance });
}

function sectionOk(value: {
  readonly summary: string;
  readonly deepGuidance: string;
}): SectionExtractionResult {
  return { ok: true, value };
}

function sectionErr(error: readonly string[]): SectionExtractionResult {
  return { ok: false, error };
}

function scoreKnowledgeEntry(entry: KnowledgeEntry, query: RelevanceQuery): number {
  const lensScore = (entry.appliesToLenses ?? []).includes(query.lensId) ? 4 : 0;

  if (lensScore === 0) {
    return 0;
  }

  const appTypeScore = scoreAppType(entry.appliesToAppTypes ?? ["generic"], query.appType);

  if (appTypeScore === 0) {
    return 0;
  }

  const steps = entry.steps ?? [];
  const stepScore = steps.length === 0 || steps.includes(query.step) ? 1 : 0;

  if (stepScore === 0) {
    return 0;
  }

  return lensScore + appTypeScore + stepScore;
}

function scoreAppType(entryAppTypes: readonly AppType[], queryAppType: string): number {
  const parsedQueryAppType = AppTypeSchema.safeParse(queryAppType);

  if (parsedQueryAppType.success && entryAppTypes.includes(parsedQueryAppType.data)) {
    return 3;
  }

  if (entryAppTypes.includes("generic")) {
    return 1;
  }

  return 0;
}

function categoryForPath(rootDir: string, filePath: string): KnowledgeCategory | undefined {
  const [category] = toSourcePath(rootDir, filePath).split("/");
  const parsed = KnowledgeCategorySchema.safeParse(category);
  return parsed.success ? parsed.data : undefined;
}

function toSourcePath(rootDir: string, filePath: string): string {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
