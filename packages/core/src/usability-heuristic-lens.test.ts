import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { createSurfaceError, err, isOk, ok } from "./errors.js";
import type { Capture, KnowledgeEntry, KnowledgeSource, ModelProvider } from "./interfaces.js";
import { createFileSystemKnowledgeSource } from "./knowledge-source.js";
import { BUILT_IN_LENS_REGISTRY } from "./lens-registry.js";
import type { ModelRequest } from "./model-provider.js";
import { createUsabilityHeuristicLens } from "./usability-heuristic-lens.js";

const knowledge = createFileSystemKnowledgeSource({
  rootDir: fileURLToPath(new URL("../../../content/knowledge/", import.meta.url)),
});

describe("usability heuristic lens", () => {
  it("emits cited judged findings from structured model output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-lens-"));
    const requests: ModelRequest[] = [];

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main id="checkout">
          <h1>Confirm purchase</h1>
          <button id="pay">Pay now</button>
        </main>`,
      );
      const model = modelWithText(
        JSON.stringify([
          {
            issueType: "user-control",
            rationale: "The checkout view does not expose a clear way to cancel or go back.",
            selector: "#checkout",
            title: "Checkout lacks an obvious escape route",
          },
        ]),
        requests,
      );
      const lens = createUsabilityHeuristicLens();
      const result = await lens.evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model,
      });

      expect(isOk(result)).toBe(true);
      expect(requests[0]?.prompt.instructions).toContain("usability");
      const modelInput = requests[0]?.prompt.input as
        | { readonly heuristic?: { readonly guidance?: unknown; readonly id?: unknown } }
        | undefined;
      expect(modelInput?.heuristic?.guidance).toEqual(
        expect.stringContaining("Use the heuristics"),
      );
      expect(modelInput?.heuristic?.id).toBe("kb_usability_nielsen_heuristics");
      expect(result).toMatchObject({
        value: [
          {
            citedHeuristics: ["kb_usability_nielsen_heuristics"],
            evidence: [
              {
                kind: "cited-heuristic",
                knowledgeEntryId: "kb_usability_nielsen_heuristics",
              },
              {
                kind: "dom",
                selector: "#checkout",
              },
            ],
            issueType: "user-control",
            lens: "usability",
            location: { selector: "#checkout" },
            method: "judged",
            rawDimensions: {},
            title: "Checkout lacks an obvious escape route",
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("resolves relative DOM artifact paths against the lens context project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-relative-"));

    try {
      const domPath = path.join(root, ".surface", "captures", "dom.html");
      await mkdir(path.dirname(domPath), { recursive: true });
      await writeFile(domPath, `<main id="checkout"><button>Pay now</button></main>`);
      const usabilityRegistration = BUILT_IN_LENS_REGISTRY.find(
        (entry) => entry.id === "usability",
      );
      const lens = usabilityRegistration?.create?.({ maxDomChars: 10, projectRoot: root });
      const requests: ModelRequest[] = [];

      const result = await lens?.evaluate({
        capture: captureWithDom(".surface/captures/dom.html"),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([]), requests),
      });

      expect(result).toMatchObject({ value: [] });
      expect(requests[0]?.prompt.input).toMatchObject({ domExcerpt: '<main id="' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects relative DOM artifact paths that escape the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-escape-"));

    try {
      const result = await createUsabilityHeuristicLens({ projectRoot: root }).evaluate({
        capture: captureWithDom("../outside.html"),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([])),
      });

      expect(result).toMatchObject({ error: { code: "capture_failed" } });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects DOM artifact symlinks that resolve outside the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-symlink-"));

    try {
      const outsidePath = path.join(os.tmpdir(), `surface-outside-${Date.now()}.html`);
      const linkPath = path.join(root, ".surface", "captures", "dom.html");
      await writeFile(outsidePath, `<main>outside</main>`);
      await mkdir(path.dirname(linkPath), { recursive: true });
      await symlink(outsidePath, linkPath);

      const result = await createUsabilityHeuristicLens({ projectRoot: root }).evaluate({
        capture: captureWithDom(".surface/captures/dom.html"),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([])),
      });

      expect(result).toMatchObject({ error: { code: "capture_failed" } });
      await rm(outsidePath, { force: true });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns config errors for non-JSON and structurally invalid model output", async () => {
    const invalidJson = await evaluateWithModelText("not json");
    const invalidShape = await evaluateWithModelText(JSON.stringify([{ issueType: "control" }]));

    expect(invalidJson).toMatchObject({ error: { code: "model_request_failed" } });
    expect(invalidShape).toMatchObject({ error: { code: "model_request_failed" } });
  });

  it("accepts JSON arrays wrapped in markdown fences and prose", async () => {
    const result = await evaluateWithModelText("Here is the result:\n```json\n[]\n```\nDone.");

    expect(result).toMatchObject({ value: [] });
  });

  it("extracts the last valid unfenced issue array from prose", async () => {
    const result = await evaluateWithModelText(
      `Examples: ["not", "issues"].
      Findings:
      ${JSON.stringify([
        {
          issueType: "visibility",
          rationale: "The page does not expose progress for the current task.",
          title: "Task progress is unclear",
        },
      ])}`,
    );

    expect(result).toMatchObject({
      value: [
        {
          issueType: "visibility",
          title: "Task progress is unclear",
        },
      ],
    });
  });

  it("returns a config error when the exact usability knowledge entry is missing", async () => {
    const result = await evaluateWithModelText(JSON.stringify([]), {
      knowledge: knowledgeWith([
        {
          id: "kb_other_usability",
          title: "Other usability entry",
          summary: "Not the canonical usability heuristic.",
        },
      ]),
    });

    expect(result).toMatchObject({ error: { code: "config_invalid" } });
  });

  it("returns a config error when the usability knowledge entry is still a draft", async () => {
    const result = await evaluateWithModelText(JSON.stringify([]), {
      knowledge: knowledgeWith([
        {
          id: "kb_usability_nielsen_heuristics",
          title: "Draft usability entry",
          summary: "Draft guidance must not ground findings.",
          draft: true,
        },
      ]),
    });

    expect(result).toMatchObject({ error: { code: "config_invalid" } });
  });

  it("returns capture errors when the DOM artifact is missing or unreadable", async () => {
    const noArtifact = await createUsabilityHeuristicLens().evaluate({
      capture: {
        ...captureWithDom("/tmp/dom.html"),
        artifacts: [],
      },
      config: resolveSurfaceConfig(),
      evidence: [],
      knowledge,
      model: modelWithText(JSON.stringify([])),
    });
    const unreadable = await createUsabilityHeuristicLens().evaluate({
      capture: captureWithDom("/tmp/surface-missing-dom.html"),
      config: resolveSurfaceConfig(),
      evidence: [],
      knowledge,
      model: modelWithText(JSON.stringify([])),
    });

    expect(noArtifact).toMatchObject({ error: { code: "capture_failed" } });
    expect(unreadable).toMatchObject({ error: { code: "capture_failed" } });
  });

  it("uses redacted DOM snapshot artifacts as sanitized model input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-redacted-"));
    const requests: ModelRequest[] = [];

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<main id="checkout" data-token="sk-live-secret"><button>Pay now</button></main>`,
      );
      const result = await createUsabilityHeuristicLens().evaluate({
        capture: {
          ...captureWithDom(domPath),
          artifacts: [
            {
              id: "dom",
              path: domPath,
              redacted: true,
              redaction: {
                boundingBoxesVerified: true,
                maskedClasses: ["token"],
                safeNoSensitiveRegions: false,
                status: "redacted",
                unsafeRegions: [],
              },
              type: "dom-snapshot",
            },
          ],
        },
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([]), requests),
      });

      expect(result).toEqual(ok([]));
      expect(JSON.stringify(requests[0]?.prompt.input)).not.toContain("sk-live-secret");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("passes model errors through without rewriting them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-model-error-"));

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(domPath, `<main id="checkout"><button>Pay now</button></main>`);
      const result = await createUsabilityHeuristicLens().evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: {
          availability: () =>
            ok({
              available: true,
              channelId: "local",
              provider: "local",
              model: "reviewer",
              sourceKind: "local",
            }),
          complete: () => err(createSurfaceError("model_request_failed", "model request failed")),
        },
      });

      expect(result).toMatchObject({ error: { code: "model_request_failed" } });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("truncates the DOM excerpt sent to the model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-truncate-"));
    const requests: ModelRequest[] = [];

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(domPath, `<main>${"x".repeat(100)}</main>`);
      const result = await createUsabilityHeuristicLens({ maxDomChars: 12 }).evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([]), requests),
      });

      expect(result).toMatchObject({ value: [] });
      expect(requests[0]?.prompt.input).toMatchObject({ domExcerpt: "<main>xxxxxx" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("prioritizes body UI over head content in the DOM excerpt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-body-"));
    const requests: ModelRequest[] = [];

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(
        domPath,
        `<html><head><style>${"x".repeat(120_000)}</style></head><body><main><button>Pay now</button></main></body></html>`,
      );
      const result = await createUsabilityHeuristicLens({ maxDomChars: 30 }).evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([]), requests),
      });

      expect(result).toMatchObject({ value: [] });
      expect(requests[0]?.prompt.input).toMatchObject({
        domExcerpt: "<main><button>Pay now</button>",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("truncates the DOM excerpt without replacement characters at UTF-8 boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-utf8-"));
    const requests: ModelRequest[] = [];

    try {
      const domPath = path.join(root, "dom.html");
      await writeFile(domPath, `🙂🙂🙂`);
      const result = await createUsabilityHeuristicLens({ maxDomChars: 1 }).evaluate({
        capture: captureWithDom(domPath),
        config: resolveSurfaceConfig(),
        evidence: [],
        knowledge,
        model: modelWithText(JSON.stringify([]), requests),
      });

      const modelInput = requests[0]?.prompt.input as { readonly domExcerpt?: unknown } | undefined;
      const domExcerpt = String(modelInput?.domExcerpt);

      expect(result).toMatchObject({ value: [] });
      expect(modelInput).toMatchObject({ domExcerpt: "🙂" });
      expect(domExcerpt).not.toContain("\uFFFD");
      expect(hasLoneSurrogate(domExcerpt)).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function captureWithDom(domPath: string): Capture {
  return {
    id: "cap_usability",
    target: { kind: "url", ref: "https://example.com/checkout" },
    backend: "playwright",
    artifacts: [{ id: "dom", type: "dom-snapshot", path: domPath, redacted: false }],
    capturedAt: "2026-06-01T00:00:00.000Z",
    status: "completed",
  };
}

async function evaluateWithModelText(
  text: string,
  options: { readonly knowledge?: KnowledgeSource } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-usability-fixture-"));

  try {
    const domPath = path.join(root, "dom.html");
    await writeFile(domPath, `<main id="checkout"><button>Pay now</button></main>`);

    return await createUsabilityHeuristicLens().evaluate({
      capture: captureWithDom(domPath),
      config: resolveSurfaceConfig(),
      evidence: [],
      knowledge: options.knowledge ?? knowledge,
      model: modelWithText(text),
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function modelWithText(text: string, requests: ModelRequest[] = []): ModelProvider {
  return {
    availability: () =>
      ok({
        available: true,
        channelId: "local",
        provider: "local",
        model: "reviewer",
        sourceKind: "local",
      }),
    complete: (request) => {
      requests.push(request);
      return ok({
        channelId: "local",
        provider: "local",
        model: "reviewer",
        sourceKind: "local",
        text,
      });
    },
  };
}

function knowledgeWith(entries: readonly KnowledgeEntry[]): KnowledgeSource {
  return {
    query: () => ok([...entries]),
    resolve: (id) => {
      const entry = entries.find((candidate) => candidate.id === id);

      return entry === undefined
        ? err(createSurfaceError("config_invalid", `missing knowledge entry: ${id}`))
        : ok(entry);
    },
  };
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);

      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }

      index += 1;
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}
