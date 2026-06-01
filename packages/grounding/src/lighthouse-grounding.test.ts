import { describe, expect, it } from "vitest";

import type { Capture } from "@surface/core/interfaces";

import {
  createLighthouseGroundingTool,
  lighthouseResultToToolResults,
  type LighthouseRunnerResult,
} from "./index.js";

const capture: Capture = {
  id: "cap_lighthouse",
  target: { kind: "url", ref: "http://localhost:3000" },
  backend: "playwright",
  artifacts: [],
  capturedAt: "2026-05-31T18:00:00.000Z",
  status: "completed",
};

describe("lighthouse grounding", () => {
  it("normalizes failed accessibility and performance audits into deterministic evidence", async () => {
    const result = await createLighthouseGroundingTool({
      runLighthouse: () =>
        Promise.resolve({
          lhr: {
            categories: {
              accessibility: {
                auditRefs: [
                  { id: "button-name" },
                  { id: "color-contrast" },
                  { id: "heading-order" },
                ],
              },
              performance: {
                auditRefs: [{ id: "largest-contentful-paint" }],
              },
            },
            audits: {
              "button-name": {
                id: "button-name",
                score: 0,
                title: "Buttons do not have an accessible name",
                details: {
                  items: [
                    { node: { selector: "button.icon" } },
                    { node: { selector: "button.icon.secondary" } },
                  ],
                },
              },
              "color-contrast": {
                id: "color-contrast",
                score: 1,
                title: "Background and foreground colors have a sufficient contrast ratio",
              },
              "largest-contentful-paint": {
                id: "largest-contentful-paint",
                score: 0.52,
                displayValue: "3.4 s",
              },
              "heading-order": {
                id: "heading-order",
                score: 0,
                title: "Heading elements are not in a sequentially-descending order",
                details: {
                  items: [
                    { node: { path: "1,HTML,1,BODY,2,H3" } },
                    { node: { snippet: "<h3>Billing</h3>" } },
                  ],
                },
              },
            },
          },
        }),
    }).run(capture);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          tool: "lighthouse",
          evidence: [
            {
              kind: "tool-result",
              tool: "lighthouse",
              rule: "button-name",
              measuredValue:
                "button.icon.secondary: Buttons do not have an accessible name (score 0)",
              threshold: "Lighthouse audit score 1",
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
              tool: "lighthouse",
              rule: "heading-order",
              measuredValue:
                "1,HTML,1,BODY,2,H3: Heading elements are not in a sequentially-descending order (score 0)",
              threshold: "Lighthouse audit score 1",
            },
            {
              kind: "tool-result",
              tool: "lighthouse",
              rule: "heading-order",
              measuredValue:
                "<h3>Billing</h3>: Heading elements are not in a sequentially-descending order (score 0)",
              threshold: "Lighthouse audit score 1",
            },
            {
              kind: "tool-result",
              tool: "lighthouse",
              rule: "largest-contentful-paint",
              measuredValue: "largest-contentful-paint: 3.4 s (score 0.52)",
              threshold: "Lighthouse audit score 1",
            },
          ],
        },
      ],
    });
  });

  it("returns empty evidence for clean or malformed recorded lighthouse JSON", () => {
    expect(
      lighthouseResultToToolResults({
        lhr: {
          audits: {
            "button-name": { score: 1, title: "Buttons have an accessible name" },
          },
        },
      }),
    ).toEqual([]);
    expect(lighthouseResultToToolResults(undefined)).toEqual([]);
    expect(
      lighthouseResultToToolResults({ lhr: { audits: null } } as unknown as LighthouseRunnerResult),
    ).toEqual([]);
  });

  it("lazy-loads the lighthouse runner only when the default runner executes", async () => {
    const importCalls: string[] = [];
    const runCalls: Array<{
      readonly url: string;
      readonly options: Readonly<Record<string, unknown>> | undefined;
    }> = [];
    const killedPorts: number[] = [];
    const tool = createLighthouseGroundingTool({
      importLighthouse: () => {
        importCalls.push("lighthouse");

        return Promise.resolve({
          default: (url, options) => {
            runCalls.push({ url, options });

            return Promise.resolve({
              lhr: {
                audits: {
                  "first-contentful-paint": {
                    score: 0.9,
                    displayValue: "1.6 s",
                  },
                },
              },
            });
          },
        });
      },
      importChromeLauncher: () => {
        importCalls.push("chrome-launcher");

        return Promise.resolve({
          launch: () =>
            Promise.resolve({
              port: 9222,
              kill: () => {
                killedPorts.push(9222);
                return Promise.reject(new Error("cleanup failed"));
              },
            }),
        });
      },
      lighthouseOptions: { onlyCategories: ["accessibility"] },
    });

    expect(importCalls).toEqual([]);
    expect(
      await tool.run({ ...capture, target: { kind: "localhost", ref: "localhost:3000" } }),
    ).toEqual({
      ok: true,
      value: [
        {
          tool: "lighthouse",
          evidence: [
            {
              kind: "tool-result",
              tool: "lighthouse",
              rule: "first-contentful-paint",
              measuredValue: "first-contentful-paint: 1.6 s (score 0.9)",
              threshold: "Lighthouse audit score 1",
            },
          ],
        },
      ],
    });
    expect(importCalls).toEqual(["lighthouse", "chrome-launcher"]);
    expect(runCalls).toEqual([
      {
        url: "http://localhost:3000",
        options: { onlyCategories: ["accessibility"], port: 9222 },
      },
    ]);
    expect(killedPorts).toEqual([9222]);
  });

  it("returns runner and target errors as step failures", async () => {
    const failed = await createLighthouseGroundingTool({
      runLighthouse: () => Promise.reject(new Error("chrome exited")),
    }).run(capture);
    const unsupportedTarget = await createLighthouseGroundingTool({
      importLighthouse: () =>
        Promise.resolve({ default: () => Promise.resolve({ lhr: { audits: {} } }) }),
    }).run({ ...capture, target: { kind: "screenshot", ref: "capture.png" } });
    const importCalls: string[] = [];
    const invalidUrl = await createLighthouseGroundingTool({
      importLighthouse: () => {
        importCalls.push("lighthouse");
        return Promise.resolve({ default: () => Promise.resolve({ lhr: { audits: {} } }) });
      },
      importChromeLauncher: () => {
        importCalls.push("chrome-launcher");
        return Promise.resolve({
          launch: () => Promise.resolve({ port: 9222, kill: () => undefined }),
        });
      },
    }).run({ ...capture, target: { kind: "url", ref: "example.com" } });

    expect(failed.ok).toBe(false);
    expect(unsupportedTarget.ok).toBe(false);
    expect(invalidUrl.ok).toBe(false);
    expect(importCalls).toEqual([]);
    if (!failed.ok) {
      expect(failed.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "Failed to run lighthouse grounding.",
      });
    }
    if (!unsupportedTarget.ok) {
      expect(unsupportedTarget.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "Failed to run lighthouse grounding.",
      });
    }
  });
});
