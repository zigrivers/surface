# Review: surface — Product Vision

**Date:** 2026-05-30
**Methodology:** deep | depth 5/5
**Status:** INITIAL
**Models:** Claude + Codex + Gemini (reconciled)
**Artifact reviewed:** `docs/vision.md` (v1)

## Findings Summary

- **Total findings: 6** — P0: 0 | P1: 1 | P2: 4 | P3: 1
- **Passes run:** 5 of 5 (Vision Clarity, Audience Precision, Competitive Rigor, Strategic Coherence, Downstream Readiness)
- **Multi-model dispatch:** Codex (3 findings) + Gemini (1 finding), reconciled with Claude's 5-pass review — see `docs/reviews/vision/review-summary.md`
- **Downstream gate:** **PASS** (after fixes) — the PRD can be written without strategic clarification questions.

## Findings by Pass

### Pass 1 — Vision Clarity

**F1 (P1) — Vision statement failed the swap test.** *[Gemini + Claude]*
- **Location:** §1 Vision Statement
- **Issue:** The original — *"Anyone who can build an interface can ship one people are able to actually use — no design degree required"* — described the democratization *outcome* but was not distinctive. It could be claimed verbatim by a UI generator (v0.dev), a site builder (Squarespace), or a component library (Tailwind UI). It captured the result of *shipping* usable UI but not surface's distinct space: making the *already-built* interface good by evaluating and fixing it.
- **Impact:** The vision statement is the single most-referenced artifact downstream. A non-distinctive North Star provides weak signal for "is this surface, or some other path to usable UI?" decisions.
- **Recommendation:** Keep the (user-chosen) democratization framing but add distinctiveness via the *already-built* angle, staying outcome-framed (Gemini's "design QA" rewrite was rejected for describing the mechanism — `vision-craft` anti-pattern "tying vision to a solution").
- **Resolution:** Escalated to the user (it revised a user-approved decision). User selected the **"already-built" refinement**: *"Whatever interface you've already built becomes one people can actually use — no design degree required."* Supporting paragraph updated to make the already-built/not-a-generator distinction explicit. **RESOLVED.**

### Pass 2 — Audience Precision

**F4 (P2) — "Co-equal" intro contradicted persona labels; no conflict rule.** *[Codex + Claude]*
- **Location:** §4 Target Audience
- **Issue:** Intro said "two co-equal audiences," but the personas were then labeled "Primary persona" (builder) and "Co-equal persona" (agent) — an internal inconsistency. No rule existed for what happens when human readability and agent execution genuinely conflict.
- **Impact:** Ambiguity flows into PRD personas; risks collapsing two distinct users into one contradictory "Everything User."
- **Recommendation:** Relabel to remove the ranking contradiction and add an explicit priority rule.
- **Resolution:** Relabeled to **"Buyer-of-record persona"** (builder) and **"First-class-executor persona"** (agent); added a **priority rule** — human trust/comprehension govern risky/subjective decisions, machine-readable contracts govern execution format — and a note to carry it into the PRD. **RESOLVED.**

*No other audience-precision findings — personas are behavior-based, with clear inclusion/exclusion (designers and "produce new UI" use cases are excluded by the vision test).*

### Pass 3 — Competitive Rigor

**F5 (P3) — No conceded dimension.** *[Claude]*
- **Location:** §6 Competitive Landscape → Genuine differentiation
- **Issue:** The analysis honestly acknowledged competitor *strengths* but did not name a dimension surface deliberately will *not* win on — a mild "better at everything" risk.
- **Impact:** Low. Slightly weakens credibility of an otherwise honest competitive section.
- **Recommendation:** Concede that surface won't match a scanner's zero-config speed / raw mechanical breadth.
- **Resolution:** Added a **"What surface concedes"** paragraph — it defers to scanners on mechanical breadth and will never be as instantaneous as a one-click score; it competes on actionable judgment. **RESOLVED.**

*Competitors are named specifically (Axe, Lighthouse, Pa11y, WAVE, Figma/Stark/FigmaLint, Baymard UX-Ray, onBeacon, Clarity, Percy, Chromatic), each with an acknowledged strength; "do nothing" is correctly treated as the strongest competitor; differentiation is structural. Strong pass overall.*

### Pass 4 — Strategic Coherence

**F2 (P2) — Success criteria lacked directional thresholds.** *[Codex P1 → reconciled P2 + Claude]*
- **Location:** §10 Success Criteria
- **Issue:** Leading indicators and Year 1/3 milestones were directionally strong and behavioral (not vanity metrics) but contained no quantified targets — "trusted," "default gate," "measurable drop" without magnitudes.
- **Impact:** Harder to falsify the vision early. (Codex rated P1; downgraded to P2 because vision success criteria are *directional* by design per `vision-craft` — the PRD owns precise metrics.)
- **Resolution:** Added illustrative **directional thresholds** (>50% fix-top-finding-in-session, ≥30% re-audit within 7 days, ≥80% unattended low-risk fix closure, single-digit judged false-positive rate) under an explicit **"directional, not contractual"** caveat. **RESOLVED.**

**F3 (P2) — Value-prop overstatement.** *[Codex + Claude]*
- **Location:** §5 Value Proposition (first outcome bullet)
- **Issue:** "You ship UI that looks and works like a designer made it" overstated the promise and sat in tension with the anti-vision's "not a replacement for human designers on high-stakes work."
- **Impact:** Implies designer-equivalent output rather than baseline defect detection + guided repair; the PRD could over-scope.
- **Resolution:** Reframed to **"meets the baseline a designer would expect — accessible, usable, coherent,"** with an explicit pointer that surface raises the floor and flags (not replaces) human judgment on high-stakes work. Now coheres with §8. **RESOLVED.**

*Guiding principles are all X-over-Y with genuine, stated tradeoffs (each passes the reasonable-disagreement test); anti-vision names specific, tempting traps with mechanisms and connects to the principles; business model coheres with the developer-led GTM and "trusted free tool" positioning; risks are honest about severity with real mitigations. Strong pass.*

### Pass 5 — Downstream Readiness

**F6 (P2) — PRD needs the human-vs-agent priority rule.** *[Claude]*
- **Location:** §4 (handoff to PRD personas)
- **Issue:** Without an explicit conflict rule, the PRD could merge the two audiences into one persona with contradictory needs (narrative plain-language vs. terse structured I/O).
- **Impact:** Would produce muddy personas → muddy user stories.
- **Resolution:** The F4 fix adds the priority rule *and* an explicit instruction to carry it into PRD personas. **RESOLVED.**

*Problem Space maps cleanly to a PRD problem statement; personas are specific enough for user stories; principles can resolve "should we build X?"; the Year-1 milestone already sketches MVP scope. Open Questions are architecture/implementation decisions appropriately deferred — none block product definition.*

## Fix Plan (executed)

| Batch | Theme | Findings | Severity | Status |
|-------|-------|----------|----------|--------|
| 1 | Vision statement distinctiveness | F1 | P1 | Applied (user-selected "already-built" refinement) |
| 2 | Audience clarity + priority rule | F4, F6 | P2 | Applied |
| 3 | Coherence: value prop + success criteria | F3, F2 | P2 | Applied |
| 4 | Competitive honesty | F5 | P3 | Applied |

## Fix Log

| Batch | Findings Addressed | Changes Made | New Issues |
|-------|-------------------|--------------|------------|
| 1 | F1 | §1 vision statement rewritten to "Whatever interface you've already built becomes one people can actually use — no design degree required"; supporting paragraph adds the already-built / not-a-generator distinction | None |
| 2 | F4, F6 | §4 relabeled personas (Buyer-of-record / First-class-executor); added priority-rule blockquote + PRD-handoff instruction | None |
| 3 | F3, F2 | §5 value-prop bullet reframed to "baseline a designer would expect" with §8 pointer; §10 added directional thresholds + "directional, not contractual" caveat | None |
| 4 | F5 | §6 added "What surface concedes" paragraph | None |

## Re-Validation Results

Re-ran all five passes against the edited document:

- **Pass 1:** New statement passes the swap test (generators make *new* UI; this is the *already-built* one), the decision test, and is shorter/more memorable (14 words). ✓
- **Pass 2:** Persona labels no longer contradict; priority rule present. ✓
- **Pass 3:** Conceded dimension added; section remains honest and specific. ✓
- **Pass 4:** Value prop coheres with anti-vision; success criteria now have directional, falsifiable targets without overcommitting. ✓
- **Pass 5:** Priority rule carries into PRD persona guidance; no Open Question blocks product definition. ✓

**No new P0/P1 findings introduced.** Two re-validation cycles not required (clean on first re-check).

## Downstream Readiness Assessment

- **Gate result:** **PASS**
- **Handoff notes for `create-prd`:**
  1. Carry the §4 **priority rule** into PRD personas — keep the builder (buyer-of-record) and the agent (first-class executor) as *distinct* personas; do not merge into one "Everything User."
  2. §10 success-criteria thresholds are **directional** — the PRD should set the real, instrumented metrics.
  3. The §12 Open Questions (browser-automation weight, dedup, confidence thresholds, scoring formula, KB freshness, adapter surface, re-audit identity, CI gate semantics) are deferred to PRD/ADR/architecture; "browser-automation weight in MVP" in particular touches MVP feature scope the PRD should resolve.
  4. The Year-1 milestone (§10) already sketches MVP boundaries — use it as the seed for the PRD's prioritized feature list.
- **Remaining P2/P3 items:** None deferred — all 6 findings resolved.
