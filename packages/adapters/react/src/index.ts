import { basename } from "node:path";

import { parse as parseBabel, type ParserPlugin } from "@babel/parser";
import type {
  ComponentMap,
  ComponentMapEntry,
  FrameworkAdapter,
  SourceFileRef,
} from "@zigrivers/surface-core/interfaces";
import { createSurfaceError, type Result, type SurfaceError } from "@zigrivers/surface-core";

export const REACT_ADAPTER_ID = "react";

const NULL_REPLACEMENT_CHARACTER = "\uFFFD";
const SUPPORTED_EXTENSIONS = [".jsx", ".tsx", ".js", ".ts"] as const;
const COMPONENT_ATTRIBUTES = ["data-component", "data-surface-component"] as const;
const SELECTOR_ATTRIBUTES = ["data-testid", "role", "aria-label"] as const;
const WRAPPER_CALLS = ["memo", "forwardRef", "React.memo", "React.forwardRef"] as const;

type AstNode = { readonly type: string; readonly [key: string]: unknown };
type ComponentReference = { readonly component: string; readonly selector: string };
type ComponentDetails = {
  readonly hasJsx: boolean;
  readonly references: readonly ComponentReference[];
  readonly selectors: readonly string[];
};

export interface ReactFrameworkAdapter extends FrameworkAdapter {
  readonly id: typeof REACT_ADAPTER_ID;
  introspect(source: SourceFileRef): Promise<Result<ComponentMap, SurfaceError>>;
}

