import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveSurfaceConfig } from "./config.js";
import { isOk, ok } from "./errors.js";
import type { Capture, KnowledgeEntry, KnowledgeSource, ModelProvider } from "./interfaces.js";
import {
  createConversionLens,
  createTaskCompletionLens,
  type CognitiveTaskDefinition,
} from "./flow-lenses.js";
import type { ModelRequest } from "./model-provider.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("cognitive walkthrough and conversion lenses", () => {
  it("emits cited first-time-user task friction from model output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-task-lens-"));
    tempRoots.push(root);
    const domPath = path.join(root, "dom.html");
    await writeFile(domPath, `<main id="checkout"><button id="pay">Pay now</button></main>`);
    const requests: ModelRequest[] = [];
    const task = {
      id: "checkout",
      conversionCritical: true,
      persona: {
        goals: ["buy a product"],
        id: "first-time-shopper",
        priorKnowledge: "first-time",
      },
      steps: ["Review cart", "Confirm shipping", "Pay"],
    } satisfies CognitiveTaskDefinition;
    const lens = createTaskCompletionLens({ task });

    const result = await lens.evaluate({
      capture: captureWithDom(domPath),
      config: resolveSurfaceConfig(),
      evidence: [],
      knowledge: knowledgeWith(taskKnowledge()),
      model: modelWithText(
        JSON.stringify([
          {
            issueType: "first-time-user-friction",
            rationale: "A first-time shopper cannot tell whether shipping is confirmed before pay.",
            selector: "#checkout",
            title: "Checkout step lacks confirmation context",
          },
        ]),
        requests,
      ),
    });

    expect(isOk(result)).toBe(true);
    expect(requests[0]?.prompt.input).toMatchObject({
      task: {
        id: "checkout",
        persona: { priorKnowledge: "first-time" },
        steps: ["Review cart", "Confirm shipping", "Pay"],
      },
    });

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]).toMatchObject({
      citedHeuristics: ["kb_task_completion_walkthrough"],
      evidence: [
        { kind: "cited-heuristic", knowledgeEntryId: "kb_task_completion_walkthrough" },
        { kind: "dom", selector: "#checkout" },
      ],
      lens: "task-completion",
      method: "judged",
      tags: ["task:checkout"],
    });
  });

  it("emits conversion-path friction tagged to the evaluated path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "surface-conversion-lens-"));
    tempRoots.push(root);
    const domPath = path.join(root, "dom.html");
    await writeFile(
      domPath,
      `<main id="checkout"><button id="pay">Pay now</button><p>Taxes calculated later</p></main>`,
    );
    const requests: ModelRequest[] = [];
    const lens = createConversionLens({ conversionPath: "checkout" });

    const result = await lens.evaluate({
      capture: captureWithDom(domPath),
      config: resolveSurfaceConfig({ cli: { evaluation: { appType: "e-commerce" } } }),
      evidence: [],
      knowledge: knowledgeWith(conversionKnowledge()),
      model: modelWithText(
        JSON.stringify([
          {
            issueType: "late-cost-surprise",
            rationale: "The checkout path says taxes are calculated later, creating cost risk.",
            selector: "#checkout",
            title: "Checkout path hides total cost until late",
          },
        ]),
        requests,
      ),
    });

    expect(isOk(result)).toBe(true);
    expect(requests[0]?.prompt.input).toMatchObject({
      appType: "e-commerce",
      conversionPath: "checkout",
    });

    if (!isOk(result)) {
      return;
    }

    expect(result.value[0]).toMatchObject({
      citedHeuristics: ["kb_conversion_path_friction_trust"],
      issueType: "late-cost-surprise",
      lens: "conversion",
      method: "judged",
      tags: ["conversion-path:checkout"],
    });
  });
});

function captureWithDom(domPath: string): Capture {
  return {
    artifacts: [
      {
        id: "dom",
        path: domPath,
        redacted: false,
        type: "dom-snapshot",
      },
    ],
    backend: "playwright",
    capturedAt: "2026-06-02T00:00:00.000Z",
    id: "cap_flow",
    status: "completed",
    target: { kind: "url", ref: "https://example.com/checkout" },
  };
}

function knowledgeWith(entry: KnowledgeEntry): KnowledgeSource {
  return {
    query: () => Promise.resolve(ok([entry])),
    resolve: () => Promise.resolve(ok(entry)),
  };
}

function taskKnowledge(): KnowledgeEntry {
  return {
    appliesToLenses: ["task-completion"],
    deepGuidance: "Walk through each task step as a first-time user.",
    id: "kb_task_completion_walkthrough",
    summary: "First-time users need clear step context and recovery.",
    title: "Task completion walkthrough",
  };
}

function conversionKnowledge(): KnowledgeEntry {
  return {
    appliesToLenses: ["conversion"],
    deepGuidance: "Inspect conversion paths for hidden cost, risk, and blocked next actions.",
    id: "kb_conversion_path_friction_trust",
    summary: "Conversion paths should make cost, risk, and next action clear.",
    title: "Conversion path friction and trust",
  };
}

function modelWithText(text: string, requests: ModelRequest[]): ModelProvider {
  return {
    availability: () => ok({ available: true, model: "reviewer", provider: "local" }),
    complete: (request) => {
      requests.push(request);
      return ok({ model: "reviewer", provider: "local", text });
    },
  };
}
