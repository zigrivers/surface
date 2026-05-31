<!-- scaffold:domain-modeling v1 2026-05-31 -->

# Domain: Knowledge Base

> **Role:** supporting. **Responsibility:** hold the curated, **inspectable** catalog of
> best-practice entries that ground judged findings, inject relevant entries per lens/step,
> and keep itself auditable via source citations and freshness metadata.
> **Source FRs:** FR-KB-1..5, FR-LENS-5 (cited heuristics), NFR-OBS-1. **Stories:** US-070.

## Ubiquitous language (this context)

`KnowledgeEntry`, `Citation`, `Freshness`, `KnowledgeCategory`, `RelevanceQuery`.
(Canonical in [index.md](./index.md).)

## Entities & value objects

```typescript
// Value object — the source backing an entry (FR-KB-4). Self-validating: non-empty source.
interface Citation {
  readonly source: string;              // e.g. "Nielsen 10 Heuristics", "WCAG 2.2 §1.4.3"
  readonly url?: string;
  readonly retrievedAt: Timestamp;
}

// Value object — auditability metadata (FR-KB-4).
interface Freshness {
  readonly volatility: "stable" | "evolving" | "volatile";
  readonly lastReviewed: Timestamp;
}

// Value object — a catalog category (FR-KB-2,3,5).
type KnowledgeCategory =
  | "core-heuristics" | "accessibility" | "forms" | "navigation" | "states"
  | "visual-content" | "design-systems" | "conversion" | "platform-web" | "agent-implementation"
  | "dashboards" | "data-viz" | "e-commerce" | "saas-onboarding" | "admin" | "search-discovery"
  | "trust-safety" | "i18n";

// AGGREGATE ROOT — one best-practice entry. Authored as markdown with yaml frontmatter.
interface KnowledgeEntry {
  readonly id: KnowledgeEntryId;        // identity; stable; cited by Finding.citedHeuristics
  readonly category: KnowledgeCategory;
  readonly summary: string;             // "## Summary" — short, injectable
  readonly deepGuidance: string;        // "## Deep Guidance" — full reference
  readonly citation: Citation;          // REQUIRED — no uncited entries (FR-KB-4)
  readonly freshness: Freshness;
  readonly appliesToAppTypes: AppType[]; // for relevance injection
  readonly appliesToLenses: LensId[];
}

// Value object — a request for relevant entries, issued by a lens/step (FR-KB-1).
interface RelevanceQuery { readonly lensId: LensId; readonly appType: AppType; readonly step: string; }
```

## Aggregate boundary

`KnowledgeEntry` is a self-contained aggregate — each entry is independently authored,
versioned, refreshed, and cited. There is no parent "Catalog" aggregate that must stay
transactionally consistent; the catalog is just the set of entries on disk
(`content/knowledge/<category>/<slug>.md`). This keeps the context generic: editing one
entry never locks another. Findings reference entries by `KnowledgeEntryId` only
(anticorruption — a finding never embeds entry prose, so an entry can be refreshed without
touching historical findings).

## Invariants (runtime-checkable)

| # | Invariant | When | On violation |
|---|---|---|---|
| KB-I1 | every entry has a non-empty `citation.source` | on load/author | reject the entry — no uncited guidance (FR-KB-4) |
| KB-I2 | every entry has both `summary` and `deepGuidance` sections | on load | reject — structural contract (FR-KB-1, US-070) |
| KB-I3 | every `KnowledgeEntryId` cited by a `Finding` resolves to a loaded entry | at finding emit | reject the citation — no dangling heuristics |
| KB-I4 | a `volatile` entry past a review interval is flagged for re-review | freshness audit | surface in the KB freshness audit (R-6) |

## Domain events

| Event | Trigger | Payload | Consumers |
|---|---|---|---|
| `KnowledgeGapSignalled` | a lens/step finds no relevant entry for a needed topic | `{ topic, lensId, step }` | NFR-OBS-1 knowledge-gap audit (mirrors Scaffold observe) |
| `EntryReviewed` | an entry's freshness is updated | `{ entryId, reviewedAt }` | freshness audit |

## Bounded-context interface

- **Exposes (open-host / published language):** `getRelevant(query): KnowledgeEntry[]` for
  Evaluation lenses, and `resolve(id): KnowledgeEntry` for the `explain` query (FR-MODE-1).
- **Consumes:** nothing from other contexts at runtime — it is an upstream supplier. Authoring
  is offline (entries live in `content/knowledge/`).
- **No write coupling:** findings cite entries; entries never reference findings.
