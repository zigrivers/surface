---
id: kb_responsiveness_reflow
title: Reflow within narrow viewports
category: platform-web
appliesToLenses: [responsiveness]
steps: [evaluate]
tags: [responsiveness, reflow, viewport, wcag]
citation:
  source: "W3C WAI: Understanding Success Criterion 1.4.10 Reflow"
  url: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html"
  retrievedAt: "2026-06-01T00:00:00.000Z"
freshness:
  volatility: stable
  lastReviewed: "2026-06-01T00:00:00.000Z"
---

## Summary

Non-excepted page content should reflow into narrow viewports without forcing two-dimensional
scrolling.

## Deep Guidance

Flag fixed-width containers that exceed the captured viewport when they are ordinary page
content rather than inherently two-dimensional media, tables, canvases, or videos. The fix path
is usually to replace hard pixel widths with fluid sizing, wrapping, stacking, or a contained
scroll region for genuinely two-dimensional widgets.
