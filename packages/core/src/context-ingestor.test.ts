import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createStaticCaptureBackend } from "./capture.js";
import { resolveSurfaceConfig } from "./config.js";
import { createContextIngestor } from "./context-ingestor.js";
import { createSurfaceError, isErr, isOk, ok } from "./errors.js";
import type { FrameworkAdapter } from "./interfaces.js";

const clock = () => "2026-05-31T18:00:00.000Z";
const oneByOnePngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function createTemporaryRoot(): Promise<string> {
  const root = `.surface-context-ingestor-${randomUUID()}`;
  await mkdir(root);
  return root;
}

async function removeTemporaryRoots(...roots: readonly string[]): Promise<void> {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
}

describe("createContextIngestor", () => {
  it("constructs screenshot targets and provenance for contents-only screenshot inputs", async () => {
    const root = await createTemporaryRoot();

    try {
      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        screenshot: { contents: "png-bytes" },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.target.kind).toBe("screenshot");
      expect(result.value.target.ref).toMatch(
        /\.surface\/context-inputs\/screenshot-[a-f0-9]{12}\.png$/,
      );
      expect(result.value.context.screenshot).toEqual({
        contents: "png-bytes",
        path: result.value.target.ref,
      });
      await expect(readFile(result.value.target.ref, "utf8")).resolves.toBe("png-bytes");
      expect(result.value.provenance).toMatchObject([
        {
          kind: "screenshot",
          present: true,
          recordedAt: "2026-05-31T18:00:00.000Z",
          ref: result.value.target.ref,
        },
      ]);
      expect(result.value.provenance[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("materializes inline PNG screenshot inputs so static capture can consume them", async () => {
    const root = await createTemporaryRoot();

    try {
      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        screenshot: { contents: oneByOnePngBase64 },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      const capture = await createStaticCaptureBackend({
        clock,
        idFactory: () => "inline-screenshot",
      }).observe(result.value.target, {
        artifactRoot: join(root, "captures"),
        config: resolveSurfaceConfig().capture,
      });

      expect(isOk(capture)).toBe(true);

      if (!capture.ok) {
        return;
      }

      expect(capture.value.artifacts[0]).toMatchObject({
        path: join(root, "captures", "inline-screenshot", "screenshot.png"),
        type: "screenshot",
      });
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("prefers screenshot targets when DOM context is also supplied for static capture", async () => {
    const root = await createTemporaryRoot();

    try {
      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        dom: { contents: "<main>DOM context</main>", path: "dom.html" },
        screenshot: { contents: oneByOnePngBase64 },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.context.dom).toEqual({
        contents: "<main>DOM context</main>",
        path: "dom.html",
      });
      expect(result.value.target.kind).toBe("screenshot");

      const capture = await createStaticCaptureBackend({
        clock,
        idFactory: () => "dom-with-screenshot",
      }).observe(result.value.target, {
        artifactRoot: join(root, "captures"),
        config: resolveSurfaceConfig().capture,
      });

      expect(isOk(capture)).toBe(true);
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("rejects inline screenshot materialization through a .surface symlink outside the project", async () => {
    const root = await createTemporaryRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "surface-context-ingestor-outside-"));

    try {
      await symlink(outsideRoot, join(root, ".surface"), "dir");

      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        screenshot: { contents: oneByOnePngBase64 },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Context input paths must be relative paths inside the project.",
        },
      });
    } finally {
      await removeTemporaryRoots(root, outsideRoot);
    }
  });

  it("rejects inline source materialization through a symlink leaf outside the project", async () => {
    const root = await createTemporaryRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "surface-context-ingestor-outside-"));

    try {
      const contents = "<main>Static source</main>";
      const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
      const outsidePath = join(outsideRoot, "outside.html");
      const outputRoot = join(root, ".surface", "context-inputs");
      await mkdir(outputRoot, { recursive: true });
      await writeFile(outsidePath, "outside");
      await symlink(outsidePath, join(outputRoot, `source-${hash}.html`));

      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        source: { contents },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Context input paths must be relative paths inside the project.",
        },
      });
      await expect(readFile(outsidePath, "utf8")).resolves.toBe("outside");
    } finally {
      await removeTemporaryRoots(root, outsideRoot);
    }
  });

  it("constructs screenshot targets for path-only screenshot inputs without reading image bytes", async () => {
    const root = await createTemporaryRoot();

    try {
      const path = join(root, "screenshot.png");
      await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1));
      const resolvedPath = await realpath(path);

      const result = await createContextIngestor({ clock }).ingest({
        screenshot: { path },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.target).toEqual({ kind: "screenshot", ref: resolvedPath });
      expect(result.value.context.screenshot).toEqual({
        contents: "",
        path: resolvedPath,
      });
      expect(result.value.provenance[0]).toMatchObject({
        kind: "screenshot",
        ref: resolvedPath,
      });
      expect(result.value.provenance[0]?.sha256).toBeUndefined();
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("rejects screenshot input symlinks that resolve outside the project", async () => {
    const root = await createTemporaryRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "surface-context-ingestor-outside-"));

    try {
      const outsidePath = join(outsideRoot, "outside.png");
      const linkPath = join(root, "outside-link.png");
      await writeFile(outsidePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      await symlink(outsidePath, linkPath);

      const result = await createContextIngestor({ clock }).ingest({
        screenshot: { path: linkPath },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Context input paths must be relative paths inside the project.",
        },
      });
    } finally {
      await removeTemporaryRoots(root, outsideRoot);
    }
  });

  it("constructs a source-only component target without a component map entry", async () => {
    const root = await createTemporaryRoot();

    try {
      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        source: {
          contents: "<main>Static source</main>",
          path: "src/static.html",
        },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.target.kind).toBe("component");
      expect(result.value.target.ref).toMatch(
        /\.surface\/context-inputs\/source-[a-f0-9]{12}\.html$/,
      );
      await expect(readFile(result.value.target.ref, "utf8")).resolves.toBe(
        "<main>Static source</main>",
      );
      expect(result.value.componentMap.entries).toEqual([]);

      const capture = await createStaticCaptureBackend({
        clock,
        idFactory: () => "source-only",
      }).observe(result.value.target, {
        artifactRoot: join(root, "captures"),
        config: resolveSurfaceConfig().capture,
      });

      expect(isOk(capture)).toBe(true);
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("resolves input paths against an explicit project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "surface-context-ingestor-root-"));

    try {
      await mkdir(join(root, "src"));
      await writeFile(join(root, "src", "Widget.html"), "<main>Widget</main>");

      const result = await createContextIngestor({ clock, projectRoot: root }).ingest({
        source: { path: "src/Widget.html" },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      const resolvedPath = await realpath(join(root, "src", "Widget.html"));
      expect(result.value.context.sources).toEqual([
        { contents: "<main>Widget</main>", path: "src/Widget.html" },
      ]);
      expect(result.value.target).toEqual({ kind: "component", ref: resolvedPath });
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("returns config_invalid for malformed top-level input", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "   ",
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Context ingestion input is invalid.",
      },
    });
  });

  it("returns config_invalid when a context input file cannot be read", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Missing",
      source: { path: "missing-context-input.html" },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        details: { path: "missing-context-input.html" },
        message: "Context input file could not be read.",
      },
    });
  });

  it("loads source contents from a relative file inside the project", async () => {
    const root = await createTemporaryRoot();

    try {
      const path = join(root, "Card.html");
      await writeFile(path, '<article data-component="Card">Basic</article>');

      const result = await createContextIngestor({ clock }).ingest({
        component: "Card",
        source: { path },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.context.sources[0]).toEqual({
        contents: '<article data-component="Card">Basic</article>',
        path,
      });
      expect(result.value.target).toEqual({
        kind: "component",
        ref: await realpath(path),
      });
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("allows relative paths with names that start with two dots without parent traversal", async () => {
    const root = `..surface-context-ingestor-${randomUUID()}`;
    await mkdir(root);

    try {
      const path = join(root, "Card.html");
      await writeFile(path, '<article data-component="Card">Basic</article>');

      const result = await createContextIngestor({ clock }).ingest({
        component: "Card",
        source: { path },
      });

      expect(isOk(result)).toBe(true);

      if (!result.ok) {
        return;
      }

      expect(result.value.context.sources[0]?.path).toBe(path);
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("rejects context input paths outside the project", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Outside",
      source: { path: "../outside.html" },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Context input paths must be relative paths inside the project.",
      },
    });
  });

  it("rejects normalized path traversal through intermediate segments", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Outside",
      source: { path: "safe/../../outside.html" },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Context input paths must be relative paths inside the project.",
      },
    });
  });

  it("rejects context input symlinks that resolve outside the project", async () => {
    const root = await createTemporaryRoot();
    const outsideRoot = await mkdtemp(join(tmpdir(), "surface-context-ingestor-outside-"));

    try {
      const outsidePath = join(outsideRoot, "outside.html");
      const linkPath = join(root, "outside-link.html");
      await writeFile(outsidePath, "<main data-component='Outside'></main>");
      await symlink(outsidePath, linkPath);

      const result = await createContextIngestor({ clock }).ingest({
        component: "Outside",
        source: { path: linkPath },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Context input paths must be relative paths inside the project.",
        },
      });
    } finally {
      await removeTemporaryRoots(root, outsideRoot);
    }
  });

  it("rejects oversized context input files", async () => {
    const root = await createTemporaryRoot();

    try {
      const path = join(root, "oversized.html");
      await writeFile(path, "x".repeat(2 * 1024 * 1024 + 1));

      const result = await createContextIngestor({ clock }).ingest({
        component: "Oversized",
        source: { path },
      });

      expect(isErr(result)).toBe(true);
      expect(result).toMatchObject({
        error: {
          code: "config_invalid",
          message: "Context input file is too large.",
        },
      });
    } finally {
      await removeTemporaryRoots(root);
    }
  });

  it("rejects oversized inline context input contents before ingesting them", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Oversized",
      source: { contents: "x".repeat(2 * 1024 * 1024 + 1) },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Context input file is too large.",
      },
    });
  });

  it("validates source path labels even when inline contents are supplied", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Outside",
      source: { contents: "<main />", path: "../outside.html" },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        message: "Context input paths must be relative paths inside the project.",
      },
    });
  });

  it("records token document, persona, and task context provenance", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      personas: [{ goals: ["compare plans"], id: "buyer", priorKnowledge: "returning" }],
      source: {
        contents: '<article data-component="PlanCard">Pro</article>',
        path: "src/PlanCard.html",
      },
      tasks: [
        {
          conversionCritical: true,
          id: "choose-plan",
          personaId: "buyer",
          steps: ["open pricing"],
        },
      ],
      tokenDocuments: [{ contents: '{"color":{"primary":"#0055ff"}}', path: "tokens.json" }],
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.context.designTokens).toEqual([
      { name: "color.primary", value: "#0055ff" },
    ]);
    expect(result.value.context.personas).toEqual([
      { goals: ["compare plans"], id: "buyer", priorKnowledge: "returning" },
    ]);
    expect(result.value.context.tasks).toEqual([
      {
        conversionCritical: true,
        id: "choose-plan",
        personaId: "buyer",
        steps: ["open pricing"],
      },
    ]);
    expect(result.value.provenance.map((entry) => entry.kind)).toEqual([
      "component",
      "source",
      "design-tokens",
      "design-tokens",
      "persona",
      "task",
    ]);
    const tokenDocumentProvenance = result.value.provenance.find(
      (entry) => entry.ref === "tokens.json",
    );

    expect(tokenDocumentProvenance).toMatchObject({
      kind: "design-tokens",
    });
    expect(tokenDocumentProvenance?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects tasks that reference an unknown persona", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      personas: [{ id: "buyer" }],
      tasks: [{ id: "choose-plan", personaId: "seller" }],
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        details: { personaId: "seller" },
        message: "Task personaId must match a supplied persona.",
      },
    });
  });

  it("uses stable design-token provenance hashes for equivalent token sets", async () => {
    const first = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      designTokens: [
        { name: "space.sm", value: "8px" },
        { name: "color.primary", value: "#0055ff" },
      ],
    });
    const second = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      designTokens: [
        { name: "color.primary", value: "#0055ff" },
        { name: "space.sm", value: "8px" },
      ],
    });

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);

    if (!first.ok || !second.ok) {
      return;
    }

    expect(first.value.provenance.find((entry) => entry.kind === "design-tokens")?.sha256).toBe(
      second.value.provenance.find((entry) => entry.kind === "design-tokens")?.sha256,
    );
    expect(first.value.provenance.find((entry) => entry.kind === "design-tokens")?.ref).toBe(
      second.value.provenance.find((entry) => entry.kind === "design-tokens")?.ref,
    );
  });

  it("deduplicates equivalent design tokens before context and provenance", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      designTokens: [
        { name: "color.primary", value: "#0055ff" },
        { name: "color.primary", value: "#0055ff" },
      ],
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.context.designTokens).toEqual([
      { name: "color.primary", value: "#0055ff" },
    ]);
    expect(result.value.provenance.find((entry) => entry.kind === "design-tokens")?.ref).toBe(
      "color.primary",
    );
  });

  it("rejects conflicting duplicate design-token values", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      designTokens: [
        { name: "color.primary", value: "#0055ff" },
        { name: "color.primary", value: "#ff0000" },
      ],
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        details: {
          existingValue: "#0055ff",
          name: "color.primary",
          value: "#ff0000",
        },
        message: "Design token values conflict for the same token name.",
      },
    });
  });

  it("returns actionable config errors for malformed token documents", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PlanCard",
      tokenDocuments: [{ contents: "{not-json}", path: "tokens.json" }],
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "config_invalid",
        details: {
          path: "tokens.json",
        },
        message: "Design token document must be valid JSON with string or numeric token values.",
      },
    });
  });

  it("uses injected framework adapters for component mapping", async () => {
    const adapter: FrameworkAdapter = {
      id: "test-adapter",
      introspect: (source) =>
        ok({
          entries: [
            {
              component: "Widget",
              file: source.path,
              selectors: ["main > button"],
            },
          ],
        }),
      supports: (file) => file.endsWith(".tsx"),
    };

    const result = await createContextIngestor({ adapters: [adapter], clock }).ingest({
      component: "Widget",
      source: { contents: "export function Widget() { return <button />; }", path: "Widget.tsx" },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.componentMap.entries).toEqual([
      {
        component: "Widget",
        file: "Widget.tsx",
        selectors: ["main > button"],
      },
    ]);
  });

  it("aggregates adapter and fallback component-map entries across multiple sources", async () => {
    const adapter: FrameworkAdapter = {
      id: "test-adapter",
      introspect: (source) =>
        ok({
          entries: [
            {
              component: "Widget",
              file: source.path,
              selectors: ["main > button"],
            },
          ],
        }),
      supports: (file) => file.endsWith(".tsx"),
    };

    const result = await createContextIngestor({ adapters: [adapter], clock }).ingest({
      component: "Widget",
      sources: [
        { contents: "export function Widget() { return <button />; }", path: "Widget.tsx" },
        { contents: '<main data-component="Widget"></main>', path: "Widget.html" },
      ],
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.componentMap.entries).toEqual([
      {
        component: "Widget",
        file: "Widget.tsx",
        selectors: ["main > button"],
      },
      {
        component: "Widget",
        file: "Widget.html",
        selectors: ['[data-component="Widget"]'],
      },
    ]);
  });

  it("does not emit selectors for component names with different casing", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "PrimaryButton",
      source: {
        contents: '<button data-component="primarybutton">Buy now</button>',
        path: "PrimaryButton.html",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.componentMap.entries).toEqual([
      {
        component: "PrimaryButton",
        file: "PrimaryButton.html",
        selectors: [],
      },
    ]);
  });

  it("returns adapter errors without swallowing them", async () => {
    const adapter: FrameworkAdapter = {
      id: "broken-adapter",
      introspect: () =>
        ({
          error: createSurfaceError("step_failed", "Adapter failed."),
          ok: false,
        }) as const,
      supports: () => true,
    };

    const result = await createContextIngestor({ adapters: [adapter], clock }).ingest({
      component: "Widget",
      source: { contents: "<main />", path: "Widget.html" },
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "step_failed",
        message: "Adapter failed.",
      },
    });
  });

  it("returns later adapter errors without producing a partial component map", async () => {
    const adapter: FrameworkAdapter = {
      id: "broken-adapter",
      introspect: (source) => {
        if (source.path === "Broken.tsx") {
          return {
            error: createSurfaceError("step_failed", "Second adapter failed."),
            ok: false,
          } as const;
        }

        return ok({
          entries: [
            {
              component: "Widget",
              file: source.path,
              selectors: ["main > button"],
            },
          ],
        });
      },
      supports: (file) => file.endsWith(".tsx"),
    };

    const result = await createContextIngestor({ adapters: [adapter], clock }).ingest({
      component: "Widget",
      sources: [
        { contents: "export function Widget() { return <button />; }", path: "Widget.tsx" },
        { contents: "export function Broken() { return <main />; }", path: "Broken.tsx" },
      ],
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "step_failed",
        message: "Second adapter failed.",
      },
    });
  });

  it("does not emit token contradiction findings from TypeScript-like sources", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Button",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: 'const style = { root: "--color-primary: #ff0000" };',
        path: "src/Button.tsx",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("does not scan plain HTML text as bare CSS declarations", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Card",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: '<main data-copy="--color-primary: #ff0000">Choose a plan</main>',
        path: "src/Card.html",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("does not scan CSS examples inside HTML prose or code blocks", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Docs",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: "<pre>.example { --color-primary: #ff0000; }</pre>",
        path: "src/Docs.html",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("matches CSS custom properties case-sensitively", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      dom: { contents: "<style>:root { --Color-primary: #ff0000; }</style>" },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("emits token contradictions for top-level CSS custom properties and strips important", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: { contents: "--color-primary: #ff0000 !important;", path: "theme.css" },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]).toMatchObject({
      location: { elementRef: "CSS custom property --color-primary" },
    });
    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      rule: "css-custom-property-contradiction",
      threshold: "#0055ff",
      tool: "context-ingestor",
    });
    expect(result.value.findings[0]?.evidence[1]).toMatchObject({
      selector: ":root",
    });
  });

  it("emits token contradictions for multiline CSS custom-property values", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: ":root {\n  --color-primary:\n    #ff0000;\n}",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      threshold: "#0055ff",
    });
  });

  it("records scoped CSS selectors for custom-property contradictions", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: ".theme { --color-primary: #ff0000; }",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[1]).toMatchObject({
      selector: ".theme",
    });
  });

  it("emits a contradiction when any duplicate custom property value mismatches", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      dom: {
        contents:
          "<style>:root { --color-primary: #ff0000; } .theme { --color-primary: #0055ff; }</style>",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toHaveLength(1);
    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      threshold: "#0055ff",
    });
  });

  it("emits token contradictions inside nested CSS at-rules", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: "@media (min-width: 40rem) { :root { --color-primary: #ff0000; } }",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      threshold: "#0055ff",
    });
  });

  it("records best-effort selectors for nested CSS rules with complex selectors", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: "@layer components{.theme:is(.active) > .button{--color-primary:#ff0000;}}",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[1]).toMatchObject({
      selector: ".theme:is(.active) > .button",
    });
  });

  it("keeps semicolons inside quoted and parenthesized CSS custom-property values", async () => {
    const complexValue = 'url("data:image/svg+xml;utf8,<svg></svg>")';
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "image.hero", value: "none" }],
      source: {
        contents: `:root { --image-hero: ${complexValue}; }`,
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: complexValue,
      threshold: "none",
    });
  });

  it("does not treat custom-property-like text inside CSS string values as declarations", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: ':root { --content-label: "--color-primary: #ff0000"; }',
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("does not treat custom-property-like text inside standard CSS string values as declarations", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: ':root::before { content: "--color-primary: #ff0000"; }',
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("does not parse declarations after an unclosed CSS comment", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents: "/* disabled theme --color-primary: #ff0000;",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings).toEqual([]);
  });

  it("keeps declarations after CSS comment markers inside string values", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
      source: {
        contents:
          ':root::before { content: "/* not a comment"; } :root { --color-primary: #ff0000; }',
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      threshold: "#0055ff",
    });
  });

  it("maps mixed-case token names to lowercase CSS custom-property names", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      component: "Theme",
      designTokens: [{ name: "Color.Primary", value: "#0055ff" }],
      source: {
        contents: ":root { --color-primary: #ff0000; }",
        path: "theme.css",
      },
    });

    expect(isOk(result)).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.value.findings[0]?.evidence[0]).toMatchObject({
      measuredValue: "#ff0000",
      threshold: "#0055ff",
    });
  });

  it("returns no_target when no target-bearing input is present", async () => {
    const result = await createContextIngestor({ clock }).ingest({
      designTokens: [{ name: "color.primary", value: "#0055ff" }],
    });

    expect(isErr(result)).toBe(true);
    expect(result).toMatchObject({
      error: {
        code: "no_target",
      },
    });
  });
});
