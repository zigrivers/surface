import type {
  ComponentMap,
  ComponentMapEntry,
  FrameworkAdapter,
  SourceFileRef,
} from "@zigrivers/surface-core/interfaces";
import { createSurfaceError, type Result, type SurfaceError } from "@zigrivers/surface-core";
import { parse, type DefaultTreeAdapterMap } from "parse5";

export const AGNOSTIC_ADAPTER_ID = "agnostic";

const NULL_REPLACEMENT_CHARACTER = "\uFFFD";
const SUPPORTED_EXTENSIONS = [".html", ".htm", ".xhtml"] as const;
const COMPONENT_ATTRIBUTES = ["data-component", "data-surface-component"] as const;
const FALLBACK_SELECTORS = ["html", "body", "main"] as const;

type ParseNode = DefaultTreeAdapterMap["node"];
type ParseElement = DefaultTreeAdapterMap["element"];
type ParseTemplate = DefaultTreeAdapterMap["template"];

export interface AgnosticFrameworkAdapter extends FrameworkAdapter {
  readonly id: typeof AGNOSTIC_ADAPTER_ID;
  introspect(source: SourceFileRef): Promise<Result<ComponentMap, SurfaceError>>;
}

export function createAgnosticAdapter(): AgnosticFrameworkAdapter {
  return {
    id: AGNOSTIC_ADAPTER_ID,
    supports: (file: string) =>
      SUPPORTED_EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension)),
    introspect(source: SourceFileRef) {
      if (!isSourceFileRef(source)) {
        return Promise.resolve(
          err(
            createSurfaceError("step_failed", "SourceFileRef requires string path and contents."),
          ),
        );
      }

      try {
        return Promise.resolve(ok({ entries: introspectHtml(source) }));
      } catch (cause) {
        return Promise.resolve(
          err(
            createSurfaceError("step_failed", "Failed to introspect agnostic HTML source.", {
              cause,
            }),
          ),
        );
      }
    },
  };
}

function ok<T>(value: T): Result<T, SurfaceError> {
  return { ok: true, value };
}

function err(error: SurfaceError): Result<never, SurfaceError> {
  return { ok: false, error };
}

function isSourceFileRef(source: unknown): source is SourceFileRef {
  if (typeof source !== "object" || source === null) {
    return false;
  }

  const candidate = source as { readonly path?: unknown; readonly contents?: unknown };

  return typeof candidate.path === "string" && typeof candidate.contents === "string";
}

function introspectHtml(source: SourceFileRef): ComponentMapEntry[] {
  const document = parse(source.contents);
  const entries = new Map<string, ComponentMapEntry>();
  const fallbackSelectors = new Set<string>();

  visitElements(document, (element) => {
    if (isFallbackSelector(element.tagName)) {
      fallbackSelectors.add(element.tagName);
    }

    for (const reference of componentReferencesFor(element)) {
      const key = `${source.path}\0${reference.component}`;
      const existing = entries.get(key);

      entries.set(
        key,
        existing === undefined
          ? { component: reference.component, file: source.path, selectors: [reference.selector] }
          : { ...existing, selectors: [...new Set([...existing.selectors, reference.selector])] },
      );
    }
  });

  if (entries.size > 0) {
    return [...entries.values()];
  }

  return [
    {
      component: "Document",
      file: source.path,
      selectors: FALLBACK_SELECTORS.filter((selector) => fallbackSelectors.has(selector)),
    },
  ];
}

function visitElements(node: ParseNode, visit: (element: ParseElement) => void): void {
  const pending: ParseNode[] = [node];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      continue;
    }

    if (isElement(current)) {
      visit(current);
    }

    const next: ParseNode[] = [];

    if (isTemplateElement(current)) {
      next.push(current.content);
    }

    if ("childNodes" in current) {
      next.push(...current.childNodes);
    }

    for (let index = next.length - 1; index >= 0; index -= 1) {
      const child = next[index];

      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}

function isElement(node: ParseNode): node is ParseElement {
  return "tagName" in node && "attrs" in node;
}

function isTemplateElement(node: ParseNode): node is ParseTemplate {
  return isElement(node) && "content" in node;
}

function componentReferencesFor(
  element: ParseElement,
): Array<{ readonly component: string; readonly selector: string }> {
  return COMPONENT_ATTRIBUTES.flatMap((attribute) => {
    const rawValue = getAttribute(element, attribute);
    const component = sanitizeComponentName(rawValue);

    if (component !== undefined) {
      return [{ component, selector: `[${attribute}="${escapeCssString(rawValue ?? "")}"]` }];
    }

    return [];
  });
}

function getAttribute(element: ParseElement, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

function isFallbackSelector(tagName: string): tagName is (typeof FALLBACK_SELECTORS)[number] {
  return FALLBACK_SELECTORS.includes(tagName as (typeof FALLBACK_SELECTORS)[number]);
}

function sanitizeComponentName(value: string | undefined): string | undefined {
  const component = value === undefined ? undefined : normalizeNullCharacters(value).trim();

  return component === undefined || component.length === 0 ? undefined : component;
}

function normalizeNullCharacters(value: string): string {
  return value.replaceAll("\0", NULL_REPLACEMENT_CHARACTER);
}

function escapeCssString(value: string): string {
  return Array.from(normalizeNullCharacters(value), (character) => {
    const codePoint = character.codePointAt(0)!;

    if ((codePoint >= 1 && codePoint <= 0x1f) || codePoint === 0x7f) {
      return `\\${codePoint.toString(16)} `;
    }

    if (character === '"' || character === "\\") {
      return `\\${character}`;
    }

    return character;
  }).join("");
}
