<!-- scaffold:prd v1 2026-05-30 -->
<!-- scaffold:prd-innovation v1 2026-05-30 -->

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

**Evidence this problem is real and urgent now** *(sources captured during
`create-vision`/`innovate-vision` web research, 2026-05; figures are externally-sourced
and should be treated as validated-as-of-research, not internal measurement):*
- AI build tools (v0, Bolt, Lovable, Cursor) have made "ship UI without a designer" the
  default; unvetted UI volume is climbing. *(Source: 2026 AI-app-builder market coverage.)*
- Automated accessibility scanners catch only **~30–40% of WCAG issues** and stop at
  mechanical violations — the usability/hierarchy/content layer is unaddressed. *(Source:
  Deque/axe + accessibility-tooling comparisons, 2025–26.)*
- The **European Accessibility Act** (in force 28 Jun 2025; existing services must comply
  by Jun 2030; penalties up to €100k or 4% of revenue; active enforcement in FR/DE/NL)
  turns invisible UI defects from "someday churn" into "this-year liability." *(Source:
  EAA compliance guides / enforcement reporting, 2025–26.)*
- **Assumption needing first-party validation:** the *magnitude* of the non-designer
  builder's own time-loss/pain is inferred, not yet measured on a surface user cohort —
  SC-1/SC-6 (§9) are designed to validate it.

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
2. **Two-tier Must + rigorous MoSCoW (§8).** The Must-Have tier is split into a **v1.0
   Release Gate** (the closed loop on web for React/Next + framework-agnostic HTML with
   measured accessibility, CLI + MCP — this defines release success) and **v1.0
   Committed-but-non-gating** items (Vue/Svelte adapters, the second capture backend,
   broader overlays) that ship in v1.0 if ready but may slip to v1.1 without failing the
   release. Should/Could items expand coverage further and never gate.
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

### P3 — CI / platform maintainer (SECONDARY — distinct goals, gets full detail)
- **Role:** Engineer who owns the team's CI/build pipeline and decides what gates merges.
- **Primary need:** A **tunable** quality gate that fails builds on the *right* findings
  (e.g., new P0/P1 measured a11y violations) without becoming noise that the team learns
  to ignore or bypass.
- **Current behavior:** Runs Lighthouse/axe in CI for a pass/fail number, or has no UI
  gate at all; tunes thresholds by trial and error.
- **Constraints:** Must keep the gate fast and low-flake; needs config-as-code; can't have
  the gate block on subjective/judged findings (false-positive fatigue → bypass culture).
- **Success:** The gate catches regressions teams care about, is tuned once and trusted,
  and never blocks on a gated/subjective finding (FR-LOOP-3, FR-MODE-2).

### P4 — Other secondary beneficiaries
- **Design-curious developer** leveling up — wants the *why* and cited heuristics
  (served by explain mode, FR-MODE-1).
- **Small team without dedicated design QA** — wants an objective second opinion in code
  review; lower volume, same outputs as P2, no new requirements.

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
  `gate [--ci]`, `baseline` (snapshot debt — FR-RULE-6), `verdict <finding-id>` (adjudicate —
  FR-SCORE-8). Target/context flags: `--url`, `--localhost`, `--route`, `--screenshot`,
  `--component`, `--dom`, `--storybook`, `--auth-state <file>` (FR-CAP-8), `--persona`,
  `--task`, `--scaffold-docs`.
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

### 6.13 Product-level decision rules (defined now; exact algorithms deferred to specs)
These are **product rules** user-stories need to write acceptance criteria. The precise
formulas/thresholds remain open (§16) but the *behavioral contract* is fixed here:
- **FR-RULE-1 (Must):** **Confidence bands.** Judged findings fall into three bands —
  *assert* (high confidence → stated as a finding), *surface-as-question* (medium →
  presented as a question, not a mandate), *suppress-unless-deep* (low → only shown at
  depth 4–5). The exact numeric cutoffs are tunable (§16); the three-band behavior is fixed.
- **FR-RULE-2 (Must):** **Human-gate categories.** A finding is `gatedForHuman` (never
  auto-executed) if its change alters **meaning, brand, copy tone, or a critical/conversion
  flow**, OR it is a judged finding above a severity threshold. Everything else is
  agent-executable without a gate.
