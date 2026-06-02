// Acceptance skeletons — Epic E2: Evaluation Pipeline & Lenses (US-010..015).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMITTED_WEB_APP_TYPE_OVERLAYS,
  JUDGED_COVERAGE_UNAVAILABLE_MESSAGE,
  createSurfaceComposition,
  createNoopPipelineHandlers,
  createPipelineOrchestrator,
  createFileStateStore,
  createConversionLens,
  createTaskCompletionLens,
  createAccessibilityLens,
  getAppTypeOverlay,
  isOk,
  listAppTypeOverlays,
  modelSkipForLens,
  ok,
  resolveModelProviderConfig,
  resolveSurfaceConfig,
  runDiscovery,
  selectLensExecutionPlan,
  synthesizeMeasuredWinsDecision,
} from "../../packages/core/src/index.js";
import { runSurfaceCli } from "../../packages/cli/src/index.js";
import type {
  Capture,
  KnowledgeEntry,
  KnowledgeSource,
  ModelProvider,
} from "../../packages/core/src/interfaces.js";
import type { ModelRequest } from "../../packages/core/src/model-provider.js";
import {
  createAxeGroundingTool,
  createLighthouseGroundingTool,
} from "../../packages/grounding/src/index.js";

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
    it("[US-011][AC1] each a11y violation produced/confirmed by Axe/Lighthouse, method:measured, with selector + measured value (integration)", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-a11y-pipeline-"));
      const capture = {
        id: "cap_a11y_acceptance",
        target: { kind: "url", ref: "http://localhost:3000" },
        backend: "playwright",
        artifacts: [
          {
            id: "dom",
            type: "dom-snapshot",
            path: ".surface/captures/dom.html",
            redacted: false,
          },
        ],
        capturedAt: "2026-05-31T18:00:00.000Z",
        status: "completed",
      } satisfies Capture;
      const axe = createAxeGroundingTool({
        runAxe: () =>
          Promise.resolve({
            violations: [
              {
                id: "color-contrast",
                nodes: [
                  {
                    target: [".cta"],
                    failureSummary:
                      "Element has insufficient color contrast of 3.1. Expected contrast ratio of 4.5:1",
                  },
                ],
              },
            ],
          }),
      });
      const lighthouse = createLighthouseGroundingTool({
        runLighthouse: () =>
          Promise.resolve({
            lhr: {
              categories: { accessibility: { auditRefs: [{ id: "button-name" }] } },
              audits: {
                "button-name": {
                  score: 0,
                  title: "Buttons do not have an accessible name",
                  details: { items: [{ node: { selector: "button.icon" } }] },
                },
              },
            },
          }),
      });
      let findings: unknown = [];

      try {
        const orchestrator = createPipelineOrchestrator({
          handlers: createNoopPipelineHandlers({
            accessibility: async ({ config }) => {
              const axeResult = await axe.run(capture);
              if (!isOk(axeResult)) {
                return axeResult;
              }

              const lighthouseResult = await lighthouse.run(capture);
              if (!isOk(lighthouseResult)) {
                return lighthouseResult;
              }

              const result = await createAccessibilityLens().evaluate({
                capture,
                config,
                evidence: [...axeResult.value, ...lighthouseResult.value].flatMap(
                  (toolResult) => toolResult.evidence,
                ),
                knowledge: {
                  query: () => Promise.resolve({ ok: true as const, value: [] }),
                  resolve: (id: string) =>
                    Promise.resolve({ ok: true as const, value: { id, summary: id, title: id } }),
                },
              });

              if (isOk(result)) {
                findings = result.value;
              }

              return result;
            },
          }),
          stateStore: createFileStateStore({ projectRoot }),
        });
        const pipelineResult = await orchestrator.run({
          config: resolveSurfaceConfig(),
          runId: "run_acceptance_a11y",
        });

        expect(isOk(pipelineResult)).toBe(true);
        expect(findings).toMatchObject([
          {
            evidence: [
              { kind: "tool-result", measuredValue: ".cta: 3.1:1", tool: "axe" },
              { kind: "dom", selector: ".cta" },
            ],
            issueType: "contrast-insufficient",
            lens: "accessibility",
            location: { selector: ".cta" },
            method: "measured",
          },
          {
            evidence: [
              {
                kind: "tool-result",
                measuredValue: "button.icon: Buttons do not have an accessible name (score 0)",
                tool: "lighthouse",
              },
              { kind: "dom", selector: "button.icon" },
            ],
            issueType: "accessible-name-missing",
            lens: "accessibility",
            location: { selector: "button.icon" },
            method: "measured",
          },
        ]);
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    });
    it("[US-011][AC2] contrast violation includes measured ratio + WCAG 2.2 AA threshold (unit)", async () => {
      const tool = createAxeGroundingTool({
        runAxe: () =>
          Promise.resolve({
            violations: [
              {
                id: "color-contrast",
                tags: ["wcag2aa", "wcag143"],
                nodes: [
                  {
                    target: [".cta"],
                    failureSummary:
                      "Element has insufficient color contrast of 3.1. Expected contrast ratio of 4.5:1",
                  },
                ],
              },
            ],
          }),
      });

      const result = await tool.run({
        id: "cap_axe",
        target: { kind: "url", ref: "http://localhost:3000" },
        backend: "playwright",
        artifacts: [],
        capturedAt: "2026-05-31T18:00:00.000Z",
        status: "completed",
      });

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
                measuredValue: ".cta: 3.1:1",
                threshold: "4.5:1 (WCAG 2.2 AA)",
              },
            ],
          },
        ],
      });
    });
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

    it("[US-013][AC1] preset accessibility-first @depth4 selects the preset/overlay lens plan and records active config (integration)", async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "surface-lenses-"));
      const config = resolveSurfaceConfig({
        cli: {
          evaluation: {
            appType: "generic",
            depth: 4,
            preset: "accessibility-first",
          },
        },
      });

      try {
        const plan = selectLensExecutionPlan({
          capture: {
            id: "cap_acceptance_live",
            target: { kind: "url", ref: "https://example.com" },
            backend: "playwright",
            artifacts: [
              {
                id: "dom",
                type: "dom-snapshot",
                path: ".surface/captures/dom.html",
                redacted: false,
              },
              {
                id: "computed-styles",
                type: "computed-styles",
                path: ".surface/captures/computed-styles.json",
                redacted: false,
              },
            ],
            capturedAt: "2026-05-31T00:00:00.000Z",
            status: "completed",
          },
          config,
          modelAvailability: {
            available: false,
            reason: "no-model-configured",
            message: "No model configured.",
          },
        });
        const decision = synthesizeMeasuredWinsDecision({
          factKey: "contrast:.btn-primary",
          judgedSource: "visual-hierarchy",
          judgedValue: "acceptable",
          measuredSource: "axe",
          measuredValue: "3.1:1",
        });
        const orchestrator = createPipelineOrchestrator({
          handlers: createNoopPipelineHandlers(),
          stateStore: createFileStateStore({ projectRoot }),
        });
        const pipelineResult = await orchestrator.run({
          config,
          runId: "run_acceptance_lenses",
        });
        const persisted = JSON.parse(
          await readFile(path.join(projectRoot, ".surface", "state.json"), "utf8"),
        ) as Record<string, unknown>;

        expect(plan.overlay.appType).toBe("generic");
        expect(plan.preset).toBe("accessibility-first");
        expect(plan.selected.map((lens) => lens.id)).toEqual(["accessibility", "visual-hierarchy"]);
        expect(plan.skipped).toEqual([]);
        expect(decision).toMatchObject({
          factKey: "contrast:.btn-primary",
          sourceOfTruth: "measured",
          measuredSource: "axe",
          judgedSource: "visual-hierarchy",
        });
        expect(isOk(pipelineResult)).toBe(true);
        expect(persisted).toMatchObject({
          currentStage: "completed",
          pipeline: {
            activeConfig: {
              evaluation: config.evaluation,
              findings: { severityCutoffs: config.findings.severityCutoffs },
              reporting: { gatePolicy: config.reporting.gatePolicy },
            },
            runId: "run_acceptance_lenses",
          },
        });
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    });
  });
  describe("US-014 cognitive walkthrough & conversion audit [should]", () => {
    it("[US-014][AC1] task/persona + flow → each step evaluated as first-time user; friction emitted citing heuristic (integration)", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "surface-us014-task-"));
      const requests: ModelRequest[] = [];

      try {
        const domPath = path.join(root, "dom.html");
        await writeFile(
          domPath,
          `<main id="checkout"><h1>Checkout</h1><button id="pay">Pay now</button></main>`,
        );
        const lens = createTaskCompletionLens({
          task: {
            conversionCritical: true,
            id: "checkout",
            persona: {
              goals: ["complete checkout"],
              id: "first-time-shopper",
              priorKnowledge: "first-time",
            },
            steps: ["Review cart", "Confirm shipping", "Pay"],
          },
        });
        const result = await lens.evaluate({
          capture: flowCaptureWithDom(domPath),
          config: resolveSurfaceConfig(),
          evidence: [],
          knowledge: flowKnowledgeWith(flowTaskKnowledge()),
          model: flowModelWithText(
            JSON.stringify([
              {
                issueType: "first-time-user-friction",
                rationale: "A first-time shopper cannot tell whether shipping is confirmed.",
                selector: "#checkout",
                title: "Checkout lacks first-time confirmation context",
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
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });

    it("[US-014][AC2] conversion path under e-commerce overlay → friction findings tagged to that path (integration)", async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "surface-us014-conversion-"));
      const requests: ModelRequest[] = [];

      try {
        const domPath = path.join(root, "dom.html");
        await writeFile(
          domPath,
          `<main id="checkout"><button id="pay">Pay now</button><p>Taxes calculated later</p></main>`,
        );
        const lens = createConversionLens({ conversionPath: "checkout" });
        const result = await lens.evaluate({
          capture: flowCaptureWithDom(domPath),
          config: resolveSurfaceConfig({ cli: { evaluation: { appType: "e-commerce" } } }),
          evidence: [],
          knowledge: flowKnowledgeWith(flowConversionKnowledge()),
          model: flowModelWithText(
            JSON.stringify([
              {
                issueType: "late-cost-surprise",
                rationale: "The checkout path hides taxes until a later step.",
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
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    });
  });
  describe("US-015 bounded alternatives & before/after diff [should]", () => {
    it("[US-015][AC1] `alternatives <target>` → bounded improvements to that view (never blank-canvas) with rationale (integration)", async () => {
      const stdout: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "alternatives", "--dom", "<main>Checkout</main>"],
        composition: createSurfaceComposition(),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout.join(""));

      expect(parsed).toMatchObject({
        command: "alternatives",
        data: {
          alternatives: {
            target: { kind: "dom", ref: "<main>Checkout</main>" },
          },
        },
        ok: true,
      });
      expect(parsed.data.alternatives.proposals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rationale: expect.stringContaining("Bounded to the captured view"),
            title: expect.not.stringMatching(/blank canvas/i),
          }),
        ]),
      );
    });

    it("[US-015][AC2] `diff <before> <after>` → reports resolved/introduced findings between them (integration)", async () => {
      const stdout: string[] = [];
      const exitCode = await runSurfaceCli({
        argv: ["node", "surface", "--json", "diff", "run_before", "run_after"],
        composition: createSurfaceComposition({
          stateStore: {
            readState: () =>
              ok({
                runRecords: [
                  {
                    runId: "run_before",
                    trackedFindings: [
                      {
                        currentFindingId: "finding_resolved",
                        identityKey: "identity_resolved",
                        status: "still-failing",
                        validation: { expectation: "before failed", kind: "measured-rule" },
                      },
                    ],
                  },
                  {
                    runId: "run_after",
                    trackedFindings: [
                      {
                        currentFindingId: "finding_introduced",
                        identityKey: "identity_introduced",
                        status: "new",
                        validation: { expectation: "after failed", kind: "measured-rule" },
                      },
                    ],
                  },
                ],
                version: "1.0",
              }),
            writeArtifact: () =>
              Promise.resolve(ok({ path: ".surface/test", sha256: "sha256:test" })),
            writeState: (state) => ok(state),
          },
        }),
        io: { stdout: (chunk) => stdout.push(chunk) },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        command: "diff",
        data: {
          introduced: [{ findingId: "finding_introduced", identityKey: "identity_introduced" }],
          resolved: [{ findingId: "finding_resolved", identityKey: "identity_resolved" }],
        },
        ok: true,
      });
    });
  });
});

