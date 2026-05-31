// Acceptance skeletons — Epic E2: Evaluation Pipeline & Lenses (US-010..015).
import { describe, it } from "vitest";

describe("E2 Evaluation Pipeline & Lenses", () => {
  describe("US-010 classify app type [gate]", () => {
    it.skip("[US-010][AC1] discovery assigns an app type (or `generic`); chosen overlay recorded in .surface/state.json (integration)", () => {});
  });
  describe("US-011 measured accessibility audit [gate]", () => {
    it.skip("[US-011][AC1] each a11y violation produced/confirmed by Axe/Lighthouse, method:measured, with selector + measured value (integration)", () => {});
    it.skip("[US-011][AC2] contrast violation includes measured ratio + WCAG 2.2 AA threshold (unit)", () => {});
  });
  describe("US-012 judged usability/visual/content lenses [gate]", () => {
    it.skip("[US-012][AC1] configured model → each judged finding cites a heuristic, carries evidence, method:judged (integration)", () => {});
    it.skip("[US-012][AC2] no model → judged lenses skipped + 'judged coverage unavailable' reported; measured still produced (integration)", () => {});
  });
  describe("US-013 lenses flex by overlay & preset [gate]", () => {
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