- **FR-RULE-3 (Must):** **Status-transition rules.** On re-audit, a tracked finding becomes
  *resolved* (no longer detected + its validation check passes), *still-failing* (still
  detected), or *regressed* (was resolved, now detected again). If the finding's anchor
  can't be matched (DOM drift), it is *identity-broken* and reported as such — never
  silently marked resolved.
- **FR-RULE-4 (Must):** **Default CI gate policy.** `surface gate` fails the build on
  **new measured P0/P1 findings** by default; **never** fails on judged or `gatedForHuman`
  findings; thresholds are config-as-code and tunable per team (FR-MODE-2, P3 persona).
- **FR-RULE-5 (Must):** **Finding-identity inputs.** Identity is derived from a stable
  combination of lens + issue-type + location anchor (preferring a deterministic element
  ref where the capture backend provides one) so the same defect keeps its ID across runs.
- **FR-RULE-6 (Must, from innovate-prd I1):** **Baseline & waivers.** A finding status of
  **`ignored`** is added alongside resolved/still-failing/regressed. `surface baseline`
  snapshots current findings into a baseline file so `surface gate` fails only on **net-new
  or expired** findings, not accepted debt. A waiver records finding ID, reason, owner, and
  optional expiry; expired waivers re-activate the finding. This makes the CI gate adoptable
  on a real, debt-laden app (P3 persona) instead of failing permanently on day one.

### 6.14 Accepted innovations (innovate-prd, 2026-05-30)
Feature-level additions approved in the innovation pass. Dispositions in §8/§14/§15; full
log + Q/A timestamps in `docs/prd-innovation.md`.
- **FR-CAP-8 (Must — RELEASE GATE; innovate-prd I2):** **Auth/session injection.** The CLI
  and MCP accept injected session state (cookies / localStorage / headers, e.g. Playwright
  storage-state format) via `--auth-state <file>` (or env), so capture can reach routes
  behind a login. Most real apps — and the committed SaaS-dashboard overlay — are otherwise
  unauditable. *Scope:* single-step session injection only; multi-step interactive login
  flows remain deferred (§14). *Success:* an authenticated dashboard route captures and
  audits the same as a public route.
- **FR-CAP-9 (Should/Deferred; innovate-prd I3):** **Multi-state capture.** Evaluate UI
  states beyond initial load. *v1.x committed:* named **task-flow recipes** (declared steps —
  click/type/navigate — each reachable state captured; unreachable steps reported). *Deferred
  (§14):* automated **interactive-state discovery** (auto-exercise dropdowns/modals/hover/
  validation). Defect density is highest in these hidden states.
- **FR-CAP-10 (Should; innovate-prd I8):** **Dual-theme evaluation.** Auto-toggle
  `prefers-color-scheme` to capture and audit **both light and dark**, mapping contrast/visual
  findings to their theme. Trivial cost; contrast failures frequently hide in the non-default
  theme.
- **FR-CAP-11 (Must — committed; innovate-prd I5):** **Sensitive-data redaction.**
  Configurable redaction of PII/secrets/proprietary content in captures **and** exports, with
  visible redaction markers and an option to retain full evidence **locally only**. Extends
  NFR-DATA-1; removes an adoption blocker for auditing real apps.
- **FR-SCORE-7 (Must — committed; innovate-prd I6):** **Deterministic fix snippets.** For
  **measured** findings whose correct fix is computable (compliant contrast hex, missing
  `aria-*`, touch-target min-size), the finding carries an optional **`suggestedPatch`** so
  agents apply trivial fixes with near-zero hallucination — and non-designers get a concrete
  change. *Out of scope:* auto-generated patches for **judged** findings (those stay
  proposed/gated).
- **FR-SCORE-8 (Should; innovate-prd I7):** **Human verdict / adjudication loop.** Structured
  commands + finding fields to **accept / reject / correct / defer** a finding, with rationale
  and reuse policy, feeding self-grounding metrics (FR-SCORE-6) and future prioritization.
- **FR-OUT-4 (Must — committed; innovate-prd I4):** **CI-native reporters.** Emit **SARIF**
  and **GitHub Checks / PR annotations** so findings appear inline at code review (not only as
  a separate issue backlog). Local artifacts remain the source of truth. Strong fit with the
  agent-first GTM and P3 persona.

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
  rather than guessing resolved/regressed (FR-RULE-3).
