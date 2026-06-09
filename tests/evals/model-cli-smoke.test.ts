import { describe, expect, it } from "vitest";

import {
  DirectSubscriptionChannelIdSchema,
  resolveSurfaceConfig,
  type DirectSubscriptionChannelId,
} from "../../packages/core/src/config.js";
import {
  defaultProcessRunner,
  resolveDirectProviders,
} from "../../packages/core/src/subscription-cli-provider.js";

describe.skipIf(process.env.SURFACE_MODEL_CLI_SMOKE !== "1")("model CLI smoke gate", () => {
  it("discovers at least one authenticated direct subscription CLI", async () => {
    const channels = smokeChannels(process.env.SURFACE_MODEL_CHANNELS);
    const config = resolveSurfaceConfig({
      cli: {
        model: {
          egressPolicy: { mode: "text" },
          fallback: {
            mode: "direct",
            providerOrder: channels,
            timeoutMs: smokeTimeoutMs(process.env.SURFACE_MODEL_SMOKE_TIMEOUT_MS),
          },
        },
      },
    });

    const resolved = await resolveDirectProviders(config, defaultProcessRunner);

    expect(defaultProcessRunner.enforcedFilesystemIsolation).toBe(true);
    expect(resolved.subscriptionProviders.length).toBeGreaterThan(0);
  });
});

function smokeChannels(value: string | undefined): readonly DirectSubscriptionChannelId[] {
  const parsedChannels = (value ?? "codex,claude,gemini")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parsedChannels.length === 0) {
    throw new Error(
      "SURFACE_MODEL_CHANNELS must include at least one direct subscription channel.",
    );
  }

  return parsedChannels.map((channel) => DirectSubscriptionChannelIdSchema.parse(channel));
}

function smokeTimeoutMs(value: string | undefined): number {
  if (value === undefined) {
    return 30_000;
  }

  const timeoutMs = Number.parseInt(value, 10);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("SURFACE_MODEL_SMOKE_TIMEOUT_MS must be a positive integer.");
  }

  return timeoutMs;
}
