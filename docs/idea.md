# surface — Product Idea

> **What this document is.** This is the seed input for the Scaffold pipeline — the
> raw material that `scaffold run create-vision` → `create-prd` → `adrs` →
> `system-architecture` → the specs → `implementation-plan` will expand and
> formalize. It is written at **idea / vision altitude**: it states intent,
> direction, and the thinking behind the concept. It deliberately does **not** lock
> architecture, freeze data schemas, or write production code. Where prescriptive
> detail exists (CLI flags, file trees, type shapes, scoring formulas, sample
> files), it has been moved into the **Appendix: candidate direction** and labeled
> as initial thinking for the downstream pipeline to refine, challenge, or replace.

---

## 1. Elevator pitch

**`surface` is the tool that makes a non-designer's already-built app look and feel like a designer made it.** It is a TypeScript CLI — and a sibling to Scaffold — that points at a real, running piece of UI (a route, a component, a screenshot, a Figma frame, a Storybook story, a live URL, a local dev server) and audits, scores, and optimizes everything between the screen and the user's eyes. It evaluates that interface against current best practices *for that specific kind of application*, grounds every claim it can in real tooling rather than taste, and turns its findings into a prioritized, agent-executable plan of concrete changes. The change it creates: a founder, developer, or AI agent who knows nothing about design points `surface` at a view and ends up with a measurably better, more professional, more usable, more accessible interface — without having to learn design themselves.

## 2. The problem & why it matters

Three forces are converging, and they all land on the same gap.

**AI now generates UI faster than anyone can vet it.** Agents and AI-assisted builders produce interfaces at high volume and high plausibility. The output *looks* finished — it compiles, it renders, it demos — but plausibility is not quality. AI-generated UI routinely ships invisible contrast failures, broken focus order, inconsistent spacing, ambiguous affordances, missing empty/error states, and confident-but-wrong interaction patterns. Nobody on the team is positioned to catch it, because the people shipping it are the same people who can't see the problems.

**Non-designers can't evaluate UX, and they know it — or worse, they don't.** A founder or solo developer can tell when something feels "off" but usually can't name *what*, *why*, or *how to fix it*. They lack the vocabulary (hierarchy, affordance, Gestalt grouping, reading level), the standards (WCAG, touch-target minimums, contrast ratios), and the methods (heuristic evaluation, cognitive walkthrough) that a designer would bring. Generic AI advice doesn't close this gap — it produces tasteful-sounding paragraphs with no evidence, no prioritization, and no path to a fix.

**A specific gap opens the moment an MVP exists.** Spec-stage design work — the kind Scaffold already does with `design-system`, `ux-spec`, and `review-ux` — happens *before* the UI is built. But once real UI exists, a different problem starts: the built thing drifts from the spec, accumulates UX debt, and is never re-evaluated against the standards it was supposed to meet. There is no tool whose job is to look at the *actually-built* interface, hold it to objective standards, and hand back work an agent can execute. That post-MVP evaluation gap is where `surface` lives.

Why it matters: UI quality is not cosmetic. It determines whether people can complete tasks, whether they trust the product, whether the product is legally accessible, and whether it converts. When the builder can't see quality and the generator can't guarantee it, quality silently erodes — and the cost surfaces later as churn, support load, abandoned flows, and accessibility liability.

## 3. Who it's for

**Primary persona — the non-designer builder.** A founder, indie developer, product owner, or small-team engineer who has shipped (or is about to ship) a real interface and wants it to be good, but has no design training and no designer on staff. They are capable and motivated; they are not stupid about design, they are *unsighted* about it. `surface` must meet them as an interactive, self-explaining guide that never overwhelms — it teaches as it audits, prioritizes ruthlessly so they always know the one thing to fix next, and explains its reasoning in plain language with evidence they can verify with their own eyes.

**First-class persona — the AI agent.** Agents are not an afterthought audience; they are a primary user. An agent driving `surface` needs deterministic, structured I/O: stable finding identifiers, machine-readable severity and confidence, file/component mappings, acceptance criteria, and validation checks it can run to prove a fix worked. The same evaluation that *explains itself* to a human must *serialize cleanly* for a machine. This dual audience is a hard design constraint, not a nice-to-have.

Secondary beneficiaries fall out naturally: design-curious developers leveling up, teams without dedicated design QA, and toolchains (CI, agent fleets) that want an objective UI quality gate.

