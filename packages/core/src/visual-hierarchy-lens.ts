import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { FindingDraftSchema, type FindingDraft } from "./findings.js";
import type { CaptureArtifact, KnowledgeEntry, Lens, LensContext } from "./interfaces.js";

export type VisualHierarchyLensOptions = {
  readonly maxFontSizeSteps?: number;
  readonly minHeadingScaleRatio?: number;
  readonly projectRoot?: string;
};

const DEFAULT_MAX_FONT_SIZE_STEPS = 4;
const DEFAULT_MIN_HEADING_SCALE_RATIO = 1.25;
const VISUAL_HIERARCHY_LENS_ID = "visual-hierarchy";

const ComputedStyleEntrySchema = z
  .object({
    fontSize: z.string().min(1),
    id: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
    selector: z.string().min(1),
    tagName: z.string().min(1),
  })
  .passthrough();

const ComputedStylesSnapshotSchema = z.array(ComputedStyleEntrySchema);

type ComputedStyleEntry = z.infer<typeof ComputedStyleEntrySchema>;

type ElementFontSize = {
  readonly fontSizePx: number;
  readonly selector: string;
  readonly tagName: string;
};

/**
 * Creates the built-in visual hierarchy lens, grounded by computed style tokens.
 */
export function createVisualHierarchyLens(options: VisualHierarchyLensOptions = {}): Lens {
  const maxFontSizeSteps = options.maxFontSizeSteps ?? DEFAULT_MAX_FONT_SIZE_STEPS;
  const minHeadingScaleRatio = options.minHeadingScaleRatio ?? DEFAULT_MIN_HEADING_SCALE_RATIO;

  return {
    id: VISUAL_HIERARCHY_LENS_ID,
    method: "judged",
    requiresLiveDom: true,
    requiresModel: false,
    evaluate: async (context) => {
      const styles = await readComputedStyles(context.capture, options.projectRoot);

      if (!isOk(styles)) {
        return err(styles.error);
      }

      const fontSizes = styles.value.flatMap((entry) => {
        const fontSizePx = parsePx(entry.fontSize);

        if (fontSizePx === undefined) {
          return [];
        }

        return [
          {
            fontSizePx,
            selector: entry.selector,
            tagName: entry.tagName.toLowerCase(),
          },
        ];
      });

      if (fontSizes.length === 0) {
        return ok([]);
      }

      const knowledge = await visualHierarchyKnowledge(context);

      if (!isOk(knowledge)) {
        return err(knowledge.error);
      }

      const drafts = [
        ...headingScaleFindings(fontSizes, knowledge.value, minHeadingScaleRatio),
        ...fontTokenFindings(fontSizes, knowledge.value, maxFontSizeSteps),
      ];
      const findings: FindingDraft[] = [];

      for (const draft of drafts) {
        const parsed = FindingDraftSchema.safeParse(draft);

        if (!parsed.success) {
          return err(
            createSurfaceError(
              "finding_draft_invalid",
              "Visual hierarchy lens emitted an invalid draft.",
              { cause: parsed.error },
            ),
          );
        }

        findings.push(parsed.data);
      }

      return ok(findings);
    },
  };
}

async function readComputedStyles(
  capture: LensContext["capture"],
  projectRoot: string | undefined,
): Promise<Result<readonly ComputedStyleEntry[], SurfaceError>> {
  const artifact = capture.artifacts.find((entry) => entry.type === "computed-styles");

  if (artifact === undefined) {
    return err(
      createSurfaceError(
        "capture_failed",
        "Visual hierarchy lens requires a computed styles artifact.",
        { details: { captureId: capture.id } },
      ),
    );
  }

  try {
    const parsed = ComputedStylesSnapshotSchema.safeParse(
      JSON.parse(await readFile(resolveArtifactPath(artifact, projectRoot), "utf8")),
    );

    if (!parsed.success) {
      return err(
        createSurfaceError("capture_failed", "Computed styles artifact is invalid.", {
          cause: parsed.error,
          details: { artifactId: artifact.id, path: artifact.path },
        }),
      );
    }

    return ok(parsed.data);
  } catch (error) {
    return err(
      createSurfaceError(
        "capture_failed",
        "Visual hierarchy lens could not read computed styles.",
        {
          cause: error,
          details: { artifactId: artifact.id, path: artifact.path },
        },
      ),
    );
  }
}

async function visualHierarchyKnowledge(
  context: LensContext,
): Promise<Result<KnowledgeEntry, SurfaceError>> {
  const result = await context.knowledge.query({
    appType: context.config.evaluation.appType ?? "generic",
    lensId: VISUAL_HIERARCHY_LENS_ID,
    step: "evaluate",
  });

  if (!isOk(result)) {
    return err(result.error);
  }

  const entry = result.value[0];

  if (entry === undefined) {
    return err(
      createSurfaceError(
        "config_invalid",
        "Visual hierarchy lens requires a visual hierarchy knowledge entry.",
        { details: { lensId: VISUAL_HIERARCHY_LENS_ID } },
      ),
    );
  }

  return ok(entry);
}