- **Malformed config / unknown subcommand:** POSIX usage error, exit code 2 (NFR-CLI-1).
- **Integration export fails** (GitHub/Linear/Jira API down, auth expired, rate-limited):
  retry with backoff; on persistent failure, write the backlog locally, report which items
  did not sync, and exit non-zero — never lose findings.
- **MCP tool error / version mismatch:** return a structured error to the calling agent;
  refuse silently-incompatible schema versions (NFR-MCP-1).
- **Malformed or stale Scaffold artifacts** (design-system/UX-spec): degrade to
  spec-less evaluation and note that guardrail-based findings were skipped.
- **Storybook ingestion failure:** skip that source, continue with others, report the gap.
- **Oversized route inventory** (hundreds of routes): cap per the depth/preset, evaluate a
  prioritized subset, and **explicitly report what was not evaluated** (no silent truncation).
- **LLM context-window overflow** (large DOM / accessibility tree / component tree exceeds
  the judging model's context): degrade gracefully — chunk/subset the input or fall back to
  **measured-only** findings for that view, and state that judged coverage was reduced.
- **Interrupted run / concurrent re-audit on the same `.surface/` state:** state access is
  guarded (lock or equivalent) so two runs cannot corrupt `state.json` or finding identity;
  an interrupted run is resumable, not left half-written.

## 8. Feature Prioritization (MoSCoW)

The Must-Have tier is **split into two sub-tiers** to resolve the breadth-vs-critical-path
tension (§3, R-1) and keep MoSCoW's tradeoff mechanics real:

**Must Have — v1.0 RELEASE GATE (release fails without these):**
The closed loop end-to-end on web for **React/Next + framework-agnostic DOM/HTML**, with
**one auto-detected capture backend** (Playwright *or* agent-browser, with static+screenshot
fallback — FR-CAP-1,2,4,6); app-type classification + **generic overlay** (FR-PIPE-1,
FR-OVL-1); pipeline stages FR-PIPE-2..9,13,14; v1 lenses FR-LENS-1,4,5; knowledge base
FR-KB-1,2,4; depth scale + core presets (quick/mvp/standard/deep/accessibility-first/
agent-ready); structured findings + prioritization + trust guards + no-vanity-score
(FR-SCORE-1..4); output artifacts FR-OUT-1,3; closed loop + stable identity + human gate
(FR-LOOP-1..3); **CLI + MCP server + runner skill + `.surface/` state** (FR-IF-1,2,3,5);
Axe/Lighthouse grounding + GitHub Issues export (FR-INT-1,2); explain mode (FR-MODE-1);
**auth/session injection** for capturing routes behind a login (FR-CAP-8, innovate-prd I2 —
elevated to the gate because most real apps and the committed SaaS overlay need it).

**Must Have — v1.0 COMMITTED (non-gating — ship in v1.0 if ready, else slip to v1.1
without failing the release):**
**Vue + Svelte adapters**; the **second capture backend** (so both Playwright *and*
agent-browser are supported, FR-CAP-3); **SaaS dashboard + e-commerce + marketing
overlays** (FR-OVL-2); plus accepted innovations — **baseline & waivers** (FR-RULE-6, I1),
**SARIF / PR annotations** (FR-OUT-4, I4), **sensitive-data redaction** (FR-CAP-11, I5),
**deterministic fix snippets** for measured findings (FR-SCORE-7, I6). These expand coverage
but do not block the gate; if they slip, v1.0 still ships a complete closed loop on
React/Next + agnostic HTML.

**Should Have:** cognitive walkthrough + conversion audit (FR-PIPE-10,11); FR-LENS-2
lenses; admin/content-media overlays; conversion-/design-system-focused presets;
multi-model review + self-grounding (FR-SCORE-5,6); opportunity map; Linear/Jira +
design-token parsers (FR-INT-3); CI gate + UX-regression (FR-MODE-2); Storybook
(FR-CAP-5); `alternatives` / `diff` (FR-IF-4); accepted innovations — **task-flow recipe
capture** (FR-CAP-9, I3), **dual-theme evaluation** (FR-CAP-10, I8), **human verdict /
adjudication loop** (FR-SCORE-8, I7).

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
| SC-5 | Judged false-positive rate | **< 10%** on a labeled sample of **≥ 100 judged findings** | Self-grounding (FR-SCORE-6): judged findings vs measured ground truth + human verdicts on the labeled sample |
| SC-6 | Before/after improvement | On a fixed benchmark of **≥ 5 real AI-generated web apps**: measured contrast/focus/target violations driven to **0**, and **median judged severity drops by ≥ 1 level** after one fix cycle | Pre/post audit diff on the fixed benchmark set, same captures |
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
- **NFR-SCALE-1 — Audit scale:** a single run handles up to a **configured max routes/views
  per run** (default e.g. 50, raised by depth/preset); beyond that, evaluate a prioritized
  subset and report what was skipped (§7). *Measure:* run against a large fixture site.
  *Threshold:* must not OOM or hang; silent truncation is a bug.
- **NFR-DATA-1 — Data retention & privacy:** captures (DOM, screenshots, source) may contain
  PII or proprietary code. **Local-only by default** — nothing leaves the machine except
  (a) content the user explicitly sends to a configured model/integration and (b) issue
  exports the user requests. Captures live under `.surface/captures/` and are **ephemeral
  per run unless the user opts to retain**; a documented retention/purge default applies.
  *Measure:* security/privacy review. *Threshold:* any default-on transmission of captured
  content to a third party without explicit user action = blocker.
- **NFR-BROWSER-1 — Capture support matrix:** dynamic capture supports current Chrome/
  Chromium (both backends), with a documented minimum version; static/screenshot inputs are
  browser-agnostic. Responsive evaluation covers a documented viewport matrix
  (mobile/tablet/desktop breakpoints). *Threshold:* a claimed viewport that isn't actually
  tested = bug.
- **NFR-OWNOUT-1 — surface's own output quality:** human-facing artifacts (CLI output,
  `findings.md`, reports) are themselves readable and accessible — plain language, no
  reliance on color alone, terminal output degrades without ANSI. (We hold our own output to
  the standard we audit.) *Measure:* dogfood surface on its own reports where applicable.