## 4. What makes it different

- **It is a sibling to Scaffold, not a feature of it.** Scaffold builds the systemic bones — architecture, data model, core flows, implementation plan. `surface` specializes in the last mile between the screen and the eye. Same philosophy, same idioms, complementary scope. (See §5.)
- **Versus a generic AI prompt ("make this UI better").** A prompt gives you opinions. `surface` walks an explicit, inspectable catalog of heuristics and standards, separates what it *measured* from what it *judged*, attaches evidence to both, and prioritizes the result for someone who can't arbitrate design debates. It is auditable; a prompt is not.
- **Versus a plain accessibility scanner (Axe, Lighthouse alone).** Scanners find mechanical violations and stop. `surface` *uses* those scanners as one grounding input among many, then layers usability, visual hierarchy, interaction design, content clarity, conversion, and platform-convention judgment on top — and turns all of it into executable work. The scanner is a sensor; `surface` is the whole instrument.
- **Best-practice-driven *and* deterministically grounded.** This is the core differentiator and it cuts both ways. Findings that *can* be checked by a machine are checked by a machine (contrast, focus order, layout shift, touch targets, reading level). Findings that require judgment are clearly labeled as judgment and backed by named heuristics and visible evidence. `surface` is built specifically to **reduce the risk of low-quality AI-generated UI by holding it to objective standards** — including its own AI's output.

## 5. Relationship to Scaffold

`surface` deliberately mirrors Scaffold's architecture so the two feel like one toolchain. The shared shape:

- **Composable meta-prompts with YAML frontmatter, assembled at runtime** — each evaluation step is a prompt template with declared `dependencies`, `outputs`, and an attached `knowledge-base` list, assembled with the right context for the run.
- **A curated knowledge base injected per step** — best-practice entries (with `## Summary` and `## Deep Guidance` sections) selected by relevance to the step and the app type.
- **Methodology presets and a 1–5 depth scale** controlling thoroughness.
- **A state file and dependency graph under a parallel `.surface/` directory**, echoing Scaffold's `.scaffold/` (`state.json`, `config.yml`, a decisions log, generated agent assets).
- **The same `run` / `next` / `status` idioms** for driving and inspecting the pipeline.
- **Greenfield/brownfield awareness** — here, "brownfield" is the normal case: the UI already exists. `surface` adapts to how much context it's given.
- **Multi-model review** (Claude / Codex / Gemini) reconciled by confidence, used to raise trust on judged findings.
- **A dual interface** — the raw CLI plus a natural-language runner skill — so both humans and agents drive it.

**The seam — and it matters.** Scaffold *already* has `design-system`, `ux-spec`, and `review-ux`. Those run at the **spec / planning** stage, before code exists: they decide what the design *should* be. `surface` fills the complementary gap — **post-MVP evaluation of the UI that actually got built.** The two should compose, not duplicate:

- `surface` **consumes** Scaffold's design-system and design-token artifacts as *guardrails* — the built UI is graded against the system the project already committed to, so "inconsistency" is measured against a real source of truth rather than invented.
- `surface` **ingests** existing Scaffold artifacts — vision, PRD, personas, UX spec — as *evaluation context*, so its judgments are anchored to who the product is for and what it's trying to achieve, not to generic ideals.
- `surface` **does not re-derive** the design system or re-write the UX spec. When the built UI contradicts the spec, that contradiction is itself a finding.

A natural lifecycle: Scaffold takes an idea to a built MVP; `surface` takes the built MVP to a polished, accessible, professional product and keeps it there as it evolves.

## 6. How it works (the core concept)

The loop is simple to say and rich to execute: **point `surface` at a view → it walks the lenses → it produces measured + judged findings, each with evidence → it sorts them into a prioritized, agent-executable plan → the work gets done → it re-audits to confirm.**

**The multimodal input model.** `surface` accepts whatever you can give it and degrades gracefully when inputs are missing:

- **Static inputs** — source code and markup, components, design tokens, Tailwind/theme config, raw HTML.
- **Visual inputs** — screenshots, Figma frames, Storybook stories.
- **Dynamic inputs** — a live URL, a localhost dev server, a route path, a DOM snapshot, a Playwright trace.
- **Context inputs** — personas, task definitions, product docs, existing Scaffold artifacts, and analytics / session-replay data.

