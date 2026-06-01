import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { isOk } from "./errors.js";
import type { Capture, Viewport } from "./interfaces.js";
import { createFileSystemKnowledgeSource } from "./knowledge-source.js";
import { createResponsivenessStatesLens } from "./responsiveness-states-lens.js";

const knowledge = createFileSystemKnowledgeSource({
  rootDir: fileURLToPath(new URL("../../../content/knowledge/", import.meta.url)),
});

describe("responsiveness and states lens", () => {
  it("emits a measured finding for fixed-width content wider than a mobile viewport", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main>
          <section id="hero" class="wide-panel">Wide campaign panel</section>
        </main>`,
      );
      const computedStylesPath = path.join(root, "computed-styles.json");
      await writeFile(
        computedStylesPath,
        JSON.stringify([
          {
            scrollWidth: 720,
            selector: "body",
            tagName: "body",
            width: "320px",
          },
          {
            selector: "#hero",
            tagName: "section",
            width: "720px",
          },
        ]),
      );
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDomAndComputedStyles(domPath, computedStylesPath, {
          width: 320,
          height: 640,
          label: "mobile",
        }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            citedHeuristics: ["kb_responsiveness_reflow"],
            evidence: [
              {
                kind: "tool-result",
                measuredValue: "720px > 320px",
                rule: "computed-layout-width",
                threshold: "viewport width 320px",
                tool: "backend",
              },
              {
                kind: "cited-heuristic",
                knowledgeEntryId: "kb_responsiveness_reflow",
              },
              {
                kind: "dom",
                selector: "#hero",
              },
            ],
            issueType: "responsive-fixed-width",
            lens: "responsiveness",
            location: { selector: "#hero" },
            method: "measured",
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not emit fixed-width findings for contained horizontal scroll regions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main>
          <section id="data-grid" role="region">Wide data grid</section>
        </main>`,
      );
      const computedStylesPath = path.join(root, "computed-styles.json");
      await writeFile(
        computedStylesPath,
        JSON.stringify([
          {
            clientWidth: 320,
            overflowX: "auto",
            scrollWidth: 720,
            selector: "#data-grid",
            tagName: "section",
            width: "320px",
          },
        ]),
      );
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDomAndComputedStyles(domPath, computedStylesPath, {
          width: 320,
          height: 640,
          label: "mobile",
        }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(result).toEqual({ ok: true, value: [] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("emits a measured finding when an empty state has no next action", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(domPath, `<main><h1>Projects</h1><p>No projects yet.</p></main>`);
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDom(domPath, { width: 1024, height: 768, label: "desktop" }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            citedHeuristics: ["kb_states_recovery_actions"],
            evidence: [
              {
                kind: "tool-result",
                measuredValue: "empty state text without action element",
                rule: "empty-state-next-action",
                tool: "backend",
              },
              {
                kind: "cited-heuristic",
                knowledgeEntryId: "kb_states_recovery_actions",
              },
            ],
            issueType: "empty-state-next-action-missing",
            lens: "responsiveness",
            location: { selector: "body" },
            method: "measured",
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not treat unrelated navigation links as empty-state recovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<header><a href="/">Home</a></header>
        <main><h1>Projects</h1><p>No projects yet.</p></main>`,
      );
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDom(domPath, { width: 1024, height: 768, label: "desktop" }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            issueType: "empty-state-next-action-missing",
            lens: "responsiveness",
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not treat words inside empty-state copy as a recovery action", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main><h1>Notifications</h1><p>No new notifications yet.</p></main>`,
      );
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDom(domPath, { width: 1024, height: 768, label: "desktop" }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(isOk(result)).toBe(true);
      expect(result).toMatchObject({
        value: [
          {
            issueType: "empty-state-next-action-missing",
            lens: "responsiveness",
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not emit state findings when the empty state includes a next action", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-responsiveness-lens-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main>
          <h1>Projects</h1>
          <p>No projects yet.</p>
          <a href="/projects/new">Create project</a>
        </main>`,
      );
      const lens = createResponsivenessStatesLens();
      const result = await lens.evaluate({
        capture: captureWithDom(domPath, { width: 1024, height: 768, label: "desktop" }),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
      });

      expect(result).toEqual({ ok: true, value: [] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function captureWithDom(domPath: string, viewport: Viewport): Capture {
  return {
    id: "cap_responsiveness",
    target: { kind: "url", ref: "https://example.com", viewport },
    backend: "playwright",
    artifacts: [{ id: "dom", type: "dom-snapshot", path: domPath, redacted: false }],
    capturedAt: "2026-06-01T00:00:00.000Z",
    status: "completed",
  };
}

function captureWithDomAndComputedStyles(
  domPath: string,
  computedStylesPath: string,
  viewport: Viewport,
): Capture {
  return {
    ...captureWithDom(domPath, viewport),
    artifacts: [
      { id: "dom", type: "dom-snapshot", path: domPath, redacted: false },
      {
        id: "computed-styles",
        type: "computed-styles",
        path: computedStylesPath,
        redacted: false,
      },
    ],
  };
}
