import { describe, expect, it } from "vitest";

import { isErr, isOk } from "./errors.js";
import type { Capture } from "./interfaces.js";
import { createMmrAuditFallback } from "./mmr-audit-fallback.js";

const capture = {
  id: "cap_mmr",
  target: { kind: "url", ref: "https://example.test" },
  backend: "playwright",
  artifacts: [
    { id: "dom", type: "dom-snapshot", path: ".surface/dom.html", redacted: false },
    { id: "screen", type: "screenshot", path: ".surface/screen.png", redacted: true },
  ],
  capturedAt: "2026-06-08T00:00:00.000Z",
  status: "completed",
} satisfies Capture;

describe("MMR audit fallback", () => {
  it("probes without captured artifacts and reports unsupported", async () => {
    const probePayloads: unknown[] = [];
    const fallback = createMmrAuditFallback({
      probe: (payload) => {
        probePayloads.push(payload);
      },
    });

    const availability = await fallback.availability({ capture });
    const run = await fallback.run({
      capture,
      request: {
        prompt: {
          instructions: "Review this capture.",
          input: { captureId: capture.id },
        },
      },
    });

    expect(isOk(availability)).toBe(true);
    expect(availability).toMatchObject({
      value: {
        available: false,
        channelId: "mmr",
        reason: "unsupported-capability",
        sourceKind: "mmr",
      },
    });
    expect(probePayloads).toEqual([{ channelId: "mmr", sourceKind: "mmr" }]);
    expect(JSON.stringify(probePayloads)).not.toMatch(/dom-snapshot|screenshot|\.surface/);
    expect(isErr(run)).toBe(true);
    expect(run).toMatchObject({
      error: {
        code: "model_unavailable",
        details: { reason: "unsupported-capability" },
      },
    });
  });
});