When several inputs are present, `surface` **triangulates** — screenshot + DOM + source code together let it distinguish "looks wrong" from "is wrong" and pin a finding to the exact place it must be fixed. When inputs are sparse, it does the most it honestly can and *says what it couldn't check* rather than guessing.

**Measured vs. judged, always separated.** Every finding is tagged by how it was reached. *Measured* findings come from or are confirmed by real tools — contrast ratios, focus order, layout shift, touch-target sizes, reading level, performance-perception signals. *Judged* findings come from AI interpretation against named heuristics. Both carry evidence (a screenshot region, a DOM node, a tool result, a cited heuristic); neither is presented as the other. The AI's job on measured findings is to *interpret, prioritize, and explain* — not to invent the measurement.

**Output is work, not a lecture.** The pipeline ends in concrete, scoped tasks mapped to specific files/components, with the change to make and the check that proves it's done — ready for a human or an agent to execute, then for `surface` to re-run and close the loop.

## 7. Guiding principles

These five are the spine of the product. Every capability should trace back to one of them.

1. **Best-practice-driven, not vibes.** Every evaluation walks an explicit, inspectable catalog of heuristics and standards. Quality is measured against objective criteria — contrast, Gestalt grouping, spacing/scale tokens, touch-target minimums, reading level — not personal taste. If `surface` can't name the principle behind a finding, the finding doesn't ship.
2. **Ground AI judgment in deterministic tooling.** This is the primary defense against hallucinated UX advice. Anything verifiable mechanically (accessibility, contrast, performance perception, focus order, layout shift) is produced or confirmed by real tools (Axe-core, Lighthouse, Playwright). The AI interprets, prioritizes, and explains; it does not fabricate measurements. **Measured** and **judged** findings are always separated, and both carry evidence.
3. **Dual audience, equally served.** Equally usable by a non-designer owner (interactive, self-explaining, never overwhelming) and by an AI agent (deterministic, structured I/O). Neither audience is a second-class citizen, and the design must satisfy both at once.
4. **Agent-executable, stack-aware output.** Findings become concrete, scoped tasks mapped to specific files/components, with concrete changes and validation checks. The output is framework-flexible (React / Next / Vue / Svelte / vanilla) via adapters — Tailwind edits are one example among many, not the assumption.
5. **Human-in-the-loop for risky changes.** `surface` proposes, and flags what needs human validation. Agents never silently make subjective or high-risk UX changes; anything that alters meaning, brand, or critical flow passes through a gate.

## 8. Capabilities & feature concepts

*Described as intended capabilities and directions — not locked specifications. The pipeline's job is to formalize these.*

### A phased evaluation pipeline

A sequence of focused stages, each composable and depth-aware:

1. **Discovery & app-type classification** — figure out what kind of app this is (it changes what "good" means).
2. **Persona / task definition** — establish (or ingest) who the user is and what they're trying to do.
3. **Route / view inventory** — enumerate what there is to evaluate.
4. **Capture** — gather screenshots, DOM, traces, tokens as available.
5. **Heuristic evaluation** — Nielsen-Norman-style usability inspection.
6. **Cognitive walkthrough** — step through key tasks as a first-time user.
7. **Tool-grounded accessibility audit** — Axe-core / Lighthouse / Playwright, interpreted.
8. **Design-system & visual-design audit** — consistency, hierarchy, spacing/scale, tokens.
9. **Content / microcopy audit** — clarity, reading level, tone, labels.
10. **Responsiveness & state/edge-case audit** — breakpoints plus empty / loading / error / success states.
11. **Conversion / activation audit** — friction in the paths that matter to the business.
12. **Competitive-pattern & innovation-opportunity review** — where conventions help, and where there's room to do better.
13. **Findings synthesis → prioritized backlog → agent-ready plan.**
14. **Post-fix validation / re-evaluation** — close the loop.

### The multi-lens evaluation model

A view is examined through many lenses, each tagged **measured** or **judged**: usability, accessibility *(measured)*, visual hierarchy, interaction design, information architecture, content clarity, conversion clarity, learnability, error prevention/recovery, responsiveness *(partly measured)*, empty/loading/edge states, trust & credibility, internationalization, inclusive design, design-system consistency *(measurable against tokens)*, platform conventions, product-strategy alignment, task completion, and agent-implementability. The lens set itself flexes by app type and preset.

### A best-practice knowledge base

