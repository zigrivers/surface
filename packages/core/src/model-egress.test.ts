import { describe, expect, it } from "vitest";

import type { ModelEgressPolicy } from "./config.js";
import { CaptureArtifactSchema, type Capture, type CaptureArtifact } from "./interfaces.js";
import {
  ModelEgressLedgerEntrySchema,
  createModelEgressLedgerEntry,
  evaluateModelArtifactEgress,
  isModelChannelPermitted,
  maskModelArtifactText,
  maskModelPlainText,
} from "./model-egress.js";

const textOnlyPolicy = {
  mode: "text",
  screenshots: "blocked",
} as const satisfies ModelEgressPolicy;

const screenshotPolicy = {
  mode: "text-and-screenshots",
  screenshots: "redacted-only",
} as const satisfies ModelEgressPolicy;

const disabledPolicy = {
  mode: "off",
  screenshots: "blocked",
} as const satisfies ModelEgressPolicy;

const verifiedRedaction: CaptureArtifact["redaction"] = {
  status: "redacted",
  maskedClasses: ["email", "auth-token"],
  safeNoSensitiveRegions: false,
  unsafeRegions: [],
  boundingBoxesVerified: true,
};

function captureWith(artifacts: readonly CaptureArtifact[]): Capture {
  return {
    id: "cap_egress",
    target: { kind: "url", ref: "https://example.test" },
    backend: "playwright",
    artifacts: [...artifacts],
    capturedAt: "2026-06-08T00:00:00.000Z",
    status: "completed",
  };
}

function artifact(
  id: string,
  type: CaptureArtifact["type"],
  redaction?: CaptureArtifact["redaction"],
): CaptureArtifact {
  return {
    id,
    type,
    path: `.surface/captures/${id}`,
    redacted: redaction !== undefined,
    ...(redaction === undefined ? {} : { redaction }),
  };
}

