import { z } from "zod";

import { FindingSchema, type Finding } from "./findings.js";
import { deriveFindingIdentity, FindingIdentitySchema, type FindingIdentity } from "./identity.js";

/**
 * Closed-loop lifecycle for a stable finding identity.
 *
 * Callers must resolve identity before using the detected transition. A detected transition is
 * only valid for the same identityKey already tracked here; otherwise use an identity-broken
 * transition so drift is explicit and never silently resolved. lastSeenRunId records the latest
 * run where the finding was detected, while history records every lifecycle observation.
 */

const nonEmptyStringSchema = z.string().min(1);

export const FindingStatusSchema = z.enum([
  "new",
  "still-failing",
  "resolved",
  "regressed",
  "identity-broken",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const GateDispositionSchema = z.enum(["active", "ignored-by-waiver"]);
export type GateDisposition = z.infer<typeof GateDispositionSchema>;

export const ValidationCheckSchema = z
  .object({
    kind: z.enum(["measured-rule", "re-evaluate-lens"]),
    expectation: nonEmptyStringSchema,
  })
  .strict();
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

export const TrackedFindingHistoryEntrySchema = z
  .object({
    runId: nonEmptyStringSchema,
    status: FindingStatusSchema,
  })
  .passthrough();
export type TrackedFindingHistoryEntry = z.infer<typeof TrackedFindingHistoryEntrySchema>;

export const TrackedFindingSchema = z
  .object({
    identityKey: nonEmptyStringSchema,
    identity: FindingIdentitySchema,
    currentFindingId: nonEmptyStringSchema.optional(),
    status: FindingStatusSchema,
    gateDisposition: GateDispositionSchema,
    validation: ValidationCheckSchema,
    firstSeenRunId: nonEmptyStringSchema,
    lastSeenRunId: nonEmptyStringSchema,
    history: z.array(TrackedFindingHistoryEntrySchema).min(1),
  })
  .passthrough()
  .superRefine((trackedFinding, context) => {
    if (trackedFinding.identity.identityKey !== trackedFinding.identityKey) {
      context.addIssue({
        code: "custom",
        message: "identityKey must match identity.identityKey",
        path: ["identityKey"],
      });
    }

    if (
      trackedFinding.history[trackedFinding.history.length - 1]?.status !== trackedFinding.status
    ) {
      context.addIssue({
        code: "custom",
        message: "latest history status must match current status",
        path: ["history"],
      });
    }

    if (trackedFinding.status === "resolved" && trackedFinding.currentFindingId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "resolved tracked findings must not have a currentFindingId",
        path: ["currentFindingId"],
      });
    }

    const seenRunIds = new Set<string>();
    trackedFinding.history.forEach((entry, index) => {
      if (seenRunIds.has(entry.runId)) {
        context.addIssue({
          code: "custom",
          message: "history runId values must be unique",
          path: ["history", index, "runId"],
        });
      }

      seenRunIds.add(entry.runId);
    });
  });
export type TrackedFinding = z.infer<typeof TrackedFindingSchema>;

const BaseTransitionSchema = z.object({
  runId: nonEmptyStringSchema,
});

const DetectedTransitionSchema = BaseTransitionSchema.extend({
  kind: z.literal("detected"),
  finding: FindingSchema,
  identity: FindingIdentitySchema.optional(),
}).strict();

const MissingTransitionSchema = BaseTransitionSchema.extend({
  kind: z.literal("missing"),
  validationPassed: z.boolean(),
}).strict();

const IdentityBrokenTransitionSchema = BaseTransitionSchema.extend({
  kind: z.literal("identity-broken"),
  currentFindingId: nonEmptyStringSchema.optional(),
}).strict();

const TrackedFindingTransitionSchema = z.discriminatedUnion("kind", [
  DetectedTransitionSchema,
  MissingTransitionSchema,
  IdentityBrokenTransitionSchema,
]);
export type TrackedFindingTransition = z.infer<typeof TrackedFindingTransitionSchema>;

export type CreateTrackedFindingInput = {
  readonly runId: string;
  readonly finding: Finding;
  readonly identity?: FindingIdentity;
  readonly validation: ValidationCheck;
  readonly gateDisposition?: GateDisposition;
};

/**
 * Create the first tracked lifecycle record for a finding identity.
 *
 * @param input - Finding, run id, validation check, and optional precomputed identity.
 * @returns A tracked finding with `new` status and one history entry.
 * @throws If the finding, validation check, or explicit identity is invalid, or if the explicit
 * identity does not match the supplied finding.
 */