A curated, inspectable catalog spanning: core heuristics, accessibility, forms, navigation, dashboards, data visualization, e-commerce, SaaS onboarding, admin panels, mobile, AI products, developer tools, regulated domains, marketplaces, search & discovery, design systems, visual & content design, internationalization, error/empty/loading states, trust & safety, conversion, platform guidance, and agent-implementation guidance. Entries are injected per step by relevance, mirroring Scaffold's knowledge model.

### App-type overlays

Each overlay shifts what "good" means: **e-commerce storefront**, **SaaS dashboard**, **marketing / landing**, **mobile app**, **content / media**, **admin / internal tool**, and a **display / kiosk / TV** type. The same lens can have very different acceptance criteria across overlays (e.g., touch targets and glanceability matter more on kiosk/TV; checkout friction dominates e-commerce).

### Methodology presets & depth

Presets: `quick`, `mvp`, `standard`, `deep`, `accessibility-first`, `conversion-focused`, `design-system-focused`, `agent-ready`, and `custom`. A **1–5 depth scale** controls thoroughness — number of views/tasks evaluated, whether multiple models are used, whether screenshots/browser checks are required, and whether the output is a lightweight report or a full implementation plan.

### Scoring & prioritization

A model that sorts the backlog for someone who can't arbitrate design debates: combine severity, confidence, effort, and impact into an ordering; use **maximal-marginal-relevance-style** selection to raise confidence and avoid redundant findings; and explicitly **guard against over-trusting AI-generated findings** — low-confidence judged findings are surfaced as questions, not mandates, and high-risk ones are gated.

### Special modes

"Explain it to a non-designer," "generate better UI alternatives," "before/after critique," UX-debt tracking, design-system drift detection, UX regression testing, and product-quality gates in CI.

### Automation & integrations

Playwright, Axe-core, Lighthouse, Storybook, the Figma API, issue trackers (GitHub Issues / Linear / Jira), multi-model CLIs, visual-regression / screenshot-diffing, design-token parsers, component-library analysis, and analytics. Roughly: deterministic web tooling (Axe/Lighthouse/Playwright), screenshot capture, and issue-tracker export are **MVP-shaped**; Figma API, visual-regression baselines, session-replay/analytics ingestion, and deep component-library analysis are **later**.

### The AI-agent workflow

The closed loop that makes findings actionable: **detect → classify → prioritize → create task → attach context/screenshots → write acceptance criteria → define validation checks → agent implements → re-run evaluation → mark resolved or still-failing.**

### Output artifacts

`surface` ultimately produces: per-lens audit documents, an opportunity map, a prioritized findings list, an implementation backlog, an agent plan, and a validation report. (Candidate shapes and paths are in the appendix.)

## 9. Best-practice foundations

`surface` is grounded in established, current standards — not invented opinions:

- **Nielsen Norman Group** usability heuristics and cognitive-walkthrough methods.
- **WCAG 2.2** (the current W3C Recommendation; AA vs AAA tradeoffs made explicit) and **WAI-ARIA**, with awareness that WCAG 3.0 remains in draft.
- **Material Design** (current major version) and **Apple Human Interface Guidelines**.
- **The GOV.UK Design System** — exemplary, evidence-based, accessibility-first patterns.
- **Baymard Institute** research for e-commerce and checkout.
- **Gestalt principles** of visual perception and grouping.
- Current **design-system**, **usability-testing**, **product-analytics**, **conversion-optimization**, and **automated-UI-testing** practice.

Knowledge entries should carry source citations and a sense of volatility/freshness so the catalog can be audited and kept current, rather than drifting into folklore. The document stays readable rather than academic; depth lives in the knowledge base.

## 10. What success looks like

- **A non-designer ships professional, accessible UI** they couldn't have produced alone — and can articulate *why* it's better.
- **The risk of low-quality AI-generated UI drops measurably** because there is now an objective gate it must pass.
- **Before/after improvement is demonstrable** — measured findings resolved, contrast/focus/target violations driven to zero, judged findings addressed with evidence.
- **The loop closes** — re-evaluation confirms fixes actually landed, and regressions are caught when they reappear.
- **Agents can drive it end-to-end** — structured output flows into task systems and back, with human gates only where risk warrants them.
- A softer but real signal: users *trust* the interface more, complete tasks more often, and abandon less.

## 11. Constraints & non-goals

