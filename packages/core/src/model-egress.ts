import { z } from "zod";
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

import { ModelChannelIdSchema, type ModelEgressPolicy } from "./config.js";
import type { Capture, CaptureArtifact, CaptureArtifactType } from "./interfaces.js";
import {
  ArtifactRedactionMetadataSchema,
  CaptureArtifactTypeSchema,
  type ArtifactRedactionMetadata,
} from "./interfaces.js";
import { ModelSourceKindSchema, ModelUnavailableReasonSchema } from "./model-provider.js";

// Model egress is intentionally narrow: text artifacts may be sent after policy
// masking, while screenshots are represented only by sanitized redaction metadata.
// Raw screenshot bytes and original screenshot paths never enter model prompts.

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

const TEXT_ARTIFACT_TYPES = new Set<CaptureArtifactType>([
  "dom-snapshot",
  "accessibility-tree",
  "computed-styles",
]);

export const ModelEgressBlockedReasonSchema = z.enum([
  "model_egress_blocked_by_policy",
  "channel_metadata_missing",
  "channel_denied_by_policy",
  "channel_not_allowed_by_policy",
  "screenshot_blocked_by_policy",
  "screenshot_blocked_no_redacted_artifact",
  "screenshot_blocked_no_verified_redaction",
  "primary_provider_failed_no_fallback",
]);
export type ModelEgressBlockedReason = z.infer<typeof ModelEgressBlockedReasonSchema>;

export const ModelEgressRedactionStatusSchema = z.enum([
  "none",
  "text-only",
  "redacted-screenshots",
]);
export type ModelEgressRedactionStatus = z.infer<typeof ModelEgressRedactionStatusSchema>;

export const ModelEgressUnavailableChannelSchema = z
  .object({
    channelId: ModelChannelIdSchema.optional(),
    sourceKind: ModelSourceKindSchema.optional(),
    reason: ModelUnavailableReasonSchema,
    message: nonEmptyStringSchema,
  })
  .strict();
export type ModelEgressUnavailableChannel = z.infer<typeof ModelEgressUnavailableChannelSchema>;

export const ModelEgressLedgerEntrySchema = z
  .object({
    runId: nonEmptyStringSchema,
    sourceKind: ModelSourceKindSchema,
    attemptedChannels: z.array(ModelChannelIdSchema),
    completedChannels: z.array(ModelChannelIdSchema),
    unavailableChannels: z.array(ModelEgressUnavailableChannelSchema),
    blockedReasons: z.array(ModelEgressBlockedReasonSchema),
    artifactClassesSent: z.array(CaptureArtifactTypeSchema),
    redactionStatus: ModelEgressRedactionStatusSchema,
  })
  .strict();
export type ModelEgressLedgerEntry = z.infer<typeof ModelEgressLedgerEntrySchema>;

export type ModelChannelPermissionInput = {
  readonly channelId?: unknown;
  readonly sourceKind?: unknown;
};

export type ModelChannelPermission =
  | { readonly permitted: true }
  | {
      readonly permitted: false;
      readonly reason: ModelEgressBlockedReason;
      readonly message: string;
    };

export type ModelArtifactEgressDecision = {
  readonly artifactsToSend: readonly CaptureArtifact[];
  readonly artifactClassesSent: readonly CaptureArtifactType[];
  readonly blockedReasons: readonly ModelEgressBlockedReason[];
  readonly redactionStatus: ModelEgressRedactionStatus;
};

export type MaskModelArtifactTextInput = {
  readonly artifactType: CaptureArtifactType;
  readonly text: string;
  readonly redaction?: ArtifactRedactionMetadata;
};

export type MaskModelArtifactTextResult = {
  readonly artifactType: CaptureArtifactType;
  readonly maskingStrategy: "pattern" | "structural";
  readonly text: string;
};

