---
id: kb_forms_labels_validation_recovery
title: Form labels, instructions, and validation recovery
category: forms
appliesToAppTypes: [generic]
appliesToLenses: [usability, accessibility]
steps: [evaluate]
tags: [forms, validation, errors, labels]
citation:
  source: "W3C WAI: Forms Tutorial"
  url: "https://www.w3.org/WAI/tutorials/forms/"
  retrievedAt: "2026-06-01T00:00:00.000Z"
freshness:
  volatility: stable
  lastReviewed: "2026-06-01T00:00:00.000Z"
---

## Summary

Forms should provide clear labels, relevant instructions, and recoverable validation feedback at
the point where users need it.

## Deep Guidance

Evaluate each input for a visible purpose, programmatic label, required or optional status, input
format guidance, and error feedback that identifies both the field and the remedy. Prefer
specific findings when hint text is doing label work, validation appears only after a costly
submission, errors are detached from fields, or recovery requires users to remember hidden rules.
Good fixes keep the user's entered data, move focus predictably, and explain how to correct the
problem in plain language.
