import { ok } from "./errors.js";
import type { Evidence, FindingDraft, ToolResultEvidence } from "./findings.js";
import type { Lens } from "./interfaces.js";
import { LIGHTHOUSE_ACCESSIBILITY_AUDIT_IDS } from "./lighthouse-audits.js";

const ACCESSIBILITY_LENS_ID = "accessibility";

const LIGHTHOUSE_PERFORMANCE_RULES = new Set([
  "cumulative-layout-shift",
  "first-contentful-paint",
  "interactive",
  "largest-contentful-paint",
  "speed-index",
  "total-blocking-time",
]);

const LIGHTHOUSE_ACCESSIBILITY_RULES = new Set<string>(LIGHTHOUSE_ACCESSIBILITY_AUDIT_IDS);
const NON_SELECTOR_ANCHORS = new Set(["unknown-target"]);

const HTML_SELECTOR_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "portal",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "search",
  "section",
  "select",
  "slot",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const ISSUE_TYPES_BY_RULE = new Map<string, string>([
  ["button-name", "accessible-name-missing"],
  ["color-contrast", "contrast-insufficient"],
  ["image-alt", "alt-text-missing"],
  ["jsx-a11y/alt-text", "alt-text-missing"],
]);

const TITLES_BY_ISSUE_TYPE = new Map<string, string>([
  ["accessible-name-missing", "Interactive control is missing an accessible name"],
  ["alt-text-missing", "Image is missing alternative text"],
  ["contrast-insufficient", "Text contrast is below the required threshold"],
]);

// These defaults intentionally weight deterministic a11y tool evidence as high-confidence and
// high-risk while keeping implementation effort low enough for agent-generated fixes.
const A11Y_DIMENSIONS_BY_CATEGORY = {
  default: {
    agentImplementability: 0.74,
    a11yLegalRisk: 0.78,
    confidence: 0.92,
    effort: 0.42,
    evidenceQuality: 0.94,
    severity: 0.62,
    userImpact: 0.68,
  },
  highRisk: {
    agentImplementability: 0.74,
    a11yLegalRisk: 0.86,
    confidence: 0.92,
    effort: 0.42,
    evidenceQuality: 0.94,
    severity: 0.72,
    userImpact: 0.78,
  },
  contrast: {
    agentImplementability: 0.82,
    a11yLegalRisk: 0.86,
    confidence: 0.92,
    effort: 0.34,
    evidenceQuality: 0.94,
    severity: 0.72,
    userImpact: 0.78,
  },
} as const satisfies Record<string, FindingDraft["rawDimensions"]>;

/**
 * Creates the built-in measured accessibility lens from normalized grounding evidence.
 */
export function createAccessibilityLens(): Lens {
  return {
    id: ACCESSIBILITY_LENS_ID,
    method: "measured",
    requiresLiveDom: true,
    requiresModel: false,
    evaluate: (context) => {
      const findingsByIdentity = new Map<string, FindingDraft>();

      for (const evidence of context.evidence) {
        if (!isAccessibilityToolResult(evidence)) {
          continue;
        }

        const draft = draftForEvidence(evidence);
        if (draft === undefined) {
          continue;
        }
        const existing = findingsByIdentity.get(draft.draftId);

        if (existing === undefined) {
          findingsByIdentity.set(draft.draftId, draft);
        } else {
          findingsByIdentity.set(draft.draftId, mergeFindingDraftEvidence(existing, draft));
        }
      }

      return ok([...findingsByIdentity.values()]);
    },
  };
}

function isAccessibilityToolResult(evidence: Evidence): evidence is ToolResultEvidence {
  if (evidence.kind !== "tool-result") {
    return false;
  }

  const candidate = evidence as {
    readonly measuredValue?: unknown;
    readonly rule?: unknown;
    readonly tool?: unknown;
  };

  if (
    typeof candidate.rule !== "string" ||
    candidate.rule.trim().length === 0 ||
    typeof candidate.measuredValue !== "string" ||
    candidate.measuredValue.trim().length === 0
  ) {
    return false;
  }

  const rule = candidate.rule.trim();

  if (candidate.tool === "lighthouse") {
    return LIGHTHOUSE_ACCESSIBILITY_RULES.has(rule) && !LIGHTHOUSE_PERFORMANCE_RULES.has(rule);
  }

  return candidate.tool === "axe" || candidate.tool === "eslint-jsx-a11y";
}

