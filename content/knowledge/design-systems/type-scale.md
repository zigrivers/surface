---
id: kb_visual_hierarchy_type_scale
title: Type scale for visual hierarchy
category: design-systems
appliesToLenses: [visual-hierarchy]
steps: [evaluate]
tags: [design-systems, tokens, typography, visual-hierarchy]
citation:
  source: "Android Developers: Material Design 3 in Compose"
  url: "https://developer.android.com/develop/ui/compose/designsystems/material3"
  retrievedAt: "2026-06-01T00:00:00.000Z"
freshness:
  volatility: stable
  lastReviewed: "2026-06-01T00:00:00.000Z"
---

## Summary

Typography should use a deliberate type scale so headings, body text, labels, and supporting
copy occupy distinct reusable roles.

## Deep Guidance

Compare computed font-size values against the page body size and against the number of font
size steps used in the view. Treat headings that collapse to body scale, and screens with many
one-off font sizes, as visual hierarchy and design-system risks because they reduce scanability
and make token reuse harder.