describe("model egress policy", () => {
  it("sends only text artifacts when screenshot egress is blocked", () => {
    const decision = evaluateModelArtifactEgress(
      captureWith([
        artifact("dom.html", "dom-snapshot"),
        artifact("a11y.json", "accessibility-tree"),
        artifact("styles.json", "computed-styles"),
        artifact("screen.png", "screenshot", verifiedRedaction),
      ]),
      textOnlyPolicy,
    );

    expect(decision.artifactsToSend.map((entry) => entry.type)).toEqual([
      "dom-snapshot",
      "accessibility-tree",
      "computed-styles",
    ]);
    expect(decision.artifactClassesSent).toEqual([
      "dom-snapshot",
      "accessibility-tree",
      "computed-styles",
    ]);
    expect(decision.blockedReasons).toContain("screenshot_blocked_by_policy");
    expect(decision.redactionStatus).toBe("text-only");
  });

  it("blocks screenshots without verified redaction metadata", () => {
    const missing = evaluateModelArtifactEgress(
      captureWith([artifact("screen.png", "screenshot")]),
      screenshotPolicy,
    );
    const empty = evaluateModelArtifactEgress(captureWith([]), screenshotPolicy);
    const mixed = evaluateModelArtifactEgress(
      captureWith([
        artifact("screen-1.png", "screenshot", verifiedRedaction),
        artifact("screen-2.png", "screenshot", {
          ...verifiedRedaction,
          boundingBoxesVerified: false,
        }),
      ]),
      screenshotPolicy,
    );

    expect(missing.artifactsToSend).toEqual([]);
    expect(missing.blockedReasons).toContain("screenshot_blocked_no_redacted_artifact");
    expect(empty.blockedReasons).toContain("screenshot_blocked_no_redacted_artifact");
    expect(mixed.artifactsToSend).toEqual([]);
    expect(mixed.blockedReasons).toContain("screenshot_blocked_no_verified_redaction");
  });

  it("allows screenshots only when every screenshot has verified redaction metadata", () => {
    const decision = evaluateModelArtifactEgress(
      captureWith([
        artifact("dom.html", "dom-snapshot"),
        artifact("screen-1.png", "screenshot", verifiedRedaction),
        artifact("screen-2.png", "screenshot", {
          status: "redacted",
          maskedClasses: [],
          safeNoSensitiveRegions: true,
          unsafeRegions: [],
          selectorsVerified: true,
          textRangesVerified: true,
        }),
      ]),
      screenshotPolicy,
    );

    expect(decision.artifactsToSend.map((entry) => entry.type)).toEqual([
      "dom-snapshot",
      "screenshot",
      "screenshot",
    ]);
    expect(decision.artifactsToSend.filter((entry) => entry.type === "screenshot")).toEqual([
      expect.objectContaining({
        id: "screenshot-metadata-1",
        path: "[redacted-screenshot-metadata-only]",
        redacted: true,
      }),
      expect.objectContaining({
        id: "screenshot-metadata-2",
        path: "[redacted-screenshot-metadata-only]",
        redacted: true,
      }),
    ]);
    expect(JSON.stringify(decision.artifactsToSend)).not.toContain("screen-1.png");
    expect(decision.artifactClassesSent).toEqual(["dom-snapshot", "screenshot"]);
    expect(decision.blockedReasons).toEqual([]);
    expect(decision.redactionStatus).toBe("redacted-screenshots");
  });

  it("round-trips redaction metadata on capture artifacts", () => {
    expect(
      CaptureArtifactSchema.parse({
        id: "screen",
        type: "screenshot",
        path: ".surface/captures/screen.png",
        redacted: true,
        redaction: verifiedRedaction,
      }),
    ).toMatchObject({
      redaction: {
        status: "redacted",
        boundingBoxesVerified: true,
      },
    });

    expect(
      CaptureArtifactSchema.safeParse({
        id: "screen",
        type: "screenshot",
        path: ".surface/captures/screen.png",
        redacted: true,
        redaction: {
          status: "redacted",
          maskedClasses: [],
          safeNoSensitiveRegions: false,
          unsafeRegions: [],
        },
      }).success,
    ).toBe(false);
  });

  it("permits BYO, local, direct, and MMR channels only inside effective policy", () => {
    const narrowedPolicy = {
      mode: "text",
      screenshots: "blocked",
      allowedChannels: ["openai", "local", "codex", "mmr"],
      deniedChannels: ["codex"],
    } as const satisfies ModelEgressPolicy;

    expect(
      isModelChannelPermitted(narrowedPolicy, { channelId: "openai", sourceKind: "api" }),
    ).toEqual({ permitted: true });
    expect(
      isModelChannelPermitted(narrowedPolicy, { channelId: "local", sourceKind: "local" }),
    ).toEqual({ permitted: true });
    expect(
      isModelChannelPermitted(narrowedPolicy, {
        channelId: "codex",
        sourceKind: "subscription-cli",
      }),
    ).toMatchObject({ permitted: false, reason: "channel_denied_by_policy" });
    expect(
      isModelChannelPermitted(narrowedPolicy, { channelId: "mmr", sourceKind: "mmr" }),
    ).toEqual({ permitted: true });
    expect(isModelChannelPermitted(narrowedPolicy, {})).toMatchObject({
      permitted: false,
      reason: "channel_metadata_missing",
    });
    expect(
      isModelChannelPermitted(disabledPolicy, { channelId: "openai", sourceKind: "api" }),
    ).toMatchObject({ permitted: false, reason: "model_egress_blocked_by_policy" });
    expect(
      isModelChannelPermitted(narrowedPolicy, { channelId: "anthropic", sourceKind: "api" }),
    ).toMatchObject({ permitted: false, reason: "channel_not_allowed_by_policy" });
  });

  it("records sanitized ledger entries without prompt, raw output, auth, screenshot, or secret data", () => {
    const ledger = createModelEgressLedgerEntry({
      runId: "run_001",
      sourceKind: "subscription-cli",
      attemptedChannels: ["codex"],
      completedChannels: [],
      unavailableChannels: [
        {
          channelId: "codex",
          reason: "auth-unavailable",
          message: "codex login is unavailable",
        },
      ],
      blockedReasons: ["channel_denied_by_policy"],
      artifactClassesSent: ["dom-snapshot"],
      redactionStatus: "text-only",
    });

    expect(ModelEgressLedgerEntrySchema.parse(ledger)).toMatchObject({
      runId: "run_001",
      attemptedChannels: ["codex"],
      unavailableChannels: [{ reason: "auth-unavailable" }],
    });
    expect(JSON.stringify(ledger)).not.toMatch(/sk-live|raw model output|prompt text|PNG bytes/i);
    expect(
      ModelEgressLedgerEntrySchema.safeParse({
        ...ledger,
        prompt: "prompt text with sk-live-secret",
      }).success,
    ).toBe(false);
  });

  it("masks sensitive DOM, accessibility, and computed-style text before model egress", () => {
    const dom = `<main>
      <input type="password" value="correct-horse">
      <input value="hunter-two" type="password">
      <input value="Call Ada at 303-555-0199">
      <button data-testid="checkout-submit-button-primary-control">Pay</button>
      <p>ada@example.test</p>
      <textarea>ship this to my private address</textarea>
      <div data-session="sess_1234567890abcdef">free-form checkout note</div>
      <div data-jwt="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"></div>
    </main>`;
    const accessibility = `button "Pay as ada@example.test with token sk-live-secret anthropic-1234567890abcdef gcloud-1234567890abcdef"`;
    const styles = `.avatar {
      background-image: url("https://cdn.example.test/u/ada.png?token=secret-token");
      border-image-source: url("https://cdn.example.test/u/ada.png?access_token=oauthAccessToken1234567890");
      content: "ada@example.test";
      --session: "sess_abcdef1234567890";
      --aws: "AKIA1234567890ABCDEF";
      --google-api: "AIza1234567890abcdef1234567890abcdef";
      --oauth: "ya29.1234567890abcdef.abcdef";
      --token-hex: "0123456789abcdef0123456789abcdef";
      --stable-hash: "abcdef1234567890abcdef1234567890";
      --opaque: "MDEyMzQ1Njc4OWFiY2RlZkFCQ0RFRjAxMjM0NTY3ODlhYmNkZWY=";
    }`;

    const maskedDom = maskModelArtifactText({
      artifactType: "dom-snapshot",
      text: dom,
      redaction: {
        ...verifiedRedaction,
        sensitiveTextRanges: [
          {
            start: dom.indexOf("free-form checkout note"),
            end: dom.indexOf("free-form checkout note") + "free-form checkout note".length,
          },
        ],
      },
    }).text;

    expect(maskedDom).toContain("checkout-submit-button-primary-control");
    expect(maskedDom).toContain('data-session="[masked-secret]"');
    expect(maskedDom).toContain('value="[masked-form-value]"');
    expect(maskedDom).not.toContain("data-masked-secret");
    expect(maskedDom).not.toMatch(
      /ada@example\.test|correct-horse|hunter-two|303-555-0199|ship this to my private address|sess_1234567890abcdef|eyJhbGci|free-form checkout note/,
    );
    expect(
      maskModelArtifactText({
        artifactType: "dom-snapshot",
        text: 'api_key_1234567890abcdef="do-not-ship"',
      }).text,
    ).not.toContain("api_key_1234567890abcdef");
    expect(
      maskModelArtifactText({ artifactType: "accessibility-tree", text: accessibility }).text,
    ).not.toMatch(/ada@example\.test|sk-live-secret|anthropic-|gcloud-/);
    const maskedStyles = maskModelArtifactText({ artifactType: "computed-styles", text: styles });

    expect(maskedStyles.maskingStrategy).toBe("structural");
    expect(maskedStyles.text).toContain('--stable-hash: "abcdef1234567890abcdef1234567890"');
    expect(maskedStyles.text).not.toMatch(
      /ada@example\.test|secret-token|oauthAccessToken1234567890|sess_abcdef1234567890|AKIA|AIza|ya29|0123456789abcdef0123456789abcdef|MDEyMz/,
    );
  });

  it("masks computed-style JSON structurally without dropping non-secret hashes", () => {
    const styles = JSON.stringify({
      button: {
        backgroundImage: 'url("https://cdn.example.test/button.png?auth=secret-token")',
        colorChecksum: "abcdef1234567890abcdef1234567890",
        content: '"ada@example.test"',
        sessionToken: "0123456789abcdef0123456789abcdef",
      },
    });

    const masked = maskModelArtifactText({ artifactType: "computed-styles", text: styles });

    expect(masked.maskingStrategy).toBe("structural");
    expect(masked.text).toContain("abcdef1234567890abcdef1234567890");
    expect(masked.text).not.toMatch(
      /ada@example\.test|secret-token|0123456789abcdef0123456789abcdef/,
    );
  });

  it("preserves common non-secret identifiers while masking opaque high-entropy tokens", () => {
    const text =
      "Build 550e8400-e29b-41d4-a716-446655440000 uses artifact abcdef1234567890abcdef1234567890 and token MDEyMzQ1Njc4OWFiY2RlZkFCQ0RFRjAxMjM0NTY3ODlhYmNkZWY= with hex abcdef1234567890abcdef1234567890abcdef1234567890";

    const masked = maskModelPlainText(text);

    expect(masked).toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(masked).toContain("abcdef1234567890abcdef1234567890");
    expect(masked).not.toContain("MDEyMzQ1Njc4");
    expect(masked).not.toContain("abcdef1234567890abcdef1234567890abcdef1234567890");
  });

  it("preserves non-secret DOM structure while masking realistic captured markup", () => {
    const dom = `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <style>
            .cta[data-state="ready"] { color: #123456; }
            .cta::after { content: "Buy now"; }
            .private::before { content: "ada@example.test"; }
          </style>
          <script>window.__token = "sk-live-secret";</script>
          <template><input value="Call Ada at 303-555-0199"></template>
        </head>
        <body>
          <main id="checkout" aria-label="Checkout flow" data-token="sess_1234567890abcdef">
            <input type="hidden" name="csrf_token" value="csrf-secret-1234567890">
            <img src="/logo.png" alt="Acme">
            <button class="cta" data-state="ready" aria-describedby="help">Pay now</button>
            <p id="help">Secure checkout</p>
            <textarea>Leave at front desk</textarea>
          </main>
        </body>
      </html>`;

    const result = maskModelArtifactText({ artifactType: "dom-snapshot", text: dom });
    const masked = result.text;

    expect(result.maskingStrategy).toBe("structural");
    expect(masked).toContain('lang="en"');
    expect(masked).toContain('id="checkout"');
    expect(masked).toContain('aria-label="Checkout flow"');
    expect(masked).toContain('class="cta"');
    expect(masked).toContain('data-state="ready"');
    expect(masked).toContain('aria-describedby="help"');
    expect(masked).toContain('name="csrf_token"');
    expect(masked).toContain('value="[masked-form-value]"');
    expect(masked).toContain('src="/logo.png"');
    expect(masked).toContain('alt="Acme"');
    expect(masked).toContain("Pay now");
    expect(masked).toContain("Secure checkout");
    expect(masked).toContain("[masked-nonvisible-content]");
    expect(masked).not.toContain("Leave at front desk");
    expect(masked).not.toMatch(
      /ada@example\.test|sk-live-secret|sess_1234567890abcdef|csrf-secret-1234567890|Leave at front desk|303-555-0199|window.__token/,
    );
  });

  it("parses DOM fragments with quoted greater-than characters before masking", () => {
    const dom =
      '<main><button aria-label="2 > 1" data-token="sess_1234567890abcdef">Pay</button></main>';

    const result = maskModelArtifactText({ artifactType: "dom-snapshot", text: dom });

    expect(result.maskingStrategy).toBe("structural");
    expect(result.text).toContain('aria-label="2 > 1"');
    expect(result.text).toContain(">Pay</button>");
    expect(result.text).not.toContain("sess_1234567890abcdef");
  });

  it("masks auth, password, credential, and key-like DOM attributes structurally", () => {
    const dom = `<main>
      <div data-password="correct-horse" data-auth="bearer-token" data-credential="cred-1234567890" data-api-key="key-1234567890" data-key="abcdef1234567890abcdef1234567890"></div>
    </main>`;

    const result = maskModelArtifactText({ artifactType: "dom-snapshot", text: dom });

    expect(result.maskingStrategy).toBe("structural");
    expect(result.text).toContain('data-password="[masked-secret]"');
    expect(result.text).toContain('data-auth="[masked-secret]"');
    expect(result.text).toContain('data-credential="[masked-secret]"');
    expect(result.text).toContain('data-api-key="[masked-secret]"');
    expect(result.text).toContain('data-key="[masked-secret]"');
    expect(result.text).not.toMatch(/correct-horse|bearer-token|cred-1234567890|key-1234567890/);
  });

  it("masks plain model text without parsing HTML-like copy as DOM", () => {
    const text =
      'Provider said CTA copy "<button>Pay now</button>" was confusing for ada@example.test with sk-live-secret.';

    const masked = maskModelPlainText(text);

    expect(masked).toContain('CTA copy "<button>Pay now</button>" was confusing');
    expect(masked).not.toMatch(/ada@example\.test|sk-live-secret/);
  });

  it("preserves truncated DOM excerpts while masking secrets", () => {
    const dom =
      '<section class="checkout-panel"><button data-token=sess_1234567890abcdef data-secret=visibleSecret1234567890 data-password=correct-horse-token>Pay now</button><input type="password" value="correct-horse"><input value="Call Ada at 303-555-0199"><textarea>Leave at private desk<div contenteditable="true">Card ending 4242';

    const result = maskModelArtifactText({ artifactType: "dom-snapshot", text: dom });
    const masked = result.text;

    expect(result.maskingStrategy).toBe("pattern");
    expect(masked).toContain('<section class="checkout-panel">');
    expect(masked).toContain("<button");
    expect(masked).toContain("Pay now");
    expect(masked).toContain('<input type="password"');
    expect(masked).toContain('value="[masked-form-value]"');
    expect(masked).toContain("data-secret=[masked-secret]");
    expect(masked).toContain("data-password=[masked-secret]");
    expect(masked).toContain("[masked-form-text]");
    expect(masked).not.toMatch(
      /sess_1234567890abcdef|visibleSecret1234567890|correct-horse-token|correct-horse|303-555-0199|Leave at private desk|Card ending 4242/,
    );
  });

  it("merges overlapping verified text ranges before masking", () => {
    const text = "prefix first-secret second-secret suffix";
    const firstStart = text.indexOf("first-secret");
    const secondEnd = text.indexOf("second-secret") + "second-secret".length;

    const masked = maskModelArtifactText({
      artifactType: "dom-snapshot",
      text,
      redaction: {
        ...verifiedRedaction,
        sensitiveTextRanges: [
          { start: firstStart, end: text.indexOf("second-secret") + 6 },
          { start: text.indexOf("first-secret") + 6, end: secondEnd },
        ],
      },
    }).text;

    expect(masked).toBe("prefix [masked-text] suffix");
  });

  it("fails closed for DOM selector redaction metadata that has not been converted to ranges", () => {
    const dom = `<main><section data-private="account">Card ending 4242</section><button>Pay</button></main>`;

    const result = maskModelArtifactText({
      artifactType: "dom-snapshot",
      text: dom,
      redaction: {
        ...verifiedRedaction,
        selectorsVerified: true,
        sensitiveSelectors: ["[data-private]"],
        textRangesVerified: true,
      },
    });

    expect(result).toEqual({
      artifactType: "dom-snapshot",
      maskingStrategy: "structural",
      text: "[masked-dom-snapshot-sensitive-selector]",
    });
    expect(result.text).not.toMatch(/Card ending 4242|Pay|data-private/);
  });
});