function draftForEvidence(evidence: ToolResultEvidence): FindingDraft | undefined {
  const normalizedEvidence = normalizeToolResultEvidence(evidence);
  if (normalizedEvidence.rule.length === 0 || normalizedEvidence.measuredValue.length === 0) {
    return undefined;
  }

  const issueType = issueTypeForRule(normalizedEvidence.rule);
  const title =
    TITLES_BY_ISSUE_TYPE.get(issueType) ?? `Accessibility rule ${normalizedEvidence.rule} failed`;
  const file =
    normalizedEvidence.tool === "eslint-jsx-a11y"
      ? fileFromMeasuredValue(normalizedEvidence)
      : undefined;
  const selector =
    normalizedEvidence.tool === "eslint-jsx-a11y"
      ? undefined
      : selectorFromMeasuredValue(normalizedEvidence);
  const elementRef =
    normalizedEvidence.tool === "eslint-jsx-a11y"
      ? undefined
      : elementRefFromMeasuredValue(normalizedEvidence);
  const location =
    normalizedEvidence.tool === "eslint-jsx-a11y"
      ? { file: file ?? "unknown-source" }
      : selector === undefined
        ? { elementRef: elementRef ?? `${normalizedEvidence.tool}:${normalizedEvidence.rule}` }
        : { selector };
  const draftAnchor =
    normalizedEvidence.tool === "eslint-jsx-a11y"
      ? normalizedEvidence.measuredValue
      : (selector ?? elementRef ?? normalizedEvidence.measuredValue);
  const evidenceItems: FindingDraft["evidence"] = [
    normalizedEvidence,
    ...(selector === undefined ? [] : [{ kind: "dom" as const, selector }]),
  ];

  return {
    draftId: `accessibility:${issueType}:${draftIdPart(draftAnchor)}`,
    lens: ACCESSIBILITY_LENS_ID,
    issueType,
    method: "measured",
    title,
    rationale: rationaleForEvidence(normalizedEvidence, title),
    citedHeuristics: [],
    evidence: evidenceItems,
    rawDimensions: dimensionsForEvidence(normalizedEvidence),
    location,
  };
}

function normalizeToolResultEvidence(evidence: ToolResultEvidence): ToolResultEvidence {
  const threshold = evidence.threshold?.trim();

  return {
    ...evidence,
    rule: evidence.rule.trim(),
    measuredValue: evidence.measuredValue.trim(),
    ...(threshold === undefined || threshold.length === 0 ? {} : { threshold }),
  };
}

// Duplicate tools confirm one violation by sharing a draftId. Summary fields are first-writer-wins
// because the first normalized draft already owns the stable title, location, and dimensions.
function mergeFindingDraftEvidence(left: FindingDraft, right: FindingDraft): FindingDraft {
  const mergedEvidence = [...left.evidence];
  const seen = new Set(mergedEvidence.map(evidenceKey));

  for (const evidence of right.evidence) {
    const key = evidenceKey(evidence);

    if (!seen.has(key)) {
      seen.add(key);
      mergedEvidence.push(evidence);
    }
  }

  return { ...left, evidence: mergedEvidence };
}

function evidenceKey(evidence: Evidence): string {
  return JSON.stringify(evidence);
}