- **Framework-flexible, not framework-bound.** React/Next/Vue/Svelte/vanilla via adapters; Tailwind is one example, not a requirement.
- **Not a design-from-scratch generator.** `surface` evaluates and improves *existing* UI. "Generate better alternatives" is a bounded mode operating on something that already exists — not a blank-canvas design tool.
- **Not a replacement for human designers on high-stakes work.** Brand identity, novel interaction paradigms, and high-risk flows still want a human. `surface` raises the floor and flags the ceiling; it doesn't pretend to be a senior designer.
- **Honest about uncertainty.** It states what it could and couldn't verify, and never dresses a judged finding as a measured one.
- **Sensible MVP boundaries.** Web-first; lean hard on deterministic tooling that already exists; don't try to ship every overlay, integration, and special mode at once. (Exact MVP scope is for the PRD.)

## 12. Open questions & key decisions

These are deliberately left open for Scaffold's pipeline to resolve:

- **Packaging:** standalone CLI, a Scaffold overlay/phase, or a Scaffold plugin? Each has different implications for shared code, distribution, and the `.surface/` vs `.scaffold/` boundary.
- **Browser-automation weight in MVP:** how much should the first version depend on a live browser (Playwright) vs. static + screenshot inputs? Live capture is powerful but raises setup cost and flakiness.
- **De-duplication across modalities:** when the same issue shows up in code, DOM, and screenshot, how are findings merged into one without losing evidence from each source?
- **Confidence & multi-model reconciliation:** exact thresholds for surfacing-as-question vs. asserting, and how Claude/Codex/Gemini votes combine.
- **Scoring formula:** the concrete weighting of severity/confidence/effort/impact, and how MMR selection is parameterized.
- **Knowledge-base authoring & freshness:** how entries are sourced, cited, versioned, and audited over time (mirroring Scaffold's knowledge-audit approach).
- **Adapter surface:** how framework adapters are defined and how much stack-specific fix generation is in scope for v1.
- **State & re-audit identity:** how findings keep stable identity across re-runs so "resolved / still-failing / regressed" is reliable.
- **CI gate semantics:** what makes a build fail, and how teams tune that without it becoming noise.

---

## Appendix: candidate direction (initial thinking, not locked)

> **Read this as a starting point, not a decision.** Everything below is more
> prescriptive than a vision document should be — exact commands, a candidate file
> tree, type shapes, scoring sketches, sample files. It is preserved here so no
> detail from the concept work is lost. Scaffold's planning steps
> (`create-prd`, `adrs`, `system-architecture`, the specs, `implementation-plan`)
> should feel free to **refine, challenge, or replace** any of it. Names, shapes,
> and numbers here are illustrative.

### A. Candidate CLI command set

Mirrors Scaffold's `run` / `next` / `status` idioms, plus surface-specific verbs:

```
surface init                       # create .surface/, detect stack, classify app type
surface run <step> [--depth 1-5]   # run one evaluation step (e.g. heuristics, a11y)
surface run all [--preset deep]    # run the full pipeline at a preset
surface next                       # show next eligible step(s)
surface status [--compact]         # pipeline progress / findings summary
surface capture <target>           # screenshot/DOM/trace a URL, route, or story
surface audit <lens> <target>      # run a single lens against a target
surface explain <finding-id>       # "explain it to a non-designer" mode
surface alternatives <target>      # generate better UI alternatives (bounded)
surface diff <before> <after>      # before/after critique
surface backlog [--export linear]  # emit prioritized backlog / agent plan
surface validate                   # re-run evaluation, mark resolved/still-failing
surface gate [--ci]                # product-quality gate for CI
```

Candidate target syntax: `--url`, `--localhost`, `--route`, `--screenshot`, `--figma`, `--storybook`, `--component`, `--dom`, `--trace`, plus context flags `--persona`, `--task`, `--scaffold-docs`, `--analytics`.

### B. Candidate repository / file tree

Echoes Scaffold's `content/` + `.scaffold/` split:

```
surface/
├── content/
│   ├── pipeline/                 # meta-prompts per step, grouped by phase
│   │   ├── discovery/
│   │   ├── heuristics/
│   │   ├── accessibility/
│   │   ├── visual-design/
│   │   ├── content/
│   │   ├── responsiveness/
│   │   ├── conversion/
│   │   └── synthesis/
│   ├── knowledge/                # best-practice entries (## Summary / ## Deep Guidance)
│   │   ├── core-heuristics/
│   │   ├── accessibility/
│   │   ├── forms/ navigation/ dashboards/ data-viz/
│   │   ├── ecommerce/ saas-onboarding/ admin/ mobile/
│   │   ├── ai-products/ developer-tools/ regulated/ marketplaces/
│   │   ├── search-discovery/ design-systems/ visual-content/
│   │   ├── i18n/ states/ trust-safety/ conversion/
│   │   ├── platform/ and agent-implementation/
│   ├── methodology/              # presets + app-type overlays as YAML
│   │   ├── quick.yml mvp.yml standard.yml deep.yml
│   │   ├── accessibility-first.yml conversion-focused.yml
│   │   ├── design-system-focused.yml agent-ready.yml custom-defaults.yml
│   │   └── overlays/ ecommerce.yml saas-dashboard.yml marketing.yml
│   │       mobile.yml content-media.yml admin.yml kiosk-tv.yml
│   ├── tools/                    # adapters + tool-runner prompts
│   └── skills/                   # natural-language runner skill(s)
└── .surface/                     # per-project state (parallel to .scaffold/)
    ├── state.json                # pipeline progress, finding identities
    ├── config.yml                # preset, depth, stack, app type, integrations
    ├── decisions.jsonl           # decision log
    ├── findings/                 # accumulated findings across runs
    ├── captures/                 # screenshots, DOM snapshots, traces
    └── generated/                # agent assets (claude-code / codex / universal)
```

### C. Candidate methodology presets & depth scale

| Preset | Intent | Typical depth |
|---|---|---|
| `quick` | Fast smell-test, top issues only | 1 |
| `mvp` | Pragmatic pass for a first release | 2 |
| `standard` | Balanced full audit | 3 |
| `deep` | Exhaustive, multi-model, full plan | 5 |
| `accessibility-first` | A11y-weighted, WCAG 2.2 AA gate | 3–4 |
| `conversion-focused` | Activation/checkout friction | 3–4 |
| `design-system-focused` | Token/consistency drift | 3 |
| `agent-ready` | Maximize structured, executable output | 4 |
| `custom` | User-tuned lens/depth/integration mix | n/a |

| Depth | Views/tasks | Multi-model | Browser checks | Output |
|---|---|---|---|---|
| 1 | 1 key view | no | optional | short report |
| 2 | few core views | no | screenshots | report + top backlog |
| 3 | primary flows | optional | screenshots + Axe/Lighthouse | full backlog |
| 4 | broad coverage | yes | + Playwright traces | backlog + agent plan |
| 5 | exhaustive | yes, reconciled | full tool grounding | full plan + validation harness |

### D. Candidate finding / task / data-model shapes

Illustrative TypeScript — the specs should formalize these:

```ts
type Lens =
  | "usability" | "accessibility" | "visual-hierarchy" | "interaction"
  | "information-architecture" | "content" | "conversion" | "learnability"
  | "error-handling" | "responsiveness" | "states" | "trust" | "i18n"
  | "inclusive-design" | "design-system" | "platform" | "product-strategy"
  | "task-completion" | "agent-implementability";

type IssueType =
  | "bug" | "usability-gap" | "accessibility-violation" | "visual-hierarchy"
  | "interaction" | "content" | "navigation" | "state-handling"
  | "responsiveness" | "performance-perception" | "trust" | "conversion"
  | "design-system-inconsistency" | "innovation-opportunity"
  | "delight-opportunity" | "research-question" | "needs-human-validation";

type Method = "measured" | "judged";

interface Finding {
  id: string;                      // stable across re-runs
  lens: Lens;
  type: IssueType;
  method: Method;                  // measured vs judged — never conflated
  title: string;
  rationale: string;               // plain-language, non-designer friendly
  heuristics: string[];            // cited best-practice references
  evidence: Evidence[];            // screenshot region, DOM node, tool result
  dimensions: {
    severity: 1 | 2 | 3 | 4 | 5;
    confidence: number;            // 0..1
    effort: "xs" | "s" | "m" | "l" | "xl";
    userImpact: 1 | 2 | 3 | 4 | 5;
    businessImpact: 1 | 2 | 3 | 4 | 5;
    a11yLegalRisk: "none" | "low" | "med" | "high";
    evidenceQuality: 1 | 2 | 3 | 4 | 5;
    agentImplementability: 1 | 2 | 3 | 4 | 5;
  };
  location?: { file?: string; component?: string; selector?: string };
  gatedForHuman: boolean;          // risky/subjective → requires validation
}

interface Task {
  id: string;
  findingIds: string[];
  change: string;                  // concrete edit, stack-aware
  files: string[];
  acceptanceCriteria: string[];
  validationChecks: ValidationCheck[]; // re-runnable proof of fix
  status: "open" | "in-progress" | "resolved" | "still-failing" | "regressed";
}
```

Candidate prioritization sketch (to be challenged): a base score such as
`priority = (severity × userImpact × businessImpact × confidence) / effortWeight`,
boosted for `a11yLegalRisk`, with **MMR-style** selection over the ranked set to
diversify the surfaced backlog and avoid near-duplicate findings — and a hard rule
that `confidence < threshold` judged findings are surfaced as *questions*, and
`gatedForHuman` findings never auto-execute.

### E. Candidate output artifacts (with paths)

| Artifact | Candidate path |
|---|---|
| Per-lens audit docs | `.surface/findings/audit-<lens>.md` |
| Opportunity map | `.surface/findings/opportunity-map.md` |
| Prioritized findings | `.surface/findings/findings.json` + `findings.md` |
| Implementation backlog | `.surface/findings/backlog.md` |
| Agent plan | `.surface/generated/agent-plan.md` |
| Validation report | `.surface/findings/validation-report.md` |

### F. Illustrative sample sketches

**(1) A pipeline meta-prompt** (mirrors Scaffold's frontmatter shape):

```markdown
---
name: accessibility-audit
description: Tool-grounded WCAG 2.2 AA evaluation of a captured view
phase: accessibility
order: 700
dependencies: [capture, app-type-classification]
outputs: [audit-accessibility.md, findings.json]
conditional: null
stateless: false
category: pipeline
knowledge-base: [accessibility/wcag-2-2-aa, accessibility/aria-patterns, states/focus-order]
---

## Purpose
Evaluate the captured view against WCAG 2.2 AA. Every violation that can be
verified mechanically MUST be produced or confirmed by Axe-core / Lighthouse /
Playwright and tagged `method: measured`. Interpretation, prioritization, and
plain-language explanation are yours; measurements are not.

## Inputs
{{capture}} (screenshot + DOM + optional trace), {{app_type}}, {{persona}},
{{tool_results.axe}}, {{tool_results.lighthouse}}, {{design_tokens?}}.

## Procedure
1. Read the prefetched tool results; treat them as authoritative for measured facts.
2. For each measured violation, emit a Finding with evidence (selector + tool id).
3. Add judged findings only for issues tools cannot see (e.g. ambiguous labels),
   tagged `method: judged`, each citing a knowledge entry.
4. Set `gatedForHuman: true` for anything that changes meaning or brand.

## Output
Append Findings to findings.json and write audit-accessibility.md. Separate
MEASURED and JUDGED sections. Never present a judged finding as measured.
```

**(2) A knowledge-entry `## Deep Guidance` block** (mirrors Scaffold's entry shape):

```markdown
## Summary
Touch targets must be large enough to hit reliably. WCAG 2.2 adds Target Size
(Minimum) at AA; platform guidance sets higher practical floors.

## Deep Guidance
- **WCAG 2.2, 2.5.8 Target Size (Minimum), AA:** targets at least 24×24 CSS px,
  or sufficient spacing if smaller. AAA (2.5.5) wants 44×44.
- **Apple HIG:** ~44×44 pt minimum. **Material Design:** ~48×48 dp with ≥8 dp
  spacing. On **kiosk/TV** overlays, raise the floor further for lean-back use.
- **How surface checks it (measured):** from the DOM + computed styles, compute
  the rendered hit area of interactive elements; flag any below the overlay's
  threshold; attach the selector and measured px as evidence.
- **Common AI-generated failure:** icon-only buttons styled to ~16–20px with no
  padding. **Fix pattern (stack-aware):** increase padding / min-size tokens;
  in Tailwind, e.g. `min-h-11 min-w-11 p-2`; verify by re-measuring after the fix.
- **Gate:** none — purely measured and low-risk, safe for agent execution.
```

---

*End of `docs/idea.md`. This file is the input to the Scaffold pipeline; the body is the source of truth for what `surface` is and why, and the appendix is starting material for the pipeline's planning steps.*
