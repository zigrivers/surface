// Acceptance skeletons — Epic E2: Evaluation Pipeline & Lenses (US-010..015).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMITTED_WEB_APP_TYPE_OVERLAYS,
  JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
  createFileStateStore,
  getAppTypeOverlay,
  isOk,
  listAppTypeOverlays,
  modelSkipForLens,
  resolveModelProviderConfig,
  resolveSurfaceConfig,
  runDiscovery,
} from "../../packages/core/src/index.js";

describe("E2 Evaluation Pipeline & Lenses", () => {
  describe("US-010 classify app type [gate]", () => {
    it("[US-010][AC1] discovery assigns app type and records the chosen overlay in state.json (integration)", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-discovery-"));

      try {
        const result = await runDiscovery(
          {
            routeCandidates: ["/products", "/cart", "/checkout"],
            runId: "run_acceptance_discovery",
            target: { kind: "url", ref: "https://shop.example.com/products/widget" },
          },
          { stateStore: createFileStateStore({ projectRoot }) },
        );
        const persisted = JSON.parse(
          await readFile(path.join(projectRoot, ".surface", "state.json"), "utf8"),
        ) as Record<string, unknown>;

        expect(isOk(result)).toBe(true);
        expect(persisted).toMatchObject({
          discovery: {
            appType: "e-commerce",
            overlayId: "e-commerce",
            runId: "run_acceptance_discovery",
          },
        });
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    });

    it("[US-010][AC1] generic overlay is the app-type fallback and committed overlays are selectable (unit)", () => {
      const resolved = resolveSurfaceConfig({
        cli: { evaluation: { appType: "e-commerce" } },
      });

      expect(getAppTypeOverlay().appType).toBe("generic");
      expect(getAppTypeOverlay(resolved.evaluation.appType).appType).toBe("e-commerce");
      expect(listAppTypeOverlays().map((overlay) => overlay.appType)).toEqual([
        "generic",
        "saas-dashboard",
        "e-commerce",
        "marketing",
      ]);
      expect(COMMITTED_WEB_APP_TYPE_OVERLAYS).toEqual([
        "saas-dashboard",
        "e-commerce",
        "marketing",
      ]);
    });

    it.skip("[US-010][AC1] discovery assigns an app type (or `generic`); chosen overlay recorded in .surface/state.json (integration)", () => {});
  });
  describe("US-011 measured accessibility audit [gate]", () => {
    it.skip("[US-011][AC1] each a11y violation produced/confirmed by Axe/Lighthouse, method:measured, with selector + measured value (integration)", () => {});
    it.skip("[US-011][AC2] contrast violation includes measured ratio + WCAG 2.2 AA threshold (unit)", () => {});
  });
  describe("US-012 judged usability/visual/content lenses [gate]", () => {
    it.skip("[US-012][AC1] configured model → each judged finding cites a heuristic, carries evidence, method:judged (integration)", () => {});
    it("[US-012][AC2] no model skips judged lenses and preserves measured coverage (unit)", () => {
      const resolution = resolveModelProviderConfig({ env: {} });

      if (resolution.configured) {
        throw new Error("expected no model configuration");
      }

      expect(
        modelSkipForLens({ id: "visual-hierarchy", requiresModel: true }, resolution.availability),
      ).toEqual({
        lensId: "visual-hierarchy",
        reason: "model_unavailable",
        message: JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
      });
      expect(
        modelSkipForLens({ id: "axe", requiresModel: false }, resolution.availability),
      ).toBeUndefined();
    });
    it.skip("[US-012][AC2] no model → judged lenses skipped + 'judged coverage unavailable' reported; measured still produced (integration)", () => {});
  });
  describe("US-013 lenses flex by overlay & preset [gate]", () => {
    it("[US-013][AC1] committed overlays carry lens acceptance criteria for preset composition (unit)", () => {
      const marketingOverlay = getAppTypeOverlay("marketing");
      const ecommerceOverlay = getAppTypeOverlay("e-commerce");

      expect(marketingOverlay.lensCriteria["message-clarity"]).toMatchObject({
        summary: expect.stringContaining("offer"),
      });
      expect(ecommerceOverlay.lensCriteria.conversion?.checks).toEqual(
        expect.arrayContaining([expect.stringContaining("Checkout steps")]),
      );
    });

    it.skip("[US-013][AC1] preset accessibility-first @depth4 → lens set + thresholds match preset/overlay; active config recorded (integration)", () => {});
  });
  describe("US-014 cognitive walkthrough & conversion audit [should]", () => {
    it.skip("[US-014][AC1] task/persona + flow → each step evaluated as first-time user; friction emitted citing heuristic (integration)", () => {});
    it.skip("[US-014][AC2] conversion path under e-commerce overlay → friction findings tagged to that path (integration)", () => {});
  });
  describe("US-015 bounded alternatives & before/after diff [should]", () => {
    it.skip("[US-015][AC1] `alternatives <target>` → bounded improvements to that view (never blank-canvas) with rationale (integration)", () => {});
    it.skip("[US-015][AC2] `diff <before> <after>` → reports resolved/introduced findings between them (integration)", () => {});
  });
});
