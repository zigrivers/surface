import pino, {
  type Bindings,
  type ChildLoggerOptions,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from "pino";

/**
 * Privacy-first pino wrapper for surface packages.
 *
 * Redaction has two layers: semantic field names such as `token` keep the key and redact the
 * value, while key names that themselves contain credential material are replaced with
 * `[RedactedKey]`. Values are traversed defensively with circular detection, hostile getters are
 * treated as sensitive, and string content is sanitized for URLs, bearer/API tokens, private keys,
 * and common opaque credential placeholders before pino serializes the log line.
 */

export const REDACTED_LOG_VALUE = "[Redacted]";
export const REDACTED_LOG_KEY = "[RedactedKey]";
export const CIRCULAR_LOG_VALUE = "[Circular]";
export const TRUNCATED_LOG_VALUE = "[Truncated]";

const UNSAFE_NORMALIZED_KEYS = new Set([
  "authorization",
  "authstate",
  "capturedcontent",
  "cookie",
  "credential",
  "dom",
  "domcontent",
  "domsnapshot",
  "html",
  "htmlcontent",
  "htmlsnapshot",
  "innerhtml",
  "jwt",
  "password",
  "privatekey",
  "screenshot",
  "screenshotbase64",
  "screenshotcontent",
  "screenshotpng",
  "secret",
  "sourcecode",
  "storage",
  "storagestate",
  "token",
]);

const SAFE_NORMALIZED_KEY_EXCEPTIONS = new Set([
  "author",
  "authoremail",
  "authorid",
  "authorname",
  "authors",
  "authentic",
  "authority",
  "oauthurl",
  "secretaries",
  "secretary",
  "tokenized",
  "tokenizedcount",
  "tokenizer",
]);

const UNSAFE_STRING_PATTERNS = [
  /bearer\s+\S+/gi,
  /\bgithub_pat_[A-Za-z0-9_]+/gi,
  /\b(?:sk|ghp|glpat|xox[baprs])[-_][A-Za-z0-9_-]+/gi,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\b(?:opaque-auth|secret[-_][A-Za-z0-9_-]+|supersecret)\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
] as const;

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const PROTOCOL_RELATIVE_URL_PATTERN = /(^|[\s([{"'])(\/\/[^\s"'<>]+)/g;
const RELATIVE_URL_PATTERN = /(^|[\s([{"'=:])(\/(?!\/)[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+)/g;
const RELATIVE_URL_SIGNAL_PATTERN = /(^|[\s([{"'=:])\/(?!\/)[^\s"'<>]*[?#]/;
const QUERY_PARAMETER_VALUE_PATTERN = /([?&#;])([^=\s&#;]+)=([^&#\s]*)/g;
const INLINE_SECRET_KEY_VALUE_PATTERN =
  /["']?\b(?:access[_-]?key|api[_-]?key|auth|authorization|cookie|credential|jwt|password|secret|token)\b["']?\s*[:=]/i;
const INLINE_SECRET_VALUE_PATTERN =
  /(["']?\b(?:access[_-]?key|api[_-]?key|auth|authorization|cookie|credential|jwt|password|secret|token)\b["']?\s*[:=]\s*)(?:"[^"]+"|'[^']+'|[^\r\n,.;&?#]+?)(?=(?:\s+\b[A-Za-z0-9_-]+\b\s*[:=])|[,.;&?#]|\s*$)/gi;
const INLINE_AUTH_SCHEME_VALUE_PATTERN =
  /\b((?:auth|authorization)\b\s*[:=]\s*)(?:Basic|Bearer|Digest|Token)\s+\S+/gi;
const FORMAT_PLACEHOLDER_PATTERN = /%[sdijoO]/;
const FORMAT_PLACEHOLDER_GLOBAL_PATTERN = /%[sdijoO]/g;
const UNSAFE_FORMAT_SIGNAL_PATTERN =
  /\b(?:access[_-]?key|api[_-]?key|auth|authorization|bearer|cookie|credential|jwt|password|secret|token)\b/i;
const LOGGER_CHILD_WRAPPED = Symbol.for("surface.loggerChildWrapped");
const COMMON_ERROR_PROPERTIES = ["code", "statusCode", "status", "errno", "syscall"] as const;
const PINO_UNSAFE_KEYS = new Set(["__proto__", "constructor", "hasOwnProperty", "prototype"]);
const URL_UNSAFE_PARAMETER_KEYS = new Set([
  "key",
  "sig",
  "signature",
  "sharedaccesssignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "xamzsignature",
  "xgoogcredential",
  "xgoogsignature",
]);
const SIMPLE_UNSAFE_LOG_KEY_PATTERN =
  /(?:AKIA|ASIA|bearer|eyJ|ghp[-_]|github_pat_|glpat[-_]|opaque-auth|secret[-_]|sk[-_]|supersecret|xox[baprs][-_])/i;

const DEFAULT_LOG_LEVEL = "info";
const MAX_SANITIZE_DEPTH = 24;
const MAX_LOG_COLLECTION_ENTRIES = 1_000;
const MAX_LOG_STRING_LENGTH = 8_192;
const MAX_LOG_STRING_SANITIZE_LENGTH = 65_536;

export type SurfaceLogFields = Record<string, unknown>;

export type CreateSurfaceLoggerOptions = {
  readonly level?: string;
  readonly runId?: string;
  readonly stream?: DestinationStream;
};

type PinoLogArgs = [obj: unknown, msg?: string | undefined, ...args: unknown[]];
type SeenObjects = WeakSet<object>;
type SanitizedChildFactory = (
  this: Logger,
  bindings?: SurfaceLogFields,
  options?: ChildLoggerOptions,
) => Logger;
type LoggerWithChildWrapperFlag = Logger & { readonly [LOGGER_CHILD_WRAPPED]?: true };

function isRecordLike(value: unknown): value is Record<string, unknown> {
  const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(value);
  const tag = Object.prototype.toString.call(value);

  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isBuffer &&
    !ArrayBuffer.isView(value) &&
    !(value instanceof Date) &&
    !(value instanceof Error) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !(value instanceof RegExp) &&
    !(value instanceof URL) &&
    tag !== "[object Map]" &&
    tag !== "[object Set]"
  );
}

function isBinaryLike(value: unknown): boolean {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function normalizeLogKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isUnsafeLogKey(key: string): boolean {
  const normalizedKey = normalizeLogKey(key);

  if (SAFE_NORMALIZED_KEY_EXCEPTIONS.has(normalizedKey)) {
    return false;
  }

  return (
    UNSAFE_NORMALIZED_KEYS.has(normalizedKey) ||
    normalizedKey.includes("secret") ||
    normalizedKey.includes("token") ||
    hasUnsafeAuthSignal(normalizedKey) ||
    normalizedKey.includes("cookie") ||
    normalizedKey.includes("password") ||
    normalizedKey.includes("apikey") ||
    normalizedKey.includes("accesskey") ||
    normalizedKey === "session" ||
    normalizedKey.includes("sessionid") ||
    normalizedKey.includes("sessionkey") ||
    normalizedKey.includes("credential") ||
    normalizedKey.includes("mfa") ||
    normalizedKey.includes("otp") ||
    normalizedKey.includes("passphrase") ||
    normalizedKey.includes("privatekey")
  );
}

function hasUnsafeAuthSignal(normalizedKey: string): boolean {
  return (
    normalizedKey.startsWith("authorization") ||
    (!normalizedKey.startsWith("author") && normalizedKey.includes("auth"))
  );
}

// String redaction is ordered as: remove private key blocks, cap extreme input size, redact
// URLs/tokens, then apply the final log-size limit. This intentionally spends some CPU for
// privacy, while the coarse cap bounds regex work on unusually large messages.
function sanitizeLogString(value: string): string {
  const boundedInput = redactPrivateKeyBlocks(coarseLimitLogString(value));
  return truncateLogString(redactLogStringSecrets(boundedInput));
}

function redactLogStringSecrets(value: string): string {
  if (!hasLogStringSanitizerSignal(value)) {
    return value;
  }

  const absoluteUrlSanitized = value.replace(URL_PATTERN, (urlValue) =>
    sanitizeMatchedUrlString(urlValue, sanitizeUrlString),
  );
  const protocolRelativeUrlSanitized = absoluteUrlSanitized.replace(
    PROTOCOL_RELATIVE_URL_PATTERN,
    (_match, prefix: string, urlValue: string) =>
      `${prefix}${sanitizeMatchedUrlString(urlValue, sanitizeProtocolRelativeUrlString)}`,
  );
  const urlSanitized = protocolRelativeUrlSanitized.replace(
    RELATIVE_URL_PATTERN,
    (_match, prefix: string, urlValue: string) =>
      `${prefix}${sanitizeMatchedUrlString(urlValue, sanitizeRelativeUrlString)}`,
  );

  return redactSecretSubstrings(urlSanitized);
}

function sanitizeMatchedUrlString(value: string, sanitizer: (urlValue: string) => string): string {
  const { urlValue, suffix } = splitTrailingUrlPunctuation(value);
  return `${sanitizer(urlValue)}${suffix}`;
}

function splitTrailingUrlPunctuation(value: string): { urlValue: string; suffix: string } {
  const match = /[),.;:!?]+$/.exec(value);

  if (match === null) {
    return { urlValue: value, suffix: "" };
  }

  return {
    suffix: match[0],
    urlValue: value.slice(0, match.index),
  };
}

function redactPrivateKeyBlocks(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      REDACTED_LOG_VALUE,
    )
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, REDACTED_LOG_VALUE);
}

function hasLogStringSanitizerSignal(value: string): boolean {
  const lowerValue = value.toLowerCase();

  return (
    lowerValue.includes("http://") ||
    lowerValue.includes("https://") ||
    value.includes("//") ||
    lowerValue.includes("bearer ") ||
    lowerValue.includes("private key") ||
    INLINE_SECRET_KEY_VALUE_PATTERN.test(value) ||
    lowerValue.includes("secret-") ||
    lowerValue.includes("secret_") ||
    lowerValue.includes("supersecret") ||
    lowerValue.includes("opaque-auth") ||
    lowerValue.includes("sk-") ||
    lowerValue.includes("sk_") ||
    lowerValue.includes("ghp_") ||
    lowerValue.includes("ghp-") ||
    lowerValue.includes("github_pat_") ||
    lowerValue.includes("glpat-") ||
    lowerValue.includes("glpat_") ||
    lowerValue.includes("xox") ||
    RELATIVE_URL_SIGNAL_PATTERN.test(value) ||
    value.includes("AKIA") ||
    value.includes("ASIA") ||
    value.includes("eyJ")
  );
}

function truncateLogString(value: string): string {
  return value.length > MAX_LOG_STRING_LENGTH
    ? `${value.slice(0, MAX_LOG_STRING_LENGTH)}${TRUNCATED_LOG_VALUE}`
    : value;
}

function coarseLimitLogString(value: string): string {
  return value.length > MAX_LOG_STRING_SANITIZE_LENGTH
    ? `${value.slice(0, MAX_LOG_STRING_SANITIZE_LENGTH)}${TRUNCATED_LOG_VALUE}`
    : value;
}

function redactSecretSubstrings(value: string): string {
  const inlineSanitized = value
    .replace(
      INLINE_AUTH_SCHEME_VALUE_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_LOG_VALUE}`,
    )
    .replace(
      INLINE_SECRET_VALUE_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_LOG_VALUE}`,
    );

  return UNSAFE_STRING_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, REDACTED_LOG_VALUE),
    inlineSanitized,
  );
}

function sanitizeUrlString(value: string): string {
  try {
    const url = new URL(value);
    return sanitizeUrl(url);
  } catch {
    return sanitizeMalformedUrlString(value);
  }
}

function sanitizeRelativeUrlString(value: string): string {
  try {
    const url = new URL(value, "http://surface.local");
    const sanitizedUrl = sanitizeUrlObject(url);
    return normalizeRedactionSentinels(
      `${sanitizedUrl.pathname}${sanitizedUrl.search}${sanitizedUrl.hash}`,
    );
  } catch {
    return sanitizeMalformedUrlString(value);
  }
}

function sanitizeProtocolRelativeUrlString(value: string): string {
  try {
    const url = new URL(value, "https://surface.local");
    const sanitizedUrl = sanitizeUrlObject(url);
    return normalizeRedactionSentinels(
      `//${sanitizedUrl.host}${sanitizedUrl.pathname}${sanitizedUrl.search}${sanitizedUrl.hash}`,
    );
  } catch {
    return sanitizeMalformedUrlString(value);
  }
}

function normalizeRedactionSentinels(value: string): string {
  return value.replace(/%5BRedacted%5D/gi, REDACTED_LOG_VALUE);
}

function sanitizeMalformedUrlString(value: string): string {
  return value.replace(QUERY_PARAMETER_VALUE_PATTERN, (match, separator: string, key: string) =>
    isUnsafeUrlParameterKey(key) ? `${separator}${key}=${REDACTED_LOG_VALUE}` : match,
  );
}

function sanitizeUrl(value: URL): string {
  return normalizeRedactionSentinels(sanitizeUrlObject(value).toString());
}

function sanitizeUrlObject(value: URL): URL {
  const safeUrl = new URL(value);

  if (safeUrl.username.length > 0) {
    safeUrl.username = REDACTED_LOG_VALUE;
  }

  if (safeUrl.password.length > 0) {
    safeUrl.password = REDACTED_LOG_VALUE;
  }

  if (safeUrl.search.length > 0) {
    safeUrl.search = sanitizeUrlSearchParams(safeUrl.searchParams).toString();
  }

  if (safeUrl.hash.length > 0) {
    const hashValue = safeUrl.hash.slice(1);
    safeUrl.hash = sanitizeHashValue(hashValue);
  }

  return safeUrl;
}

function sanitizeUrlSearchParams(parameters: URLSearchParams): URLSearchParams {
  const sanitizedParameters = new URLSearchParams();

  for (const [key, parameterValue] of [...parameters]) {
    const sanitizedValue = sanitizeLogString(parameterValue);
    sanitizedParameters.append(
      key,
      isUnsafeUrlParameterKey(key) ? REDACTED_LOG_VALUE : sanitizedValue,
    );
  }

  return sanitizedParameters;
}

function isUnsafeUrlParameterKey(key: string): boolean {
  const normalizedKey = normalizeLogKey(key);
  return (
    isUnsafeLogKey(key) || normalizedKey === "code" || URL_UNSAFE_PARAMETER_KEYS.has(normalizedKey)
  );
}

function sanitizeHashValue(hashValue: string): string {
  const queryStart = hashValue.startsWith("?") ? 0 : hashValue.indexOf("?");
  const prefix = queryStart >= 0 ? hashValue.slice(0, queryStart + 1) : "";
  const parameterText = queryStart >= 0 ? hashValue.slice(queryStart + 1) : hashValue;

  if (parameterText.includes("=")) {
    try {
      return `${prefix}${sanitizeUrlSearchParams(new URLSearchParams(parameterText)).toString()}`;
    } catch {
      return REDACTED_LOG_VALUE;
    }
  }

  const sanitizedHash = redactSecretSubstrings(hashValue);
  return sanitizedHash === hashValue ? hashValue : REDACTED_LOG_VALUE;
}

function readErrorProperty(error: Error, key: string): unknown {
  try {
    return (error as unknown as Record<string, unknown>)[key];
  } catch {
    return REDACTED_LOG_VALUE;
  }
}

// Error objects can contain hostile getters and non-enumerable standard fields. Read the standard
// properties defensively, then copy only string-named own properties into a null-prototype object.
function sanitizeError(error: Error, seen: SeenObjects, depth: number): SurfaceLogFields | string {
  if (seen.has(error)) {
    return CIRCULAR_LOG_VALUE;
  }

  seen.add(error);

  const name = readErrorProperty(error, "name");
  const message = readErrorProperty(error, "message");
  const stack = readErrorProperty(error, "stack");
  const sanitized = createLogFieldsObject();
  sanitized.name = typeof name === "string" ? sanitizeLogString(name) : "Error";
  sanitized.message = sanitizeLogString(String(message));

  if (typeof stack === "string") {
    sanitized.stack = sanitizeLogString(stack);
  }

  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "name" || key === "message" || key === "stack") {
      continue;
    }

    try {
      sanitized[key] = sanitizeLogValue(
        key,
        (error as unknown as Record<string, unknown>)[key],
        seen,
        depth + 1,
      );
    } catch {
      sanitized[key] = REDACTED_LOG_VALUE;
    }
  }

  for (const key of COMMON_ERROR_PROPERTIES) {
    if (Object.hasOwn(sanitized, key) || !(key in error)) {
      continue;
    }

    try {
      sanitized[key] = sanitizeLogValue(key, readErrorProperty(error, key), seen, depth + 1);
    } catch {
      sanitized[key] = REDACTED_LOG_VALUE;
    }
  }

  seen.delete(error);
  return sanitized;
}

function sanitizeLogValue(
  key: string | undefined,
  value: unknown,
  seen: SeenObjects,
  depth: number,
): unknown {
  if (depth > MAX_SANITIZE_DEPTH) {
    return REDACTED_LOG_VALUE;
  }

  if (key !== undefined && isUnsafeLogKey(key) && value !== null && value !== undefined) {
    return REDACTED_LOG_VALUE;
  }

  if (typeof value === "string") {
    return sanitizeLogString(value);
  }

  if (typeof value === "function") {
    return REDACTED_LOG_VALUE;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol") {
    return REDACTED_LOG_VALUE;
  }

  if (isBinaryLike(value) || value instanceof WeakMap || value instanceof WeakSet) {
    return REDACTED_LOG_VALUE;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeError(value, seen, depth);
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (value instanceof URL) {
    return sanitizeUrl(value);
  }

  // Honor user-defined serializers before collection traversal, matching JSON serialization while
  // still sanitizing the serialized result and treating throwing serializers as sensitive.
  if (hasToJson(value)) {
    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);

    try {
      return sanitizeLogValue(undefined, value.toJSON(), seen, depth + 1);
    } catch {
      return REDACTED_LOG_VALUE;
    } finally {
      seen.delete(value);
    }
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);
    const sanitized = sanitizeLogFieldsImpl(mapToLogFields(value), seen, depth + 1);
    seen.delete(value);
    return sanitized;
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);
    const sanitized = [...value]
      .slice(0, MAX_LOG_COLLECTION_ENTRIES)
      .map((item) => sanitizeLogValue(undefined, item, seen, depth + 1));

    if (value.size > MAX_LOG_COLLECTION_ENTRIES) {
      sanitized.push(TRUNCATED_LOG_VALUE);
    }

    seen.delete(value);
    return sanitized;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);
    const sanitized = value
      .slice(0, MAX_LOG_COLLECTION_ENTRIES)
      .map((item) => sanitizeLogValue(undefined, item, seen, depth + 1));

    if (value.length > MAX_LOG_COLLECTION_ENTRIES) {
      sanitized.push(TRUNCATED_LOG_VALUE);
    }

    seen.delete(value);
    return sanitized;
  }

  if (isRecordLike(value)) {
    if (seen.has(value)) {
      return CIRCULAR_LOG_VALUE;
    }

    seen.add(value);
    const sanitized = sanitizeLogFieldsImpl(value, seen, depth + 1);
    seen.delete(value);
    return sanitized;
  }

  return value;
}

function hasToJson(value: unknown): value is { toJSON: () => unknown } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  try {
    return typeof (value as { toJSON?: unknown }).toJSON === "function";
  } catch {
    return false;
  }
}

/**
 * Return a log-safe copy that removes captured content and credential-shaped fields.
 */
export function sanitizeLogFields(fields: SurfaceLogFields): SurfaceLogFields {
  return sanitizeLogFieldsImpl(fields, new WeakSet<object>(), 0);
}

/**
 * Recursively sanitize object-like log fields. `seen` is scoped to one log call so circular
 * references are reported without permanently retaining caller objects.
 */
function sanitizeLogFieldsImpl(
  fields: SurfaceLogFields,
  seen: SeenObjects,
  depth: number,
): SurfaceLogFields {
  const sanitized = createLogFieldsObject();

  let fieldCount = 0;
  let truncated = false;

  for (const key in fields) {
    if (!Object.hasOwn(fields, key)) {
      continue;
    }

    if (fieldCount >= MAX_LOG_COLLECTION_ENTRIES) {
      truncated = true;
      break;
    }

    const logKey = sanitizeLogKey(key);
    const sanitizedKey = nextSanitizedLogKey(sanitized, logKey);

    try {
      sanitized[sanitizedKey] =
        logKey === key
          ? sanitizeLogValue(key, (fields as Record<string, unknown>)[key], seen, depth)
          : REDACTED_LOG_VALUE;
    } catch {
      sanitized[sanitizedKey] = REDACTED_LOG_VALUE;
    }

    fieldCount += 1;
  }

  if (truncated) {
    sanitized[nextSanitizedLogKey(sanitized, TRUNCATED_LOG_VALUE)] = TRUNCATED_LOG_VALUE;
  }

  return sanitized;
}

function createLogFieldsObject(): SurfaceLogFields {
  return Object.create(null) as SurfaceLogFields;
}

function sanitizeLogKey(key: string): string {
  if (canUseLogKeyWithoutDeepStringInspection(key)) {
    return key;
  }

  return !INLINE_SECRET_KEY_VALUE_PATTERN.test(key) &&
    redactLogStringSecrets(redactPrivateKeyBlocks(key)) === key
    ? key
    : REDACTED_LOG_KEY;
}

function canUseLogKeyWithoutDeepStringInspection(key: string): boolean {
  return (
    key.length <= 128 &&
    /^[A-Za-z0-9_.-]+$/.test(key) &&
    !isUnsafeLogKey(key) &&
    !SIMPLE_UNSAFE_LOG_KEY_PATTERN.test(key)
  );
}

function sanitizeUnsafeFormatString(format: string): string {
  let sanitized = "";
  let cursor = 0;

  for (const match of format.matchAll(FORMAT_PLACEHOLDER_GLOBAL_PATTERN)) {
    sanitized += sanitizeLogString(format.slice(cursor, match.index));
    sanitized += match[0];
    cursor = match.index + match[0].length;
  }

  return sanitized + sanitizeLogString(format.slice(cursor));
}

function nextSanitizedLogKey(fields: SurfaceLogFields, key: string): string {
  if (!Object.hasOwn(fields, key)) {
    return key;
  }

  let index = 2;
  let nextKey = `${key}${index}`;

  while (Object.hasOwn(fields, nextKey)) {
    index += 1;
    nextKey = `${key}${index}`;
  }

  return nextKey;
}

function sanitizeLogArguments(args: PinoLogArgs): PinoLogArgs {
  if (canUseLogArgumentsWithoutSanitizing(args)) {
    return args;
  }

  const seen = new WeakSet<object>();
  const unsafeFormatIndex = getUnsafeFormatArgumentIndex(args);

  return args.map((arg, index) => {
    try {
      if (index === 0 && arg instanceof Error) {
        return { err: sanitizeLogValue(undefined, arg, seen, 0) };
      }

      if (unsafeFormatIndex !== undefined && index > unsafeFormatIndex) {
        return REDACTED_LOG_VALUE;
      }

      if (unsafeFormatIndex !== undefined && index === unsafeFormatIndex) {
        return typeof arg === "string" ? sanitizeUnsafeFormatString(arg) : arg;
      }

      const sanitized = sanitizeLogValue(undefined, arg, seen, 0);

      return index === 0 && isRecordLike(sanitized) ? toPinoLogFields(sanitized) : sanitized;
    } catch {
      return REDACTED_LOG_VALUE;
    }
  }) as PinoLogArgs;
}

function shouldRedactFormattedArgument(format: unknown): boolean {
  return (
    typeof format === "string" &&
    FORMAT_PLACEHOLDER_PATTERN.test(format) &&
    UNSAFE_FORMAT_SIGNAL_PATTERN.test(format)
  );
}

function getUnsafeFormatArgumentIndex(args: PinoLogArgs): number | undefined {
  if (shouldRedactFormattedArgument(args[0])) {
    return 0;
  }

  if (shouldRedactFormattedArgument(args[1])) {
    return 1;
  }

  return undefined;
}

function canUseLogArgumentsWithoutSanitizing(args: PinoLogArgs): boolean {
  if (args.length === 0) {
    return true;
  }

  if (getUnsafeFormatArgumentIndex(args) !== undefined) {
    return false;
  }

  for (const arg of args) {
    if (!canUseLogArgumentWithoutSanitizing(arg)) {
      return false;
    }
  }

  return true;
}

function canUseLogArgumentWithoutSanitizing(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length <= MAX_LOG_STRING_LENGTH && !hasLogStringSanitizerSignal(value);
  }

  return (
    value === undefined || value === null || typeof value === "number" || typeof value === "boolean"
  );
}

function mapToLogFields(value: Map<unknown, unknown>): SurfaceLogFields {
  const fields = createLogFieldsObject();

  let entryCount = 0;

  for (const [entryKey, entryValue] of value) {
    if (entryCount >= MAX_LOG_COLLECTION_ENTRIES) {
      fields[nextSanitizedLogKey(fields, TRUNCATED_LOG_VALUE)] = TRUNCATED_LOG_VALUE;
      break;
    }

    let key: string;

    try {
      key = String(entryKey);
    } catch {
      key = REDACTED_LOG_KEY;
    }

    fields[nextSanitizedLogKey(fields, key)] = entryValue;
    entryCount += 1;
  }

  return fields;
}

function toSurfaceLogFields(bindings: Bindings | undefined): SurfaceLogFields {
  if (bindings === undefined || bindings === null) {
    return createLogFieldsObject();
  }

  const fields = createLogFieldsObject();

  for (const key of Object.keys(bindings)) {
    try {
      fields[key] = bindings[key] as unknown;
    } catch {
      fields[key] = REDACTED_LOG_VALUE;
    }
  }

  return fields;
}

function toPinoLogFields(fields: SurfaceLogFields): SurfaceLogFields {
  const pinoFields = createLogFieldsObject();

  for (const key of Object.keys(fields)) {
    const pinoKey = PINO_UNSAFE_KEYS.has(key)
      ? nextSanitizedLogKey(pinoFields, REDACTED_LOG_KEY)
      : key;

    Object.defineProperty(pinoFields, pinoKey, {
      configurable: true,
      enumerable: true,
      value: pinoKey === key ? fields[key] : REDACTED_LOG_VALUE,
      writable: true,
    });
  }

  Object.defineProperty(pinoFields, "hasOwnProperty", {
    configurable: true,
    value(this: object, key: PropertyKey) {
      return Object.prototype.hasOwnProperty.call(this, key);
    },
  });

  return pinoFields;
}

function isSanitizedChildFactory(value: unknown): value is SanitizedChildFactory {
  return typeof value === "function";
}

function getLoggerChild(logger: Logger): SanitizedChildFactory {
  const ownChildDescriptor: { value?: unknown } | undefined = Object.getOwnPropertyDescriptor(
    logger,
    "child",
  );
  const ownChild = ownChildDescriptor?.value;

  if (isSanitizedChildFactory(ownChild)) {
    return ownChild;
  }

  const loggerPrototype = Object.getPrototypeOf(logger) as { child?: unknown } | null;
  const prototypeChild = loggerPrototype?.child;
  if (isSanitizedChildFactory(prototypeChild)) {
    return prototypeChild;
  }

  throw new TypeError("Logger child factory is unavailable");
}

function withSanitizedChildBindings(logger: Logger): Logger {
  const wrappedLogger = logger as LoggerWithChildWrapperFlag;

  if (LOGGER_CHILD_WRAPPED in wrappedLogger) {
    return logger;
  }

  const child = getLoggerChild(logger);

  wrappedLogger.child = function childWithSanitizedBindings<
    ChildCustomLevels extends string = never,
  >(this: Logger, bindings?: Bindings, options?: ChildLoggerOptions<ChildCustomLevels>) {
    let sanitizedBindings: SurfaceLogFields | undefined;

    try {
      sanitizedBindings =
        bindings === undefined
          ? undefined
          : toPinoLogFields(sanitizeLogFields(toSurfaceLogFields(bindings)));
    } catch {
      sanitizedBindings = undefined;
    }

    try {
      return withSanitizedChildBindings(child.call(this, sanitizedBindings, options));
    } catch {
      return withSanitizedChildBindings(child.call(this, undefined, options));
    }
  } as unknown as Logger["child"];

  Object.defineProperty(wrappedLogger, LOGGER_CHILD_WRAPPED, {
    value: true,
  });

  return wrappedLogger;
}

/**
 * Create the structured pino logger used by surface libraries.
 *
 * The logger is intentionally opinionated: it writes privacy-safe JSON with ISO timestamps
 * and sanitizes base fields, child bindings, object-first logs, and formatted arguments.
 */
export function createSurfaceLogger(options: CreateSurfaceLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    base: options.runId === undefined ? null : { runId: options.runId },
    level: options.level ?? getEnvironmentLogLevel() ?? DEFAULT_LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      bindings(bindings) {
        return toPinoLogFields(sanitizeLogFields(toSurfaceLogFields(bindings)));
      },
    },
    hooks: {
      logMethod(args, method) {
        return method.apply(this, sanitizeLogArguments(args));
      },
    },
  };

  const logger =
    options.stream === undefined ? pino(loggerOptions) : pino(loggerOptions, options.stream);

  return withSanitizedChildBindings(logger);
}

function getEnvironmentLogLevel(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env?.SURFACE_LOG_LEVEL;
}
