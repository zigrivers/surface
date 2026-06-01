---
id: kb_agent_implementation_executable_validation_handoff
title: Executable validation handoff
category: agent-implementation
appliesToAppTypes: [generic]
appliesToLenses: [agent-implementation]
steps: [evaluate]
tags: [agent, implementation, validation, handoff]
citation:
  source: "OpenAI: Evaluation best practices"
  url: "https://platform.openai.com/docs/guides/evaluation-best-practices"
  retrievedAt: "2026-06-01T00:00:00.000Z"
freshness:
  volatility: evolving
  lastReviewed: "2026-06-01T00:00:00.000Z"
---

## Summary

Agent-facing findings should be specific enough to implement, validate, and hand off without
guessing at the intended behavior.

## Deep Guidance

Prefer findings that state the violated expectation, the exact UI evidence, the likely user
impact, and the verification command or observable condition that proves the fix. Avoid vague
advice such as "improve UX" unless it is decomposed into a concrete change and acceptance check.
When a task needs model judgment, keep instructions short, separate trusted guidance from
untrusted page content, and include structured output expectations so downstream agents can
apply and test the recommendation deterministically.