- **NFR — Not applicable (explicit, with rationale):** **Availability/uptime SLA, RTO/RPO** —
  surface is a locally-run CLI/agent tool, not a hosted service; the only network surface is
  the optional MCP server (covered by NFR-MCP-1) and user-invoked integrations. **Concurrent
  multi-user sessions / horizontal scaling** — N/A for a local tool; "scale" is bounded by
  NFR-SCALE-1 (routes per run), not user count. These are recorded as N/A so downstream
  phases don't treat them as forgotten.

## 11. Constraints
- **Technical (externally-observable requirements — implementation choices deferred):**
  The PRD requires the *user-/agent-facing* contract — Scaffold-mirroring `run`/`next`/
  `status` idioms, a user-visible `.surface/` state directory, an MCP server interface, and
  composability with Scaffold artifacts. **Implementation-language and internal runtime
  architecture (e.g., "TypeScript CLI," meta-prompt assembly engine) are NOT decided by this
  PRD** — `idea.md` proposes TypeScript and a Scaffold-like engine, but those belong to
  `tech-stack` and architecture. Required *external* dependencies are listed in §12.
- **Licensing:** the chosen open-source license must be compatible with key dependencies
  (e.g., agent-browser is Apache-2.0) and the wider toolchain. *(License choice itself →
  tech-stack.)*
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

Each dependency notes status, auth model, cost/limits, offline behavior, and product
impact if unavailable. (Exact min-versions are pinned in `tech-stack`/architecture.)

