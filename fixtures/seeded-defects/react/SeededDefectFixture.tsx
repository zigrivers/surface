import React from "react";

export function LowContrastHero() {
  return (
    <section
      data-surface-component="LowContrastHero"
      style={{ background: "#eef2ff", borderRadius: 12, padding: 24 }}
    >
      <h1 data-testid="seeded-react-title">Seeded checkout defects</h1>
      <p data-testid="seeded-react-low-contrast" style={{ color: "#b7bdd1" }}>
        This muted paragraph intentionally fails contrast guidance.
      </p>
      <a data-testid="seeded-react-skip-link" href="#orders" style={{ outline: "none" }}>
        Skip to orders
      </a>
    </section>
  );
}

export function TargetSizeControls() {
  return (
    <section data-surface-component="TargetSizeControls" aria-label="Checkout actions">
      <button data-testid="tiny-remove" style={{ border: 0, height: 20, minWidth: 20, padding: 0 }}>
        x
      </button>
      <button data-testid="primary-checkout">Checkout</button>
    </section>
  );
}

export function EmptyOrdersState() {
  return (
    <section
      id="orders"
      data-surface-component="EmptyOrdersState"
      style={{ border: "1px dashed #cbd5e1", color: "#94a3b8", minHeight: 120, padding: 16 }}
    >
      <h2 data-testid="seeded-react-empty-title">Orders</h2>
    </section>
  );
}

export default function SeededDefectFixture() {
  return (
    <main data-component="SeededDefectFixture">
      <LowContrastHero />
      <TargetSizeControls />
      <EmptyOrdersState />
    </main>
  );
}
