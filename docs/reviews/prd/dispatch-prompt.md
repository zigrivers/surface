You are reviewing a PRODUCT REQUIREMENTS DOCUMENT (PRD) for an open-source tool called `surface` — a CLI + MCP server that audits the *built, running* UI of web apps, separates measured (tool-confirmed) from judged (AI) findings, and emits an agent-executable, re-verifiable backlog of fixes. Its two audiences: AI agents/build-pipelines (primary adopter) and non-designer builders (beneficiary + authority on risky changes).

A PRD says WHAT and for whom, not HOW (architecture/specs own the HOW). Review it using these 8 passes, each targeting a specific PRD failure mode:

1. **Problem Statement Rigor** — specific, testable, observable, names a specific user group, has evidence, does NOT prescribe a solution.
2. **Persona & Stakeholder Coverage** — goal-driven personas with constraints/behavior/success; every stakeholder represented; no "Everything User"; 2-6 meaningful personas.
3. **Feature Scoping Completeness** — in-scope / out-of-scope / deferred all present; features specific enough to estimate; MoSCoW prioritization that actually forces tradeoffs (not everything "Must"); no requirements-as-solutions (technical prescriptions that belong in architecture).
4. **Success Criteria Measurability** — every criterion has a target value AND a measurement method; tied to the problem statement; covers behavior/business/technical/adoption types.
5. **NFR Quantification** — categories addressed (performance, scalability, availability, security, accessibility, data retention, i18n, browser/device support, monitoring); quantified with numbers + conditions, not adjectives. Flag any category completely absent (or absent without an explicit N/A rationale).
6. **Constraint & Dependency Documentation** — technical/timeline/budget/team/regulatory constraints; each traceable to downstream impact; external integrations have documented API limits/costs/rate-limits/auth.
7. **Error & Edge Case Coverage** — sad paths for every feature with user input or external dependency; failure modes for integrations; concurrency/large-data/interrupted-state scenarios.
8. **Downstream Readiness for User Stories** — can stories be written without guesswork? features map ~1:N to stories; personas are story actors; business rules explicit enough for acceptance criteria.

## Severity
- **P0**: Breaks the next phase (user-stories) — cannot proceed or will produce wrong output.
- **P1**: Significant gap — stories can proceed but will make wrong assumptions.
- **P2**: Improvement — correct but could be clearer.
- **P3**: Polish.

Special context to weigh honestly:
- This is a DELIBERATELY BROAD v1 (the product owner chose breadth: many lenses, several overlays, all framework adapters, both capture backends, MCP in v1). §3 documents this as accepted scope risk with MoSCoW containment. Judge whether the Must-Have list is realistically "v1" or whether breadth undermines prioritization — this is a key thing to assess, not rubber-stamp.
- The PRD names specific technologies (TypeScript, React/Vue/Svelte, Axe-core, Lighthouse, Playwright, agent-browser, MCP). Assess whether each is legitimate product-scoping/inherited-from-vision vs. an architecture decision that shouldn't be in a PRD.

Be rigorous and honest. Flag genuine issues; don't invent problems to seem thorough. Zero or few findings is valid if the doc is strong. Verify claims against the actual text.

## Output Format
Respond with ONLY a JSON array (no prose before/after):
[
  {"severity":"P0|P1|P2|P3","pass":"<pass name>","location":"<section>","description":"<concrete issue>","suggestion":"<specific fix>"}
]

## DOCUMENT UNDER REVIEW (docs/plan.md) follows:

---

<!-- scaffold:prd v1 2026-05-30 -->

# surface — Product Requirements Document

> **Status:** v1 draft · depth 5 · **Sources:** `docs/vision.md` (North Star),
> `docs/idea.md` (candidate direction — appendix material translated into
> requirements). This PRD says **WHAT** surface must do and for whom; the
> architecture, ADRs, and specs own the **HOW**. Where this PRD and the vision
> conflict, the vision wins until explicitly revised.

---

## 1. Problem Statement

**Non-designer builders — and the AI agents and build pipelines that ship UI on their
behalf — produce interfaces at high volume that look finished but are not good, and
neither the builder nor the generator can tell.** AI-generated and hand-built UI
routinely ships invisible contrast failures, broken focus order, inconsistent spacing,
ambiguous affordances, missing empty/error states, and confident-but-wrong interaction
patterns. The builder cannot perceive these defects (no design vocabulary, standards, or
methods); the generator cannot guarantee their absence. There is no tool whose job is to
evaluate the **actually-built, running interface** against objective standards and hand
back **work an agent can execute and re-verify**.