| Dependency | Status | Auth | Cost / rate limits | Offline / unavailable behavior | Impact if absent |
|---|---|---|---|---|---|
| **Axe-core** | Required (gate) | none | free, local | runs locally | No measured a11y grounding → release-gate failure |
| **Lighthouse** | Required (gate) | none | free, local | runs locally | Lose perf-perception/a11y signals |
| **Playwright** *or* **agent-browser** (≥1) | Required (gate); both = committed | none (local browser) | free; browser binary install cost | fall back to static+screenshot (NFR-PORT-1) | Lose live-DOM measured checks; static path still works |
| **agent-browser** (vercel-labs) | Committed | none; domain allowlist | free, Apache-2.0 | optional backend | Lose deterministic `@e` refs / React-tree mapping advantages |
| **MCP server SDK** | Required (gate) | n/a | free | n/a | No agent-native embedding → fails the agent-first gate |
| **Framework adapters** (React/Next gate; Vue/Svelte committed) | Mixed | n/a | free | agnostic DOM/HTML always works | Lose stack-aware fixes for that framework |
| **GitHub Issues API** (export) | Required (gate) | OAuth/token (user-provided) | free tier; **rate-limited** (back off, batch) | write backlog locally, report unsynced (§7) | No GitHub export; local backlog still produced |
| **Linear / Jira API** (export) | Should | API token (user) | per-vendor limits | local fallback | No Linear/Jira export |
| **Model inference (judged findings)** | Required for judged | **BYO API key / local model** (user-provided via env) | **user bears inference cost**; provider rate limits | judged lenses degrade to measured-only | No judged findings; measured findings still produced |
| **Codex / Gemini CLIs** (multi-model) | Should (depth 4–5) | each CLI's own auth (BYO) | user bears cost | reconciliation falls back to single-model | Lower confidence on judged findings |
| **Design-token parsers / Storybook** | Should/Could | none | free | skip that source, report gap | Weaker design-system grounding / fewer capture sources |

**Key contract:** surface ships no inference of its own — the user supplies model
credentials (BYO key) or a local model; surface never transmits captured content to a model
or tracker without explicit user configuration (NFR-DATA-1).

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
**multi-step interactive login flows** (single-step auth-state injection IS in the gate,
FR-CAP-8 — only multi-step interactive login is deferred); **automated interactive-state
discovery** (auto-exercising dropdowns/modals/hover — the deferred half of FR-CAP-9; named
task-flow recipes are committed); **monorepo / multi-app target resolution** (innovate-prd
I9 — deferred, noted); additional locales (i18n breadth). Architecture must leave seams for
these (extensible capture sources, overlay registry, integration adapters) without
committing to them in v1.

## 15. Phased Delivery Plan
- **v1.0 Release Gate (Must — blocks release):** closed loop on web for **React/Next +
  framework-agnostic DOM/HTML** with measured accessibility, core lenses, **generic
  overlay**, core presets, CLI + **MCP server** + runner skill, Axe/Lighthouse + **one
  capture backend** (static+screenshot fallback), **auth/session injection** (FR-CAP-8),
  GitHub Issues export, explain mode.
- **v1.0 Committed (non-gating — in v1.0 if ready, else v1.1):** **Vue + Svelte adapters**,
  the **second capture backend** (both Playwright and agent-browser), **SaaS / e-commerce /
  marketing overlays**, and accepted innovations **baseline & waivers** (I1), **SARIF / PR
  annotations** (I4), **sensitive-data redaction** (I5), **deterministic fix snippets** (I6).
- **v1.1 — Should items:** cognitive walkthrough + conversion audit, additional lenses &
  overlays, multi-model review + self-grounding, Linear/Jira, CI gate + UX-regression,
  Storybook, `alternatives`/`diff`, **task-flow recipe capture** (I3), **dual-theme eval**
  (I8), **human verdict loop** (I7).
- **v1.2 — Could items:** competitive/innovation review, remaining lenses & KB categories,
  `custom` preset, shallow component-library analysis, debt/drift modes.
- **v2 — Deferred (§14).**

## 16. Open Questions (carried from vision §12; some resolved here)
**Resolved by this PRD:** browser-automation weight (*both backends, auto-detect, static
fallback*); framework coverage (*React/Next + Vue + Svelte + agnostic*); MCP timing (*v1*);
scope breadth (*broad, contained — §3*).
**Still open (for ADRs / architecture / specs)** — note: the *product-level behavior* for
several of these is now fixed in §6.13 (FR-RULE-1..5); what remains open is the *algorithm/
threshold*, not the contract:
- De-duplication across modalities (code/DOM/screenshot) without losing per-source evidence.
- Exact confidence cutoffs for the three bands (FR-RULE-1) & multi-model reconciliation math.
- Concrete prioritization-scoring weights and MMR parameterization (internal ordering, not
  a headline score — FR-SCORE-4).
- KB authoring/sourcing/versioning/audit cadence.
- Adapter interface definition and how much stack-specific fix generation is in v1 vs later.
- Stable finding-identity algorithm across re-runs (DOM-drift tolerance; contract in FR-RULE-5).
- CI gate tuning specifics (default policy fixed in FR-RULE-4; per-team config surface open).
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
