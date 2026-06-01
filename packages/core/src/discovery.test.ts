import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { isOk, ok } from "./errors.js";
import { runDiscovery } from "./discovery.js";
import type { ProjectStateSnapshot, StateStore } from "./interfaces.js";

describe("Discovery", () => {
  it("classifies e-commerce from routes and reports capped inventory skips", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/products", " ", "/cart", "/checkout", "/account", ""],
      routeCap: 2,
      runId: "run_discovery_shop",
      target: { kind: "url", ref: "https://shop.example.com/products/widget" },
    });

    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        overlayId: "e-commerce",
        personaTask: {
          persona: "shopper",
        },
        routeInventory: {
          cap: 2,
          routes: [{ path: "/products/widget" }, { path: "/products" }],
          skipped: [
            { path: "/cart", reason: "route_cap_exceeded" },
            { path: "/checkout", reason: "route_cap_exceeded" },
            { path: "/account", reason: "route_cap_exceeded" },
          ],
        },
      },
    });
    if (!result.ok) {
      throw new Error("expected discovery to succeed");
    }

    expect(result.value.events.map((event) => event.type)).toEqual([
      "AppTypeClassified",
      "RoutesSkipped",
    ]);
  });

  it("uses explicit non-generic config app type before route signals", async () => {
    const result = await runDiscovery({
      config: {
        ...DEFAULT_SURFACE_CONFIG,
        evaluation: {
          ...DEFAULT_SURFACE_CONFIG.evaluation,
          appType: "saas-dashboard",
        },
      },
      routeCandidates: ["/checkout"],
      runId: "run_discovery_config",
      target: { kind: "url", ref: "https://example.com/checkout" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "saas-dashboard",
        classification: {
          matchedSignals: ["config:saas-dashboard"],
          source: "config",
        },
        overlayId: "saas-dashboard",
      },
    });
  });

  it("does not treat default generic config as an explicit override", async () => {
    const result = await runDiscovery({
      config: DEFAULT_SURFACE_CONFIG,
      routeCandidates: ["/checkout"],
      runId: "run_discovery_default_config",
      target: { kind: "url", ref: "https://example.com/checkout" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        classification: {
          matchedSignals: ["checkout"],
          source: "target-ref",
        },
        overlayId: "e-commerce",
      },
    });
  });

  it("allows explicit generic override intent to override route signals", async () => {
    const result = await runDiscovery({
      appTypeOverride: "generic",
      config: DEFAULT_SURFACE_CONFIG,
      routeCandidates: ["/checkout"],
      runId: "run_discovery_generic_override",
      target: { kind: "url", ref: "https://example.com/checkout" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        classification: {
          matchedSignals: ["config:generic"],
          source: "config",
        },
        overlayId: "generic",
      },
    });
  });

  it("falls back to persona and task defaults for whitespace-only hints", async () => {
    const input = {
      metadata: { wrapper: "acceptance" },
      personaHint: "  ",
      routeCandidates: ["/pricing"],
      runId: "run_discovery_blank_hints",
      target: { kind: "url", ref: "https://example.com/" },
      taskHint: "\t",
    } as const;
    const result = await runDiscovery(input);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      throw new Error("expected discovery to succeed");
    }

    expect(result.value).toHaveProperty("metadata", { wrapper: "acceptance" });
    expect(result).toMatchObject({
      value: {
        appType: "marketing",
        personaTask: {
          persona: "prospective customer",
          task: "understand the offer and choose the next step",
        },
      },
    });
  });

  it("matches hyphenated app-type signals as contiguous route tokens", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/our-case-study"],
      runId: "run_discovery_hyphenated_signal",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "marketing",
        classification: {
          matchedSignals: ["case-study"],
          source: "route-inventory",
        },
      },
    });
  });

  it("does not match multi-token signals across route boundaries", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/case", "/study"],
      runId: "run_discovery_route_boundary",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        overlayId: "generic",
      },
    });
  });

  it("reports target-only classification as target-ref", async () => {
    const result = await runDiscovery({
      runId: "run_discovery_target_source",
      target: { kind: "url", ref: "https://shop.example.com/checkout" },
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      throw new Error("expected discovery to succeed");
    }

    expect(result.value.classification.matchedSignals).toContain("checkout");
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        classification: {
          source: "target-ref",
        },
      },
    });
  });

  it("normalizes unregistered config overlays to generic so app type and overlay agree", async () => {
    const result = await runDiscovery({
      config: {
        ...DEFAULT_SURFACE_CONFIG,
        evaluation: {
          ...DEFAULT_SURFACE_CONFIG.evaluation,
          appType: "admin",
        },
      },
      routeCandidates: ["/settings"],
      runId: "run_discovery_unregistered_override",
      target: { kind: "url", ref: "https://example.com/settings" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        classification: {
          matchedSignals: ["config:admin"],
          source: "config",
        },
        overlayId: "generic",
        personaTask: {
          persona: "first-time web user",
        },
      },
    });
  });

  it("classifies from capped-out route signals while still reporting skipped routes", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/checkout"],
      routeCap: 1,
      runId: "run_discovery_skipped_signal",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        routeInventory: {
          routes: [{ path: "/" }],
          skipped: [{ path: "/checkout", reason: "route_cap_exceeded" }],
        },
      },
    });
  });

  it("accepts full targets and normalizes bare localhost route refs", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/cartons", "/history", "localhost:3000/products"],
      runId: "run_discovery_localhost",
      target: {
        kind: "localhost",
        ref: "localhost:3000/dashboard",
        viewport: { height: 900, label: "desktop", width: 1440 },
      },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        classification: {
          matchedSignals: ["products"],
          source: "route-inventory",
        },
        routeInventory: {
          routes: [
            { path: "/dashboard", source: "target" },
            { path: "/cartons", source: "candidate" },
            { path: "/history", source: "candidate" },
            { path: "/products", source: "candidate" },
          ],
        },
      },
    });
  });

  it("normalizes hostname candidates and never throws on malformed localhost refs", async () => {
    const result = await runDiscovery({
      routeCandidates: [
        "shop.example.com/products",
        "[::1]:3000/cart",
        "myserver/products",
        "localhost:abc/cart",
        "localhost",
        "about.html",
        "v1.0/products",
        "index.php",
      ],
      runId: "run_discovery_hostname_candidate",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        routeInventory: {
          routes: [
            { path: "/", source: "target" },
            { path: "/products", source: "candidate" },
            { path: "/cart", source: "candidate" },
            { path: "/myserver/products", source: "candidate" },
            { path: "/localhost:abc/cart", source: "candidate" },
            { path: "/about.html", source: "candidate" },
            { path: "/v1.0/products", source: "candidate" },
            { path: "/index.php", source: "candidate" },
          ],
        },
      },
    });
  });

  it("preserves ordinary slash-separated relative routes", async () => {
    const result = await runDiscovery({
      routeCandidates: ["products/list", "checkout/confirm", "dev-server:4173/cart"],
      runId: "run_discovery_relative_paths",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        routeInventory: {
          routes: [
            { path: "/", source: "target" },
            { path: "/products/list", source: "candidate" },
            { path: "/checkout/confirm", source: "candidate" },
            { path: "/cart", source: "candidate" },
          ],
        },
      },
    });
  });

  it("uses hash-route paths from absolute urls for inventory and classification", async () => {
    const result = await runDiscovery({
      routeCandidates: ["https://example.com/#/checkout"],
      runId: "run_discovery_hash_route",
      target: { kind: "url", ref: "https://example.com/#/pricing" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        classification: {
          matchedSignals: ["checkout"],
          source: "route-inventory",
        },
        routeInventory: {
          routes: [
            { path: "/pricing", source: "target" },
            { path: "/checkout", source: "candidate" },
          ],
        },
      },
    });
  });

  it("uses hash-route paths from relative refs for inventory and classification", async () => {
    const result = await runDiscovery({
      routeCandidates: ["#/checkout", "/#/cart?step=shipping"],
      runId: "run_discovery_relative_hash_route",
      target: { kind: "route", ref: "/#/pricing" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        routeInventory: {
          routes: [
            { path: "/pricing", source: "target" },
            { path: "/checkout", source: "candidate" },
            { path: "/cart", source: "candidate" },
          ],
        },
      },
    });
  });

  it("decodes URL-encoded path text before matching discovery signals", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/case%20study"],
      runId: "run_discovery_encoded_signal",
      target: { kind: "url", ref: "https://example.com/" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "marketing",
        classification: {
          matchedSignals: ["case-study"],
          source: "route-inventory",
        },
        routeInventory: {
          routes: [{ path: "/" }, { path: "/case study" }],
        },
      },
    });
  });

  it("does not add non-route target refs to route inventory", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/product-detail"],
      runId: "run_discovery_non_route_target",
      target: { kind: "component", ref: "ProductCard" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "e-commerce",
        routeInventory: {
          routes: [{ path: "/product-detail", source: "candidate" }],
        },
      },
    });
  });

  it("does not classify app type from non-route target refs", async () => {
    const result = await runDiscovery({
      runId: "run_discovery_non_route_target_ref",
      target: { kind: "screenshot", ref: "checkout.png" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        classification: {
          matchedSignals: [],
          source: "generic-fallback",
        },
        routeInventory: {
          routes: [],
        },
      },
    });
  });

  it("falls back to read and write when persisting to a store without updateState", async () => {
    let state: ProjectStateSnapshot = { version: "1.0" };
    const stateStore: StateStore = {
      readState: () => ok(state),
      writeArtifact: () => ok({ path: ".surface/reports/findings.json", sha256: "abc123" }),
      writeState: (nextState) => {
        state = nextState;
        return ok(nextState);
      },
    };
    const result = await runDiscovery(
      {
        runId: "run_discovery_fallback_store",
        target: { kind: "url", ref: "https://example.com/" },
      },
      { stateStore },
    );

    expect(isOk(result)).toBe(true);
    expect(state).toMatchObject({
      discovery: {
        runId: "run_discovery_fallback_store",
      },
    });
  });

  it("keeps should-tier app-type signals generic until their overlays are registered", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/admin", "/article"],
      runId: "run_discovery_unregistered_signals",
      target: { kind: "url", ref: "https://example.com/admin" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        overlayId: "generic",
      },
    });
  });

  it("falls back to generic and records the generic overlay when no signals match", async () => {
    const result = await runDiscovery({
      routeCandidates: ["/about"],
      runId: "run_discovery_generic",
      target: { kind: "url", ref: "https://example.com/about" },
    });

    expect(isOk(result)).toBe(true);
    expect(result).toMatchObject({
      value: {
        appType: "generic",
        classification: {
          matchedSignals: [],
          source: "generic-fallback",
        },
        overlayId: "generic",
      },
    });
  });
});