**Falsifiable hypothesis:** If a non-designer (or an agent acting for them) points
surface at a built view and acts on its top finding, the interface measurably improves on
objective criteria (contrast/focus/target violations eliminated, judged-severity reduced)
**and** the builder/agent can confirm the fix landed via re-audit — without design
training. If acting on surface's output does *not* produce measurable improvement, or
users cannot trust its findings enough to act, the product has failed.

**Evidence this problem is real and urgent now:**
- AI build tools (v0, Bolt, Lovable, Cursor) have made "ship UI without a designer" the
  default; unvetted UI volume is climbing.
- Automated accessibility scanners catch only ~30–40% of WCAG issues and stop at
  mechanical violations — the usability/hierarchy/content layer is unaddressed.
- The **European Accessibility Act** (in force 28 Jun 2025; existing services must comply
  by Jun 2030; penalties up to €100k or 4% of revenue; active enforcement in FR/DE/NL)
  turns invisible UI defects from "someday churn" into "this-year liability."

## 2. Goals & Non-Goals

### Goals (v1)
1. Evaluate a built/running web interface against objective standards, separating
   **measured** (tool-confirmed) from **judged** (AI-interpreted) findings, both with
   evidence.
2. Produce a **prioritized, agent-executable backlog**: each finding becomes a scoped
   task mapped to files/components, with a concrete change and a re-runnable validation
   check.
3. **Close the loop**: re-audit confirms fixes landed and detects regressions, with
   stable finding identity across runs.
4. Serve **both** audiences from one evaluation — machine-clean structured I/O for the
   agent (primary adopter), plain-language self-explaining output for the human
   (beneficiary and authority on risky changes).
5. Ship **web-first** with broad-but-prioritized coverage of lenses, app-type overlays,
   framework adapters, capture backends, integrations, and an **MCP server** for native
   agent embedding.

### Non-Goals (v1)
- Not a design-from-scratch / blank-canvas generator (see §13 Anti-scope).
- Not a replacement for a human designer on brand identity, novel interaction paradigms,
  or high-stakes flows — surface raises the floor and flags the ceiling.
- Not a vanity-score generator — no single headline number; gating keys off findings by
  severity.
- Not a Figma/design-stage tool — surface evaluates the *built* artifact, post-MVP.
- Not native mobile or desktop app evaluation in v1 (web-first; mobile-web is in scope,
  native is deferred).

## 3. Scope Philosophy & Scope Risk (read this first)

The product owner has chosen a **broad horizontal v1** (multiple lenses, several app-type
overlays, all framework adapters, both capture backends, MCP server, multiple
integrations). This is deliberately more ambitious than a thin vertical slice and pushes
against the vision's own anti-vision ("not everything at once").

**This is accepted, with three containment mechanisms:**
1. **Web-first, hard.** None of the breadth extends beyond web. Native mobile/desktop,
   kiosk/TV, Figma ingestion, session-replay/analytics, and deep component-library
   analysis remain **deferred** (§14).
2. **Rigorous MoSCoW (§8).** Within the broad scope there is still a Must-Have critical
   path — the closed loop on web/React with measured accessibility — that defines release
   success. Should/Could items expand coverage but do not gate the release.
3. **Documented scope risk (§13, R-1).** Breadth is the single largest delivery risk;
   the phased plan (§15) front-loads the critical path and allows Should/Could items to
   slip without failing v1.

## 4. Target Users / Personas

