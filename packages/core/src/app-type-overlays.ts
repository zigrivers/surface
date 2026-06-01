import { z } from "zod";
import { stringify as stringifyYaml } from "yaml";

import { AppTypeSchema, type AppType } from "./config.js";
import { nonEmptyStringSchema } from "./schemas.js";

export const OverlayReleaseTierSchema = z.enum(["gate", "committed", "should"]);
export type OverlayReleaseTier = z.infer<typeof OverlayReleaseTierSchema>;

export const OverlayAcceptanceCriteriaSchema = z
  .object({
    summary: nonEmptyStringSchema,
    checks: z.array(nonEmptyStringSchema).min(1),
    riskSignals: z.array(nonEmptyStringSchema).min(1),
  })
  .strict();
export type OverlayAcceptanceCriteria = z.infer<typeof OverlayAcceptanceCriteriaSchema>;

export const AppTypeOverlaySchema = z
  .object({
    appType: AppTypeSchema,
    defaultPersona: nonEmptyStringSchema,
    defaultTask: nonEmptyStringSchema,
    discoverySignals: z.array(nonEmptyStringSchema),
    label: nonEmptyStringSchema,
    releaseTier: OverlayReleaseTierSchema,
    routeHints: z.array(nonEmptyStringSchema).min(1),
    lensCriteria: z
      .record(nonEmptyStringSchema, OverlayAcceptanceCriteriaSchema)
      .refine((criteria) => Object.keys(criteria).length > 0, {
        message: "lensCriteria must define at least one lens",
      }),
  })
  .strict()
  .superRefine((overlay, context) => {
    if (overlay.releaseTier === "gate" && overlay.appType !== "generic") {
      context.addIssue({
        code: "custom",
        message: 'only the "generic" overlay is a gate overlay in v1',
        path: ["releaseTier"],
      });
    }
  });
export type AppTypeOverlay = z.infer<typeof AppTypeOverlaySchema>;

export const REGISTERED_APP_TYPE_OVERLAYS = [
  "generic",
  "saas-dashboard",
  "e-commerce",
  "marketing",
] as const satisfies readonly AppType[];
export type RegisteredAppTypeOverlay = (typeof REGISTERED_APP_TYPE_OVERLAYS)[number];

export const COMMITTED_WEB_APP_TYPE_OVERLAYS = [
  "saas-dashboard",
  "e-commerce",
  "marketing",
] as const satisfies readonly RegisteredAppTypeOverlay[];

export const APP_TYPE_OVERLAY_YAML_HEADER =
  "# Generated from packages/core/src/app-type-overlays.ts. Do not edit by hand.";

function deepFreeze<T extends object>(value: T): Readonly<T> {
  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === "object" && nestedValue !== null && !Object.isFrozen(nestedValue)) {
      deepFreeze(nestedValue);
    }
  }

  return value;
}

