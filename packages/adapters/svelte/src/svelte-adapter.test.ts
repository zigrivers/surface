import { describe, expect, it } from "vitest";

import { createSvelteAdapter } from "./index.js";

describe("svelte framework adapter", () => {
  it("supports Svelte source files", () => {
    const adapter = createSvelteAdapter();

    expect(adapter.id).toBe("svelte");
    expect(adapter.supports("src/routes/+page.svelte")).toBe(true);
    expect(adapter.supports("components/CheckoutPanel.SVELTE")).toBe(true);
    expect(adapter.supports("components/Button.tsx")).toBe(false);
  });

  it("maps a Svelte component file to stable DOM selectors and child component refs", async () => {
    const adapter = createSvelteAdapter();
    const result = await adapter.introspect({
      path: "components/CheckoutPanel.svelte",
      contents: `
        <script lang="ts">
          import HelpPanel from "./HelpPanel.svelte";
        </script>

        <section data-surface-component="CheckoutPanel">
          <button id="pay" data-testid="pay-now">Pay now</button>
          <HelpPanel aria-label="Checkout help" />
          <PaymentSummary />
        </section>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "CheckoutPanel",
            file: "components/CheckoutPanel.svelte",
            selectors: [
              '[aria-label="Checkout help"]',
              '[data-surface-component="CheckoutPanel"]',
              '[data-testid="pay-now"]',
              '[id="pay"]',
              "svelte:HelpPanel",
              "svelte:PaymentSummary",
            ],
          },
        ],
      },
    });
  });

  it("maps marker components inside a Svelte file", async () => {
    const adapter = createSvelteAdapter();
    const result = await adapter.introspect({
      path: "routes/+page.svelte",
      contents: `
        <main>
          <section data-surface-component="EmptyOrdersState">
            <h2 data-testid="empty-title">No orders yet</h2>
          </section>
          <svelte:component this={DynamicPanel} data-testid="dynamic-panel" />
        </main>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "EmptyOrdersState",
            file: "routes/+page.svelte",
            selectors: ['[data-surface-component="EmptyOrdersState"]'],
          },
          {
            component: "Page",
            file: "routes/+page.svelte",
            selectors: [
              '[data-surface-component="EmptyOrdersState"]',
              '[data-testid="dynamic-panel"]',
              '[data-testid="empty-title"]',
              "svelte:DynamicPanel",
            ],
          },
        ],
      },
    });
  });

  it("escapes selector strings and ignores dynamic attribute values", async () => {
    const adapter = createSvelteAdapter();
    const result = await adapter.introspect({
      path: "components/PromoCard.svelte",
      contents: `
        <article data-component="PromoCard" aria-label={"dynamic"} data-testid={'promo-card'} />
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "PromoCard",
            file: "components/PromoCard.svelte",
            selectors: ['[data-component="PromoCard"]'],
          },
        ],
      },
    });
  });

  it("returns an error result for malformed source references and parse errors", async () => {
    const adapter = createSvelteAdapter();
    const malformed = await adapter.introspect({ path: "bad.svelte", contents: null } as never);
    const invalidSyntax = await adapter.introspect({
      path: "bad.svelte",
      contents: "<script>let =</script>",
    });

    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "SourceFileRef requires string path and contents.",
      });
    }

    expect(invalidSyntax.ok).toBe(false);
    if (!invalidSyntax.ok) {
      expect(invalidSyntax.error).toMatchObject({
        kind: "RuntimeError",
        code: "step_failed",
        message: "Failed to introspect Svelte source.",
      });
    }
  });
});
