import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { isOk } from "./errors.js";
import type { Capture, KnowledgeSource, LensContext } from "./interfaces.js";
import { createAccessibilityLens } from "./accessibility-lens.js";

const capture = {
  id: "cap_a11y",
  target: { kind: "url", ref: "http://localhost:3000" },
  backend: "playwright",
  artifacts: [
    { id: "dom", type: "dom-snapshot", path: ".surface/captures/dom.html", redacted: false },
  ],
  capturedAt: "2026-06-01T18:00:00.000Z",
  status: "completed",
} satisfies Capture;

const knowledge = {
  query: () => Promise.resolve({ ok: true as const, value: [] }),
  resolve: (id: string) =>
    Promise.resolve({ ok: true as const, value: { id, summary: id, title: id } }),
} satisfies KnowledgeSource;

describe("accessibility lens", () => {
  it("turns measured accessibility evidence into finding drafts with selectors and measurements", async () => {
    const lens = createAccessibilityLens();
    const result = await lens.evaluate(
      contextWithEvidence([
        {
          kind: "tool-result",
          tool: "axe",
          rule: "color-contrast",
          measuredValue: ".cta: 3.1:1",
          threshold: "4.5:1 (WCAG 2.2 AA)",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "button-name",
          measuredValue: "button.icon: Buttons do not have an accessible name (score 0)",
          threshold: "Lighthouse audit score 1",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "button-name",
          measuredValue: "button: Buttons do not have an accessible name",
        },
        {
          kind: "tool-result",
          tool: "eslint-jsx-a11y",
          rule: "jsx-a11y/alt-text",
          measuredValue: "src/Hero.tsx:12:4 img missing alt text",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "document-title",
          measuredValue: "document-title: Document does not have a title element (score 0)",
          threshold: "Lighthouse audit score 1",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "target-size",
          measuredValue: ".tap-target: Touch targets do not have sufficient size or spacing",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "listitem",
          measuredValue: "ul li: List items are not contained in list parents",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "viewport",
          measuredValue: 'viewport: Does not have a <meta name="viewport"> tag',
          threshold: "Lighthouse audit score 1",
        },
      ]),
    );

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: [
        {
          draftId: "accessibility:contrast-insufficient:.cta",
          evidence: [
            {
              kind: "tool-result",
              measuredValue: ".cta: 3.1:1",
              rule: "color-contrast",
              threshold: "4.5:1 (WCAG 2.2 AA)",
              tool: "axe",
            },
            { kind: "dom", selector: ".cta" },
          ],
          issueType: "contrast-insufficient",
          lens: "accessibility",
          location: { selector: ".cta" },
          method: "measured",
          rawDimensions: { confidence: 0.92, evidenceQuality: 0.94 },
          rationale:
            "Text contrast is below the required threshold. axe reported color-contrast: .cta: 3.1:1. The failing threshold was 4.5:1 (WCAG 2.2 AA).",
          title: "Text contrast is below the required threshold",
        },
        {
          draftId: "accessibility:accessible-name-missing:button.icon",
          issueType: "accessible-name-missing",
          lens: "accessibility",
          location: { selector: "button.icon" },
          method: "measured",
        },
        {
          draftId: "accessibility:accessible-name-missing:button",
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "button: Buttons do not have an accessible name",
              rule: "button-name",
              tool: "axe",
            },
            { kind: "dom", selector: "button" },
          ],
          issueType: "accessible-name-missing",
          lens: "accessibility",
          location: { selector: "button" },
          method: "measured",
        },
        {
          draftId: "accessibility:alt-text-missing:src/Hero.tsx:12:4_img_missing_alt_text_o31011",
          issueType: "alt-text-missing",
          lens: "accessibility",
          location: { file: "src/Hero.tsx" },
          method: "measured",
        },
        {
          draftId: "accessibility:document-title:document-title",
          issueType: "document-title",
          lens: "accessibility",
          location: { elementRef: "document-title" },
          method: "measured",
        },
        {
          draftId: "accessibility:target-size:.tap-target",
          issueType: "target-size",
          lens: "accessibility",
          location: { selector: ".tap-target" },
          method: "measured",
        },
        {
          draftId: "accessibility:listitem:ul_li_pk8mcb",
          issueType: "listitem",
          lens: "accessibility",
          location: { selector: "ul li" },
          method: "measured",
        },
      ],
    });
    expect(result.ok && result.value.map((finding) => finding.issueType)).not.toContain("viewport");
  });

  it("does not fabricate DOM selectors for malformed or source-file-only evidence", async () => {
    const result = await createAccessibilityLens().evaluate(
      contextWithEvidence([
        {
          kind: "tool-result",
          tool: "axe",
          rule: "image-alt",
          measuredValue: "Missing alternate text",
        },
        {
          kind: "tool-result",
          tool: "eslint-jsx-a11y",
          rule: "jsx-a11y/alt-text",
          measuredValue: "Hero image missing alt text",
        },
        {
          kind: "tool-result",
          tool: "eslint-jsx-a11y",
          rule: "jsx-a11y/aria-props",
          measuredValue: "warning before src/Card.tsx:8:6 invalid ARIA prop",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "aria-roles",
          measuredValue: "my-card: Custom card has an invalid ARIA role",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "button-name",
          measuredValue: "Buttons must have discernible text: button.icon missing text.",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "image-alt",
          measuredValue: "unknown-target: Missing alternate text",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "button-name",
          measuredValue: "Submit: Buttons do not have an accessible name",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "td-headers-attr",
          measuredValue: "td: Table cell headers attribute is invalid",
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "Missing alternate text",
              rule: "image-alt",
              tool: "axe",
            },
          ],
          location: { elementRef: "axe:image-alt" },
        },
        {
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "Hero image missing alt text",
              rule: "jsx-a11y/alt-text",
              tool: "eslint-jsx-a11y",
            },
          ],
          location: { file: "unknown-source" },
        },
        {
          location: { file: "src/Card.tsx" },
        },
        {
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "my-card: Custom card has an invalid ARIA role",
              rule: "aria-roles",
              tool: "axe",
            },
            { kind: "dom", selector: "my-card" },
          ],
          location: { selector: "my-card" },
        },
        {
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "Buttons must have discernible text: button.icon missing text.",
              rule: "button-name",
              tool: "axe",
            },
          ],
          location: { elementRef: "Buttons must have discernible text" },
          rationale:
            "Interactive control is missing an accessible name. axe reported button-name: Buttons must have discernible text: button.icon missing text.",
        },
        {
          location: { elementRef: "unknown-target" },
        },
        {
          location: { elementRef: "Submit" },
        },
        {
          location: { selector: "td" },
        },
      ],
    });
  });

  it("skips malformed evidence and merges duplicate violations without throwing", async () => {
    const result = await createAccessibilityLens().evaluate(
      contextWithEvidence([
        {
          kind: "tool-result",
          tool: "axe",
          rule: " image-alt ",
          measuredValue: " img.hero: Missing alternate text. ",
        },
        {
          kind: "tool-result",
          tool: "axe",
          rule: "image-alt",
          measuredValue: "img.hero: Missing alternate text.",
        },
        {
          kind: "tool-result",
          tool: "lighthouse",
          rule: "image-alt",
          measuredValue: "img.hero: Image elements do not have [alt] attributes (score 0)",
        },
        { kind: "tool-result", tool: "axe", measuredValue: "missing rule" } as never,
        { kind: "tool-result", tool: "axe", rule: "image-alt" } as never,
      ]),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          draftId: "accessibility:alt-text-missing:img.hero",
          evidence: [
            {
              kind: "tool-result",
              measuredValue: "img.hero: Missing alternate text.",
              rule: "image-alt",
              tool: "axe",
            },
            { kind: "dom", selector: "img.hero" },
            {
              kind: "tool-result",
              measuredValue: "img.hero: Image elements do not have [alt] attributes (score 0)",
              rule: "image-alt",
              tool: "lighthouse",
            },
          ],
          issueType: "alt-text-missing",
          location: { selector: "img.hero" },
          rationale:
            "Image is missing alternative text. axe reported image-alt: img.hero: Missing alternate text.",
        },
      ],
    });
  });

  it("returns no findings when no accessibility tool-result evidence is present", async () => {
    const result = await createAccessibilityLens().evaluate(
      contextWithEvidence([{ kind: "dom", selector: "main" }]),
    );

    expect(result).toEqual({ ok: true, value: [] });
  });
});

function contextWithEvidence(evidence: LensContext["evidence"]): LensContext {
  return {
    capture,
    config: resolveSurfaceConfig(),
    evidence,
    knowledge,
  };
}
