import type { RedactionRule } from "./config.js";
import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";

export const REDACTED_EXPORT_VALUE = "[Redacted]";

const MAX_EXPORT_REDACTION_DEPTH = 32;

type CompiledExportRedactionRule = {
  readonly pattern: string;
  readonly regex: RegExp;
};

export function redactExportString(
  value: string,
  redactionRules: readonly RedactionRule[] | undefined,
): Result<string, SurfaceError> {
  const compiledRules = compileExportRedactionRules(redactionRules);

  if (!compiledRules.ok) {
    return compiledRules;
  }

  return ok(redactStringWithRules(value, compiledRules.value));
}

export function redactExportValue<T>(
  value: T,
  redactionRules: readonly RedactionRule[] | undefined,
): Result<T, SurfaceError> {
  const compiledRules = compileExportRedactionRules(redactionRules);

  if (!compiledRules.ok) {
    return compiledRules;
  }

  if (compiledRules.value.length === 0) {
    return ok(value);
  }

  return ok(redactUnknownValue(value, compiledRules.value) as T);
}

function compileExportRedactionRules(
  redactionRules: readonly RedactionRule[] | undefined,
): Result<readonly CompiledExportRedactionRule[], SurfaceError> {
  const exportRules = redactionRules?.filter((rule) => rule.appliesTo.includes("export")) ?? [];
  const compiled: CompiledExportRedactionRule[] = [];

  for (const rule of exportRules) {
    try {
      compiled.push({ pattern: rule.pattern, regex: new RegExp(rule.pattern, "g") });
    } catch (cause) {
      return err(
        createSurfaceError("export_failed", "Export redaction rule pattern is invalid.", {
          cause,
          details: { pattern: rule.pattern },
        }),
      );
    }
  }

  return ok(compiled);
}

function redactUnknownValue(
  value: unknown,
  rules: readonly CompiledExportRedactionRule[],
  depth = 0,
): unknown {
  if (depth > MAX_EXPORT_REDACTION_DEPTH) {
    return value;
  }

  if (typeof value === "string") {
    return redactStringWithRules(value, rules);
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown) => redactUnknownValue(entry, rules, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        redactUnknownValue(entry, rules, depth + 1),
      ]),
    );
  }

  return value;
}

function redactStringWithRules(
  value: string,
  rules: readonly CompiledExportRedactionRule[],
): string {
  let redacted = value;

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    redacted = redacted.replace(rule.regex, REDACTED_EXPORT_VALUE);
  }

  return redacted;
}
