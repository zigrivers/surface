import { describe, expect, it } from "vitest";

import { createVueAdapter } from "./index.js";

describe("vue framework adapter", () => {
  it("supports Vue source files", () => {
    const adapter = createVueAdapter();

    expect(adapter.id).toBe("vue");
    expect(adapter.supports("src/components/CheckoutPanel.vue")).toBe(true);
    expect(adapter.supports("src/components/CheckoutPanel.VUE")).toBe(true);
    expect(adapter.supports("src/components/CheckoutPanel.svelte")).toBe(false);
  });

  it("maps a Vue SFC to stable DOM selectors and child component refs", async () => {
    const adapter = createVueAdapter();
    const result = await adapter.introspect({
      path: "components/CheckoutPanel.vue",
      contents: `
        <script setup lang="ts">
          import HelpPanel from "./HelpPanel.vue";
        </script>

        <template>
          <section data-surface-component="CheckoutPanel">
            <button id="pay" data-testid="pay-now">Pay now</button>
            <HelpPanel aria-label="Checkout help" />
            <PaymentSummary />
          </section>
        </template>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "CheckoutPanel",
            file: "components/CheckoutPanel.vue",
            selectors: [
              '[aria-label="Checkout help"]',
              '[data-surface-component="CheckoutPanel"]',
              '[data-testid="pay-now"]',
              '[id="pay"]',
              "vue:HelpPanel",
              "vue:PaymentSummary",
            ],
          },
        ],
      },
    });
  });

  it("maps marker components and dynamic component refs", async () => {
    const adapter = createVueAdapter();
    const result = await adapter.introspect({
      path: "routes/+page.vue",
      contents: `
        <template>
          <main>
            <section data-surface-component="EmptyOrdersState">
              <h2 data-testid="empty-title">No orders yet</h2>
            </section>
            <component :is="DynamicPanel" data-testid="dynamic-panel" />
          </main>
        </template>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "EmptyOrdersState",
            file: "routes/+page.vue",
            selectors: ['[data-surface-component="EmptyOrdersState"]'],
          },
          {
            component: "Page",
            file: "routes/+page.vue",
            selectors: [
              '[data-surface-component="EmptyOrdersState"]',
              '[data-testid="dynamic-panel"]',
              '[data-testid="empty-title"]',
              "vue:DynamicPanel",
            ],
          },
        ],
      },
    });
  });

  it("escapes selector strings and ignores dynamic attribute values", async () => {
    const adapter = createVueAdapter();
    const result = await adapter.introspect({
      path: "components/PromoCard.vue",
      contents: `
        <template>
          <article data-component="PromoCard" :aria-label="label" data-testid='promo"card' />
        </template>
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "PromoCard",
            file: "components/PromoCard.vue",
            selectors: ['[data-component="PromoCard"]', '[data-testid="promo\\"card"]'],
          },
        ],
      },
    });
  });

  it("returns an error result for malformed source references and parse errors", async () => {
    const adapter = createVueAdapter();
    const malformed = await adapter.introspect({ path: "bad.vue", contents: null } as never);
    const invalidSyntax = await adapter.introspect({
      path: "bad.vue",
      contents: "<template><section></template>",
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
        message: "Failed to introspect Vue source.",
      });
    }
  });
});
