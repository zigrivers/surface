import { describe, expect, it } from "vitest";

import type { Capture } from "@zigrivers/surface-core/interfaces";

import { createJsxA11yGroundingTool } from "./index.js";

const capture: Capture = {
  id: "cap_static",
  target: { kind: "component", ref: "src/IconButton.tsx" },
  backend: "static",
  artifacts: [],
  capturedAt: "2026-05-31T18:00:00.000Z",
  status: "completed",
};

describe("eslint-jsx-a11y grounding", () => {
  it("emits deterministic tool-result evidence for React source a11y violations", async () => {
    const tool = createJsxA11yGroundingTool({
      sources: [
        {
          path: "src/IconButton.tsx",
          contents: `
            export function IconButton() {
              return <img src="/checkout.png" />;
            }
          `,
        },
      ],
    });

    const result = await tool.run(capture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected eslint-jsx-a11y grounding to pass");
    }

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      tool: "eslint-jsx-a11y",
      evidence: [
        {
          kind: "tool-result",
          tool: "eslint-jsx-a11y",
          rule: "jsx-a11y/alt-text",
          threshold: "eslint-plugin-jsx-a11y recommended",
        },
      ],
    });
    expect(result.value[0]?.evidence[0]?.measuredValue).toContain("src/IconButton.tsx:3:22");
  });

  it("sorts evidence deterministically across files and source order", async () => {
    const sources = [
      {
        path: "src/ZHero.jsx",
        contents: 'export function ZHero() { return <img src="/hero.png" />; }',
      },
      {
        path: "src/ALogo.jsx",
        contents: 'export function ALogo() { return <img src="/logo.png" />; }',
      },
    ];
    const forward = await createJsxA11yGroundingTool({ sources }).run(capture);
    const reversed = await createJsxA11yGroundingTool({ sources: [...sources].reverse() }).run(
      capture,
    );

    expect(forward).toEqual(reversed);
    expect(forward.ok && forward.value[0]?.evidence.map((entry) => entry.measuredValue)).toEqual([
      expect.stringContaining("src/ALogo.jsx"),
      expect.stringContaining("src/ZHero.jsx"),
    ]);
  });

  it("ignores unsupported source files and rejects malformed source references", async () => {
    const unsupported = await createJsxA11yGroundingTool({
      sources: [{ path: "README.md", contents: "<img />" }],
    }).run(capture);
    const malformed = await createJsxA11yGroundingTool({
      sources: [{ path: "bad.tsx", contents: null } as never],
    }).run(capture);

    expect(unsupported).toEqual({ ok: true, value: [] });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "SourceFileRef requires string path and contents.",
      });
    }
  });
});
