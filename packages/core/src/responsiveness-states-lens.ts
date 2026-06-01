import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import { FindingDraftSchema, type FindingDraft } from "./findings.js";
import type { CaptureArtifact, KnowledgeEntry, Lens, LensContext } from "./interfaces.js";

export type ResponsivenessStatesLensOptions = {
  readonly projectRoot?: string;
};

const RESPONSIVENESS_LENS_ID = "responsiveness";
const EMPTY_STATE_PATTERN =
  /\b(no|nothing)\s+[\w\s-]{0,40}\s*(yet|found|available|created|saved)\b/i;
const ERROR_STATE_PATTERN =
  /\b(error|failed|something went wrong|service unavailable|there is a problem)\b/i;

const ComputedStyleEntrySchema = z
  .object({
    clientWidth: z.number().nonnegative().optional(),
    overflowX: z.string().optional(),
    scrollWidth: z.number().nonnegative().optional(),
    selector: z.string().min(1),
    tagName: z.string().min(1),
    width: z.string().optional(),
  })
  .passthrough();

const ComputedStylesSnapshotSchema = z.array(ComputedStyleEntrySchema);

type ComputedStyleEntry = z.infer<typeof ComputedStyleEntrySchema>;

type FixedWidthIssue = {
  readonly measuredWidthPx: number;
  readonly selector: string;
};

type KnowledgeBundle = {
  readonly reflow: KnowledgeEntry;
  readonly states: KnowledgeEntry;
};

/**
 * Creates the built-in responsiveness and UI-state lens over DOM capture artifacts.
 */
