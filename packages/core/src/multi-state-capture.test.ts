import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { createSurfaceError, err, isOk, ok, type Result, type SurfaceError } from "./errors.js";
import type { CaptureService } from "./capture.js";
import type { Finding } from "./findings.js";
import type { Capture, CaptureOptions, Target } from "./interfaces.js";
import {
  runTaskFlowCapture,
  tagFindingsWithCaptureContext,
  type TaskFlowCaptureRecipe,
} from "./multi-state-capture.js";

const target = { kind: "url", ref: "https://example.com" } satisfies Target;
const captureOptions = {
  config: DEFAULT_SURFACE_CONFIG.capture,
} satisfies CaptureOptions;
const finding = {
  id: "f_light_contrast",
  lens: "accessibility",
  issueType: "contrast-insufficient",
  method: "measured",
  title: "Button contrast is below AA",
  rationale: "Primary button contrast is insufficient against its background.",
  citedHeuristics: ["kb_wcag_143"],
  evidence: [
    {
      kind: "tool-result",
      tool: "axe",
      rule: "color-contrast",
      measuredValue: "3.1:1",
      threshold: "4.5:1",
    },
  ],
  dimensions: {
    severity: 0.8,
    confidence: 1,
    effort: 0.2,
    userImpact: 0.7,
    businessImpact: 0.5,
    a11yLegalRisk: 0.9,
    evidenceQuality: 1,
    agentImplementability: 0.9,
  },
  severityBand: "P1",
  location: { selector: ".btn-primary" },
  confidenceBand: "assert",
  gatedForHuman: false,
} satisfies Finding;

describe("multi-state capture", () => {
  it("captures reachable task-flow states and reports unreachable steps", async () => {
    const observedTargets: Target[] = [];
    const recipe = {
      id: "checkout-flow",
      steps: [
        { id: "cart", target },
        { id: "payment", target: { kind: "url", ref: "https://example.com/payment" } },
      ],
    } satisfies TaskFlowCaptureRecipe;
    const service = fakeCaptureService((observedTarget) => {
      observedTargets.push(observedTarget);

      if (observedTarget.ref.endsWith("/payment")) {
        return err(createSurfaceError("capture_unreachable", "Payment step is unreachable."));
      }

      return ok(captureFor("cart", observedTarget));
    });

    const result = await runTaskFlowCapture({
      captureOptions,
      recipe,
      service,
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(observedTargets.map((entry) => entry.ref)).toEqual([
      "https://example.com",
      "https://example.com/payment",
    ]);
    expect(result.value.captures).toHaveLength(1);
    expect(result.value.captures[0]).toMatchObject({
      capture: { id: "cap-cart" },
      stateId: "cart",
    });
    expect(result.value.unreachable).toHaveLength(1);
    expect(result.value.unreachable[0]).toMatchObject({
      reason: "Payment step is unreachable.",
      stateId: "payment",
    });
  });

  it("expands a task-flow step across light and dark themes", async () => {
    const observedTargets: Target[] = [];
    const service = fakeCaptureService((observedTarget) => {
      observedTargets.push(observedTarget);
      return ok(captureFor(`home-${observedTarget.theme ?? "none"}`, observedTarget));
    });

    const result = await runTaskFlowCapture({
      captureOptions,
      recipe: {
        id: "home-dual-theme",
        steps: [{ id: "home", target }],
        themes: ["light", "dark"],
      },
      service,
    });

    expect(isOk(result)).toBe(true);

    if (!isOk(result)) {
      return;
    }

    expect(observedTargets.map((entry) => entry.theme)).toEqual(["light", "dark"]);
    expect(result.value.captures.map((entry) => entry.theme)).toEqual(["light", "dark"]);
  });

  it("tags findings with capture state and theme context", () => {
    const tagged = tagFindingsWithCaptureContext([finding], {
      stateId: "home",
      theme: "dark",
    });

    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({
      captureContext: { stateId: "home", theme: "dark" },
      tags: ["state:home", "theme:dark"],
    });
  });
});

function fakeCaptureService(
  capture: (target: Target) => Result<Capture, SurfaceError>,
): CaptureService {
  return {
    capture: (observedTarget) => Promise.resolve(capture(observedTarget)),
  };
}

function captureFor(id: string, observedTarget: Target): Capture {
  return {
    artifacts: [
      {
        id: "screenshot",
        path: `.surface/captures/${id}/screenshot.png`,
        redacted: false,
        type: "screenshot",
      },
    ],
    backend: "playwright",
    capturedAt: "2026-06-02T00:00:00.000Z",
    id: `cap-${id}`,
    status: "completed",
    target: observedTarget,
  };
}
