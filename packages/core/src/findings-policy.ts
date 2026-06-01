import { z } from "zod";

import { NormalizedScoreSchema } from "./scores.js";

export const ConfidenceCutoffsSchema = z
  .object({
    assert: NormalizedScoreSchema,
    question: NormalizedScoreSchema,
  })
  .strict()
  .refine((cutoffs) => cutoffs.assert >= cutoffs.question, {
    message: "assert cutoff must be greater than or equal to question cutoff",
  });
export type ConfidenceCutoffs = z.infer<typeof ConfidenceCutoffsSchema>;

export const SeverityCutoffsSchema = z
  .object({
    P0: NormalizedScoreSchema,
    P1: NormalizedScoreSchema,
    P2: NormalizedScoreSchema,
    P3: NormalizedScoreSchema,
  })
  .strict()
  .refine(
    (cutoffs) => cutoffs.P0 >= cutoffs.P1 && cutoffs.P1 >= cutoffs.P2 && cutoffs.P2 >= cutoffs.P3,
    {
      message: "severity cutoffs must descend from P0 through P3",
    },
  );
export type SeverityCutoffs = z.infer<typeof SeverityCutoffsSchema>;

export const FindingsPolicySchema = z
  .object({
    confidenceCutoffs: ConfidenceCutoffsSchema,
    severityCutoffs: SeverityCutoffsSchema,
  })
  .strict();
export type FindingsPolicy = z.infer<typeof FindingsPolicySchema>;

function deepFreeze<T extends object>(value: T): T {
  for (const nestedValue of Object.values(value)) {
    if (nestedValue !== null && typeof nestedValue === "object") {
      deepFreeze(nestedValue);
    }
  }

  return Object.freeze(value);
}

export const DEFAULT_FINDINGS_POLICY = deepFreeze({
  confidenceCutoffs: {
    assert: 0.8,
    question: 0.5,
  },
  severityCutoffs: {
    P0: 0.95,
    P1: 0.75,
    P2: 0.45,
    P3: 0,
  },
});
