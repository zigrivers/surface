<!-- scaffold:vision v1 2026-05-30 -->
<!-- scaffold:innovate-vision v1 2026-05-30 -->

# surface — Product Vision

> The North Star for `surface`. Every downstream decision — PRD, architecture,
> implementation priorities — should be checkable against this document. When the
> PRD and this vision conflict, revisit the vision first.

---

## 1. Vision Statement

**Whatever interface you've already built becomes one people can actually use — no design degree required.**

The positive change is *access*: whether an interface is good stops depending on
whether a designer was in the room. The emphasis on *already built* is deliberate —
this is not about generating new UI (a generator or template tool does that), but
about taking the thing that already shipped and making it genuinely usable. Test it
against a decision — "does this make quality reachable for someone who can't see
design problems in the UI they already have?" If a proposed feature only helps people
who already have design skill, or only helps produce *new* UI from scratch, it fails
the vision.

## 2. Elevator Pitch

> For **the AI agents and build pipelines that ship interfaces — and the founders and
> solo developers they ship for** — who can produce a working interface but can't tell
> whether it's actually *good* — **surface** is a **UI quality gate** (delivered as a
> command-line tool and an MCP server) that grades the built interface against objective
> standards and hands back a prioritized, agent-executable plan of concrete fixes.
> Unlike **accessibility scanners that stop at mechanical violations, or AI design tools
> that critique mockups before the code exists**, our product **evaluates the interface
> that actually shipped, separates what it measured from what it judged, and turns every
> finding into work an agent can complete and re-verify.**

> **Category note:** surface is not trying to win an existing category — it is creating
> one. *What a linter or a test suite is to code, surface is to the built interface:* an
> automatic quality gate you run as a standard step, not a specialist tool you consult.

## 3. Problem Space

Three forces converge on one gap.

**AI now generates UI faster than anyone can vet it.** Agents and AI-assisted
builders produce interfaces at high volume and high *plausibility*. The output
compiles, renders, and demos — but plausibility is not quality. AI-generated UI
routinely ships invisible contrast failures, broken focus order, inconsistent
spacing, ambiguous affordances, missing empty/error states, and confident-but-wrong
interaction patterns. Nobody on the team catches it, because the people shipping it
are the same people who can't see the problems.

**Non-designers can't evaluate UX — and often don't know it.** A founder or solo
developer can feel that something is "off" but can't name *what*, *why*, or *how to
fix it*. They lack the vocabulary (hierarchy, affordance, Gestalt grouping, reading
level), the standards (WCAG, touch-target minimums, contrast ratios), and the methods
(heuristic evaluation, cognitive walkthrough) a designer brings. Generic AI advice
doesn't close the gap — it produces tasteful-sounding paragraphs with no evidence, no
prioritization, and no path to a fix.

**The gap opens the moment an MVP exists.** Spec-stage design work happens *before*
the UI is built. Once real UI exists, a different problem starts: the built thing
drifts from the spec, accumulates UX debt, and is never re-evaluated against the
standards it was supposed to meet. No tool's job is to look at the *actually-built*
interface, hold it to objective standards, and hand back work an agent can execute.

**The root cause is not laziness or low standards — it's blindness.** The builder
cannot perceive the defect, and the generator cannot guarantee its absence. So
quality silently erodes, and the cost surfaces later as churn, support load,
abandoned flows, and accessibility liability. This is not cosmetic: UI quality
determines whether people can complete tasks, whether they trust the product, whether
the product is legally accessible, and whether it converts.

**Why now.** Two shifts make this gap urgent rather than chronic. First, AI build
tools (v0, Bolt, Lovable, Cursor, and the agent fleets behind them) have turned
"shipping an interface without a designer" from an exception into the default — the
volume of unvetted UI is climbing fast. Second, accessibility is becoming *law*: the
**European Accessibility Act** took effect on 28 June 2025, with existing services
required to comply by June 2030 and penalties reaching **€100,000 or 4% of annual
revenue**; regulators in France, Germany, and the Netherlands are already pursuing
e-commerce and banking platforms. The cost of invisible UI defects is moving from
"someday churn" to "this-year liability" — for exactly the builders least equipped to
see it coming.

## 4. Target Audience

