import { readFile } from "node:fs/promises";
import path from "node:path";

import { retext } from "retext";
import retextEnglish from "retext-english";
import retextEquality from "retext-equality";
import retextReadability from "retext-readability";

import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { FindingDraftSchema, type FindingDraft } from "./findings.js";
import type { CaptureArtifact, KnowledgeEntry, Lens, LensContext } from "./interfaces.js";

export type ContentMicrocopyLensOptions = {
  readonly maxReadingGrade?: number;
  readonly minWords?: number;
  readonly projectRoot?: string;
};

type RetextMessage = {
  readonly reason: string;
  readonly ruleId?: string | null;
  readonly source?: string | null;
  readonly line?: number | null;
  readonly column?: number | null;
};

const DEFAULT_MAX_READING_GRADE = 8;
const DEFAULT_MIN_WORDS = 5;
const CONTENT_LENS_ID = "content";

export function createContentMicrocopyLens(options: ContentMicrocopyLensOptions = {}): Lens {
  const maxReadingGrade = options.maxReadingGrade ?? DEFAULT_MAX_READING_GRADE;
  const targetAge = maxReadingGrade + 5;
  const minWords = options.minWords ?? DEFAULT_MIN_WORDS;

  return {
    id: CONTENT_LENS_ID,
    method: "judged",
    requiresLiveDom: true,
    requiresModel: false,
    evaluate: async (context) => {
      const text = await readDomText(context.capture, options.projectRoot);

      if (!isOk(text)) {
        return err(text.error);
      }

      if (text.value.length === 0) {
        return ok([]);
      }

      const knowledge = await contentKnowledge(context);

      if (!isOk(knowledge)) {
        return err(knowledge.error);
      }

      const file = await retext()
        .use(retextEnglish)
        .use(retextReadability, { age: targetAge, minWords })
        .use(retextEquality)
        .process(text.value);
      const messages = file.messages as RetextMessage[];
      const findings: FindingDraft[] = [];

      for (const [index, message] of messages.entries()) {
        const draft = FindingDraftSchema.safeParse(
          draftForRetextMessage({
            index,
            knowledgeEntry: knowledge.value,
            maxReadingGrade,
            message,
          }),
        );

        if (!draft.success) {
          return err(
            createSurfaceError("finding_draft_invalid", "Content lens emitted an invalid draft.", {
              cause: draft.error,
            }),
          );
        }

        findings.push(draft.data);
      }

      return ok(findings);
    },
  };
}

async function readDomText(
  capture: LensContext["capture"],
  projectRoot: string | undefined,
): Promise<Result<string, SurfaceError>> {
  const artifact = capture.artifacts.find((entry) => entry.type === "dom-snapshot");

  if (artifact === undefined) {
    return err(
      createSurfaceError("capture_failed", "Content lens requires a DOM snapshot artifact.", {
        details: { captureId: capture.id },
      }),
    );
  }

  try {
    return ok(
      extractVisibleText(await readFile(resolveArtifactPath(artifact, projectRoot), "utf8")),
    );
  } catch (error) {
    return err(
      createSurfaceError("capture_failed", "Content lens could not read the DOM snapshot.", {
        cause: error,
        details: { artifactId: artifact.id, path: artifact.path },
      }),
    );
  }
}

async function contentKnowledge(
  context: LensContext,
): Promise<Result<KnowledgeEntry, SurfaceError>> {
  const result = await context.knowledge.query({
    appType: context.config.evaluation.appType ?? "generic",
    lensId: CONTENT_LENS_ID,
    step: "content",
  });

  if (!isOk(result)) {
    return err(result.error);
  }

  const entry = result.value[0];

  if (entry === undefined) {
    return err(
      createSurfaceError("config_invalid", "Content lens requires a content knowledge entry.", {
        details: { lensId: CONTENT_LENS_ID },
      }),
    );
  }

  return ok(entry);
}

function draftForRetextMessage(input: {
  readonly index: number;
  readonly knowledgeEntry: KnowledgeEntry;
  readonly maxReadingGrade: number;
  readonly message: RetextMessage;
}): FindingDraft {
  const source = input.message.source ?? "retext";
  const ruleId = input.message.ruleId ?? "content";
  const isReadability = source === "retext-readability";

  return {
    draftId: `content:${source}:${ruleId}:${input.index}`,
    lens: CONTENT_LENS_ID,
    issueType: isReadability ? "readability" : "inclusive-language",
    method: "judged",
    title: isReadability
      ? `Content reading grade may exceed grade ${input.maxReadingGrade}`
      : "Microcopy may use non-inclusive language",
    rationale: isReadability
      ? `${input.message.reason}. Retext readability uses Flesch-Kincaid/Gunning-Fog-style algorithms; keep task-critical copy at or below grade ${input.maxReadingGrade}.`
      : input.message.reason,
    citedHeuristics: [input.knowledgeEntry.id],
    evidence: [{ kind: "cited-heuristic", knowledgeEntryId: input.knowledgeEntry.id }],
    rawDimensions: {
      agentImplementability: 0.72,
      confidence: 0.74,
      effort: 0.28,
      evidenceQuality: 0.7,
      severity: isReadability ? 0.46 : 0.58,
      userImpact: isReadability ? 0.56 : 0.68,
    },
    location: { selector: "body" },
  };
}

function resolveArtifactPath(artifact: CaptureArtifact, projectRoot: string | undefined): string {
  return path.isAbsolute(artifact.path)
    ? artifact.path
    : path.resolve(projectRoot ?? process.cwd(), artifact.path);
}

function extractVisibleText(html: string): string {
  return html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/g, "'")
    .replaceAll(/\s+/g, " ")
    .trim();
}