export function createTrackedFinding(input: CreateTrackedFindingInput): TrackedFinding {
  const finding = FindingSchema.parse(input.finding);
  const identity = identityForFinding(finding, input.identity);
  const validation = ValidationCheckSchema.parse(input.validation);

  return TrackedFindingSchema.parse({
    identityKey: identity.identityKey,
    identity,
    currentFindingId: finding.id,
    status: "new",
    gateDisposition: input.gateDisposition ?? "active",
    validation,
    firstSeenRunId: input.runId,
    lastSeenRunId: input.runId,
    history: [{ runId: input.runId, status: "new" }],
  });
}

/**
 * Apply one lifecycle observation to a tracked finding.
 *
 * @param trackedFinding - Existing tracked finding state.
 * @param transition - Detected, missing, or identity-broken observation for a later run.
 * @returns Updated tracked finding state with appended history.
 * @throws If the transition is invalid, reuses a run id, or a detected finding resolves to a
 * different identityKey than the tracked finding.
 */
export function transitionTrackedFinding(
  trackedFinding: TrackedFinding,
  transition: TrackedFindingTransition,
): TrackedFinding {
  const previous = TrackedFindingSchema.parse(trackedFinding);
  const parsedTransition = TrackedFindingTransitionSchema.parse(transition);
  const nextStatus = nextStatusFor(previous, parsedTransition);
  const nextIdentity =
    parsedTransition.kind === "detected"
      ? identityForFinding(parsedTransition.finding, parsedTransition.identity)
      : previous.identity;

  if (nextIdentity.identityKey !== previous.identityKey) {
    throw new Error("detected transition identityKey must match the tracked finding identityKey");
  }

  return TrackedFindingSchema.parse({
    ...previous,
    identity: nextIdentity,
    currentFindingId:
      parsedTransition.kind === "detected"
        ? parsedTransition.finding.id
        : parsedTransition.kind === "identity-broken"
          ? parsedTransition.currentFindingId
          : undefined,
    status: nextStatus,
    lastSeenRunId:
      parsedTransition.kind === "detected" ? parsedTransition.runId : previous.lastSeenRunId,
    history: [...previous.history, { runId: parsedTransition.runId, status: nextStatus }],
  });
}

function identityForFinding(
  finding: Finding,
  identity: FindingIdentity | undefined,
): FindingIdentity {
  const derivedIdentity = deriveFindingIdentity(finding);

  if (identity === undefined) {
    return derivedIdentity;
  }

  const parsedIdentity = FindingIdentitySchema.parse(identity);

  if (!sameFindingIdentity(parsedIdentity, derivedIdentity)) {
    throw new Error("explicit identity must match the supplied finding identity");
  }

  return parsedIdentity;
}

function sameFindingIdentity(left: FindingIdentity, right: FindingIdentity): boolean {
  return (
    left.identityKey === right.identityKey &&
    left.lens === right.lens &&
    left.issueType === right.issueType &&
    left.anchorKind === right.anchorKind &&
    left.locationAnchor === right.locationAnchor &&
    left.discriminator === right.discriminator
  );
}

function nextStatusFor(
  previous: TrackedFinding,
  transition: TrackedFindingTransition,
): FindingStatus {
  switch (transition.kind) {
    case "detected": {
      return latestStableStatus(previous) === "resolved" ? "regressed" : "still-failing";
    }
    case "missing":
      return missingStatusFor(previous, transition.validationPassed);
    case "identity-broken":
      return "identity-broken";
  }
}

function missingStatusFor(previous: TrackedFinding, validationPassed: boolean): FindingStatus {
  if (previous.status === "identity-broken" && validationPassed) {
    // Missing validation can confirm absence, but only a detected same-identity finding can recover
    // from an unmatchable anchor.
    return "identity-broken";
  }

  if (!validationPassed) {
    return latestStableStatus(previous) === "resolved" ? "regressed" : "still-failing";
  }

  return "resolved";
}

function latestStableStatus(previous: TrackedFinding): FindingStatus {
  return latestNonIdentityBrokenStatus(previous.history) ?? previous.status;
}

function latestNonIdentityBrokenStatus(
  history: readonly TrackedFindingHistoryEntry[],
): FindingStatus | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const status = history[index]?.status;

    if (status !== undefined && status !== "identity-broken") {
      return status;
    }
  }

  return undefined;
}