surface serves **two audiences at once, and they enter from different directions.**
The **AI agent is the primary adopter and driver** — surface is reached most often
*through* an automated pipeline: an AI build tool, a CI gate, or an agent fleet that
runs it as a standard step the way it runs tests or a linter. The **non-designer
builder is the ultimate beneficiary and the authority of record** — the value flows to
the human who couldn't see the problems, and the human remains the one who signs off on
anything risky or subjective. Neither is a second-class citizen: the same evaluation
must *serialize cleanly* for the machine that runs it and *explain itself* to the human
it serves.

> **This is a deliberate, recently-made bet (see §11, risk #3):** we lead adoption with
> the agent, not the human. The wedge is that AI build pipelines will increasingly run a
> UI quality gate automatically — so surface arrives by being *embedded*, not *sought
> out*. If that bet proves wrong, the human-driven path is the fallback, not the plan.

> **Priority rule (adoption vs. authority — they are separate axes):** *adoption* leads
> with the agent; *authority* stays with the human. Machine-readable contracts govern
> **execution format** — IDs, severity, acceptance criteria, validation checks. Human
> trust and comprehension govern **risky or subjective decisions** — anything that
> alters meaning, brand, or a critical flow defers to the human (this is the safety gate
> of principle #5, and the agent-first flip does **not** weaken it). The PRD should carry
> both personas forward as distinct, never collapsing them into one "Everything User."

### Primary adopter & driver — the AI agent

The agent is how surface is reached at scale. It needs deterministic, structured I/O and
cannot arbitrate taste.

- **Behaviors & motivations:** Drives toolchains end-to-end; runs surface as an embedded
  step (CI gate, build-pipeline hook, MCP tool call); needs machine-readable contracts and
  unambiguous severity, confidence, and acceptance criteria.
- **Context of use:** Inside an AI build pipeline (e.g. after a code-gen step), a CI
  quality gate, or an agent fleet — executing a surface-generated backlog as scoped tasks
  against specific files, then re-auditing to confirm.
- **Current workarounds:** Mechanical scanners that emit violations with no
  prioritization; or LLM critiques that are unstructured prose, impossible to act on
  deterministically.
- **Success from its view:** Stable finding identifiers, machine-readable severity and
  confidence, file/component mappings, acceptance criteria, and validation checks it can
  run to *prove* a fix worked — then re-run to close the loop, escalating only the
  human-gated findings.

### Ultimate beneficiary & authority of record — the non-designer builder

A founder, indie developer, product owner, or small-team engineer who has shipped (or is
about to ship) a real interface and wants it to be good. The reason surface exists, and
the final say on anything risky.

- **Behaviors & motivations:** Capable and motivated; ships fast; reaches for tools that
  remove blockers. Not stupid about design — *unsighted* about it. Wants to learn enough
  to not embarrass themselves, but won't take a design course.
- **Context of use:** Reviews what the agent surfaced — or runs surface directly, pointing
  at a route, component, or live URL and asking "is this any good, and what do I fix
  first?" Approves or vetoes the risky/subjective changes the agent escalated.
- **Current workarounds:** Eyeball it; ask a friend; paste a screenshot into a chatbot and
  get vague praise; run Lighthouse and get a number with no path to a fix; ship it and hope.
- **Success from their view:** A short, ranked list of concrete changes — *the one thing
  to fix next* — explained in plain language, with evidence they can verify with their own
  eyes, and a way to confirm the fix worked.

### Secondary beneficiaries

Design-curious developers leveling up; teams without dedicated design QA; toolchains
(CI, agent fleets) that want an objective UI quality gate.

## 5. Value Proposition

surface delivers **measurably better, more usable, more accessible interfaces to people
who cannot produce them alone** — and the confidence to know *why* the result is
better.

Framed as outcomes, not features:

- **You ship UI that meets the baseline a designer would expect** — accessible,
  usable, and coherent — without learning design, hiring one, or guessing. (surface
  raises the floor; for brand identity and high-stakes flows it flags what still needs
  a human, rather than pretending to be one — see §8.)
- **You always know the one thing to fix next** — ruthless prioritization for someone
  who can't arbitrate design debates.
- **You can trust the verdict** — measured findings come from real tools; judged
  findings cite named heuristics and show evidence; the two are never conflated.
- **The output is work, not a lecture** — concrete, scoped tasks mapped to specific
  files, with the change to make and the check that proves it's done.
- **The loop closes** — re-audit confirms fixes landed and catches regressions when
  they reappear.
- **You get ahead of accessibility law** — surface's measured accessibility grounding
  helps you find and fix the violations that now carry real legal exposure under the
  European Accessibility Act, *before* a regulator or complainant does. (Honest limit:
  automated tooling catches only part of WCAG — surface reduces risk and flags what
  still needs a human audit; it does not certify legal compliance.)

Against the strongest alternative — *doing nothing and shipping the AI-generated UI as
is* — the value is risk removed: the contrast failure that fails a user, the focus trap
that triggers a complaint, the broken checkout that silently loses revenue, caught
before it costs.

## 6. Competitive Landscape

The market is crowded with adjacent tools, but **no one occupies surface's exact
intersection**: evaluating the *built, running* interface, for a *CLI/agent-first*
audience, separating *measured from judged*, and emitting *agent-executable work*.

### Direct & adjacent competitors

- **Accessibility scanners — Axe DevTools (Deque), Lighthouse, Pa11y, WAVE.**
  *Strength:* Mature, trusted, genuinely deterministic; Axe is purpose-built and runs
  ~70+ rules; Lighthouse is built into Chrome and frictionless. *Weakness:* By their own
  community's measure, automated scanners catch only ~30–40% of WCAG issues, and they
  stop at mechanical violations entirely — no usability, hierarchy, content, or
  conversion judgment, and no prioritized, agent-executable plan. *Why choose surface:*
  surface *uses* these as one grounding input, then layers the other 60–70% of judgment
  on top and turns all of it into work.

- **Figma-stage AI design review — Figma's native "Check designs" linter, FigmaLint,
  Design Lint, Stark, Design System Linter Pro.** *Strength:* Tight Figma integration;
  Stark is the go-to for contrast/WCAG inside the design file; catches drift early, in
  the designer's native tool. *Weakness:* They evaluate the *design artifact before code
  exists*, and they target *designers* who can already read the feedback. They do not
  see the interface that actually got built, and they don't speak CLI or agent.
  *Why choose surface:* surface's whole premise is post-MVP — the gap that opens *after*
  Figma, when the built thing has drifted from any spec.

- **AI UX audit / heuristic-eval tools — Baymard UX-Ray 2.0, onBeacon, Khroma,
  ClarityUX.** *Strength:* Baymard's UX-Ray runs 346 research-backed heuristics with a
  claimed 95% match to human auditors and deep e-commerce authority; onBeacon offers
  expert-level reviews from credible pedigree. *Weakness:* Designer- and
  dashboard-oriented; web-app delivery, not a CLI; output is critique for humans, not
  structured, agent-executable tasks with re-runnable validation; grounding in
  deterministic tooling is not the organizing principle. *Why choose surface:* surface
  is built for the builder *and* the agent, and treats deterministic grounding +
  measured/judged separation as a hard constraint.

### Indirect alternatives

- **Session replay & analytics — Microsoft Clarity, VWO, Smartlook.** Find friction
  *after* launch, from real traffic. Powerful but post-hoc — they need users to suffer
  first, and they diagnose symptoms, not the design defect.
- **Visual-regression — Percy, Chromatic.** Catch *change*, not *quality*. They tell you
  a pixel moved, not whether it should have.
- **Generic AI prompt ("make this UI better").** Gives opinions: tasteful-sounding, no
  evidence, no prioritization, no path to a fix, and no separation of measured fact from
  judgment. Auditable is the difference.

### The "do nothing" option — the strongest competitor

Ship the AI-generated UI and find out later. It's free and frictionless, which is
exactly why it wins by default. surface beats it only by being *low-friction enough to
use before shipping* and *concrete enough that the fix is obvious* — otherwise the
builder will rationally choose to just ship.

### Ecosystem position (complementary, not competitive)

The AI build tools that generate UI — **v0, Bolt, Lovable, Cursor**, and the agent
fleets behind them — are not competitors; they are the *source of the work surface does*.
They produce interfaces at high volume and varying quality (even the strongest, v0, is
praised for UI but still ships variance). surface's natural place is **downstream of the
generator**: the standard QA pass that runs *after* UI is built, the way a test suite
runs after code is written. The strategic aim is for "run surface" to become a default
step in those pipelines — which is also why the AI agent is the primary adopter (§4).

### Genuine differentiation

surface is the **objective UI quality gate for the post-MVP, AI-built world** — pointed
at the *real* interface, grounded in real tooling, honest about measured vs. judged, and
producing work an agent can execute and re-verify. It is auditable where a prompt is
not, judgment-bearing where a scanner is not, and code-aware where a Figma reviewer is
not. **It is creating a category, not entering one:** *the UI quality gate* — what a
linter or test suite is to code, surface is to the built interface. Winning means the
category exists and surface defines it, not that surface out-features an incumbent.

**What surface concedes.** It will never be as zero-config or instantaneous as dropping
a Lighthouse score into a PR, and it won't match a dedicated scanner's raw breadth of
mechanical rules — it *defers to* those scanners for that. The depth that makes surface
valuable (judgment, prioritization, executable fixes) costs a little more setup and
time than a one-click number. We compete on *actionable judgment*, not on being the
fastest button to click.

## 7. Guiding Principles

Each is framed as a real tradeoff — a reasonable team could choose the opposite.

1. **We choose grounded evidence over confident opinion.** Anything verifiable by a
   machine is produced or confirmed by a real tool (Axe-core, Lighthouse, Playwright);
   the AI interprets and explains but never fabricates a measurement. *The tradeoff:* we
   ship fewer, slower, evidence-backed findings instead of more, faster, plausible ones.
   *Opposite a team might pick:* lean fully on the model for speed and coverage.

2. **We choose honest uncertainty over the appearance of authority.** Measured and
   judged findings are always separated and always carry evidence; low-confidence
   judgments are surfaced as *questions*, not mandates. *The tradeoff:* the output looks
   less authoritative than a tool that asserts everything with equal confidence.
   *Opposite:* present every finding as settled fact for a cleaner UX.

3. **We choose serving both audiences over optimizing for one.** Every output must
   explain itself to a non-designer *and* serialize cleanly for an agent. *The tradeoff:*
   we reject designs that would be simpler if we only served humans, or only served
   machines. *Opposite:* pick the human (a polished report) or the machine (a raw JSON
   firehose) and do it better.

4. **We choose executable work over insight.** A finding that doesn't become a scoped,
   located, checkable task is incomplete. *The tradeoff:* we spend effort mapping
   findings to files and writing validation checks instead of generating more findings.
   *Opposite:* maximize the breadth of the audit and leave fixing to the user.

5. **We choose proposing-with-a-gate over autonomous action on risky changes.** Anything
   that alters meaning, brand, or a critical flow passes through a human gate; agents
   never silently make subjective high-risk UX changes. *The tradeoff:* we slow down the
   fully-automated path for safety. *Opposite:* let agents auto-apply everything for
   maximum throughput.

## 8. Anti-Vision

What surface is explicitly **NOT**:

- **Not a design-from-scratch generator.** surface evaluates and improves *existing* UI.
  "Generate better alternatives" is a bounded mode operating on something that already
  exists — *if we find ourselves building a blank-canvas design tool, we've lost the
  plot.*
- **Not a replacement for human designers on high-stakes work.** Brand identity, novel
  interaction paradigms, and high-risk flows still want a human. surface raises the floor
  and flags the ceiling; it never pretends to be a senior designer.
- **Not another mechanical scanner.** *If our output is a list of violations with a
  score and no prioritized, executable path to a fix, we've become Lighthouse with extra
  steps.*
- **Not a Figma plugin / design-stage tool.** The moment we optimize for critiquing
  mockups for designers, we've abandoned the post-MVP gap that is our entire reason to
  exist.
- **Not a confident bullshitter.** *If we ever dress a judged finding as a measured one,
  or assert a low-confidence opinion as fact, we've betrayed the core promise.* The
  defense against hallucinated UX advice is the product, not a footnote.
- **Not a vanity-score generator.** We gate on *findings and severity*, never on a single
  headline number ("your UI scores 87/100"). A score invites gaming, manufactures false
  confidence, and buries the *one thing to fix next* under an aggregate. *If we find
  ourselves leading with a score instead of the next concrete fix, we've undercut our own
  honesty principle.* (CI gating keys off open findings by severity, not a number.)
- **Not a framework-locked tool.** Tailwind is one example among many, not the
  assumption. *If a finding only works for one stack, the adapter layer failed.*
- **Not everything at once.** We will be tempted to ship every overlay, integration, and
  special mode. *If the MVP tries to cover kiosk/TV, Figma ingestion, and session-replay
  analytics before nailing web + deterministic tooling, we've over-reached.*

## 9. Business Model Intuition

**surface is open-source and community-driven** — a sibling to Scaffold, distributed
the same way. Sustainability comes from adoption and ecosystem fit, not direct revenue.

- **Revenue model:** None directly. surface earns its place by being the obvious,
  trusted, free tool for post-MVP UI quality — the way Axe-core earns trust in
  accessibility. Value accrues to the broader toolchain (Scaffold and the agent
  ecosystem it composes with) rather than to a paywall.
- **Unit economics direction:** The marginal cost of an audit is mostly model inference
  plus optional browser-automation compute, both borne by the user running their own
  keys/tooling. There is no hosted infrastructure to subsidize, so the project scales
  without a cost cliff. The "unit" of value is a *closed loop*: a finding detected,
  fixed, and re-verified.
- **Go-to-market intuition:** **Agent-led first, developer-led second.** The primary
  channel is *embedding* — surface becomes a default step inside AI build pipelines, CI
  gates, and agent fleets, reached as an MCP tool call rather than sought out. The
  complementary human channel is bottom-up developer adoption riding Scaffold's channels
  (the CLI discovered by builders already in a terminal). Both grow on the same pull:
  "point it at your app and it tells you what's wrong, for free." Credibility, not
  marketing spend, is the moat: the tool is trusted because its measured findings are
  verifiable and its judged findings are honest.
- **Knowledge base as a shared standard (compounding asset):** the open, cited,
  freshness-audited catalog of UI best-practice is not just internal fuel — the aim is
  for it to become a *citable reference others in the ecosystem point to*. That turns the
  maintenance burden (risk #4) into a moat: a community standard is harder to displace
  than a feature, and contributions compound rather than fork.
- **What would make it unviable:** If keeping the knowledge base current and the tool
  grounding accurate demands more sustained maintenance than a community can carry, the
  open model strains. (Tracked as a strategic risk below.)

> Packaging decision: surface ships as a **standalone sibling CLI *and* MCP server**,
> with its own `.surface/` state, composing with Scaffold but distributed independently —
> not as a Scaffold phase or plugin. The CLI serves the human; the MCP server makes
> surface a native, embeddable tool for the agents that are its primary adopters (§4).
> This preserves its own identity and lifecycle while letting the toolchain feel like one.

## 10. Success Criteria

> The targets below are **directional, not contractual** — they exist to make the
> vision falsifiable and to anchor the PRD, which will finalize exact metrics,
> instrumentation, and thresholds. The numbers are illustrative magnitudes, not
> commitments.

### Leading indicators (early signals the vision is working)

- A non-designer runs surface, fixes the top finding **in the same session**, and can
  *articulate why* the result is better — the explanation landed. *(Directional: >50% of
  first-time users act on the top finding before leaving.)*
- Users return: someone who audits once comes back to re-audit after their next change —
  the loop is sticky, not one-shot. *(Directional: ≥30% re-audit within 7 days.)*
- Agents complete surface-generated tasks and the *re-audit confirms the fix* without
  human intervention on low-risk findings. *(Directional: ≥80% of low-risk fixes close
  the loop unattended.)*
- Measured findings are trusted: users act on contrast/focus/target findings without
  second-guessing them — which requires the judged-finding false-positive rate to stay
  low enough that trust doesn't leak. *(Directional: judged false-positive rate in the
  single digits.)*
- **surface measures and publishes its own trustworthiness.** It tracks how often its
  *judged* findings hold up against *measured* ground truth (and human verdicts on gated
  ones) and reports that accuracy openly — the tool that audits its own reliability. *(A
  leading indicator the grounding promise is real, not asserted; directly attacks risk
  #1.)*

### Year 1 milestones

- Web-first MVP: deterministic tooling (Axe/Lighthouse/Playwright) grounding, screenshot
  capture, the core measured/judged pipeline, and issue-tracker export — all working
  end-to-end on real projects.
- Demonstrable before/after: on a sample of real AI-generated apps, contrast/focus/target
  violations driven to zero and a measurable reduction in judged-severity findings after
  one fix cycle.
- An agent can drive surface end-to-end — detect → task → fix → re-audit — on at least the
  common stacks (React/Next), via the CLI, the runner skill, *and* an MCP server so it
  embeds natively in agent pipelines.
- At least one AI build pipeline or CI flow runs surface as an embedded quality-gate step
  (the agent-led adoption wedge showing early signal).

### Year 3 aspirations

- surface is the default objective UI quality gate in agent-driven build pipelines — the
  thing you run before you ship AI-built UI, the way you run a linter or a test suite.
- The knowledge base is a respected, citable, freshness-audited catalog of UI
  best-practice — not folklore.
- App-type overlays and richer integrations (Figma, visual-regression baselines,
  analytics ingestion) extend the core without diluting it.
- A measurable, reportable drop in the rate of shipped accessibility and usability
  defects across projects that adopt it.

### What failure looks like (even if it ships on time)

- Users run it once and never return — the output was a lecture, not actionable work.
- The tool's *own* judged findings prove unreliable, and users learn to distrust it —
  the grounding promise failed.
- It's accurate but too high-friction to use before shipping, so builders rationally
  choose "do nothing."
- It drifts into being "Lighthouse with prettier output" — mechanical findings, no
  executable path, no judgment that justifies its existence.

## 11. Strategic Risks & Assumptions

Explicit bets that must hold:

1. **Bet: deterministic tooling can ground *enough* of the audit to make AI judgment
   trustworthy.** *If wrong:* too much of "good UI" is unmeasurable, and surface becomes
   another opinion engine. *What invalidates it:* the measurable share (contrast, focus,
   targets, shift, reading level) proves too narrow to anchor user trust. *Severity:
   high.* *Mitigation:* lead with measured findings; gate and question low-confidence
   judgments; multi-model reconciliation to raise trust on judged findings; and
   **measure-and-publish surface's own judged false-positive rate** so trustworthiness is
   demonstrated with evidence rather than asserted.

2. **Bet: non-designers will act on the output without overwhelm.** *If wrong:*
   prioritization fails, users freeze, and they go back to shipping blind. *What
   invalidates it:* even a ranked backlog is too much for the persona. *Severity: high.*
   *Mitigation:* ruthless "one thing to fix next" framing; plain-language explanation;
   depth presets that scale output from a one-liner to a full plan.

3. **Bet (now central): AI build pipelines and agent fleets will adopt an embedded UI
   quality gate as a standard step — making the agent the primary adoption channel.**
   This is the wager behind the agent-first flip (§4): surface arrives by being embedded,
   not sought out. *If wrong:* the primary distribution channel doesn't materialize and
   adoption depends entirely on the slower human-driven path. *What invalidates it:* agent
   toolchains and AI builders don't standardize on a UI quality gate, or surface isn't the
   one they pick. *Severity: high* (raised from medium — it is now the load-bearing GTM
   bet, not a secondary audience). *Mitigation:* MCP delivery makes embedding cheap and
   native; the **human-driven CLI path stays fully functional as the fallback** (the
   value to the human beneficiary doesn't depend on agent adoption); and we watch the
   inverse risk too — if humans turn out to be the faster adopters, the §4 priority is
   re-examined rather than defended.

4. **Bet: a community can keep the knowledge base and tool grounding current.** *If
   wrong:* standards drift (WCAG, platform guidelines), entries rot, and trust erodes.
   *What invalidates it:* maintenance load exceeds community capacity under the
   open-source model. *Severity: medium.* *Mitigation:* citations + freshness/volatility
   metadata + a knowledge-audit process (mirroring Scaffold's), so staleness is visible
   and fixable; and **position the catalog as a shared community standard** so external
   contributions compound the maintenance rather than concentrating it on one maintainer.

5. **Bet: surface stays low-friction enough to beat "do nothing."** *If wrong:* setup
   cost (especially live browser automation) pushes builders to skip it. *What
   invalidates it:* Playwright/browser dependency makes the first run flaky or heavy.
   *Severity: medium.* *Mitigation:* degrade gracefully on sparse inputs; make
   static + screenshot a first-class path; keep live capture optional and depth-gated.

## 12. Open Questions

Deliberately unresolved — for downstream phases (PRD, ADRs, architecture, specs) to
settle. None of these block product definition.

- **Browser-automation weight in MVP:** how much should v1 depend on live Playwright vs.
  static + screenshot inputs? (Ties to risk #5.)
- **De-duplication across modalities:** when the same issue appears in code, DOM, and
  screenshot, how are findings merged without losing each source's evidence?
- **Confidence & multi-model reconciliation:** the exact thresholds for surfacing-as-
  question vs. asserting, and how Claude/Codex/Gemini votes combine. (Ties to risk #1.)
- **Prioritization scoring:** the concrete weighting of severity/confidence/effort/impact
  used to *rank findings*, and how MMR-style selection is parameterized. (This is internal
  ordering, not a user-facing headline score — see the anti-vision in §8.)
- **Knowledge-base authoring & freshness:** how entries are sourced, cited, versioned,
  and audited over time. (Ties to risk #4.)
- **Adapter surface:** how framework adapters are defined, and how much stack-specific fix
  generation is in scope for v1.
- **State & re-audit identity:** how findings keep stable identity across re-runs so
  "resolved / still-failing / regressed" is reliable.
- **CI gate semantics:** what makes a build fail, and how teams tune that without it
  becoming noise.

---

## Appendix: Strategic Innovation Log (innovate-vision)

Innovation pass run 2026-05-30 (depth 5, all 5 dimensions + contrarian stress-test).
Decisions below are the product owner's; each is strategic-level (feature-level ideas
were deferred to `innovate-prd`).

| # | Dimension | Innovation | Impact | Cost | Disposition | Integrated into |
|---|-----------|-----------|--------|------|-------------|-----------------|
| I1 | Market opportunity | EAA accessibility-compliance wedge / "why now" timing | High | Trivial | **Approved (must-have)** | §3 Why now, §5 value prop |
| I2 | Positioning | Explicit category creation — "the UI quality gate" | High | Trivial | **Approved (must-have)** | §2 category note, §6 differentiation |
| I3 | AI-native | MCP-server delivery so agents adopt natively | High | Moderate | **Approved (must-have, strategic only)** | §2, §4, §9 packaging, §10 |
| I5 | Ecosystem | Position downstream of AI builders (v0/Bolt/Lovable/Cursor) | High | Trivial | **Approved (must-have)** | §3, §6 ecosystem position |
| I4 | AI-native | Self-grounding — publish surface's own judged false-positive rate | Med-High | Moderate | **Approved (backlog)** | §10 leading indicator, §11 risk #1 |
| I6 | Ecosystem | Knowledge base as a shared, citable standard / moat | Medium | Moderate | **Approved (backlog)** | §9, §11 risk #4 |
| I7 | Contrarian | Refuse a vanity score — gate on findings/severity | Medium | Trivial | **Approved (backlog → anti-vision)** | §8, §12 prioritization-scoring note |
| I8 | Contrarian | **Flip to agent-first** — AI agent is the primary adopter/driver | High | Trivial (framing) | **Approved (bold bet)** | §2, §4 (reworked), §6, §9 GTM, §11 risk #3 |

**Note on I8 (agent-first flip).** This reverses the adoption priority settled in
`review-vision` (which had the human as buyer-of-record). The flip changes *who adopts
first* (now the agent), **not** the safety model: the human remains the authority of
record on risky/subjective changes (principle #5 and the §4 priority rule are intact).
Risk #3 was escalated from medium to **high** to reflect that agent adoption is now the
load-bearing go-to-market bet. The inverse risk (humans adopt faster) is logged as a
watch-item in §4 and risk #3 rather than ignored.

**Deferred / rejected:** none rejected outright. Feature-level expressions of these
innovations (the MCP tool schema, the CI-gate config surface, the accuracy dashboard, the
KB contribution model) are explicitly deferred to `innovate-prd` / the specs.

---

*This vision is the strategic North Star for `surface`. Downstream: `create-prd`
translates it into a product requirements document. When the PRD and this vision
conflict, the vision wins until explicitly revised.*