export function createResponsivenessStatesLens(
  options: ResponsivenessStatesLensOptions = {},
): Lens {
  return {
    id: RESPONSIVENESS_LENS_ID,
    method: "measured",
    requiresLiveDom: true,
    requiresModel: false,
    evaluate: async (context) => {
      const dom = await readDom(context.capture, options.projectRoot);

      if (!isOk(dom)) {
        return err(dom.error);
      }

      const computedStyles = await readComputedStyles(context.capture, options.projectRoot);

      if (!isOk(computedStyles)) {
        return err(computedStyles.error);
      }

      const knowledge = await responsivenessKnowledge(context);

      if (!isOk(knowledge)) {
        return err(knowledge.error);
      }

      const drafts = [
        ...fixedWidthFindings(
          computedStyles.value,
          context.capture.target.viewport?.width,
          knowledge.value,
        ),
        ...stateFindings(dom.value, knowledge.value),
      ];
      const findings: FindingDraft[] = [];

      for (const draft of drafts) {
        const parsed = FindingDraftSchema.safeParse(draft);

        if (!parsed.success) {
          return err(
            createSurfaceError(
              "finding_draft_invalid",
              "Responsiveness lens emitted an invalid draft.",
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

async function readDom(
  capture: LensContext["capture"],
  projectRoot: string | undefined,
): Promise<Result<string, SurfaceError>> {
  const artifact = capture.artifacts.find((entry) => entry.type === "dom-snapshot");

  if (artifact === undefined) {
    return err(
      createSurfaceError(
        "capture_failed",
        "Responsiveness lens requires a DOM snapshot artifact.",
        {
          details: { captureId: capture.id },
        },
      ),
    );
  }

  try {
    return ok(await readFile(resolveArtifactPath(artifact, projectRoot), "utf8"));
  } catch (error) {
    return err(
      createSurfaceError("capture_failed", "Responsiveness lens could not read the DOM snapshot.", {
        cause: error,
        details: { artifactId: artifact.id, path: artifact.path },
      }),
    );
  }
}

async function readComputedStyles(
  capture: LensContext["capture"],
  projectRoot: string | undefined,
): Promise<Result<readonly ComputedStyleEntry[], SurfaceError>> {
  const artifact = capture.artifacts.find((entry) => entry.type === "computed-styles");

  if (artifact === undefined) {
    return ok([]);
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
      createSurfaceError("capture_failed", "Responsiveness lens could not read computed styles.", {
        cause: error,
        details: { artifactId: artifact.id, path: artifact.path },
      }),
    );
  }
}

async function responsivenessKnowledge(
  context: LensContext,
): Promise<Result<KnowledgeBundle, SurfaceError>> {
  const result = await context.knowledge.query({
    appType: context.config.evaluation.appType ?? "generic",
    lensId: RESPONSIVENESS_LENS_ID,
    step: "evaluate",
  });

  if (!isOk(result)) {
    return err(result.error);
  }

  const reflow = result.value.find((entry) => entry.tags?.includes("reflow") === true);
  const states = result.value.find((entry) => entry.tags?.includes("state-recovery") === true);

  if (reflow === undefined || states === undefined) {
    return err(
      createSurfaceError(
        "config_invalid",
        "Responsiveness lens requires reflow and state-recovery knowledge entries.",
        {
          details: {
            lensId: RESPONSIVENESS_LENS_ID,
            missing: [
              ...(reflow === undefined ? ["reflow"] : []),
              ...(states === undefined ? ["state-recovery"] : []),
            ],
          },
        },
      ),
    );
  }

  return ok({ reflow, states });
}

function fixedWidthFindings(
  styles: readonly ComputedStyleEntry[],
  viewportWidth: number | undefined,
  knowledge: KnowledgeBundle,
): readonly FindingDraft[] {
  if (viewportWidth === undefined) {
    return [];
  }

  return fixedWidthIssues(styles, viewportWidth).map((issue) => ({
    draftId: `responsiveness:fixed-width:${issue.selector}:${issue.measuredWidthPx}`,
    lens: RESPONSIVENESS_LENS_ID,
    issueType: "responsive-fixed-width",
    method: "measured",
    title: "Fixed-width content exceeds the viewport",
    rationale: `${issue.selector} declares ${formatPx(issue.measuredWidthPx)} width in a ${formatPx(
      viewportWidth,
    )} viewport. Non-excepted content should reflow instead of forcing horizontal scrolling.`,
    citedHeuristics: [knowledge.reflow.id],
    evidence: [
      {
        kind: "tool-result",
        tool: "backend",
        rule: "computed-layout-width",
        measuredValue: `${formatPx(issue.measuredWidthPx)} > ${formatPx(viewportWidth)}`,
        threshold: `viewport width ${formatPx(viewportWidth)}`,
      },
      { kind: "cited-heuristic", knowledgeEntryId: knowledge.reflow.id },
      { kind: "dom", selector: issue.selector },
    ],
    rawDimensions: {
      agentImplementability: 0.76,
      confidence: 0.78,
      effort: 0.34,
      evidenceQuality: 0.8,
      severity: 0.58,
      userImpact: 0.66,
    },
    location: { selector: issue.selector },
  }));
}

function stateFindings(html: string, knowledge: KnowledgeBundle): readonly FindingDraft[] {
  const text = extractVisibleText(html);
  const findings: FindingDraft[] = [];

  if (containsEmptyState(text) && !hasNextAction(html, text)) {
    findings.push(
      stateFinding({
        issueType: "empty-state-next-action-missing",
        measuredValue: "empty state text without action element",
        rationale:
          "The page appears to present an empty state but does not include an action such as creating, adding, retrying, or navigating somewhere useful.",
        rule: "empty-state-next-action",
        title: "Empty state does not provide a next action",
        knowledgeEntry: knowledge.states,
      }),
    );
  }

  if (containsErrorState(text) && !hasRecoveryAction(html, text)) {
    findings.push(
      stateFinding({
        issueType: "error-state-recovery-missing",
        measuredValue: "error state text without recovery action",
        rationale:
          "The page appears to present an error state but does not include a recovery action such as retrying, refreshing, contacting support, or going back.",
        rule: "error-state-recovery",
        title: "Error state does not provide recovery",
        knowledgeEntry: knowledge.states,
      }),
    );
  }

  if (containsLoadingState(text) && !hasStatusSemantics(html)) {
    findings.push(
      stateFinding({
        issueType: "loading-state-status-missing",
        measuredValue: "loading state text without status semantics",
        rationale:
          "The page appears to present a loading state without status semantics such as role=status, role=progressbar, aria-live, or aria-busy.",
        rule: "loading-state-status",
        title: "Loading state is not exposed as status",
        knowledgeEntry: knowledge.states,
      }),
    );
  }

  return findings;
}

function stateFinding(input: {
  readonly issueType: string;
  readonly knowledgeEntry: KnowledgeEntry;
  readonly measuredValue: string;
  readonly rationale: string;
  readonly rule: string;
  readonly title: string;
}): FindingDraft {
  return {
    draftId: `responsiveness:${input.rule}`,
    lens: RESPONSIVENESS_LENS_ID,
    issueType: input.issueType,
    method: "measured",
    title: input.title,
    rationale: input.rationale,
    citedHeuristics: [input.knowledgeEntry.id],
    evidence: [
      {
        kind: "tool-result",
        tool: "backend",
        rule: input.rule,
        measuredValue: input.measuredValue,
      },
      { kind: "cited-heuristic", knowledgeEntryId: input.knowledgeEntry.id },
    ],
    rawDimensions: {
      agentImplementability: 0.66,
      confidence: 0.68,
      effort: 0.28,
      evidenceQuality: 0.64,
      severity: 0.46,
      userImpact: 0.58,
    },
    location: { selector: "body" },
  };
}

function fixedWidthIssues(
  styles: readonly ComputedStyleEntry[],
  viewportWidth: number,
): readonly FixedWidthIssue[] {
  const issues: FixedWidthIssue[] = [];

  for (const entry of styles) {
    const tagName = entry.tagName.toLowerCase();

    if (ignoredFixedWidthTag(tagName) || hasContainedHorizontalScroll(entry, viewportWidth)) {
      continue;
    }

    const width = measuredLayoutWidth(entry);

    if (width <= viewportWidth) {
      continue;
    }

    issues.push({ measuredWidthPx: width, selector: entry.selector });
  }

  return issues;
}

function measuredLayoutWidth(entry: ComputedStyleEntry): number {
  return boxWidth(entry);
}

function ignoredFixedWidthTag(tagName: string): boolean {
  return ["canvas", "svg", "table", "video"].includes(tagName);
}

function hasContainedHorizontalScroll(entry: ComputedStyleEntry, viewportWidth: number): boolean {
  if (entry.overflowX !== "auto" && entry.overflowX !== "scroll") {
    return false;
  }

  return boxWidth(entry) <= viewportWidth && (entry.scrollWidth ?? 0) > boxWidth(entry);
}

function boxWidth(entry: ComputedStyleEntry): number {
  return Math.max(parsePx(entry.width) ?? 0, entry.clientWidth ?? 0);
}

function attributeValue(attributes: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:(['"])(.*?)\\1|([^\\s>]+))`, "i");
  const match = attributes.match(pattern);

  return match?.[2] ?? match?.[3];
}

function containsEmptyState(text: string): boolean {
  return EMPTY_STATE_PATTERN.test(text);
}

function containsErrorState(text: string): boolean {
  return ERROR_STATE_PATTERN.test(text);
}

function containsLoadingState(text: string): boolean {
  return /\b(loading|please wait|spinner)\b/i.test(text);
}

function hasNextAction(html: string, text: string): boolean {
  return hasActionLabelAfterState(
    html,
    text,
    EMPTY_STATE_PATTERN,
    /\b(create|add|retry|refresh|reload|contact|back)\b/i,
  );
}

function hasRecoveryAction(html: string, text: string): boolean {
  return hasActionLabelAfterState(
    html,
    text,
    ERROR_STATE_PATTERN,
    /\b(retry|try again|refresh|reload|contact|back|support)\b/i,
  );
}

function hasActionLabelAfterState(
  html: string,
  text: string,
  statePattern: RegExp,
  actionPattern: RegExp,
): boolean {
  const match = text.match(statePattern);

  if (match?.index === undefined || match[0] === undefined) {
    return false;
  }

  const textAfterState = normalizeText(
    text.slice(match.index + match[0].length, match.index + 240),
  );

  return actionLabels(html).some((label) => {
    const normalizedLabel = normalizeText(label);

    return actionPattern.test(normalizedLabel) && textAfterState.includes(normalizedLabel);
  });
}

function actionLabels(html: string): readonly string[] {
  const labels: string[] = [];
  const linkedOrButtonTextPattern = /<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const inputPattern = /<input\b([^>]*)>/gi;

  for (const match of html.matchAll(linkedOrButtonTextPattern)) {
    const label = extractVisibleText(match[2] ?? "");

    if (label.length > 0) {
      labels.push(label);
    }
  }

  for (const match of html.matchAll(inputPattern)) {
    const attributes = match[1] ?? "";
    const label = attributeValue(attributes, "aria-label") ?? attributeValue(attributes, "value");

    if (label !== undefined) {
      labels.push(label);
    }
  }

  return labels;
}

function normalizeText(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function hasStatusSemantics(html: string): boolean {
  return (
    /\brole\s*=\s*(['"])(status|progressbar)\1/i.test(html) ||
    /\baria-live\s*=/i.test(html) ||
    /\baria-busy\s*=\s*(['"])true\1/i.test(html)
  );
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

function formatPx(value: number): string {
  return Number.isInteger(value) ? `${value}px` : `${value.toFixed(2)}px`;
}

function parsePx(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);

  if (match === undefined || match === null) {
    return undefined;
  }

  return Number(match[1]);
}

function resolveArtifactPath(artifact: CaptureArtifact, projectRoot: string | undefined): string {
  return path.isAbsolute(artifact.path)
    ? artifact.path
    : path.resolve(projectRoot ?? process.cwd(), artifact.path);
}
