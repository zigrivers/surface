import { basename } from "node:path";

import type {
  ComponentMap,
  ComponentMapEntry,
  FrameworkAdapter,
  SourceFileRef,
} from "@zigrivers/surface-core/interfaces";
import { createSurfaceError, type Result, type SurfaceError } from "@zigrivers/surface-core";
import { parse } from "svelte/compiler";

export const SVELTE_ADAPTER_ID = "svelte";

const NULL_REPLACEMENT_CHARACTER = "\uFFFD";
const SUPPORTED_EXTENSIONS = [".svelte"] as const;
const COMPONENT_ATTRIBUTES = ["data-component", "data-surface-component"] as const;
const SELECTOR_ATTRIBUTES = ["data-testid", "role", "aria-label"] as const;

type AstNode = Readonly<Record<string, unknown>>;
type ComponentReference = { readonly component: string; readonly selector: string };
type ComponentDetails = {
  readonly references: readonly ComponentReference[];
  readonly selectors: readonly string[];
};

export interface SvelteFrameworkAdapter extends FrameworkAdapter {
  readonly id: typeof SVELTE_ADAPTER_ID;
  introspect(source: SourceFileRef): Promise<Result<ComponentMap, SurfaceError>>;
}

export function createSvelteAdapter(): SvelteFrameworkAdapter {
  return {
    id: SVELTE_ADAPTER_ID,
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
        return Promise.resolve(ok({ entries: introspectSvelteSource(source) }));
      } catch (cause) {
        return Promise.resolve(
          err(
            createSurfaceError("step_failed", "Failed to introspect Svelte source.", {
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

function introspectSvelteSource(source: SourceFileRef): ComponentMapEntry[] {
  const root = parse(source.contents, { filename: source.path, modern: true }) as unknown;
  const fragment = recordValue(root)?.fragment;
  const details = collectComponentDetails(fragment);
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

function collectComponentDetails(root: unknown): ComponentDetails {
  const references: ComponentReference[] = [];
  const selectors: string[] = [];

  walkSvelteNodes(root, (node) => {
    references.push(...markerReferencesFor(node));
    selectors.push(...selectorsForSvelteNode(node));
  });

  return { references, selectors };
}

function walkSvelteNodes(root: unknown, visit: (node: AstNode) => void): void {
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const value = pending.pop();
    const node = recordValue(value);

    if (node === undefined) {
      continue;
    }

    visit(node);
    pending.push(...nodesForFragment(node.fragment));
    pending.push(...nodesForFragment(node));
  }
}

function nodesForFragment(value: unknown): readonly unknown[] {
  const fragment = recordValue(value);
  const nodes = fragment?.nodes;

  return Array.isArray(nodes) ? nodes : [];
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
    const rawValue = svelteStringAttribute(node, attribute);
    const component = sanitizeComponentName(rawValue);

    return component === undefined || !isComponentName(component)
      ? []
      : [{ component, selector: `[${attribute}="${escapeCssString(rawValue ?? "")}"]` }];
  });
}

function selectorsForSvelteNode(node: AstNode): string[] {
  const elementName = stringValue(node.name);

  if (elementName === undefined) {
    return [];
  }

  const selectors: string[] = [];

  for (const attribute of COMPONENT_ATTRIBUTES) {
    const value = svelteStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  const id = svelteStringAttribute(node, "id");

  if (id !== undefined && id.trim().length > 0) {
    selectors.push(`[id="${escapeCssString(id)}"]`);
  }

  for (const attribute of SELECTOR_ATTRIBUTES) {
    const value = svelteStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  if (node.type === "Component" && isComponentName(elementName)) {
    selectors.push(`svelte:${elementName}`);
  }

  if (node.type === "SvelteComponent") {
    const expressionName = identifierName(node.expression);

    if (expressionName !== undefined && isComponentName(expressionName)) {
      selectors.push(`svelte:${expressionName}`);
    }
  }

  if (selectors.length > 0) {
    return selectors;
  }

  return [];
}

function svelteStringAttribute(node: AstNode, name: string): string | undefined {
  const attribute = nodeAttributes(node).find((candidate) => candidate.name === name);
  const value = attribute?.value;

  if (value === true) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeNullCharacters(value);
  }

  if (!Array.isArray(value) || value.length !== 1) {
    return undefined;
  }

  const valueNode = recordValue(value[0]);

  if (valueNode?.type !== "Text") {
    return undefined;
  }

  return stringValue(valueNode.data) ?? stringValue(valueNode.raw);
}

function nodeAttributes(node: AstNode): readonly AstNode[] {
  return Array.isArray(node.attributes) ? node.attributes.filter(isRecord) : [];
}

function componentNameFromPath(path: string): string {
  const withoutExtension = basename(path).replace(/\.svelte$/iu, "");
  const normalized = withoutExtension
    .split(/[^a-z0-9]+/iu)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");

  return normalized.length === 0 ? "Component" : normalized;
}

function identifierName(value: unknown): string | undefined {
  const node = recordValue(value);

  return node?.type === "Identifier" ? stringValue(node.name) : undefined;
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

function recordValue(value: unknown): AstNode | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
