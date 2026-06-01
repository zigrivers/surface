import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { createAgnosticAdapter } from "./index.js";

describe("agnostic framework adapter", () => {
  it("supports static HTML-like source files", () => {
    const adapter = createAgnosticAdapter();

    expect(adapter.id).toBe("agnostic");
    expect(adapter.supports("fixtures/plain.html")).toBe(true);
    expect(adapter.supports("fixtures/plain.HTM")).toBe(true);
    expect(adapter.supports("src/Button.tsx")).toBe(false);
  });

  it("maps declared agnostic components to stable selectors", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/plain.html",
      contents: `
        <main>
          <section data-component="CheckoutSummary">
            <button id="pay-now">Pay now</button>
          </section>
          <aside data-surface-component="HelpPanel">
            <a href="/support">Support</a>
          </aside>
        </main>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "CheckoutSummary",
            file: "fixtures/plain.html",
            selectors: ['[data-component="CheckoutSummary"]'],
          },
          {
            component: "HelpPanel",
            file: "fixtures/plain.html",
            selectors: ['[data-surface-component="HelpPanel"]'],
          },
        ],
      },
    });
  });

  it("merges duplicate component hints across supported marker attributes", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/duplicates.html",
      contents: `
        <main>
          <section data-component=" Panel "></section>
          <aside data-surface-component="Panel"></aside>
          <footer data-component="Panel"></footer>
        </main>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Panel",
            file: "fixtures/duplicates.html",
            selectors: [
              '[data-component=" Panel "]',
              '[data-surface-component="Panel"]',
              '[data-component="Panel"]',
            ],
          },
        ],
      },
    });
  });

  it("maps both marker attributes when they appear on the same element", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/mixed-markers.html",
      contents: '<section data-component="Hero" data-surface-component="HeroSurface"></section>',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Hero",
            file: "fixtures/mixed-markers.html",
            selectors: ['[data-component="Hero"]'],
          },
          {
            component: "HeroSurface",
            file: "fixtures/mixed-markers.html",
            selectors: ['[data-surface-component="HeroSurface"]'],
          },
        ],
      },
    });
  });

  it("escapes generated selectors for quoted, slashed, and multiline component names", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/special.html",
      contents: '<section data-component="Checkout&quot;Summary\nPanel\\x"></section>',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: 'Checkout"Summary\nPanel\\x',
            file: "fixtures/special.html",
            selectors: ['[data-component="Checkout\\"Summary\\a Panel\\\\x"]'],
          },
        ],
      },
    });
  });

  it("traverses component markers inside template content", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/templates.html",
      contents: `
        <template data-component="TemplateHost">
          <main data-surface-component="TemplatePanel"></main>
        </template>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "TemplateHost",
            file: "fixtures/templates.html",
            selectors: ['[data-component="TemplateHost"]'],
          },
          {
            component: "TemplatePanel",
            file: "fixtures/templates.html",
            selectors: ['[data-surface-component="TemplatePanel"]'],
          },
        ],
      },
    });
  });

  it("normalizes null characters in component names while preserving selector values", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/nullish.html",
      contents: '<section data-component="Null\0Name"></section>',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Null\uFFFDName",
            file: "fixtures/nullish.html",
            selectors: ['[data-component="Null\uFFFDName"]'],
          },
        ],
      },
    });
  });

  it("falls back to a document component for plain HTML without component hints", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/static.html",
      contents: "<!doctype html><html><body><main><h1>Welcome</h1></main></body></html>",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/static.html",
            selectors: ["html", "body", "main"],
          },
        ],
      },
    });
  });

  it("maps the seeded plain HTML defect fixture to stable component selectors", async () => {
    const adapter = createAgnosticAdapter();
    const fixtureUrl = new URL(
      "../../../../fixtures/seeded-defects/plain-html/index.html",
      import.meta.url,
    );
    const contents = await readFile(fixtureUrl, "utf8");

    const result = await adapter.introspect({
      path: "fixtures/seeded-defects/plain-html/index.html",
      contents,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    const entriesByComponent = new Map(
      result.value.entries.map((entry) => [entry.component, entry]),
    );

    expect([...entriesByComponent.keys()].sort()).toEqual([
      "EmptyOrdersState",
      "LowContrastHero",
      "SeededDefectHtmlFixture",
      "TargetSizeControls",
    ]);
    const fixtureEntry = entriesByComponent.get("SeededDefectHtmlFixture");
    const lowContrastEntry = entriesByComponent.get("LowContrastHero");
    const targetSizeEntry = entriesByComponent.get("TargetSizeControls");
    const emptyOrdersEntry = entriesByComponent.get("EmptyOrdersState");

    expect(fixtureEntry?.file).toBe("fixtures/seeded-defects/plain-html/index.html");
    expect(fixtureEntry?.selectors).toEqual(
      expect.arrayContaining(['[data-component="SeededDefectHtmlFixture"]']),
    );
    expect(lowContrastEntry?.file).toBe("fixtures/seeded-defects/plain-html/index.html");
    expect(lowContrastEntry?.selectors).toEqual(
      expect.arrayContaining(['[data-surface-component="LowContrastHero"]']),
    );
    expect(targetSizeEntry?.file).toBe("fixtures/seeded-defects/plain-html/index.html");
    expect(targetSizeEntry?.selectors).toEqual(
      expect.arrayContaining(['[data-surface-component="TargetSizeControls"]']),
    );
    expect(emptyOrdersEntry?.file).toBe("fixtures/seeded-defects/plain-html/index.html");
    expect(emptyOrdersEntry?.selectors).toEqual(
      expect.arrayContaining(['[data-surface-component="EmptyOrdersState"]']),
    );
  });

  it("returns an error result for malformed source references", async () => {
    const adapter = createAgnosticAdapter();

    for (const source of [
      null,
      { contents: "<main></main>" },
      { path: "fixtures/malformed.html", contents: null },
      { path: "fixtures/malformed.html", contents: 123 },
    ]) {
      const result = await adapter.introspect(source as never);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({
          kind: "RuntimeError",
          code: "step_failed",
          message: "SourceFileRef requires string path and contents.",
        });
      }
    }
  });

  it("uses parse5 implicit document structure for empty and fragment-like HTML", async () => {
    const adapter = createAgnosticAdapter();

    await expect(
      adapter.introspect({
        path: "fixtures/empty.html",
        contents: "",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/empty.html",
            selectors: ["html", "body"],
          },
        ],
      },
    });

    await expect(
      adapter.introspect({
        path: "fixtures/fragment.html",
        contents: "<main><h1>Welcome</h1></main>",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/fragment.html",
            selectors: ["html", "body", "main"],
          },
        ],
      },
    });
  });

  it("falls back to the implicit document structure for non-HTML text", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/not-html.html",
      contents: "plain text without markup",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/not-html.html",
            selectors: ["html", "body"],
          },
        ],
      },
    });
  });

  it("walks deeply nested generated HTML without recursive traversal limits", async () => {
    const adapter = createAgnosticAdapter();
    const depth = 5_000;
    const result = await adapter.introspect({
      path: "fixtures/deep.html",
      contents: `${"<div>".repeat(depth)}<main></main>${"</div>".repeat(depth)}`,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/deep.html",
            selectors: ["html", "body", "main"],
          },
        ],
      },
    });
  });

  it("omits absent fallback selectors for plain HTML without a main landmark", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/no-main.html",
      contents: "<!doctype html><html><body><h1>Welcome</h1></body></html>",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Document",
            file: "fixtures/no-main.html",
            selectors: ["html", "body"],
          },
        ],
      },
    });
  });

  it("introspects XHTML and foreign-content component markers", async () => {
    const adapter = createAgnosticAdapter();
    const result = await adapter.introspect({
      path: "fixtures/icon.xhtml",
      contents:
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><svg><g data-component="IconGlyph"></g></svg></body></html>',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "IconGlyph",
            file: "fixtures/icon.xhtml",
            selectors: ['[data-component="IconGlyph"]'],
          },
        ],
      },
    });
  });
});
