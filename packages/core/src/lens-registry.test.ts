import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import {
  BUILT_IN_LENS_REGISTRY,
  selectLensExecutionPlan,
  synthesizeMeasuredWinsDecision,
  type LensRegistration,
} from "./lens-registry.js";
import type { Capture } from "./interfaces.js";

const completedCapture = {
  id: "cap_live",
  target: { kind: "url", ref: "https://example.com" },
  backend: "playwright",
  artifacts: [
    { id: "dom", type: "dom-snapshot", path: ".surface/captures/dom.html", redacted: false },
    {
      id: "computed-styles",
      type: "computed-styles",
      path: ".surface/captures/computed-styles.json",
      redacted: false,
    },
  ],
  capturedAt: "2026-05-31T00:00:00.000Z",
  status: "completed",
} satisfies Capture;

describe("lens registry", () => {
  it("selects the overlay and preset intersection in registry order", () => {
    const config = resolveSurfaceConfig({
      cli: {
        evaluation: {
          appType: "e-commerce",
          depth: 4,
          preset: "conversion-focused",
        },
      },
    });
    const plan = selectLensExecutionPlan({
      capture: completedCapture,
      config,
      modelAvailability: {
        available: true,
        model: "reviewer",
        provider: "local",
      },
    });

    expect(plan.overlay.appType).toBe("e-commerce");
    expect(plan.selected.map((lens) => lens.id)).toEqual([
      "responsiveness",
      "conversion",
      "trust-and-credibility",
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips live-DOM lenses when capture only has static artifacts", () => {
    const config = resolveSurfaceConfig({
      cli: {
        evaluation: {
          appType: "generic",
          depth: 3,
          preset: "standard",
        },
      },
    });
    const staticCapture = {
      ...completedCapture,
      artifacts: [
        {
          id: "screenshot",
          type: "screenshot",
          path: ".surface/captures/screenshot.png",
          redacted: false,
        },
      ],
      degradation: {
        skippedArtifacts: ["dom-snapshot", "accessibility-tree", "computed-styles"],
        skippedReason: "static fallback",
      },
      status: "degraded",
    } satisfies Capture;

    const plan = selectLensExecutionPlan({
      capture: staticCapture,
      config,
      modelAvailability: {
        available: false,
        reason: "no-model-configured",
        message: "No model configured.",
      },
    });

    expect(plan.selected).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        lensId: "accessibility",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but this capture did not produce one.",
      },
      {
        lensId: "usability",
        reason: "model_unavailable",
        message: "No model configured.",
      },
      {
        lensId: "visual-hierarchy",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but this capture did not produce one.",
      },
      {
        lensId: "content",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but this capture did not produce one.",
      },
    ]);
  });

  it("treats omitted model availability and capture as unavailable inputs", () => {
    const config = resolveSurfaceConfig({
      cli: {
        evaluation: {
          appType: "generic",
          depth: 3,
          preset: "standard",
        },
      },
    });

    const plan = selectLensExecutionPlan({ config });

    expect(plan.selected).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        lensId: "accessibility",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but no capture was provided.",
      },
      {
        lensId: "usability",
        reason: "model_unavailable",
        message: "Model availability was not provided.",
      },
      {
        lensId: "visual-hierarchy",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but no capture was provided.",
      },
      {
        lensId: "content",
        reason: "live_dom_unavailable",
        message: "Lens requires a live DOM snapshot, but no capture was provided.",
      },
    ]);
  });

  it("skips visual hierarchy when live DOM capture lacks computed styles", () => {
    const config = resolveSurfaceConfig({
      cli: {
        evaluation: {
          appType: "generic",
          depth: 3,
          preset: "standard",
        },
      },
    });
    const domOnlyCapture = {
      ...completedCapture,
      artifacts: [
        {
          id: "dom",
          type: "dom-snapshot",
          path: ".surface/captures/dom.html",
          redacted: false,
        },
      ],
    } satisfies Capture;

    const plan = selectLensExecutionPlan({
      capture: domOnlyCapture,
      config,
      modelAvailability: {
        available: false,
        reason: "no-model-configured",
        message: "No model configured.",
      },
    });

    expect(plan.selected.map((lens) => lens.id)).toEqual(["accessibility", "content"]);
    expect(plan.skipped).toEqual([
      {
        lensId: "usability",
        reason: "model_unavailable",
        message: "No model configured.",
      },
      {
        lensId: "visual-hierarchy",
        reason: "live_dom_unavailable",
        message: "Lens requires computed styles, but this capture did not produce them.",
      },
    ]);
  });

  it("keeps measured-wins synthesis decisions auditable", () => {
    expect(
      synthesizeMeasuredWinsDecision({
        factKey: "contrast:.btn-primary",
        judgedSource: "visual-hierarchy",
        judgedValue: "acceptable",
        measuredSource: "axe",
        measuredValue: "3.1:1",
      }),
    ).toEqual({
      factKey: "contrast:.btn-primary",
      judgedSource: "visual-hierarchy",
      judgedValue: "acceptable",
      measuredSource: "axe",
      measuredValue: "3.1:1",
      reason: "Measured evidence overrides the judged interpretation for the same fact.",
      sourceOfTruth: "measured",
    });
  });

  it("allows injected registries for future lenses without mutating built-ins", () => {
    const customLens = {
      id: "accessibility",
      method: "measured",
      requiresLiveDom: false,
      requiresModel: false,
      presets: ["custom"],
    } satisfies LensRegistration;
    const config = resolveSurfaceConfig({
      cli: { evaluation: { appType: "generic", preset: "custom" } },
    });

    expect(selectLensExecutionPlan({ config, registry: [customLens] }).selected).toEqual([
      customLens,
    ]);
    expect(BUILT_IN_LENS_REGISTRY.find((lens) => lens.id === "accessibility")).toMatchObject({
      requiresLiveDom: true,
    });
  });
});
