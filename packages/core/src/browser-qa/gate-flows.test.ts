import { describe, expect, it, vi } from "vitest";

import { ok } from "../errors.js";
import { browserQaFlowRunsForGate } from "./gate-flows.js";

describe("browserQaFlowRunsForGate", () => {
  it("uses the latest matching run when an earlier run for the same flow failed", async () => {
    const olderFailed = {
      flowId: "checkout",
      gateEligible: true,
      highestFailedSeverity: "high" as const,
      id: "flowrun_checkout_failed",
      source: { ref: "surface-flows/checkout.yml" },
      status: "failed" as const,
      steps: [
        {
          completedAt: "2026-06-10T12:00:00.000Z",
          startedAt: "2026-06-10T11:59:00.000Z",
        },
      ],
      target: { kind: "url", ref: "http://localhost:3000/checkout" },
    };
    const newerPassed = {
      flowId: "checkout",
      gateEligible: true,
      id: "flowrun_checkout_passed",
      source: { ref: "surface-flows/checkout.yml" },
      status: "passed" as const,
      steps: [
        {
          completedAt: "2026-06-10T12:05:00.000Z",
          startedAt: "2026-06-10T12:04:00.000Z",
        },
      ],
      target: { kind: "url", ref: "http://localhost:3000/checkout" },
    };

    const result = await browserQaFlowRunsForGate(
      {
        browserQa: {
          qaStore: {
            listFlowRuns: vi.fn(() => Promise.resolve(ok([olderFailed, newerPassed]))),
          },
        },
      },
      { ci: true, withFlows: "surface-flows/checkout.yml" },
    );

    expect(result).toMatchObject({
      ok: true,
      value: [{ id: "flowrun_checkout_passed", status: "passed" }],
    });
  });
});
