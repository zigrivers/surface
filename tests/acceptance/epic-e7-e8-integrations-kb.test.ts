// Acceptance skeletons — Epic E7: Integrations (US-060..061) + Epic E8: KB/Presets/Multi-model (US-070..071).
import { describe, it } from "vitest";

describe("E7 Integrations", () => {
  describe("US-060 GitHub Issues export [gate]", () => {
    it.skip("[US-060][AC1] token + --export github → issues created with finding context (integration)", () => {});
    it.skip("[US-060][AC2] rate-limit/API failure → retry w/ backoff, write backlog locally, report unsynced, exit non-zero (integration)", () => {});
  });
  describe("US-061 Linear/Jira export & token parsers [should]", () => {
    it.skip("[US-061][AC1] --export linear|jira → items created per that vendor's API within rate limits (integration)", () => {});
  });
});

describe("E8 Knowledge Base, Presets & Multi-model", () => {
  describe("US-070 inspectable, cited knowledge base [gate]", () => {
    it.skip("[US-070][AC1] finding cites a heuristic → KB entry has ## Summary/## Deep Guidance, source citation, freshness metadata (unit)", () => {});
  });
  describe("US-071 multi-model reconciliation [should]", () => {
    it.skip("[US-071][AC1] depth 4–5 + installed CLIs → findings reconciled by confidence; divergence surfaced as a question (integration)", () => {});
    it.skip("[US-071][AC2] a CLI unavailable → degrade to single-model; record which channels participated (integration)", () => {});
  });
});