export function isModelChannelPermitted(
  policy: ModelEgressPolicy,
  metadata: ModelChannelPermissionInput,
): ModelChannelPermission {
  const parsedChannelId = ModelChannelIdSchema.safeParse(metadata.channelId);
  const parsedSourceKind = ModelSourceKindSchema.safeParse(metadata.sourceKind);

  if (!parsedChannelId.success || !parsedSourceKind.success) {
    return {
      permitted: false,
      reason: "channel_metadata_missing",
      message: "model provider is missing canonical channel metadata",
    };
  }

  const channelId = parsedChannelId.data;

  if (policy.mode === "off") {
    return {
      permitted: false,
      reason: "model_egress_blocked_by_policy",
      message: "model egress is disabled by effective policy",
    };
  }

  if (policy.deniedChannels?.includes(channelId) === true) {
    return {
      permitted: false,
      reason: "channel_denied_by_policy",
      message: `model channel ${channelId} is denied by effective policy`,
    };
  }

  if (policy.allowedChannels !== undefined && !policy.allowedChannels.includes(channelId)) {
    return {
      permitted: false,
      reason: "channel_not_allowed_by_policy",
      message: `model channel ${channelId} is not allowed by effective policy`,
    };
  }

  return { permitted: true };
}

export function evaluateModelArtifactEgress(
  capture: Capture,
  policy: ModelEgressPolicy,
): ModelArtifactEgressDecision {
  if (policy.mode === "off") {
    return {
      artifactsToSend: [],
      artifactClassesSent: [],
      blockedReasons: ["model_egress_blocked_by_policy"],
      redactionStatus: "none",
    };
  }

  const textArtifacts = capture.artifacts.filter((artifact) =>
    TEXT_ARTIFACT_TYPES.has(artifact.type),
  );
  const screenshotArtifacts = capture.artifacts.filter(
    (artifact) => artifact.type === "screenshot",
  );
  const blockedReasons: ModelEgressBlockedReason[] = [];
  let screenshotMetadataArtifacts: CaptureArtifact[] = [];

  if (policy.mode !== "text-and-screenshots" || policy.screenshots === "blocked") {
    if (screenshotArtifacts.length > 0) {
      blockedReasons.push("screenshot_blocked_by_policy");
    }
  } else if (
    screenshotArtifacts.length === 0 ||
    screenshotArtifacts.some((artifact) => artifact.redaction === undefined)
  ) {
    blockedReasons.push("screenshot_blocked_no_redacted_artifact");
  } else if (!screenshotArtifacts.every(hasVerifiedScreenshotRedaction)) {
    blockedReasons.push("screenshot_blocked_no_verified_redaction");
  } else {
    screenshotMetadataArtifacts = screenshotArtifacts.map((artifact, index) =>
      screenshotMetadataArtifact(artifact, index),
    );
  }

  const artifactsToSend = [...textArtifacts, ...screenshotMetadataArtifacts];
  const artifactClassesSent = uniqueArtifactClasses(artifactsToSend);
  const redactionStatus =
    screenshotMetadataArtifacts.length > 0
      ? "redacted-screenshots"
      : artifactClassesSent.length > 0
        ? "text-only"
        : "none";

  return {
    artifactsToSend,
    artifactClassesSent,
    blockedReasons,
    redactionStatus,
  };
}

function screenshotMetadataArtifact(artifact: CaptureArtifact, index: number): CaptureArtifact {
  return {
    id: `screenshot-metadata-${index + 1}`,
    path: "[redacted-screenshot-metadata-only]",
    redacted: true,
    redaction: sanitizeScreenshotRedactionMetadata(artifact.redaction),
    type: "screenshot",
  };
}

function sanitizeScreenshotRedactionMetadata(
  redaction: ArtifactRedactionMetadata | undefined,
): ArtifactRedactionMetadata {
  const base = redaction ?? {
    boundingBoxesVerified: true,
    maskedClasses: [],
    safeNoSensitiveRegions: true,
    status: "redacted",
    unsafeRegions: [],
  };

  return {
    maskedClasses: base.maskedClasses.map(maskSensitivePatterns).filter(hasNonEmptyText),
    safeNoSensitiveRegions: base.safeNoSensitiveRegions,
    status: "redacted",
    unsafeRegions: base.unsafeRegions.map((_, index) => `region-${index + 1}`),
    ...(base.boundingBoxesVerified === undefined
      ? {}
      : { boundingBoxesVerified: base.boundingBoxesVerified }),
    ...(base.selectorsVerified === undefined ? {} : { selectorsVerified: base.selectorsVerified }),
    ...(base.textRangesVerified === undefined
      ? {}
      : { textRangesVerified: base.textRangesVerified }),
  };
}