export function createReactAdapter(): ReactFrameworkAdapter {
  return {
    id: REACT_ADAPTER_ID,
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
        return Promise.resolve(ok({ entries: introspectReactSource(source) }));
      } catch (cause) {
        return Promise.resolve(
          err(
            createSurfaceError("step_failed", "Failed to introspect React source.", {
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

function introspectReactSource(source: SourceFileRef): ComponentMapEntry[] {
  const ast = parseBabel(source.contents, {
    errorRecovery: false,
    plugins: parserPluginsForPath(source.path),
    sourceType: "unambiguous",
  });
  const entries = new Map<string, ComponentMapEntry>();

  walkAst(ast, (node) => {
    const declaration = componentDeclarationFor(node, source.path);

    if (declaration !== undefined) {
      mergeEntry(entries, source.path, declaration.component, declaration.selectors);
      for (const reference of declaration.references) {
        mergeEntry(entries, source.path, reference.component, [reference.selector]);
      }
      return "skip";
    }

    for (const reference of markerReferencesFor(node)) {
      mergeEntry(entries, source.path, reference.component, [reference.selector]);
    }

    return undefined;
  });

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      selectors: [...new Set(entry.selectors)].sort(compareStableStrings),
    }))
    .sort((left, right) => compareStableStrings(left.component, right.component));
}

function parserPluginsForPath(path: string): ParserPlugin[] {
  const isTypeScript = /\.[cm]?tsx?$/u.test(path);
  const supportsJsx = /\.[cm]?[jt]sx$/u.test(path) || /\.[cm]?js$/u.test(path);

  return [
    ...(isTypeScript ? (["typescript"] as const) : (["flow"] as const)),
    ...(supportsJsx ? (["jsx"] as const) : []),
    "classProperties",
    "classPrivateProperties",
    "classPrivateMethods",
  ];
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

function componentDeclarationFor(
  node: AstNode,
  path: string,
): ({ readonly component: string } & ComponentDetails) | undefined {
  if (node.type === "FunctionDeclaration") {
    const name = identifierName(node.id);
    const details = collectComponentDetails(node);

    return name !== undefined && isComponentName(name) && details.hasJsx
      ? { component: name, ...details }
      : undefined;
  }

  if (node.type === "VariableDeclarator") {
    const name = identifierName(node.id);
    const initializer = unwrapReactWrapper(node.init);
    const details = initializer === undefined ? undefined : collectComponentDetails(initializer);

    return name !== undefined &&
      isComponentName(name) &&
      isFunctionLike(initializer) &&
      details?.hasJsx === true
      ? { component: name, ...details }
      : undefined;
  }

  if (node.type === "ClassDeclaration") {
    const name = identifierName(node.id);
    const details = collectComponentDetails(node);

    return name !== undefined &&
      isComponentName(name) &&
      extendsReactBase(node) &&
      classHasJsxRender(node) &&
      details.hasJsx
      ? { component: name, ...details }
      : undefined;
  }

  if (node.type === "ExportDefaultDeclaration") {
    const declaration = asAstNode(node.declaration);

    if (declaration?.type === "FunctionDeclaration") {
      const details = collectComponentDetails(declaration);

      return details.hasJsx
        ? { component: identifierName(declaration.id) ?? componentNameFromPath(path), ...details }
        : undefined;
    }

    if (declaration?.type === "ClassDeclaration") {
      const details = collectComponentDetails(declaration);

      return extendsReactBase(declaration) && classHasJsxRender(declaration) && details.hasJsx
        ? { component: identifierName(declaration.id) ?? componentNameFromPath(path), ...details }
        : undefined;
    }

    const unwrapped = unwrapReactWrapper(declaration);
    const details = unwrapped === undefined ? undefined : collectComponentDetails(unwrapped);

    const name = unwrapped === undefined ? undefined : componentNameFromExpression(unwrapped, path);

    return isFunctionLike(unwrapped) && name !== undefined && details?.hasJsx === true
      ? { component: name, ...details }
      : undefined;
  }

  return undefined;
}

function collectComponentDetails(node: AstNode): ComponentDetails {
  let hasJsx = false;
  const references: ComponentReference[] = [];
  const selectors: string[] = [];

  walkAst(node, (child) => {
    if (child.type === "JSXElement" || child.type === "JSXFragment") {
      hasJsx = true;
    }

    if (child !== node && isNestedComponentBoundary(child)) {
      return "skip";
    }

    if (child.type === "JSXOpeningElement") {
      references.push(...markerReferencesFor(child));

      selectors.push(...selectorsForJsxOpeningElement(child));
    }

    return undefined;
  });

  return { hasJsx, references, selectors };
}

function isNestedComponentBoundary(node: AstNode): boolean {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    return true;
  }

  return node.type === "VariableDeclarator" && isFunctionLike(unwrapReactWrapper(node.init));
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}

function markerReferencesFor(node: AstNode): ComponentReference[] {
  if (node.type !== "JSXOpeningElement") {
    return [];
  }

  return COMPONENT_ATTRIBUTES.flatMap((attribute) => {
    const rawValue = jsxStringAttribute(node, attribute);
    const component = sanitizeComponentName(rawValue);

    return component === undefined || !isComponentName(component)
      ? []
      : [{ component, selector: `[${attribute}="${escapeCssString(rawValue ?? "")}"]` }];
  });
}

function selectorsForJsxOpeningElement(node: AstNode): string[] {
  const elementName = jsxElementName(node.name);

  if (elementName === undefined) {
    return [];
  }

  const selectors: string[] = [];

  for (const attribute of COMPONENT_ATTRIBUTES) {
    const value = jsxStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  const id = jsxStringAttribute(node, "id");

  if (id !== undefined && id.trim().length > 0) {
    selectors.push(`[id="${escapeCssString(id)}"]`);
  }

  for (const attribute of SELECTOR_ATTRIBUTES) {
    const value = jsxStringAttribute(node, attribute);

    if (value !== undefined && value.trim().length > 0) {
      selectors.push(`[${attribute}="${escapeCssString(value)}"]`);
    }
  }

  if (!startsWithLowercase(elementName)) {
    selectors.push(`react:${elementName}`);
  }

  if (selectors.length > 0) {
    return selectors;
  }

  return [elementName];
}

function classHasJsxRender(node: AstNode): boolean {
  const body = asAstNode(node.body);
  const members = asAstNodeArray(body?.body);

  return members.some((member) => {
    const keyName = propertyName(member.key);

    return keyName === "render" && collectComponentDetails(member).hasJsx;
  });
}

function extendsReactBase(node: AstNode): boolean {
  const superClass = calleeName(node.superClass);

  return (
    superClass === "Component" ||
    superClass === "PureComponent" ||
    superClass === "React.Component" ||
    superClass === "React.PureComponent"
  );
}

function unwrapReactWrapper(node: unknown): AstNode | undefined {
  let current = asAstNode(node);

  while (current?.type === "CallExpression" && isReactWrapperCall(current)) {
    current = asAstNode(asAstNodeArray(current.arguments)[0]);
  }

  return current;
}

function isReactWrapperCall(node: AstNode): boolean {
  const callee = calleeName(node.callee);

  return callee !== undefined && WRAPPER_CALLS.includes(callee as (typeof WRAPPER_CALLS)[number]);
}

function isFunctionLike(node: unknown): node is AstNode {
  const candidate = asAstNode(node);

  return (
    candidate?.type === "ArrowFunctionExpression" ||
    candidate?.type === "FunctionExpression" ||
    candidate?.type === "FunctionDeclaration"
  );
}

function jsxStringAttribute(node: AstNode, attributeName: string): string | undefined {
  const attributes = asAstNodeArray(node.attributes);

  for (const attribute of attributes) {
    if (attribute.type !== "JSXAttribute" || jsxElementName(attribute.name) !== attributeName) {
      continue;
    }

    const value = attribute.value;

    if (value === null) {
      return "";
    }

    if (isAstNode(value) && value.type === "StringLiteral" && typeof value.value === "string") {
      return value.value;
    }

    const expression = isAstNode(value) ? asAstNode(value.expression) : undefined;

    if (expression?.type === "StringLiteral" && typeof expression.value === "string") {
      return expression.value;
    }

    if (expression?.type === "TemplateLiteral") {
      const quasis = asAstNodeArray(expression.quasis);
      const expressions = Array.isArray(expression.expressions) ? expression.expressions : [];
      const cooked = objectValue(quasis[0]?.value, "cooked");

      if (quasis.length === 1 && expressions.length === 0 && typeof cooked === "string") {
        return cooked;
      }
    }
  }

  return undefined;
}

function walkAst(root: unknown, visit: (node: AstNode) => "skip" | undefined | void): void {
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();

    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (isAstNode(current) && visit(current) === "skip") {
      continue;
    }

    for (const value of Object.values(current)) {
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          pending.push(value[index]);
        }
      } else if (typeof value === "object" && value !== null) {
        pending.push(value);
      }
    }
  }
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

function asAstNode(value: unknown): AstNode | undefined {
  return isAstNode(value) ? value : undefined;
}

function asAstNodeArray(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function identifierName(node: unknown): string | undefined {
  const candidate = asAstNode(node);

  return candidate?.type === "Identifier" && typeof candidate.name === "string"
    ? candidate.name
    : undefined;
}

function jsxElementName(node: unknown): string | undefined {
  const candidate = asAstNode(node);

  if (candidate?.type === "JSXIdentifier" && typeof candidate.name === "string") {
    return candidate.name;
  }

  if (candidate?.type === "JSXMemberExpression") {
    const object = jsxElementName(candidate.object);
    const property = jsxElementName(candidate.property);

    return object !== undefined && property !== undefined ? `${object}.${property}` : undefined;
  }

  return undefined;
}

function calleeName(node: unknown): string | undefined {
  const candidate = asAstNode(node);

  if (candidate?.type === "Identifier" && typeof candidate.name === "string") {
    return candidate.name;
  }

  if (candidate?.type === "MemberExpression") {
    const object = calleeName(candidate.object);
    const property =
      candidate.computed === true
        ? stringLiteralValue(candidate.property)
        : propertyName(candidate.property);

    return object !== undefined && property !== undefined ? `${object}.${property}` : undefined;
  }

  return undefined;
}

function propertyName(node: unknown): string | undefined {
  const candidate = asAstNode(node);

  if (
    (candidate?.type === "Identifier" || candidate?.type === "JSXIdentifier") &&
    typeof candidate.name === "string"
  ) {
    return candidate.name;
  }

  return stringLiteralValue(candidate);
}

function stringLiteralValue(node: unknown): string | undefined {
  const candidate = asAstNode(node);

  return candidate?.type === "StringLiteral" && typeof candidate.value === "string"
    ? candidate.value
    : undefined;
}

function componentNameFromPath(path: string): string {
  const file = basename(path).replace(/\.[cm]?[jt]sx?$/u, "");
  const normalized = file
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");

  if (normalized.length === 0) {
    return "DefaultExport";
  }

  return isComponentName(normalized) ? normalized : `Default${normalized}`;
}

function componentNameFromExpression(node: AstNode, path: string): string {
  const name = identifierName(node.id);

  return name !== undefined && isComponentName(name) ? name : componentNameFromPath(path);
}

function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/u.test(name);
}

function startsWithLowercase(name: string): boolean {
  return /^[a-z]/u.test(name);
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
