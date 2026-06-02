import { describe, expect, it } from "vitest";

import type { Capture } from "@zigrivers/surface-core/interfaces";

import { axeResultToToolResults, createAxeGroundingTool, type AxeRunResult } from "./index.js";

const capture: Capture = {
  id: "cap_axe",
  target: { kind: "url", ref: "http://localhost:3000" },
  backend: "playwright",
  artifacts: [],
  capturedAt: "2026-05-31T18:00:00.000Z",
  status: "completed",
};

describe("axe grounding", () => {
  it("normalizes axe violations into deterministic tool-result evidence", async () => {
    const tool = createAxeGroundingTool({
      runAxe: () =>
        Promise.resolve({
          violations: [
            {
              id: "color-contrast",
              tags: ["wcag2aa", "wcag143"],
              nodes: [
                {
                  target: [".secondary"],
                  failureSummary:
                    "Element has insufficient color contrast of 2.6. Expected contrast ratio of 4.5:1",
                },
                {
                  target: [".primary"],
                  failureSummary:
                    "Element has insufficient color contrast of 3.1. Expected contrast ratio of 4.5:1",
                },
              ],
            },
          ],
        }),
    });

    const result = await tool.run(capture);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          tool: "axe",
          evidence: [
            {
              kind: "tool-result",
              tool: "axe",
              rule: "color-contrast",
              measuredValue: ".primary: 3.1:1",
              threshold: "4.5:1 (WCAG 2.2 AA)",
            },
            {
              kind: "tool-result",
              tool: "axe",
              rule: "color-contrast",
              measuredValue: ".secondary: 2.6:1",
              threshold: "4.5:1 (WCAG 2.2 AA)",
            },
          ],
        },
      ],
    });
  });

  it("returns an empty result for clean axe runs and errors for runner failures", async () => {
    const clean = await createAxeGroundingTool({
      runAxe: () => Promise.resolve({ violations: [] }),
    }).run(capture);
    const failed = await createAxeGroundingTool({
      runAxe: () => Promise.reject(new Error("page closed")),
    }).run(capture);

    expect(clean).toEqual({ ok: true, value: [] });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "Failed to run axe grounding.",
      });
    }
  });

  it("omits thresholds for axe rules without parsed numeric thresholds", async () => {
    const result = await createAxeGroundingTool({
      runAxe: () =>
        Promise.resolve({
          violations: [
            {
              id: "image-alt",
              tags: ["wcag2a", "wcag111"],
              nodes: [
                {
                  target: ["img.hero"],
                  failureSummary:
                    "Fix any of the following: Element does not have an alt attribute",
                },
              ],
            },
          ],
        }),
    }).run(capture);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          tool: "axe",
          evidence: [
            {
              kind: "tool-result",
              tool: "axe",
              rule: "image-alt",
              measuredValue:
                "img.hero: Fix any of the following: Element does not have an alt attribute",
            },
          ],
        },
      ],
    });
  });

  it("degrades malformed axe result shapes to no evidence or unknown targets", () => {
    expect(axeResultToToolResults(null)).toEqual([]);
    expect(axeResultToToolResults({ violations: null } as unknown as AxeRunResult)).toEqual([]);
    expect(axeResultToToolResults({ violations: "bad" } as unknown as AxeRunResult)).toEqual([]);

    expect(
      axeResultToToolResults({
        violations: [
          {
            id: "image-alt",
            nodes: [
              {
                target: "img.hero",
                any: [{ message: "Element does not have alternate text" }],
              },
              {
                target: [],
                failureSummary: "Missing alternate text",
              },
            ],
          },
          { nodes: [{ target: ["button"] }] },
        ],
      } as unknown as AxeRunResult),
    ).toEqual([
      {
        tool: "axe",
        evidence: [
          {
            kind: "tool-result",
            tool: "axe",
            rule: "image-alt",
            measuredValue: "unknown-target: Element does not have alternate text",
          },
          {
            kind: "tool-result",
            tool: "axe",
            rule: "image-alt",
            measuredValue: "unknown-target: Missing alternate text",
          },
        ],
      },
    ]);
  });

  it("parses fallback contrast ratios and preserves deterministic duplicate-key order", () => {
    expect(
      axeResultToToolResults({
        violations: [
          {
            id: "color-contrast",
            nodes: [
              {
                target: [".dup"],
                failureSummary: "Element contrast ratio is 3.1:1, expected at least 7:1",
              },
              {
                target: [".dup"],
                failureSummary: "Element contrast ratio is 3.1:1, expected at least 4.5:1",
              },
              {
                target: [".fallback"],
                failureSummary: "Element contrast ratio is 2.2:1, expected at least 4.5:1",
              },
            ],
          },
          {
            id: "image-alt",
            nodes: [
              {
                target: ["img.logo"],
                failureSummary: "Missing alternate text",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        tool: "axe",
        evidence: [
          {
            kind: "tool-result",
            tool: "axe",
            rule: "color-contrast",
            measuredValue: ".dup: 3.1:1",
            threshold: "7:1 (WCAG 2.2 AA)",
          },
          {
            kind: "tool-result",
            tool: "axe",
            rule: "color-contrast",
            measuredValue: ".dup: 3.1:1",
            threshold: "4.5:1 (WCAG 2.2 AA)",
          },
          {
            kind: "tool-result",
            tool: "axe",
            rule: "color-contrast",
            measuredValue: ".fallback: 2.2:1",
            threshold: "4.5:1 (WCAG 2.2 AA)",
          },
          {
            kind: "tool-result",
            tool: "axe",
            rule: "image-alt",
            measuredValue: "img.logo: Missing alternate text",
          },
        ],
      },
    ]);
  });
});
