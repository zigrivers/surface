import { basename } from "node:path";

import type {
  ComponentMap,
  ComponentMapEntry,
  FrameworkAdapter,
  SourceFileRef,
} from "@surface/core/interfaces";
import { createSurfaceError, type Result, type SurfaceError } from "@surface/core";
import { parse } from "@vue/compiler-sfc";

export const VUE_ADAPTER_ID = "vue";

const NULL_REPLACEMENT_CHARACTER = "\uFFFD";
const SUPPORTED_EXTENSIONS = [".vue"] as const;
const COMPONENT_ATTRIBUTES = ["data-component", "data-surface-component"] as const;
const SELECTOR_ATTRIBUTES = ["data-testid", "role", "aria-label"] as const;

type AstNode = Readonly<Record<string, unknown>>;
type ComponentReference = { readonly component: string; readonly selector: string };
type ComponentDetails = {
  readonly references: readonly ComponentReference[];
  readonly selectors: readonly string[];
};

export interface VueFrameworkAdapter extends FrameworkAdapter {
  readonly id: typeof VUE_ADAPTER_ID;
  introspect(source: SourceFileRef): Promise<Result<ComponentMap, SurfaceError>>;
}

export function createVueAdapter(): VueFrameworkAdapter {
  return {
    id: VUE_ADAPTER_ID,
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
        return Promise.resolve(ok({ entries: introspectVueSource(source) }));
      } catch (cause) {
        return Promise.resolve(
          err(
            createSurfaceError("step_failed", "Failed to introspect Vue source.", {
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

function introspectVueSource(source: SourceFileRef): ComponentMapEntry[] {
  const parsed = parse(source.contents, { filename: source.path });

  if (parsed.errors.length > 0) {
    throw errorForVueParserError(parsed.errors[0]);
  }

  const details = collectComponentDetails(parsed.descriptor.template?.ast);
  const entries = new Map<string, ComponentMapEntry>();
  const component = componentNameFromPath(source.path);

  mergeEntry(entries, source.path, component, details.selectors);

  for (const reference of details.references) {
    mergeEntry(entries, source.path, reference.component, [reference.selector]);
  }

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      selectors: [...new Set(entry.selectors)].sort(compareStableStrings),
    }))
    .sort((left, right) => compareStableStrings(left.component, right.component));
}

function errorForVueParserError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function collectComponentDetails(root: unknown): ComponentDetails {
  const references: ComponentReference[] = [];
  const selectors: string[] = [];

  walkVueNodes(root, (node) => {
    references.push(...markerReferencesFor(node));
    selectors.push(...selectorsForVueNode(node));
  });

  return { references, selectors };
}

function walkVueNodes(root: unknown, visit: (node: AstNode) => void): void {
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const value = pending.pop();
    const node = recordValue(value);

    if (node === undefined) {
      continue;
    }

    visit(node);
    pending.push(...childrenForNode(node));
  }
}

function childrenForNode(node: AstNode): readonly unknown[] {
  return Array.isArray(node.children) ? node.children : [];
}

function mergeEntry(
  entries: Map<string, ComponentMapEntry>,
  file: string,
  component: string,
  selectors: readonly string[],
): void {
  const key = `${file}\0${component}`;
  const existing = entries.get(key);

  entries.set(
    key,
    existing === undefined
      ? { component, file, selectors: [...selectors] }
      : { ...existing, selectors: [...existing.selectors, ...selectors] },
  );
}

function markerReferencesFor(node: AstNode): ComponentReference[] {
  return COMPONENT_ATTRIBUTES.flatMap((attribute) => {
    const rawValue = vueStringAttribute(node, attribute);
    const component = sanitizeComponentName(rawValue);

    return component === undefined || !isComponentName(component)
      ? []
      : [{ component, selector: `[${attribute}="${escapeCssString(rawValue ?? "")}"]` }];
  });
}

function selectorsForVueNode(node: AstNode): string[] {
  const tag = stringValue(node.tag);

  if (tag === undefined) {
    return [];
  }

  const selectors: string[] = [];

  for (const attribute of COMPONENT_ATTRIBUTES) {
    const value = vueStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  const id = vueStringAttribute(node, "id");

  if (id !== undefined && id.trim().length > 0) {
    selectors.push(`[id="${escapeCssString(id)}"]`);
  }

  for (const attribute of SELECTOR_ATTRIBUTES) {
    const value = vueStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  if (numberValue(node.tagType) === 1 && isComponentName(tag)) {
    selectors.push(`vue:${tag}`);
  }

  if (numberValue(node.tagType) === 1 && tag === "component") {
    const dynamicName = directiveExpressionFor(node, "is");

    if (dynamicName !== undefined && isComponentName(dynamicName)) {
      selectors.push(`vue:${dynamicName}`);
    }
  }

  if (selectors.length > 0) {
    return selectors;
  }

  return [];
}

function vueStringAttribute(node: AstNode, name: string): string | undefined {
  const attribute = nodeProps(node).find(
    (candidate) => numberValue(candidate.type) === 6 && candidate.name === name,
  );
  const value = recordValue(attribute?.value);

  return stringValue(value?.content);
}

function directiveExpressionFor(node: AstNode, argument: string): string | undefined {
  const directive = nodeProps(node).find((candidate) => {
    const arg = recordValue(candidate.arg);

    return (
      numberValue(candidate.type) === 7 &&
      stringValue(candidate.name) === "bind" &&
      stringValue(arg?.content) === argument
    );
  });
  const expression = recordValue(directive?.exp);

  return stringValue(expression?.content);
}

function nodeProps(node: AstNode): readonly AstNode[] {
  return Array.isArray(node.props) ? node.props.filter(isRecord) : [];
}

function componentNameFromPath(path: string): string {
  const withoutExtension = basename(path).replace(/\.vue$/iu, "");
  const normalized = withoutExtension
    .split(/[^a-z0-9]+/iu)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");

  return normalized.length === 0 ? "Component" : normalized;
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

function isComponentName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/u.test(value);
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function recordValue(value: unknown): AstNode | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
