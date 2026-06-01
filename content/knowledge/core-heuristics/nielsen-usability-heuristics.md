---
id: kb_usability_nielsen_heuristics
title: Nielsen usability heuristics
category: core-heuristics
appliesToLenses: [usability]
steps: [evaluate]
tags: [heuristics, usability, nielsen]
citation:
  source: "Nielsen Norman Group: 10 Usability Heuristics for User Interface Design"
  url: "https://www.nngroup.com/articles/ten-usability-heuristics/"
  retrievedAt: "2026-06-01T00:00:00.000Z"
freshness:
  volatility: stable
  lastReviewed: "2026-06-01T00:00:00.000Z"
---

## Summary

Usability findings should be grounded in Nielsen's 10 interaction heuristics:
visibility of system status; match between the system and the real world; user control
and freedom; consistency and standards; error prevention; recognition rather than recall;
flexibility and efficiency of use; aesthetic and minimalist design; helping users recognize,
diagnose, and recover from errors; and help and documentation.

## Deep Guidance

Use the heuristics as review lenses for built interfaces:

- Visibility of system status: the UI keeps users informed about what is happening.
- Match between system and real world: labels and flows use user-facing language and
  domain concepts.
- User control and freedom: users can undo, cancel, go back, or escape unwanted states.
- Consistency and standards: similar controls, labels, and layouts behave predictably.
- Error prevention: risky or invalid actions are prevented before users commit them.
- Recognition rather than recall: users can see needed options, context, and prior inputs.
- Flexibility and efficiency: frequent users have efficient paths without hurting first-time
  users.
- Aesthetic and minimalist design: visible content supports the current task without
  distracting noise.
- Error recovery: error states explain the problem and provide a concrete recovery action.
- Help and documentation: assistance is available where users need it, especially for
  complex tasks.

Prefer concrete findings tied to visible DOM evidence and a user's current task, such as
unclear status, missing escape routes, unfamiliar terminology, inconsistent controls,
memory burden, or error states that do not help users recover.