The vision sets an **agent-first adoption** model with the human as **beneficiary and
authority of record**. The PRD keeps these as distinct personas (never an "Everything
User") and carries the **priority rule** forward: *machine-readable contracts govern
execution format; human trust governs risky/subjective decisions.*

### P1 — AI agent / build pipeline (PRIMARY ADOPTER)
- **Role:** An autonomous or semi-autonomous agent, CI job, or AI build pipeline that
  runs surface as an embedded step (MCP tool call, CLI in a script, CI gate).
- **Primary need:** Deterministic, structured I/O — stable finding IDs, machine-readable
  severity/confidence, file/component mappings, acceptance criteria, runnable validation
  checks — so it can detect → task → fix → re-audit without a human in the loop on
  low-risk findings.
- **Current behavior:** Runs mechanical scanners (no prioritization) or prompts an LLM
  for unstructured critique (not executable).
- **Constraints:** Cannot arbitrate taste; must escalate risky/subjective findings; needs
  bounded, parseable output and stable contracts.
- **Success:** Closes the loop on low-risk findings unattended; escalates only gated
  findings; ≥80% of low-risk fixes re-audit clean without human intervention.

### P2 — Non-designer builder (BENEFICIARY & AUTHORITY OF RECORD)
- **Role:** Founder, indie developer, product owner, or small-team engineer who shipped
  or is about to ship a real interface.
- **Primary need:** To know *the one thing to fix next*, in plain language, with evidence
  they can verify, and a way to confirm the fix — without learning design.
- **Current behavior:** Eyeballs it; asks a friend; pastes a screenshot into a chatbot for
  vague praise; runs Lighthouse and gets a number with no fix path; ships and hopes.
- **Constraints:** No design vocabulary/standards/methods; low time budget; easily
  overwhelmed by a long backlog; non-technical-about-design but technical-about-code.
- **Success:** Acts on the top finding in the same session, can articulate *why* it's
  better, and returns to re-audit after the next change.

### P3 — Secondary beneficiaries
- **Design-curious developer** leveling up (wants the *why*, cited heuristics).
- **Team without design QA** (wants an objective gate in review).
- **CI / platform maintainer** (wants a tunable quality gate that fails builds on the
  right findings without becoming noise).

> **Persona priority rule (carried from vision §4):** when human comprehension and agent
> execution conflict, risky/subjective/brand/critical-flow decisions defer to P2 (human);
> execution-format decisions defer to P1 (machine contract). User stories must preserve
> both personas distinctly.

## 5. Product Overview — the core concept

**Point surface at a view → it captures what it can → it walks the lenses → it emits
measured + judged findings, each with evidence → it sorts them into a prioritized,
agent-executable plan → the work gets done → it re-audits to confirm.** The unit of value
is the **closed loop**, not the report. surface degrades gracefully: with rich inputs it
*triangulates* (screenshot + DOM + source distinguish "looks wrong" from "is wrong" and
pin the fix location); with sparse inputs it does what it honestly can and *says what it
couldn't check*.

## 6. Functional Requirements

Organized by capability area. Each Must-Have feature states what it does **and** at least
one explicit out-of-scope boundary. Priorities are consolidated in §8 (MoSCoW).

### 6.1 Inputs & multimodal capture
- **FR-CAP-1 (Must):** Accept **static inputs** — source/markup, components, design tokens,
  Tailwind/theme config, raw HTML. *Out of scope:* compiling/running arbitrary build
  systems; surface reads, it does not build the project.
- **FR-CAP-2 (Must):** Accept **visual inputs** — screenshots and image files. *Out:*
  Figma frame ingestion (deferred §14).
- **FR-CAP-3 (Must):** Accept **dynamic inputs** — a live URL, localhost dev server, route
  path, DOM snapshot. Support **two interchangeable capture backends, auto-detected**:
  **Playwright** and **agent-browser** (vercel-labs; CDP-based, agent-oriented). Capture
  produces screenshots, DOM snapshot, accessibility tree, and computed styles. *Out:*
  authenticated multi-step flows requiring credentials in v1 beyond a single provided
  auth step (deferred refinement).
- **FR-CAP-4 (Must):** Accept **context inputs** — personas, task definitions, product
  docs, and existing **Scaffold artifacts** (vision, PRD, personas, UX spec, design-system,
  design tokens) as evaluation context and guardrails. *Out:* analytics / session-replay
  ingestion (deferred §14).
- **FR-CAP-5 (Should):** **Storybook** story ingestion as a capture source.
- **FR-CAP-6 (Must):** **Graceful degradation** — when inputs are sparse, surface runs the
  honest subset of lenses and explicitly reports what it could **not** check.
- **FR-CAP-7 (Should):** **Capture-backend rationale** — when agent-browser is present,
  prefer its deterministic element references (`@e1…`) as evidence anchors and for stable
  finding identity; use its computed-styles and accessibility-tree output for measured
  checks; use React component-tree inspection (when available) to aid file/component
  mapping.

### 6.2 Evaluation pipeline (phased stages)
A composable, depth-aware sequence. v1 stages:
- **FR-PIPE-1 (Must):** Discovery & **app-type classification** (determines which overlay
  and acceptance criteria apply).
- **FR-PIPE-2 (Must):** Persona / task definition (ingest existing, or establish minimal).
- **FR-PIPE-3 (Must):** Route / view inventory (enumerate what to evaluate).
- **FR-PIPE-4 (Must):** Capture (per §6.1).
- **FR-PIPE-5 (Must):** **Heuristic evaluation** (Nielsen-Norman-style usability inspection).
- **FR-PIPE-6 (Must):** **Tool-grounded accessibility audit** (Axe-core / Lighthouse /
  capture backend), interpreted — measured findings are produced/confirmed by tools.
- **FR-PIPE-7 (Must):** **Design-system & visual-design audit** (consistency, hierarchy,
  spacing/scale, tokens; measurable against provided tokens/design-system).
- **FR-PIPE-8 (Must):** **Content / microcopy audit** (clarity, reading level, tone, labels).
- **FR-PIPE-9 (Must):** **Responsiveness & state/edge-case audit** (breakpoints; empty /
  loading / error / success states).
- **FR-PIPE-10 (Should):** **Cognitive walkthrough** (step through key tasks as a
  first-time user).
- **FR-PIPE-11 (Should):** **Conversion / activation audit** (friction in
  business-critical paths).
- **FR-PIPE-12 (Could):** **Competitive-pattern & innovation-opportunity review.**
- **FR-PIPE-13 (Must):** **Findings synthesis → prioritized backlog → agent-ready plan.**
- **FR-PIPE-14 (Must):** **Post-fix validation / re-evaluation** (close the loop).

### 6.3 Multi-lens evaluation model
Each lens is tagged **measured** or **judged**.
- **FR-LENS-1 (Must):** v1 lenses — usability, **accessibility (measured)**, visual
  hierarchy, interaction design, content clarity, empty/loading/edge states,
  **responsiveness (partly measured)**, **design-system consistency (measurable against
  tokens)**.
- **FR-LENS-2 (Should):** information architecture, conversion clarity, trust &
  credibility, learnability, error prevention/recovery.
- **FR-LENS-3 (Could):** internationalization, inclusive design, platform conventions,
  product-strategy alignment, task completion, agent-implementability.
- **FR-LENS-4 (Must):** The lens set **flexes by app-type overlay and preset**.
- **FR-LENS-5 (Must):** Every finding declares its `method` (measured|judged) and carries
  evidence (screenshot region, DOM node/selector or element ref, tool result, and/or a
  cited heuristic). **A judged finding is never presented as measured.**

### 6.4 Best-practice knowledge base
- **FR-KB-1 (Must):** A curated, **inspectable** catalog of best-practice entries
  (`## Summary` / `## Deep Guidance`), injected per step by relevance to step + app type.
- **FR-KB-2 (Must):** v1 categories (web-relevant core): core heuristics, accessibility,
  forms, navigation, states (error/empty/loading), visual & content design, design
  systems, conversion, platform guidance (web), agent-implementation.
- **FR-KB-3 (Should):** dashboards, data-viz, e-commerce, SaaS onboarding, admin, search &
  discovery, trust & safety, i18n.
- **FR-KB-4 (Must):** Entries carry **source citations** and **freshness/volatility**
  metadata so the catalog is auditable and can be kept current.
- **FR-KB-5 (Could):** developer-tools, AI-products, marketplaces, regulated-domains,
  mobile categories.

### 6.5 App-type overlays
Each overlay shifts what "good" means (acceptance criteria per lens).
- **FR-OVL-1 (Must):** **Generic web** baseline overlay.
- **FR-OVL-2 (Must):** **SaaS dashboard**, **e-commerce storefront**, **marketing /
  landing** overlays (the three most common web archetypes).
- **FR-OVL-3 (Should):** **admin / internal tool**, **content / media** overlays.
- **FR-OVL-4 (Won't, v1):** **mobile app (native)** and **display / kiosk / TV** overlays
  (deferred §14). *Mobile-web is covered by responsive evaluation under the web overlays.*

### 6.6 Methodology presets & depth
- **FR-METH-1 (Must):** **1–5 depth scale** controlling thoroughness (views/tasks
  evaluated, multi-model use, whether browser/screenshot checks are required, lightweight
  report vs full implementation plan).
- **FR-METH-2 (Must):** Presets: `quick`, `mvp`, `standard`, `deep`, `accessibility-first`,
  `agent-ready`.
- **FR-METH-3 (Should):** `conversion-focused`, `design-system-focused`.
- **FR-METH-4 (Could):** `custom` (user-tuned lens/depth/integration mix).

### 6.7 Findings, scoring & prioritization
- **FR-SCORE-1 (Must):** Each finding is a structured record (candidate shape in
  `idea.md` appendix D — `Finding`: id, lens, type, method, title, rationale, cited
  heuristics, evidence[], dimensions{severity, confidence, effort, userImpact,
  businessImpact, a11yLegalRisk, evidenceQuality, agentImplementability}, location{file,
  component, selector}, gatedForHuman). *The exact schema is finalized in the specs.*
- **FR-SCORE-2 (Must):** Prioritize the backlog by combining severity, confidence, effort,
  and impact (candidate base: `priority = severity × userImpact × businessImpact ×
  confidence / effortWeight`, **boosted for `a11yLegalRisk`**), with **MMR-style
  selection** to diversify and avoid near-duplicate findings.
- **FR-SCORE-3 (Must):** **Trust guards** — judged findings with `confidence < threshold`
  are surfaced as **questions, not mandates**; `gatedForHuman` findings **never
  auto-execute**.
- **FR-SCORE-4 (Must):** **No vanity score** — surface does not emit a single headline
  quality number; prioritization is internal ordering only (anti-vision §13).
- **FR-SCORE-5 (Should):** **Multi-model review** (Claude / Codex / Gemini) reconciled by
  confidence to raise trust on judged findings (depth 4–5).
- **FR-SCORE-6 (Should):** **Self-grounding** — track and report surface's own judged-finding
  false-positive rate against measured ground truth and human verdicts on gated findings.

### 6.8 Output artifacts
- **FR-OUT-1 (Must):** Per-lens audit documents; prioritized findings as **both** machine
  (`findings.json`) and human (`findings.md`) forms; an **implementation backlog**; an
  **agent plan**; a **validation report**. *(Candidate paths in `idea.md` appendix E.)*
- **FR-OUT-2 (Should):** Opportunity map.
- **FR-OUT-3 (Must):** All human-facing artifacts explain findings in plain language with
  verifiable evidence; all machine artifacts use stable IDs and a documented schema.

### 6.9 Agent workflow / closed loop
- **FR-LOOP-1 (Must):** The closed loop — **detect → classify → prioritize → create task →
  attach context/screenshots → write acceptance criteria → define validation checks →
  (agent or human) implements → re-run evaluation → mark resolved / still-failing /
  regressed.**
- **FR-LOOP-2 (Must):** **Stable finding identity** across re-runs so status transitions
  (resolved / still-failing / regressed) are reliable.
- **FR-LOOP-3 (Must):** **Human gate** — risky/subjective/brand/critical-flow changes are
  flagged `gatedForHuman` and require human validation before execution.

### 6.10 Interfaces
- **FR-IF-1 (Must):** **CLI** mirroring Scaffold's idioms plus surface verbs (candidate set
  in `idea.md` appendix A): `init`, `run <step>`, `run all`, `next`, `status`, `capture`,
  `audit <lens> <target>`, `explain <finding-id>`, `backlog [--export]`, `validate`,
  `gate [--ci]`. Target/context flags: `--url`, `--localhost`, `--route`, `--screenshot`,
  `--component`, `--dom`, `--storybook`, `--persona`, `--task`, `--scaffold-docs`.
- **FR-IF-2 (Must):** **MCP server** exposing surface's capabilities as tools so agents
  embed it natively (per the agent-first GTM). *Exact tool schema → specs.*
- **FR-IF-3 (Must):** **Natural-language runner skill** so both humans and agents drive it
  conversationally (dual interface).
- **FR-IF-4 (Should):** `alternatives <target>` (bounded "generate better UI alternatives"
  on existing UI) and `diff <before> <after>` (before/after critique).
- **FR-IF-5 (Must):** **`.surface/` project state** — `state.json` (pipeline progress,
  finding identities), `config.yml` (preset/depth/stack/app-type/integrations),
  `decisions` log, `findings/`, `captures/`, `generated/` agent assets — parallel to
  `.scaffold/`.

### 6.11 Integrations
- **FR-INT-1 (Must):** **Axe-core, Lighthouse** (deterministic accessibility/perf
  grounding); **Playwright** and **agent-browser** (capture).
- **FR-INT-2 (Must):** **Issue-tracker export — GitHub Issues**.
- **FR-INT-3 (Should):** Linear / Jira export; **design-token parsers**; multi-model CLIs
  (Codex/Gemini) for FR-SCORE-5.
- **FR-INT-4 (Could):** Storybook (also FR-CAP-5); component-library analysis (shallow).
- **FR-INT-5 (Won't, v1 — deferred §14):** Figma API; visual-regression / screenshot
  diffing baselines; session-replay / analytics ingestion; deep component-library analysis.

### 6.12 Special modes
- **FR-MODE-1 (Must):** **"Explain it to a non-designer"** mode (per-finding plain-language
  teaching).
- **FR-MODE-2 (Should):** **Product-quality gate in CI**; **UX-regression testing** (via
  re-audit + stable identity).
- **FR-MODE-3 (Could):** before/after critique (`diff`), generate-better-alternatives,
  UX-debt tracking, design-system drift detection.

## 7. Sad paths & error scenarios
- **No / sparse inputs:** run the honest subset; report uncheckable lenses explicitly
  (FR-CAP-6). Never fabricate a measurement.
- **Capture backend unavailable / fails** (no Playwright, no agent-browser, URL
  unreachable): fall back to static + screenshot; emit a clear, exit-coded error; state
  which measured checks were skipped.
- **Target requires auth / JS-heavy / SPA route not reachable:** report partial capture;
  degrade lenses that needed live DOM.
- **Grounding tool disagrees with model judgment:** measured wins for measured facts; the
  model interprets, never overrides, a measurement.
- **Multi-model disagreement (depth 4–5):** reconcile by confidence; surface divergence as
  a question, not a silent pick.
- **Low-confidence judged finding:** surfaced as a question (FR-SCORE-3), not a mandate.
- **Re-audit can't match a prior finding** (DOM changed): mark identity break explicitly
  rather than guessing resolved/regressed.
- **Malformed config / unknown subcommand:** POSIX usage error, exit code 2 (NFR-CLI-1).

## 8. Feature Prioritization (MoSCoW)

**Must Have (release fails without these — the critical path):**
Multimodal capture incl. both backends auto-detected (FR-CAP-1..4,6); app-type
classification + 4 core overlays (generic, SaaS, e-commerce, marketing); pipeline stages
FR-PIPE-1..9,13,14; v1 lenses FR-LENS-1,4,5; knowledge base FR-KB-1,2,4; depth scale +
core presets (quick/mvp/standard/deep/accessibility-first/agent-ready); structured
findings + prioritization + trust guards + no-vanity-score (FR-SCORE-1..4); output
artifacts FR-OUT-1,3; closed loop + stable identity + human gate (FR-LOOP-1..3); CLI +
MCP server + runner skill + `.surface/` state (FR-IF-1,2,3,5); Axe/Lighthouse +
Playwright + agent-browser + GitHub Issues export (FR-INT-1,2); explain mode (FR-MODE-1);
**all framework adapters: React/Next + Vue + Svelte + framework-agnostic DOM/HTML.**

**Should Have:** cognitive walkthrough + conversion audit (FR-PIPE-10,11); FR-LENS-2
lenses; admin/content-media overlays; conversion-/design-system-focused presets;
multi-model review + self-grounding (FR-SCORE-5,6); opportunity map; Linear/Jira +
design-token parsers (FR-INT-3); CI gate + UX-regression (FR-MODE-2); Storybook
(FR-CAP-5); `alternatives` / `diff` (FR-IF-4).

**Could Have:** FR-PIPE-12; FR-LENS-3; FR-KB-3,5; `custom` preset; shallow
component-library analysis; FR-MODE-3.

**Won't Have (v1):** native mobile / kiosk-TV overlays; Figma ingestion; visual-regression
baselines; session-replay/analytics; deep component-library analysis. (See §14.)

## 9. Success Criteria (measurable)

Derived from vision §10 (directional) into PRD targets with measurement methods. Targets
are v1 acceptance-grade unless marked aspirational.

| # | Criterion | Target | Measurement |
|---|-----------|--------|-------------|
| SC-1 | Builder acts on top finding in-session | >50% of first-time runs end with the top finding addressed | Session/run telemetry (opt-in) or pilot-cohort study |
| SC-2 | Re-audit stickiness | ≥30% of projects re-audit within 7 days | `.surface/state.json` run history (opt-in telemetry) |
| SC-3 | Agent closes low-risk loop unattended | ≥80% of low-risk fixes re-audit clean without human intervention | Re-audit status transitions in pilot agent runs |
| SC-4 | Measured-finding determinism | 100% reproducible measured findings on unchanged input | Re-run same capture → identical measured set (CI test) |
| SC-5 | Judged false-positive rate | Single digits (%) | Self-grounding (FR-SCORE-6): judged vs measured ground truth + human verdicts on a labeled sample |
| SC-6 | Before/after improvement | On a sample of real AI-generated web apps: contrast/focus/target violations → 0 and judged-severity reduced after one fix cycle | Pre/post audit diff on a fixed sample set |
| SC-7 | Agent-led adoption signal | ≥1 AI build pipeline / CI flow runs surface as an embedded gate | Integration evidence |

**Failure indicators (even if it ships):** users run once and never return (output was a
lecture); surface's own judged findings prove unreliable (SC-5 fails) and users distrust
it; it's accurate but too high-friction so builders choose "do nothing"; it degenerates
into "Lighthouse with prettier output."

## 10. Non-Functional Requirements (quantified; each has target / measurement / threshold)

- **NFR-PERF-1 — Audit latency (excluding model inference):** `quick` preset on a single
  view completes tool-grounding + capture in **p95 < 30s** on a typical dev laptop.
  *Measure:* benchmark harness in CI. *Threshold:* 30–45s warns; >45s fails the perf gate.
- **NFR-DET-1 — Determinism of measured findings:** identical input ⇒ identical measured
  findings (SC-4). *Measure:* repeat-run CI test. *Threshold:* any nondeterminism in a
  measured finding is a release blocker.
- **NFR-TRUST-1 — Judged reliability:** judged false-positive rate in single digits (SC-5),
  continuously self-reported. *Threshold:* ≥15% triggers a trust review; the tool must
  never present a judged finding as measured (binary, zero-tolerance).
- **NFR-CLI-1 — POSIX conformance:** exit codes 0 success / 1 error / 2 usage; combinable
  short flags; `--` terminates parsing; `--json` machine-readable mode on every command.
  *Measure:* CLI contract tests. *Threshold:* any deviation breaks the agent contract = blocker.
- **NFR-MCP-1 — MCP stability:** documented, versioned tool schema; backward-compatible
  within a major version. *Measure:* schema snapshot tests. *Threshold:* breaking change
  without a major bump = blocker.
- **NFR-A11Y-STD-1 — Standards checked:** default target **WCAG 2.2 AA** (AA/AAA
  configurable; AA vs AAA tradeoffs explicit). *Measure:* rule coverage report. *Threshold:*
  AA rule set must be complete for v1.
- **NFR-SEC-1 — Safe by default:** read-only against target source; **no source/code
  exfiltration**; live capture honors **domain allowlists** (supported by agent-browser);
  network interception is opt-in. *Measure:* security review (OWASP-aligned). *Threshold:*
  any default-on exfiltration path = blocker.
- **NFR-PORT-1 — Capture portability:** auto-detect and run with **either** Playwright or
  agent-browser; degrade to static+screenshot when neither is present (FR-CAP-3,6).
  *Measure:* matrix test across {playwright, agent-browser, neither}. *Threshold:* the
  "neither" path must still produce a useful static audit.
- **NFR-FW-1 — Framework coverage:** stack-aware fixes verified for **React/Next, Vue,
  Svelte**; framework-agnostic DOM/HTML checks run on any stack. *Measure:* per-adapter
  fixture suite. *Threshold:* a fix that only works on one stack when others are claimed = bug.
- **NFR-I18N-1 (Should):** content/reading-level checks are locale-aware for at least
  English in v1; architecture supports additional locales. 
- **NFR-OBS-1 (Should):** surface emits structured run logs and a knowledge-gap signal when
  the KB lacks a needed topic (mirroring Scaffold's observe model).

## 11. Constraints
- **Technical:** TypeScript CLI (per `idea.md`; confirmed in `tech-stack`). Mirrors
  Scaffold's architecture (composable meta-prompts with YAML frontmatter assembled at
  runtime; per-step knowledge injection; `.surface/` state + dependency graph;
  `run`/`next`/`status` idioms). Depends on external tools (Axe-core, Lighthouse,
  Playwright, agent-browser) and multi-model CLIs (optional). **Open-source license must be
  compatible with agent-browser (Apache-2.0) and the rest of the toolchain.**
- **Composition:** Consumes Scaffold's design-system / design-token / UX-spec / vision /
  PRD artifacts as guardrails and context; **does not re-derive** the design system or
  re-write the UX spec — a built-UI contradiction of the spec is itself a finding.
- **Regulatory:** Accessibility is a first-class, legally-relevant dimension (EAA). surface
  **reduces accessibility legal risk and flags what needs human audit; it does not certify
  legal compliance** (honest-limit constraint).
- **Platform:** Web-first only in v1.
- **Team/timeline (assumption — confirm):** small open-source core team + community; no
  externally-imposed hard deadline. Phased plan (§15) is capability-ordered, not
  date-bound. *(Flagged as an open input, §16.)*

## 12. Dependencies
Axe-core, Lighthouse, Playwright, **agent-browser** (vercel-labs, Apache-2.0), an MCP
server SDK, framework adapters (React/Next, Vue, Svelte), GitHub Issues API (export),
optional Codex/Gemini CLIs (multi-model), optional design-token parsers and Storybook.

## 13. Risks & Anti-scope

**Risks (mitigations):**
- **R-1 Scope breadth (high):** broad v1 risks not nailing the closed loop. *Mitigate:*
  MoSCoW critical path (§8); web-first containment; phased plan lets Should/Could slip.
- **R-2 Grounding sufficiency (high):** if too little is measurable, surface is "just
  opinions." *Mitigate:* lead with measured findings; gate/question low-confidence;
  multi-model reconciliation; self-grounding accuracy reporting (SC-5).
- **R-3 Builder overwhelm (high):** a long backlog freezes P2. *Mitigate:* "one thing to
  fix next"; depth presets scaling output; plain-language explain mode.
- **R-4 Agent-adoption bet (high):** agent-first GTM may not materialize. *Mitigate:* MCP
  lowers embedding cost; human CLI path stands alone as fallback; watch the inverse.
- **R-5 Capture friction (medium):** two backends + auto-detect add surface area.
  *Mitigate:* static+screenshot first-class fallback; backends optional.
- **R-6 KB freshness (medium):** entries rot. *Mitigate:* citations + freshness metadata +
  knowledge-audit; KB-as-shared-standard to distribute maintenance.

**Anti-scope (what v1 will NOT do — from vision §8):** design-from-scratch generation;
replacing human designers on high-stakes work; vanity scoring; Figma/design-stage
critique; framework-locked fixes; "everything at once" beyond the web-first boundary.

## 14. Deferred (future releases — inform architecture, not v1 implementation)
Native mobile & desktop app evaluation; **kiosk / TV** and **native-mobile** app-type
overlays; **Figma API** ingestion; **visual-regression / screenshot-diff baselines**;
**session-replay / analytics** ingestion; **deep component-library analysis**;
authenticated multi-step flow capture; additional locales (i18n breadth). Architecture
must leave seams for these (extensible capture sources, overlay registry, integration
adapters) without committing to them in v1.

## 15. Phased Delivery Plan
- **v1.0 — Critical path (Must):** closed loop on web for **React/Next** with measured
  accessibility, core lenses, generic + 3 overlays, core presets, CLI + **MCP server** +
  runner skill, Axe/Lighthouse + both capture backends, GitHub Issues export, explain mode.
  *Vue + Svelte + framework-agnostic adapters land within v1.0 as parallel adapter work.*
- **v1.1 — Should items:** cognitive walkthrough + conversion audit, additional lenses &
  overlays, multi-model review + self-grounding, Linear/Jira, CI gate + UX-regression,
  Storybook, `alternatives`/`diff`.
- **v1.2 — Could items:** competitive/innovation review, remaining lenses & KB categories,
  `custom` preset, shallow component-library analysis, debt/drift modes.
- **v2 — Deferred (§14).**

## 16. Open Questions (carried from vision §12; some resolved here)
**Resolved by this PRD:** browser-automation weight (*both backends, auto-detect, static
fallback*); framework coverage (*React/Next + Vue + Svelte + agnostic*); MCP timing (*v1*);
scope breadth (*broad, contained — §3*).
**Still open (for ADRs / architecture / specs):**
- De-duplication across modalities (code/DOM/screenshot) without losing per-source evidence.
- Exact confidence & multi-model reconciliation thresholds (question-vs-assert).
- Concrete prioritization-scoring weights and MMR parameterization (internal ordering, not
  a headline score).
- KB authoring/sourcing/versioning/audit cadence.
- Adapter interface definition and how much stack-specific fix generation is in v1 vs later.
- Stable finding-identity algorithm across re-runs (DOM drift tolerance).
- CI gate semantics: which findings fail a build, and how teams tune it without noise.
- **Team size / timeline** (assumption in §11 — confirm to finalize the phased plan).

## 17. Traceability
Vision §3 → PRD §1 (problem); vision §4 → §4 (personas + priority rule); vision §5 → §5,
§9 (value/outcomes); vision §6 → §13 (competitive/anti-scope); vision §7 → guiding
principles honored across §6 (measured/judged, executable work, human gate, both
audiences, grounded evidence); vision §8 → §13 anti-scope + FR-SCORE-4; vision §9 → §11
(open-source, MCP packaging); vision §10 → §9 (success); vision §11 → §13 (risks); vision
§12 → §16. Innovation log (vision appendix) I1→§1/§6.1/§9, I2→§5/§13, I3→FR-IF-2, I4→
FR-SCORE-6/SC-5, I5→§1/§12, I6→§11, I7→FR-SCORE-4, I8→§4 personas.

---

*This PRD is the foundation for `user-stories`, `tech-stack`, `domain-modeling`,
architecture, and the specs. It says WHAT; downstream phases decide HOW.*
