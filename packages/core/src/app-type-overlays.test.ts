import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { AppTypeSchema, type AppType } from "./config.js";
import {
  APP_TYPE_OVERLAY_REGISTRY,
  COMMITTED_WEB_APP_TYPE_OVERLAYS,
  AppTypeOverlaySchema,
  serializeAppTypeOverlayToYaml,
  REGISTERED_APP_TYPE_OVERLAYS,
  getAppTypeOverlay,
  hasRegisteredAppTypeOverlay,
  listAppTypeOverlays,
} from "./app-type-overlays.js";

const overlayContentDir = new URL("../../../content/methodology/overlays/", import.meta.url);

describe("app-type overlays", () => {
  it("registers the gate baseline and committed web overlays", () => {
    const overlays = listAppTypeOverlays();

    expect(overlays.map((overlay) => overlay.appType)).toEqual([
      "generic",
      "saas-dashboard",
      "e-commerce",
      "marketing",
    ]);
    expect(getAppTypeOverlay("generic")).toMatchObject({
      appType: "generic",
      releaseTier: "gate",
    });
    expect(COMMITTED_WEB_APP_TYPE_OVERLAYS).toEqual(["saas-dashboard", "e-commerce", "marketing"]);
    expect(overlays.filter((overlay) => overlay.releaseTier === "committed")).toHaveLength(
      COMMITTED_WEB_APP_TYPE_OVERLAYS.length,
    );
  });

  it("validates each registry entry against the overlay schema and app-type schema", () => {
    for (const appType of REGISTERED_APP_TYPE_OVERLAYS) {
      const overlay = APP_TYPE_OVERLAY_REGISTRY[appType];

      expect(AppTypeSchema.parse(overlay.appType)).toBe(appType);
      expect(AppTypeOverlaySchema.parse(overlay)).toEqual(overlay);
      expect(overlay.lensCriteria).not.toEqual({});
    }
  });

  it("falls back to generic for uncommitted overlays while preserving app-type validation", () => {
    const appTypes = AppTypeSchema.options;

    expect(appTypes).toContain("admin");
    expect(appTypes).toContain("content-media");
    expect(hasRegisteredAppTypeOverlay("admin")).toBe(false);
    expect(getAppTypeOverlay("admin")).toBe(APP_TYPE_OVERLAY_REGISTRY.generic);
    expect(getAppTypeOverlay("content-media")).toBe(APP_TYPE_OVERLAY_REGISTRY.generic);
  });

  it("ships generated yaml content for every registered overlay", async () => {
    for (const appType of REGISTERED_APP_TYPE_OVERLAYS) {
      const yaml = await readFile(new URL(`${appType}.yml`, overlayContentDir), "utf8");

      expect(yaml).toBe(serializeAppTypeOverlayToYaml(APP_TYPE_OVERLAY_REGISTRY[appType]));
    }
  });

  it("quotes yaml-sensitive criteria strings safely", () => {
    const overlay = AppTypeOverlaySchema.parse({
      appType: "generic",
      label: "Generic: web # baseline",
      releaseTier: "gate",
      routeHints: ["- leading dash", "route: checkout"],
      lensCriteria: {
        "risk:signals": {
          summary: 'Copy with: colon, # hash, "quote", and\nnew line',
          checks: ["? leading question", "contains # comment marker"],
          riskSignals: ["breaks: plain scalar"],
        },
      },
    });

    expect(serializeAppTypeOverlayToYaml(overlay)).toContain('"Generic: web # baseline"');
    expect(serializeAppTypeOverlayToYaml(overlay)).toContain("|-\n      Copy with: colon");
    expect(serializeAppTypeOverlayToYaml(overlay)).toContain('"- leading dash"');
  });

  it("keeps registry values frozen so runtime composition cannot mutate methodology defaults", () => {
    const overlay = getAppTypeOverlay("marketing");
    const firstLens = Object.values(overlay.lensCriteria)[0];

    expect(Object.isFrozen(overlay)).toBe(true);
    expect(Object.isFrozen(overlay.routeHints)).toBe(true);
    expect(Object.isFrozen(firstLens)).toBe(true);
  });

  it("narrows committed app types without widening unknown strings", () => {
    const appType: AppType = "e-commerce";

    if (!hasRegisteredAppTypeOverlay(appType)) {
      throw new Error("expected e-commerce to be registered");
    }

    expect(APP_TYPE_OVERLAY_REGISTRY[appType].label).toBe("E-commerce storefront");
  });
});
