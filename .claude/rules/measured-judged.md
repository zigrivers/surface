---
description: The measured/judged trust discipline — the one invariant surface cannot violate
globs: ["packages/core/**/*.ts", "packages/grounding/**/*.ts", "packages/reporters/**/*.ts"]
---

- Every function that emits a `Finding` **must set `method` explicitly** (`"measured"` | `"judged"`).
- A `method:"measured"` finding **must** derive from a real tool result and carry a `tool-result`
  `Evidence` entry — **never synthesize a measurement** (vision principle #2, FND-I1).
- A **judged finding is never presented as measured**; the rendered measured/judged label is
  derived **only** from `Finding.method` (FND-I2, RPT-I9). Zero tolerance (NFR-TRUST-1).
- `suggestedPatch` exists **only** on measured findings (FND-I3).
- `gatedForHuman` findings are **never auto-executed**; on re-audit an agent cannot mark a gated
  finding `resolved` without a `Verdict`/human-confirmed validation (FR-LOOP-3).
- No vanity score — prioritization is internal ordering only (FR-SCORE-4); the gate evaluates
  `SeverityBand`, never a headline number.
- Source of truth: `docs/domain-models/findings.md`, ADR-005.