const rawAppTypeOverlays = {
  generic: {
    appType: "generic",
    defaultPersona: "first-time web user",
    defaultTask: "complete the primary task without prior product knowledge",
    discoverySignals: [],
    label: "Generic web",
    releaseTier: "gate",
    routeHints: ["home", "primary navigation", "primary task", "supporting content"],
    lensCriteria: {
      accessibility: {
        summary: "Baseline WCAG-oriented usability for all web surfaces.",
        checks: [
          "Interactive controls expose names, roles, states, focus order, and keyboard access.",
          "Text, iconography, and status changes remain perceivable across configured viewports.",
        ],
        riskSignals: [
          "Unlabeled controls",
          "Keyboard traps",
          "Low contrast text or state indicators",
        ],
      },
      usability: {
        summary: "Core tasks are discoverable, predictable, and recoverable.",
        checks: [
          "Primary actions are easy to locate without relying on prior product knowledge.",
          "Errors and empty states explain what happened and what the user can do next.",
        ],
        riskSignals: ["Ambiguous calls to action", "Dead ends", "No feedback after user input"],
      },
      "visual-hierarchy": {
        summary: "Layout communicates priority without hiding essential next actions.",
        checks: [
          "Headings, spacing, and grouping make the main path scannable.",
          "Responsive layouts preserve information order and action visibility.",
        ],
        riskSignals: [
          "Competing primary actions",
          "Critical content below unrelated decoration",
          "Overlapping content",
        ],
      },
      content: {
        summary: "Task-critical copy is clear, concise, inclusive, and readable.",
        checks: [
          "Headings, labels, and instructions explain what users can do next.",
          "Dense or complex copy stays within the configured reading target.",
        ],
        riskSignals: [
          "Long jargon-heavy sentences",
          "Ambiguous labels",
          "Insensitive or exclusionary language",
        ],
      },
    },
  },
  "saas-dashboard": {
    appType: "saas-dashboard",
    defaultPersona: "recurring product operator",
    defaultTask: "monitor state and complete an operational workflow",
    discoverySignals: ["dashboard", "analytics", "workspace", "settings", "billing", "team"],
    label: "SaaS dashboard",
    releaseTier: "committed",
    routeHints: ["dashboard", "settings", "detail view", "empty state", "error state"],
    lensCriteria: {
      "task-completion": {
        summary: "Repeated operational workflows are efficient and stateful.",
        checks: [
          "High-frequency actions are reachable without navigating away from working context.",
          "Saved views, filters, and statuses make return visits predictable.",
        ],
        riskSignals: [
          "Hidden bulk actions",
          "Unclear saved state",
          "Filters with no visible effect",
        ],
      },
      "data-density": {
        summary: "Dense information remains comparable and legible.",
        checks: [
          "Tables, charts, and summaries align labels, values, units, and time ranges.",
          "Loading, empty, and stale data states are distinguishable.",
        ],
        riskSignals: ["Unlabeled metrics", "Ambiguous date ranges", "Inconsistent number formats"],
      },
      "trust-and-control": {
        summary: "Users can understand impact before committing operational changes.",
        checks: [
          "Destructive or broad-scope actions show scope, consequences, and recovery options.",
          "Permission, sync, and integration errors identify the affected account or resource.",
        ],
        riskSignals: [
          "Silent permission failure",
          "No undo path",
          "Destructive action lacks scope preview",
        ],
      },
    },
  },
  "e-commerce": {
    appType: "e-commerce",
    defaultPersona: "shopper",
    defaultTask: "evaluate a product and complete a purchase path",
    discoverySignals: [
      "cart",
      "checkout",
      "product",
      "products",
      "shop",
      "store",
      "order",
      "orders",
      "shipping",
    ],
    label: "E-commerce storefront",
    releaseTier: "committed",
    routeHints: ["product listing", "product detail", "cart", "checkout", "order confirmation"],
    lensCriteria: {
      conversion: {
        summary: "Purchase paths preserve confidence and momentum.",
        checks: [
          "Product value, price, availability, shipping, and return information are visible before checkout.",
          "Checkout steps expose progress, errors, total cost, and recovery paths.",
        ],
        riskSignals: [
          "Unexpected fees",
          "Unavailable product discovered late",
          "Checkout errors without field-level recovery",
        ],
      },
      "trust-and-credibility": {
        summary: "The storefront makes risk, fulfillment, and support expectations explicit.",
        checks: [
          "Policies, trust signals, and support options are accessible near purchase decisions.",
          "Payment and account flows clearly identify secure handoffs and required data.",
        ],
        riskSignals: [
          "Missing return policy",
          "Ambiguous payment state",
          "Unsupported discount or promo feedback",
        ],
      },
      responsiveness: {
        summary: "Shopping and checkout remain usable on mobile-width viewports.",
        checks: [
          "Filters, variants, sticky actions, and cart summaries fit configured mobile viewports.",
          "Tap targets and form controls remain reachable without occluding price or error details.",
        ],
        riskSignals: [
          "Variant selector clipped on mobile",
          "Checkout footer covers form errors",
          "Filter state hidden after selection",
        ],
      },
    },
  },
  marketing: {
    appType: "marketing",
    defaultPersona: "prospective customer",
    defaultTask: "understand the offer and choose the next step",
    discoverySignals: ["landing", "pricing", "signup", "demo", "contact", "features", "case-study"],
    label: "Marketing landing",
    releaseTier: "committed",
    routeHints: ["landing page", "pricing", "signup", "contact", "case study"],
    lensCriteria: {
      "message-clarity": {
        summary: "The page communicates the offer, audience, and next step quickly.",
        checks: [
          "The first viewport identifies the product or offer and a concrete user benefit.",
          "Supporting proof and feature detail reinforce the primary call to action.",
        ],
        riskSignals: [
          "Vague hero claim",
          "CTA appears before value is clear",
          "Proof points lack context",
        ],
      },
      conversion: {
        summary: "Conversion paths are focused and friction is intentional.",
        checks: [
          "Primary and secondary calls to action are visually distinct and route to expected destinations.",
          "Forms ask only for information needed at that stage and expose validation feedback.",
        ],
        riskSignals: [
          "Competing CTA hierarchy",
          "Form asks for unexplained data",
          "Pricing or signup path is hard to find",
        ],
      },
      "visual-hierarchy": {
        summary: "Narrative flow supports scanning from promise to proof to action.",
        checks: [
          "Sections are ordered so claims are supported before deep detail or commitment.",
          "Media, animation, and decoration do not obscure product, offer, or action clarity.",
        ],
        riskSignals: [
          "Decorative media hides the product",
          "Proof appears disconnected from claim",
          "Important CTA pushed below unrelated content",
        ],
      },
    },
  },
} satisfies Record<RegisteredAppTypeOverlay, z.input<typeof AppTypeOverlaySchema>>;

export const APP_TYPE_OVERLAY_REGISTRY = deepFreeze(
  Object.fromEntries(
    REGISTERED_APP_TYPE_OVERLAYS.map((appType) => [
      appType,
      AppTypeOverlaySchema.parse(rawAppTypeOverlays[appType]),
    ]),
  ) as Record<RegisteredAppTypeOverlay, AppTypeOverlay>,
);

export function hasRegisteredAppTypeOverlay(appType: AppType): appType is RegisteredAppTypeOverlay {
  return Object.hasOwn(APP_TYPE_OVERLAY_REGISTRY, appType);
}

export function getAppTypeOverlay(appType: AppType = "generic"): Readonly<AppTypeOverlay> {
  return hasRegisteredAppTypeOverlay(appType)
    ? APP_TYPE_OVERLAY_REGISTRY[appType]
    : APP_TYPE_OVERLAY_REGISTRY.generic;
}

export function listAppTypeOverlays(): readonly Readonly<AppTypeOverlay>[] {
  return REGISTERED_APP_TYPE_OVERLAYS.map((appType) => APP_TYPE_OVERLAY_REGISTRY[appType]);
}

export function serializeAppTypeOverlayToYaml(overlay: AppTypeOverlay): string {
  const parsed = AppTypeOverlaySchema.parse(overlay);

  return `${APP_TYPE_OVERLAY_YAML_HEADER}\n${stringifyYaml(parsed, {
    lineWidth: 0,
    sortMapEntries: false,
  })}`;
}
