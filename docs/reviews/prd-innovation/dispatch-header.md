You are doing a FEATURE-LEVEL INNOVATION pass on the PRD for `surface` — an open-source CLI + MCP server that audits the *built, running* UI of web apps, separates measured (tool-confirmed) from judged (AI) findings, and emits an agent-executable, re-verifiable backlog of fixes. Primary adopter: AI agents/build-pipelines; beneficiary: non-designer builders.

Your job: identify whether the RIGHT FEATURES are in the PRD at all. Focus on:
- **Missing expected features** — things users would be surprised are absent; their absence feels like a bug (a "day-1 complaint").
- **Competitive / table-stakes** — features the category (linters, scanners, code-quality/CI tools, design-QA tools) has made standard.
- **AI-native capabilities** — things that wouldn't exist without AI.
- **Defensive product gaps** — what makes adoption fail without it.
- **Competitive differentiators** — capabilities that would set surface apart.

OUT OF SCOPE for this pass (do NOT propose these):
- UX polish on existing features (inline validation, smart defaults, progressive disclosure) — that's a later step.
- Implementation/architecture/technology choices.
- Non-functional improvements to existing features.

CRITICAL CONSTRAINT — respect scope discipline: the PRD is DELIBERATELY BROAD already (the owner chose breadth, then a review split Must-Have into a tight "v1.0 Release Gate" vs "v1.0 Committed-non-gating" to contain risk). Do NOT propose features that expand the v1.0 Release Gate. For each suggestion, recommend a disposition that PROTECTS the gate: prefer "v1.x committed" or "deferred (v2)" over "gate." Only recommend "gate" if its absence genuinely breaks the core closed-loop value on day one. Quality over quantity — 3–6 high-value suggestions beat a long list. Don't invent filler.

## Output Format
Respond with ONLY a JSON array (no prose):
[
  {"category":"missing-expected|table-stakes|ai-native|defensive-gap|differentiator","title":"<short>","problem":"<problem it solves + for which user type>","behaviorChange":"<expected change>","cost":"trivial|moderate|significant","impact":"high|medium|low","recommendedDisposition":"gate|v1.x-committed|deferred|reject-with-reason"}
]

## DOCUMENT UNDER REVIEW (docs/plan.md) follows:

---

