<main data-component="SeededDefectSvelteFixture">
  <section
    data-surface-component="LowContrastHero"
    style="background: #eef2ff; border-radius: 12px; padding: 24px"
  >
    <h1 data-testid="seeded-svelte-title">Seeded checkout defects</h1>
    <p data-testid="seeded-svelte-low-contrast" style="color: #b7bdd1">
      This muted paragraph intentionally fails contrast guidance.
    </p>
    <a data-testid="seeded-svelte-skip-link" href="#orders" style="outline: none">
      Skip to orders
    </a>
  </section>

  <section data-surface-component="TargetSizeControls" aria-label="Checkout actions">
    <button data-testid="tiny-remove" style="border: 0; height: 20px; min-width: 20px; padding: 0">
      x
    </button>
    <button data-testid="primary-checkout">Checkout</button>
  </section>

  <section
    id="orders"
    data-surface-component="EmptyOrdersState"
    style="border: 1px dashed #cbd5e1; color: #94a3b8; min-height: 120px; padding: 16px"
  >
    <h2 data-testid="seeded-svelte-empty-title">Orders</h2>
  </section>
</main>