export function createModelEgressLedgerEntry(
  input: z.input<typeof ModelEgressLedgerEntrySchema>,
): ModelEgressLedgerEntry {
  return ModelEgressLedgerEntrySchema.parse({
    ...input,
    unavailableChannels: input.unavailableChannels.map((entry) => ({
      ...entry,
      message: sanitizeLedgerMessage(entry.message),
    })),
  });
}

export function maskModelArtifactText(
  input: MaskModelArtifactTextInput,
): MaskModelArtifactTextResult {
  if (input.artifactType === "dom-snapshot" && hasSensitiveSelectors(input.redaction)) {
    return {
      artifactType: input.artifactType,
      maskingStrategy: "structural",
      text: "[masked-dom-snapshot-sensitive-selector]",
    };
  }

  const rangedText = maskSensitiveTextRanges(input.text, input.redaction?.sensitiveTextRanges);
  const masked =
    input.artifactType === "dom-snapshot"
      ? maskDomSnapshotText(rangedText)
      : input.artifactType === "computed-styles"
        ? maskComputedStylesText(rangedText)
        : { maskingStrategy: "pattern" as const, text: maskSensitivePatterns(rangedText) };

  return {
    artifactType: input.artifactType,
    maskingStrategy: masked.maskingStrategy,
    text: masked.text,
  };
}

export function maskModelPlainText(text: string): string {
  return maskSensitivePatterns(text);
}

function hasSensitiveSelectors(redaction: ArtifactRedactionMetadata | undefined): boolean {
  return redaction?.sensitiveSelectors?.some((selector) => selector.trim().length > 0) === true;
}