function flowCaptureWithDom(domPath: string): Capture {
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
    id: "cap_us014",
    status: "completed",
    target: { kind: "url", ref: "https://example.com/checkout" },
  };
}

function flowKnowledgeWith(entry: KnowledgeEntry): KnowledgeSource {
  return {
    query: () => Promise.resolve(ok([entry])),
    resolve: () => Promise.resolve(ok(entry)),
  };
}

function flowTaskKnowledge(): KnowledgeEntry {
  return {
    appliesToLenses: ["task-completion"],
    deepGuidance: "Walk through each task step as a first-time user.",
    id: "kb_task_completion_walkthrough",
    summary: "First-time users need clear step context and recovery.",
    title: "Task completion walkthrough",
  };
}

function flowConversionKnowledge(): KnowledgeEntry {
  return {
    appliesToLenses: ["conversion"],
    deepGuidance: "Inspect conversion paths for hidden cost, risk, and blocked next actions.",
    id: "kb_conversion_path_friction_trust",
    summary: "Conversion paths should make cost, risk, and next action clear.",
    title: "Conversion path friction and trust",
  };
}

function flowModelWithText(text: string, requests: ModelRequest[]): ModelProvider {
  return {
    availability: () => ok({ available: true, model: "reviewer", provider: "local" }),
    complete: (request) => {
      requests.push(request);
      return ok({ model: "reviewer", provider: "local", text });
    },
  };
}
