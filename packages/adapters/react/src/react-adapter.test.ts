import { describe, expect, it } from "vitest";

import { createReactAdapter } from "./index.js";

describe("react framework adapter", () => {
  it("supports React and Next source files", () => {
    const adapter = createReactAdapter();

    expect(adapter.id).toBe("react");
    expect(adapter.supports("components/Button.tsx")).toBe(true);
    expect(adapter.supports("pages/index.jsx")).toBe(true);
    expect(adapter.supports("app/page.js")).toBe(true);
    expect(adapter.supports("fixtures/plain.html")).toBe(false);
  });

  it("maps function and arrow components to file and JSX selectors", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "components/CheckoutSummary.tsx",
      contents: `
        import React from "react";

        export function CheckoutSummary() {
          return (
            <section data-component="CheckoutSummary">
              <button data-testid="pay-now">Pay now</button>
            </section>
          );
        }

        export const HelpPanel = () => (
          <aside data-surface-component="HelpPanel" role="complementary" />
        );
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "CheckoutSummary",
            file: "components/CheckoutSummary.tsx",
            selectors: ['[data-component="CheckoutSummary"]', '[data-testid="pay-now"]'],
          },
          {
            component: "HelpPanel",
            file: "components/CheckoutSummary.tsx",
            selectors: ['[data-surface-component="HelpPanel"]', '[role="complementary"]'],
          },
        ],
      },
    });
  });

  it("parses JavaScript and JSX sources without the TypeScript plugin", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "components/FlowButton.jsx",
      contents: `
        type Props = { label: string };

        export function FlowButton(props: Props) {
          return <button data-testid="flow-button">{props.label}</button>;
        }
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "FlowButton",
            file: "components/FlowButton.jsx",
            selectors: ['[data-testid="flow-button"]'],
          },
        ],
      },
    });
  });

  it("maps Next default exports and custom JSX children", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "app/dashboard/page.tsx",
      contents: `
        function Header() {
          return <header id="masthead" />;
        }

        export default function Page() {
          return (
            <main>
              <Header data-testid="header-slot" />
            </main>
          );
        }
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Header",
            file: "app/dashboard/page.tsx",
            selectors: ['[id="masthead"]'],
          },
          {
            component: "Page",
            file: "app/dashboard/page.tsx",
            selectors: ['[data-testid="header-slot"]', "main", "react:Header"],
          },
        ],
      },
    });
  });

  it("maps memo, forwardRef, and class component declarations", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "components/cards.tsx",
      contents: `
        import React, { forwardRef, memo } from "react";

        export const Card = memo(() => <article aria-label="Summary card" />);

        export const TextField = React.forwardRef<HTMLInputElement>((props, ref) => {
          return <input id="email" ref={ref} {...props} />;
        });

        export class LegacyPanel extends React.Component {
          render() {
            return <section role="region" />;
          }
        }
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Card",
            file: "components/cards.tsx",
            selectors: ['[aria-label="Summary card"]'],
          },
          {
            component: "LegacyPanel",
            file: "components/cards.tsx",
            selectors: ['[role="region"]'],
          },
          {
            component: "TextField",
            file: "components/cards.tsx",
            selectors: ['[id="email"]'],
          },
        ],
      },
    });
  });

  it("maps default class exports and static template literal attributes", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "components/promo-card.tsx",
      contents: `
        export default class PromoCard extends React.Component {
          render() {
            return <section data-component={\`PromoCard\`} data-testid={\`promo-card\`} />;
          }
        }
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "PromoCard",
            file: "components/promo-card.tsx",
            selectors: ['[data-component="PromoCard"]', '[data-testid="promo-card"]'],
          },
        ],
      },
    });
  });

  it("maps anonymous and named default function expressions", async () => {
    const adapter = createReactAdapter();
    const anonymous = await adapter.introspect({
      path: "app/settings/page.tsx",
      contents: `
        export default () => <main id="settings" />;
      `,
    });
    const namedWrapper = await adapter.introspect({
      path: "components/default-wrapper.tsx",
      contents: `
        import { memo } from "react";

        export default memo(function NamedDefault() {
          return <section data-testid="named-default" />;
        });
      `,
    });

    expect(anonymous).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "Page",
            file: "app/settings/page.tsx",
            selectors: ['[id="settings"]'],
          },
        ],
      },
    });
    expect(namedWrapper).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "NamedDefault",
            file: "components/default-wrapper.tsx",
            selectors: ['[data-testid="named-default"]'],
          },
        ],
      },
    });
  });

  it("ignores non-React classes and invalid marker component names", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "components/non-react.tsx",
      contents: `
        class Renderer {
          render() {
            return <section data-component="Not A Component!" />;
          }
        }

        export function ValidPanel() {
          return <aside data-component="Marketing Card!" data-testid="valid-panel" />;
        }
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [
          {
            component: "ValidPanel",
            file: "components/non-react.tsx",
            selectors: ['[data-component="Marketing Card!"]', '[data-testid="valid-panel"]'],
          },
        ],
      },
    });
  });

  it("returns an empty map for valid non-React TypeScript source", async () => {
    const adapter = createReactAdapter();
    const result = await adapter.introspect({
      path: "lib/math.ts",
      contents: `
        export function identity<T>(value: T): T {
          return value;
        }

        const cast = identity<number>(1);
      `,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        entries: [],
      },
    });
  });

  it("returns an error result for malformed source references and parse errors", async () => {
    const adapter = createReactAdapter();
    const malformed = await adapter.introspect({ path: "bad.tsx", contents: null } as never);
    const invalidSyntax = await adapter.introspect({
      path: "bad.tsx",
      contents: "export function Broken( { return <main />;",
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
        message: "Failed to introspect React source.",
      });
    }
  });
});