function maskSensitivePatterns(text: string): string {
  return maskFormLikeMarkupPatterns(text)
    .replace(/([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})/gi, "[masked-email]")
    .replace(/\b(?:sk|anthropic|gcloud)-[A-Za-z0-9_-]{8,}\b/g, "[masked-token]")
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[masked-token]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[masked-token]")
    .replace(/\bya29\.[0-9A-Za-z_-]+(?:\.[0-9A-Za-z_-]+)*\b/g, "[masked-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[masked-token]")
    .replace(/\b(?:sess|session|token|secret|api[_-]?key)_[A-Za-z0-9_-]{8,}\b/gi, "[masked-secret]")
    .replace(
      /([?&][A-Za-z0-9_.:-]*(?:token|secret|session|api[-_]?key|key|auth|credential|password)[A-Za-z0-9_.:-]*=)[^"')\s&]+/gi,
      "$1[masked-secret]",
    )
    .replace(
      /(\s(?:data-)?[A-Za-z0-9_:-]*(?:session|token|secret|api[-_]?key)[A-Za-z0-9_:-]*\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu,
      (
        _match: string,
        prefix: string,
        doubleQuotedValue: string | undefined,
        singleQuotedValue: string | undefined,
        unquotedValue: string | undefined,
      ) => {
        if (doubleQuotedValue !== undefined) {
          return `${prefix}"[masked-secret]"`;
        }

        if (singleQuotedValue !== undefined) {
          return `${prefix}'[masked-secret]'`;
        }

        if (unquotedValue !== undefined) {
          return `${prefix}[masked-secret]`;
        }

        return `${prefix}[masked-secret]`;
      },
    )
    .replace(
      /(<input\b[^>]*type=["']?password["']?[^>]*\bvalue=["'])[^"']*(["'][^>]*>)/gi,
      "$1[masked-password]$2",
    )
    .replace(
      /(<input\b[^>]*\bvalue=["'])[^"']*(["'][^>]*type=["']?password["']?[^>]*>)/gi,
      "$1[masked-password]$2",
    )
    .replace(
      /(content\s*:\s*)(["'])([^"']*)(\2)/gi,
      (_match: string, prefix: string, quote: string, value: string) =>
        `${prefix}${quote}${maskSensitivePatterns(value)}${quote}`,
    )
    .replace(
      /(--[A-Za-z0-9_-]*(?:session|token|secret|key)[A-Za-z0-9_-]*\s*:\s*)[^;]+/gi,
      "$1[masked-secret]",
    )
    .replace(
      /(\b[A-Za-z0-9_.:-]*(?:token|secret|session|api[-_]?key|auth|credential|password)[A-Za-z0-9_.:-]*\s*[:=]\s*["']?)[a-f0-9]{32,}/gi,
      "$1[masked-hex-secret]",
    )
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, (candidate) =>
      isLikelyHighEntropySecret(candidate) ? "[masked-high-entropy]" : candidate,
    );
}

function maskComputedStylesText(text: string): {
  readonly maskingStrategy: "structural";
  readonly text: string;
} {
  const json = maskComputedStylesJson(text);

  if (json !== undefined) {
    return { maskingStrategy: "structural", text: maskSensitivePatterns(json) };
  }

  return {
    maskingStrategy: "structural",
    text: maskSensitivePatterns(maskCssDeclarations(text)),
  };
}

function maskComputedStylesJson(text: string): string | undefined {
  try {
    return JSON.stringify(maskComputedStyleJsonValue(JSON.parse(text)), null, 2);
  } catch {
    return undefined;
  }
}

function maskComputedStyleJsonValue(value: unknown, propertyName = ""): unknown {
  if (typeof value === "string") {
    return maskComputedStyleValue(propertyName, value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => maskComputedStyleJsonValue(entry, propertyName));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, maskComputedStyleJsonValue(entry, key)]),
    );
  }

  return value;
}

const CSS_DECLARATION_PATTERN = new RegExp(
  String.raw`(^|[;\{\n]\s*)((?:--|-)?[A-Za-z0-9_-]+)\s*:\s*([^;\{\}\n]*)(?=;|\}|\n|$)`,
  "gu",
);

function maskCssDeclarations(text: string): string {
  return text.replace(
    CSS_DECLARATION_PATTERN,
    (_match: string, prefix: string, propertyName: string, propertyValue: string) =>
      `${prefix}${propertyName}: ${maskComputedStyleValue(propertyName, propertyValue)}`,
  );
}

function maskComputedStyleValue(propertyName: string, propertyValue: string): string {
  if (isSensitiveStyleProperty(propertyName)) {
    return preserveCssValueWrapper(propertyValue, "[masked-secret]");
  }

  const urlMasked = maskCssUrls(propertyValue);

  if (propertyName.toLowerCase() === "content") {
    return urlMasked.replace(
      /(["'])([^"']*)(\1)/gu,
      (_match: string, quote: string, value: string) =>
        `${quote}${maskSensitivePatterns(value)}${quote}`,
    );
  }

  return urlMasked;
}

function isSensitiveStyleProperty(propertyName: string): boolean {
  const normalizedProperty = propertyName.toLowerCase();

  return /(?:token|secret|session|api[-_]?key|apikey|auth|credential|password|oauth)/iu.test(
    normalizedProperty,
  );
}

function preserveCssValueWrapper(originalValue: string, replacement: string): string {
  const trimmed = originalValue.trim();
  const quote = trimmed.startsWith('"') ? '"' : trimmed.startsWith("'") ? "'" : "";

  if (quote.length === 0) {
    return replacement;
  }

  return `${quote}${replacement}${quote}`;
}

function maskCssUrls(value: string): string {
  return value.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu,
    (_match: string, doubleQuotedUrl: string, singleQuotedUrl: string, bareUrl: string) => {
      if (doubleQuotedUrl !== undefined) {
        return `url("${maskSensitivePatterns(doubleQuotedUrl)}")`;
      }

      if (singleQuotedUrl !== undefined) {
        return `url('${maskSensitivePatterns(singleQuotedUrl)}')`;
      }

      return `url(${maskSensitivePatterns(bareUrl.trim())})`;
    },
  );
}

function maskFormLikeMarkupPatterns(text: string): string {
  return text
    .replace(
      /(<(script|style|template|noscript)\b[^>]*>)[\s\S]*?(?=<\/\2\b|$)/giu,
      "$1[masked-nonvisible-content]",
    )
    .replace(/<input\b[^<>]*/giu, maskInputTagPattern)
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(?=<\/textarea\b|$)/giu, "$1[masked-form-text]")
    .replace(
      /(<([a-z][\w:-]*)\b[^>]*\bcontenteditable(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>)[\s\S]*?(?=<\/\2\b|$)/giu,
      (match: string, openingTag: string) =>
        /\bcontenteditable\s*=\s*(?:"false"|'false'|false)\b/iu.test(openingTag)
          ? match
          : `${openingTag}[masked-form-text]`,
    );
}

function maskInputTagPattern(inputTag: string): string {
  const placeholder = /\btype\s*=\s*(?:"password"|'password'|password)\b/iu.test(inputTag)
    ? "[masked-password]"
    : "[masked-form-value]";

  return inputTag.replace(
    /\bvalue\s*=\s*(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s>]*)/giu,
    (attribute) => {
      const prefix = attribute.match(/^(\bvalue\s*=\s*)/iu)?.[1] ?? "value=";
      const rawValue = attribute.slice(prefix.length);
      const quote = rawValue.startsWith('"') || rawValue.startsWith("'") ? rawValue[0] : "";

      return `${prefix}${quote}${placeholder}${quote}`;
    },
  );
}

function hasNonEmptyText(value: string): boolean {
  return value.length > 0;
}

function isLikelyHighEntropySecret(candidate: string): boolean {
  const characterClasses = [
    /[a-z]/u.test(candidate),
    /[A-Z]/u.test(candidate),
    /\d/u.test(candidate),
    /[+/=_-]/u.test(candidate),
  ].filter(Boolean).length;

  return characterClasses >= 3 && shannonEntropy(candidate) >= 4.5;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();

  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;

    return entropy - probability * Math.log2(probability);
  }, 0);
}

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

function maskDomSnapshotText(text: string): {
  readonly maskingStrategy: "pattern" | "structural";
  readonly text: string;
} {
  try {
    if (!shouldParseDomSnapshot(text)) {
      return { maskingStrategy: "pattern", text: maskSensitivePatterns(text) };
    }

    const document = isFullHtmlDocument(text) ? parse(text) : parseFragment(text);
    maskHtmlNode(document);

    return { maskingStrategy: "structural", text: maskSensitivePatterns(serialize(document)) };
  } catch {
    return { maskingStrategy: "pattern", text: maskSensitivePatterns(text) };
  }
}

function isFullHtmlDocument(text: string): boolean {
  return /^\s*(?:<!doctype\b|<html\b)/iu.test(text);
}

function shouldParseDomSnapshot(text: string): boolean {
  if (isFullHtmlDocument(text)) {
    return true;
  }

  const trimmed = text.trimEnd();

  // parse5 completes or drops truncated fragments; keep excerpts stable and
  // fall back to pattern masking when capture truncation leaves open tags.
  if (/<[^>]*$/u.test(trimmed)) {
    return false;
  }

  return !hasUnclosedNonVoidHtmlTag(trimmed);
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function hasUnclosedNonVoidHtmlTag(text: string): boolean {
  const stack: string[] = [];

  for (const match of text.matchAll(/<\/?([a-z][\w:-]*)(?:\s[^<>]*)?>/giu)) {
    const tag = match[1]?.toLowerCase();
    const rawTag = match[0];

    if (tag === undefined || VOID_HTML_TAGS.has(tag) || rawTag.endsWith("/>")) {
      continue;
    }

    if (rawTag.startsWith("</")) {
      const index = stack.lastIndexOf(tag);

      if (index !== -1) {
        stack.splice(index);
      }
      continue;
    }

    stack.push(tag);
  }

  return stack.length > 0;
}

function maskHtmlNode(node: HtmlNode, textMask?: string): void {
  if ("value" in node && typeof node.value === "string") {
    node.value = textMask ?? maskSensitivePatterns(node.value);
  }

  if ("data" in node && typeof node.data === "string") {
    node.data = textMask ?? maskSensitivePatterns(node.data);
  }

  let childTextMask = textMask;

  if (isHtmlElement(node)) {
    maskElementAttributes(node);
    childTextMask = childTextMask ?? childTextMaskForElement(node);
  }

  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      maskHtmlNode(child, childTextMask);
    }
  }
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return "attrs" in node && Array.isArray(node.attrs);
}

function maskElementAttributes(node: HtmlElement): void {
  const tagName = node.tagName.toLowerCase();
  const isPasswordInput =
    tagName === "input" &&
    node.attrs.some(
      (attribute) =>
        attribute.name.toLowerCase() === "type" && attribute.value.toLowerCase() === "password",
    );
  const masksInputValue = tagName === "input";

  for (const attribute of node.attrs) {
    const name = attribute.name.toLowerCase();
    const sensitiveName = isSensitiveAttributeName(name);

    if (isPasswordInput && name === "value") {
      attribute.value = "[masked-password]";
    } else if (masksInputValue && name === "value") {
      attribute.value = "[masked-form-value]";
    } else if (sensitiveName) {
      attribute.value = "[masked-secret]";
    } else {
      attribute.value = maskSensitivePatterns(attribute.value);
    }
  }
}

function childTextMaskForElement(node: HtmlElement): string | undefined {
  const tagName = node.tagName.toLowerCase();

  if (NON_VISIBLE_TEXT_TAGS.has(tagName)) {
    return "[masked-nonvisible-content]";
  }

  if (tagName === "textarea") {
    return "[masked-form-text]";
  }

  return node.attrs.some(
    (attribute) =>
      attribute.name.toLowerCase() === "contenteditable" &&
      attribute.value.toLowerCase() !== "false",
  )
    ? "[masked-form-text]"
    : undefined;
}

const NON_VISIBLE_TEXT_TAGS = new Set(["noscript", "script", "style", "template"]);

function isSensitiveAttributeName(name: string): boolean {
  return /(?:session|token|secret|api[_-]?key)/i.test(name);
}

function hasVerifiedScreenshotRedaction(artifact: CaptureArtifact): boolean {
  if (artifact.redaction === undefined) {
    return false;
  }

  const parsedRedaction = ArtifactRedactionMetadataSchema.safeParse(artifact.redaction);

  if (!parsedRedaction.success || parsedRedaction.data.unsafeRegions.length > 0) {
    return false;
  }

  return (
    parsedRedaction.data.maskedClasses.length > 0 ||
    parsedRedaction.data.safeNoSensitiveRegions === true
  );
}

function uniqueArtifactClasses(artifacts: readonly CaptureArtifact[]): CaptureArtifactType[] {
  return [...new Set(artifacts.map((artifact) => artifact.type))];
}

function maskSensitiveTextRanges(
  text: string,
  ranges: readonly { readonly start: number; readonly end: number }[] | undefined,
): string {
  if (ranges === undefined || ranges.length === 0) {
    return text;
  }

  let masked = text;
  const normalizedRanges = ranges
    .map((range) => ({
      end: Math.max(0, Math.min(text.length, range.end)),
      start: Math.max(0, Math.min(text.length, range.start)),
    }))
    .filter((range) => range.end > range.start);
  const sortedRanges = [...mergeSensitiveTextRanges(normalizedRanges)].sort(
    (left, right) => right.start - left.start,
  );

  for (const range of sortedRanges) {
    const start = Math.max(0, Math.min(masked.length, range.start));
    const end = Math.max(start, Math.min(masked.length, range.end));
    masked = `${masked.slice(0, start)}[masked-text]${masked.slice(end)}`;
  }

  return masked;
}

function mergeSensitiveTextRanges(
  ranges: readonly { readonly start: number; readonly end: number }[],
): readonly { readonly start: number; readonly end: number }[] {
  const sortedRanges = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: { start: number; end: number }[] = [];

  for (const range of sortedRanges) {
    const previous = merged.at(-1);

    if (previous === undefined || range.start > previous.end) {
      merged.push({ end: range.end, start: range.start });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  return merged;
}

function sanitizeLedgerMessage(message: string): string {
  return maskModelPlainText(message);
}
