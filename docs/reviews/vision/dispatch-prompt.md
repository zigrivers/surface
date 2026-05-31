You are reviewing a PRODUCT VISION document for a software project called `surface`. A product vision is a strategic North Star — NOT a PRD, NOT a feature list, NOT a business plan. It defines purpose, audience, positioning, and guiding principles.

Review the document below using these 5 passes, each targeting a specific failure mode of vision documents:

1. **Vision Clarity** — Is the vision statement specific to THIS product (apply the "swap test": could a competitor's name replace it and still be true?), inspiring, memorable, free of buzzwords, and able to resolve a yes/no product decision (the "decision test")? Is the elevator pitch (Geoffrey Moore template) filled with specific, non-generic language?

2. **Audience Precision** — Is the target audience defined by behaviors/motivations/constraints, not demographics? Clear inclusion/exclusion criteria? Any "everyone" trap? Does it explain WHY these people need THIS product? (Note: this product deliberately serves two co-equal audiences — a non-designer builder and an AI agent. Judge whether that dual framing is a strength or an "Everything User" contradiction that will confuse downstream personas.)

3. **Competitive Rigor** — Are competitors named specifically? Is at least one genuine STRENGTH acknowledged per competitor (not weakness-only)? Is differentiation structural (different approach/audience/tradeoff) vs. aspirational ("better UX")? Is the "do nothing" option treated as a competitor? Any "better at everything" dishonesty?

4. **Strategic Coherence** — Are guiding principles in X-over-Y form with REAL tradeoffs (would a reasonable team pick the opposite)? Does the anti-vision name specific, tempting traps (not strawmen) with mechanisms? Are success criteria measurable and time-bound, including a "failure despite shipping" scenario? Does the business model cohere with the audience and value prop? Are risks honest about severity with real mitigation? Do all sections tell ONE consistent story?

5. **Downstream Readiness** — Could a PRD be written from this WITHOUT asking strategic clarification questions? Does Problem Space map to a PRD problem statement? Are personas specific enough for user stories? Are principles concrete enough to resolve "should we build X?" Do any Open Questions actually block product definition (they should not)?

## Severity definitions
- **P0**: Breaks downstream work — vision is fundamentally unclear or contradictory; PRD cannot proceed correctly.
- **P1**: Significant gap — PRD can proceed but will make wrong assumptions.
- **P2**: Improvement — correct but could be clearer/more precise.
- **P3**: Polish — style/nitpick.

Be rigorous and honest. Flag genuine issues; do not invent problems to seem thorough. If a section is strong, say so by simply not flagging it. It is valid to return few or zero findings if the document is genuinely strong.

## Output Format
Respond with ONLY a JSON array of findings (no prose before or after):
[
  {
    "severity": "P0|P1|P2|P3",
    "pass": "Vision Clarity|Audience Precision|Competitive Rigor|Strategic Coherence|Downstream Readiness",
    "location": "section name or number",
    "description": "what is wrong, with concrete detail",
    "suggestion": "specific recommended fix"
  }
]

## Document Under Review: docs/vision.md

---

# surface — Product Vision

## 1. Vision Statement
**Anyone who can build an interface can ship one people are able to actually use — no design degree required.**
The positive change is *access*: whether an interface is good stops depending on whether a designer was in the room. Test it against a decision — "does this make quality reachable for someone who can't see design problems themselves?" If a proposed feature only helps people who already have design skill, it fails the vision.

## 2. Elevator Pitch
For founders, solo developers, and the AI agents building alongside them — who can ship a working interface but can't tell whether it's actually *good* — surface is a command-line UI quality auditor that grades the built interface against objective standards and hands back a prioritized, agent-executable plan of concrete fixes. Unlike accessibility scanners that stop at mechanical violations, or AI design tools that critique mockups before the code exists, our product evaluates the interface that actually shipped, separates what it measured from what it judged, and turns every finding into work an agent can complete and re-verify.

## 3. Problem Space
Three forces converge on one gap.
(a) AI now generates UI faster than anyone can vet it. Output compiles, renders, demos — but plausibility is not quality. AI-generated UI routinely ships invisible contrast failures, broken focus order, inconsistent spacing, ambiguous affordances, missing empty/error states, confident-but-wrong interaction patterns. The people shipping it are the same people who can't see the problems.
(b) Non-designers can't evaluate UX — and often don't know it. They lack the vocabulary, standards (WCAG, touch-target minimums, contrast ratios), and methods (heuristic evaluation, cognitive walkthrough). Generic AI advice produces tasteful-sounding paragraphs with no evidence, no prioritization, no path to a fix.
(c) The gap opens the moment an MVP exists. Spec-stage design work happens before the UI is built. Once real UI exists, the built thing drifts from the spec, accumulates UX debt, and is never re-evaluated. No tool's job is to look at the actually-built interface, hold it to objective standards, and hand back work an agent can execute.
Root cause is blindness, not laziness: the builder cannot perceive the defect, the generator cannot guarantee its absence. Cost surfaces as churn, support load, abandoned flows, accessibility liability.

## 4. Target Audience
Serves two co-equal audiences; the dual constraint is the product's spine.
PRIMARY — non-designer builder: founder/indie dev/product owner/small-team engineer who shipped or is about to ship real UI. Behaviors: ships fast, reaches for tools that remove blockers, "unsighted" about design not stupid about it. Context: just finished or generated a feature, points at a route/component/URL asking "is this good and what do I fix first?" Workarounds: eyeball it, ask a friend, paste screenshot into chatbot for vague praise, run Lighthouse and get a number with no fix path, ship and hope. Success: short ranked list of concrete changes — the one thing to fix next — in plain language, with verifiable evidence and a way to confirm the fix.
CO-EQUAL — AI agent: drives toolchains end-to-end, needs machine-readable contracts, cannot arbitrate taste so needs unambiguous severity/confidence/acceptance criteria. Context: CI pipeline or agent fleet gating builds, or executing a surface-generated backlog. Success: stable finding IDs, machine-readable severity/confidence, file/component mappings, acceptance criteria, runnable validation checks.
SECONDARY: design-curious devs leveling up; teams without design QA; CI/agent toolchains wanting an objective UI quality gate.

## 5. Value Proposition
Delivers measurably better, more usable, more accessible interfaces to people who cannot produce them alone — plus the confidence to know WHY it's better. Outcomes: ship UI like a designer made it without learning design; always know the one thing to fix next; trust the verdict (measured from real tools, judged cites heuristics + evidence, never conflated); output is work not a lecture (scoped tasks mapped to files with a proving check); the loop closes (re-audit confirms fixes, catches regressions). Vs "do nothing": risk removed.

## 6. Competitive Landscape
No one occupies surface's exact intersection: built/running interface × CLI/agent-first × measured-vs-judged × agent-executable work.
DIRECT/ADJACENT:
- Accessibility scanners (Axe DevTools/Deque, Lighthouse, Pa11y, WAVE). Strength: mature, trusted, deterministic; Axe runs ~70+ rules; Lighthouse built into Chrome. Weakness: automated scanners catch only ~30–40% of WCAG issues, stop at mechanical violations, no usability/hierarchy/content/conversion judgment, no prioritized executable plan. surface uses these as one grounding input then layers judgment + turns into work.
- Figma-stage AI design review (Figma "Check designs" linter, FigmaLint, Design Lint, Stark, Design System Linter Pro). Strength: tight Figma integration, Stark go-to for contrast/WCAG in design file, catches drift early. Weakness: evaluate the design artifact before code exists, target designers, don't see built UI, don't speak CLI/agent. surface's premise is post-MVP.
- AI UX audit / heuristic-eval (Baymard UX-Ray 2.0, onBeacon, Khroma, ClarityUX). Strength: UX-Ray runs 346 research-backed heuristics, claimed 95% match to human auditors, deep e-commerce authority; onBeacon expert reviews. Weakness: designer/dashboard-oriented, web-app not CLI, output is critique for humans not structured agent-executable tasks, grounding not the organizing principle.
INDIRECT: session replay/analytics (Clarity, VWO, Smartlook — post-hoc, need traffic, diagnose symptoms); visual regression (Percy, Chromatic — catch change not quality); generic AI prompt (opinions, no evidence/prioritization/fix-path/separation).
DO NOTHING (strongest competitor): ship and find out later. Free and frictionless, wins by default. surface beats it only by being low-friction enough to use before shipping and concrete enough that the fix is obvious.
DIFFERENTIATION: objective UI quality gate for the post-MVP AI-built world — real interface, real tooling, honest measured-vs-judged, agent-executable + re-verifiable. Auditable where a prompt is not, judgment-bearing where a scanner is not, code-aware where a Figma reviewer is not.

## 7. Guiding Principles
1. Grounded evidence over confident opinion (machine-verifiable confirmed by real tools; AI never fabricates measurements). Tradeoff: fewer/slower evidence-backed findings vs more/faster plausible ones.
2. Honest uncertainty over the appearance of authority (measured/judged separated, low-confidence surfaced as questions). Tradeoff: looks less authoritative.
3. Serving both audiences over optimizing for one (every output explains to a human AND serializes for an agent). Tradeoff: reject designs simpler if serving only one.
4. Executable work over insight (a finding that isn't a scoped located checkable task is incomplete). Tradeoff: spend effort mapping to files/checks vs generating more findings.
5. Proposing-with-a-gate over autonomous action on risky changes (meaning/brand/critical-flow changes pass a human gate). Tradeoff: slows the fully-automated path.

## 8. Anti-Vision
NOT: a design-from-scratch generator (evaluates existing UI; blank-canvas = lost the plot); a replacement for human designers on high-stakes work (brand/novel interaction/high-risk flows want a human); another mechanical scanner (violations+score with no executable fix path = Lighthouse with extra steps); a Figma plugin/design-stage tool (optimizing for critiquing mockups for designers abandons the post-MVP gap); a confident bullshitter (dressing judged as measured = betraying the core promise); a framework-locked tool (Tailwind is one example; finding that only works for one stack = adapter failed); everything at once (shipping every overlay/integration/mode before nailing web+deterministic tooling = over-reach).

## 9. Business Model Intuition
Open-source and community-driven, sibling to Scaffold. Revenue: none directly; earns place by being the trusted free tool (like Axe-core in accessibility); value accrues to the broader toolchain. Unit economics: marginal cost is model inference + optional browser compute, borne by user's own keys/tooling; no hosted infra to subsidize, scales without a cost cliff; unit of value = a closed loop. GTM: developer-led bottom-up, rides Scaffold's channels, CLI is the product, growth via natural pull, credibility is the moat. Unviable if: keeping the knowledge base current exceeds community maintenance capacity. Packaging: standalone sibling CLI with its own .surface/ state, distributed independently.

## 10. Success Criteria
Leading: non-designer fixes top finding and can articulate why it's better; users return to re-audit; agents complete tasks and re-audit confirms fix without human intervention on low-risk; measured findings trusted/acted on. Year 1: web-first MVP (Axe/Lighthouse/Playwright grounding, screenshot capture, measured/judged pipeline, issue-tracker export) end-to-end on real projects; demonstrable before/after (contrast/focus/target violations to zero, judged-severity reduced after one fix cycle); agent drives end-to-end on React/Next via dual CLI+skill. Year 3: default UI quality gate in agent-driven pipelines; respected freshness-audited knowledge base; overlays + richer integrations extend core without diluting; measurable drop in shipped a11y/usability defects. Failure-despite-shipping: run once never return (lecture not work); own judged findings unreliable and users distrust it; accurate but too high-friction so builders choose "do nothing"; drifts into "Lighthouse with prettier output."

## 11. Strategic Risks & Assumptions
1. (high) Deterministic tooling can ground enough of the audit to make AI judgment trustworthy. Mitigation: lead with measured, gate/question low-confidence, multi-model reconciliation.
2. (high) Non-designers act on output without overwhelm. Mitigation: ruthless "one thing next", plain language, depth presets.
3. (medium) Agents are a real willing driver. Mitigation: human interface stands alone, structured I/O costs little.
4. (medium) A community keeps the knowledge base current. Mitigation: citations + freshness metadata + knowledge-audit process.
5. (medium) surface stays low-friction enough to beat "do nothing". Mitigation: degrade gracefully on sparse inputs, static+screenshot first-class, live capture optional.

## 12. Open Questions
Browser-automation weight in MVP; de-duplication across modalities; confidence & multi-model reconciliation thresholds; scoring formula weighting; knowledge-base authoring & freshness; adapter surface definition; state & re-audit finding identity; CI gate semantics. (All deferred to downstream; none block product definition.)