function issueTypeForRule(rule: string): string {
  return ISSUE_TYPES_BY_RULE.get(rule) ?? rule.replace(/^jsx-a11y\//u, "");
}

function selectorFromMeasuredValue(evidence: ToolResultEvidence): string | undefined {
  const anchor = anchorFromMeasuredValue(evidence);

  if (anchor === undefined || !isCssSelectorAnchor(evidence, anchor)) {
    return undefined;
  }

  return anchor;
}

function elementRefFromMeasuredValue(evidence: ToolResultEvidence): string | undefined {
  const anchor = anchorFromMeasuredValue(evidence);

  return anchor === undefined || isCssSelectorAnchor(evidence, anchor) ? undefined : anchor;
}

// Grounding adapters format measurements as "<anchor>: <details>". The first delimiter is the
// only structured boundary; additional colons belong to the human-readable details.
function anchorFromMeasuredValue(evidence: ToolResultEvidence): string | undefined {
  const delimiter = evidence.measuredValue.indexOf(": ");

  if (delimiter <= 0) {
    return undefined;
  }

  const anchor = evidence.measuredValue.slice(0, delimiter).trim();

  return anchor.length > 0 ? anchor : undefined;
}

// A selector must be a bare element name, a clearly selector-prefixed anchor, or a compound
// selector. Human prose anchors fall back to elementRef so downstream fixes do not target fiction.
function isCssSelectorAnchor(evidence: ToolResultEvidence, anchor: string): boolean {
  const normalized = anchor.trim();

  if (evidence.tool === "lighthouse" && normalized === evidence.rule) {
    return false;
  }

  if (normalized.startsWith("<")) {
    return false;
  }

  if (NON_SELECTOR_ANCHORS.has(normalized)) {
    return false;
  }

  if (/^[a-z][a-z0-9-]*$/u.test(normalized)) {
    return isBareSelectorTag(normalized);
  }

  if (/^[.#[:]/u.test(normalized)) {
    return true;
  }

  return isCompoundSelectorAnchor(normalized);
}

function isBareSelectorTag(value: string): boolean {
  return HTML_SELECTOR_TAGS.has(value) || /^[a-z][a-z0-9]*-[a-z0-9-]*$/u.test(value);
}

function isCompoundSelectorAnchor(value: string): boolean {
  const firstTag = value.match(/^([a-z][a-z0-9-]*)/u)?.[1];

  if (firstTag === undefined || !isBareSelectorTag(firstTag)) {
    return false;
  }

  return /^[a-z][a-z0-9-]*(?:[.#[:][^\s>~+]+|\s*(?:[>~+]\s*)?[a-z.#[:][^\s>~+]*)/u.test(value);
}

function fileFromMeasuredValue(evidence: ToolResultEvidence): string | undefined {
  const match = evidence.measuredValue.match(/([^\s"'`]+?\.[cm]?[jt]sx?):\d+:\d+\b/u);

  return match?.[1];
}

function rationaleForEvidence(evidence: ToolResultEvidence, title: string): string {
  const threshold =
    evidence.threshold === undefined ? "" : ` The failing threshold was ${evidence.threshold}.`;
  const measured = ensureSentenceTerminator(evidence.measuredValue);

  return `${title}. ${evidence.tool} reported ${evidence.rule}: ${measured}${threshold}`;
}

function ensureSentenceTerminator(value: string): string {
  return /[.!?)]$/u.test(value) ? value : `${value}.`;
}

function dimensionsForEvidence(evidence: ToolResultEvidence): FindingDraft["rawDimensions"] {
  const isContrast = evidence.rule === "color-contrast";
  const isNameOrText = /(?:name|alt|label)/u.test(evidence.rule);

  return isContrast
    ? A11Y_DIMENSIONS_BY_CATEGORY.contrast
    : isNameOrText
      ? A11Y_DIMENSIONS_BY_CATEGORY.highRisk
      : A11Y_DIMENSIONS_BY_CATEGORY.default;
}

function draftIdPart(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[^\w./:#-]+/gu, "_").replace(/^_+|_+$/gu, "");

  if (normalized.length === 0) {
    return `unanchored_${stableHash(trimmed)}`;
  }

  const prefix = normalized.slice(0, 120);

  return normalized === trimmed && normalized.length <= 160
    ? normalized
    : `${prefix}_${stableHash(trimmed)}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