function headingScaleFindings(
  fontSizes: readonly ElementFontSize[],
  knowledgeEntry: KnowledgeEntry,
  minHeadingScaleRatio: number,
): readonly FindingDraft[] {
  const bodySize = bodyFontSize(fontSizes);

  if (bodySize === undefined) {
    return [];
  }

  return fontSizes.flatMap((entry) => {
    if (!isHeading(entry.tagName)) {
      return [];
    }

    const ratio = entry.fontSizePx / bodySize;

    if (ratio >= minHeadingScaleRatio) {
      return [];
    }

    return [
      draftForHeadingScale({
        bodySize,
        entry,
        knowledgeEntry,
        minHeadingScaleRatio,
        ratio,
      }),
    ];
  });
}

function fontTokenFindings(
  fontSizes: readonly ElementFontSize[],
  knowledgeEntry: KnowledgeEntry,
  maxFontSizeSteps: number,
): readonly FindingDraft[] {
  const uniqueFontSizes = [...new Set(fontSizes.map((entry) => entry.fontSizePx))].sort(
    (left, right) => left - right,
  );

  if (uniqueFontSizes.length <= maxFontSizeSteps) {
    return [];
  }

  const selector =
    fontSizes.find((entry) => entry.tagName === "body")?.selector ?? fontSizes[0]?.selector;

  if (selector === undefined) {
    return [];
  }

  return [
    {
      draftId: `visual-hierarchy:font-size-steps:${formatSizes(uniqueFontSizes)}`,
      lens: VISUAL_HIERARCHY_LENS_ID,
      issueType: "design-system-token-drift",
      method: "judged",
      title: "Font sizes do not appear to follow a compact type scale",
      rationale: `This view uses ${uniqueFontSizes.length} font-size steps (${formatSizes(
        uniqueFontSizes,
      )}), exceeding the configured limit of ${maxFontSizeSteps}. A compact type scale makes hierarchy easier to scan and keeps design-system tokens reusable.`,
      citedHeuristics: [knowledgeEntry.id],
      evidence: [{ kind: "cited-heuristic", knowledgeEntryId: knowledgeEntry.id }],
      rawDimensions: {
        agentImplementability: 0.68,
        confidence: 0.72,
        effort: 0.36,
        evidenceQuality: 0.74,
        severity: 0.44,
        userImpact: 0.5,
      },
      location: { selector },
    },
  ];
}

function draftForHeadingScale(input: {
  readonly bodySize: number;
  readonly entry: ElementFontSize;
  readonly knowledgeEntry: KnowledgeEntry;
  readonly minHeadingScaleRatio: number;
  readonly ratio: number;
}): FindingDraft {
  return {
    draftId: `visual-hierarchy:heading-scale:${input.entry.selector}`,
    lens: VISUAL_HIERARCHY_LENS_ID,
    issueType: "visual-hierarchy",
    method: "judged",
    title: "Heading text is not visually distinct from body text",
    rationale: `${input.entry.tagName.toUpperCase()} text is ${formatSize(
      input.entry.fontSizePx,
    )} while body text is ${formatSize(input.bodySize)} (${input.ratio.toFixed(
      2,
    )}x). Use a clearer type-scale step so users can scan page structure before reading details.`,
    citedHeuristics: [input.knowledgeEntry.id],
    evidence: [
      { kind: "cited-heuristic", knowledgeEntryId: input.knowledgeEntry.id },
      { kind: "dom", selector: input.entry.selector },
    ],
    rawDimensions: {
      agentImplementability: 0.7,
      confidence: 0.76,
      effort: 0.3,
      evidenceQuality: 0.76,
      severity: 0.48,
      userImpact: 0.58,
    },
    location: { selector: input.entry.selector },
  };
}

function bodyFontSize(fontSizes: readonly ElementFontSize[]): number | undefined {
  const explicitBody = fontSizes.find((entry) => entry.tagName === "body")?.fontSizePx;

  if (explicitBody !== undefined) {
    return explicitBody;
  }

  const nonHeadingSizes = fontSizes
    .filter((entry) => !isHeading(entry.tagName))
    .map((entry) => entry.fontSizePx)
    .sort((left, right) => left - right);

  return nonHeadingSizes[Math.floor(nonHeadingSizes.length / 2)];
}

function isHeading(tagName: string): boolean {
  return /^h[1-6]$/.test(tagName);
}

function parsePx(value: string): number | undefined {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);

  if (match === null) {
    return undefined;
  }

  return Number(match[1]);
}

function formatSizes(values: readonly number[]): string {
  return values.map(formatSize).join(", ");
}

function formatSize(value: number): string {
  return Number.isInteger(value) ? `${value}px` : `${value.toFixed(2)}px`;
}

function resolveArtifactPath(artifact: CaptureArtifact, projectRoot: string | undefined): string {
  return path.isAbsolute(artifact.path)
    ? artifact.path
    : path.resolve(projectRoot ?? process.cwd(), artifact.path);
}
