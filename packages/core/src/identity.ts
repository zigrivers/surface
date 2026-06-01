import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

import { FindingSchema, type Evidence, type Finding, type Location } from "./findings.js";

const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const IdentityAnchorKindSchema = z.enum(["element-ref", "selector", "component", "file"]);
export type IdentityAnchorKind = z.infer<typeof IdentityAnchorKindSchema>;

export const FindingIdentityCandidateSchema = z
  .object({
    lens: nonEmptyStringSchema,
    issueType: nonEmptyStringSchema,
    locationAnchor: nonEmptyStringSchema,
    anchorKind: IdentityAnchorKindSchema,
  })
  .strict();
export type FindingIdentityCandidate = z.infer<typeof FindingIdentityCandidateSchema>;

export const FindingIdentitySchema = FindingIdentityCandidateSchema.extend({
  discriminator: nonEmptyStringSchema.optional(),
  identityKey: nonEmptyStringSchema,
}).strict();
export type FindingIdentity = z.infer<typeof FindingIdentitySchema>;

export const StableFindingIdentityAssignmentSchema = z
  .object({
    findingId: nonEmptyStringSchema,
    status: z.literal("stable"),
    identity: FindingIdentitySchema,
    reason: z.enum(["stable-anchor", "disambiguated-collision"]),
  })
  .strict();
export type StableFindingIdentityAssignment = z.infer<typeof StableFindingIdentityAssignmentSchema>;

export const BrokenFindingIdentityAssignmentSchema = z
  .object({
    findingId: nonEmptyStringSchema,
    status: z.literal("identity-broken"),
    candidate: FindingIdentityCandidateSchema,
    reason: z.literal("ambiguous-collision"),
  })
  .strict();
export type BrokenFindingIdentityAssignment = z.infer<typeof BrokenFindingIdentityAssignmentSchema>;

export const FindingIdentityAssignmentSchema = z.discriminatedUnion("status", [
  StableFindingIdentityAssignmentSchema,
  BrokenFindingIdentityAssignmentSchema,
]);
export type FindingIdentityAssignment = z.infer<typeof FindingIdentityAssignmentSchema>;

export const StableIdentityDriftResultSchema = z
  .object({
    currentFindingId: nonEmptyStringSchema,
    status: z.literal("stable"),
    identity: FindingIdentitySchema,
    reason: z.literal("stable-anchor"),
  })
  .strict();

export const BrokenIdentityDriftResultSchema = z
  .object({
    currentFindingId: nonEmptyStringSchema,
    status: z.literal("identity-broken"),
    previousIdentity: FindingIdentitySchema,
    candidate: FindingIdentityCandidateSchema,
    reason: z.literal("anchor-drift"),
  })
  .strict();

export const IdentityDriftResultSchema = z.discriminatedUnion("status", [
  StableIdentityDriftResultSchema,
  BrokenIdentityDriftResultSchema,
]);
export type IdentityDriftResult = z.infer<typeof IdentityDriftResultSchema>;

function normalizePart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeIdentityPart(value: string): string {
  return normalizePart(value).toLowerCase();
}

function compareStableStrings(left: string, right: string): number {
  // Intentionally lexical for byte-stable ordering, not natural numeric ordering.
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) {
    return '{"$undefined":true}';
  }

  if (value !== null && typeof value === "object") {
    if (seen.has(value)) {
      throw new TypeError("canonicalJson cannot serialize circular structures");
    }

    seen.add(value);

    const toJsonFn = (value as { toJSON?: () => unknown }).toJSON;

    try {
      if (typeof toJsonFn === "function") {
        return canonicalJson(toJsonFn.call(value), seen);
      }

      if (Array.isArray(value)) {
        // Arrays preserve position, so an undefined entry needs an explicit sentinel.
        // Object properties with undefined values are omitted below to match JSON object semantics.
        return `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
      }

      return `{${Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([leftKey], [rightKey]) => compareStableStrings(leftKey, rightKey))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry, seen)}`)
        .join(",")}}`;
    } finally {
      seen.delete(value);
    }
  }

  return JSON.stringify(value) ?? "null";
}

function hashIdentityInput(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

type FindingIdentityInput = FindingIdentityCandidate & {
  readonly discriminator?: string;
};

function identityHashInput(candidate: FindingIdentityInput): string {
  return canonicalJson({
    version: 1,
    lens: normalizeIdentityPart(candidate.lens),
    issueType: normalizeIdentityPart(candidate.issueType),
    anchorKind: candidate.anchorKind,
    locationAnchor: normalizeAnchorForKind(candidate.anchorKind, candidate.locationAnchor),
    discriminator: candidate.discriminator ?? "",
  });
}

function identityKeyForCandidate(candidate: FindingIdentityInput): string {
  return `ik_${hashIdentityInput(identityHashInput(candidate))}`;
}

function sameBaseCandidate(
  left: FindingIdentityCandidate,
  right: FindingIdentityCandidate,
): boolean {
  return (
    normalizeIdentityPart(left.lens) === normalizeIdentityPart(right.lens) &&
    normalizeIdentityPart(left.issueType) === normalizeIdentityPart(right.issueType) &&
    left.anchorKind === right.anchorKind &&
    normalizeAnchorForKind(left.anchorKind, left.locationAnchor) ===
      normalizeAnchorForKind(right.anchorKind, right.locationAnchor)
  );
}

function normalizeAnchorForKind(kind: IdentityAnchorKind, value: string): string {
  const trimmedValue = value.trim();

  if (kind === "file") {
    // Surface treats repository paths case-insensitively for identity stability across macOS,
    // Windows, and Linux agents. Projects with same-directory files differing only by case are
    // considered unsupported for stable closed-loop identity.
    return trimmedValue.replaceAll("\\", "/").toLowerCase();
  }

  if (kind === "component") {
    return trimmedValue.toLowerCase();
  }

  return trimmedValue;
}

function normalizedAnchor(
  kind: IdentityAnchorKind,
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalizedValue = normalizeAnchorForKind(kind, value);

  return normalizedValue.length === 0 ? undefined : normalizedValue;
}

function locationAnchorFrom(
  location: Location,
): Pick<FindingIdentityCandidate, "anchorKind" | "locationAnchor"> {
  const elementRef = normalizedAnchor("element-ref", location.elementRef);
  const selector = normalizedAnchor("selector", location.selector);
  const component = normalizedAnchor("component", location.component);
  const file = normalizedAnchor("file", location.file);

  if (elementRef !== undefined) {
    return {
      anchorKind: "element-ref",
      locationAnchor: elementRef,
    };
  }

  if (selector !== undefined) {
    return {
      anchorKind: "selector",
      locationAnchor: canonicalJson(["selector", file ?? "", component ?? "", selector]),
    };
  }

  if (component !== undefined) {
    return {
      anchorKind: "component",
      locationAnchor:
        file === undefined
          ? canonicalJson(["component", component])
          : canonicalJson(["component", file, component]),
    };
  }

  if (file !== undefined) {
    return {
      anchorKind: "file",
      locationAnchor: file,
    };
  }

  // LocationSchema requires at least one anchor; this protects callers if that schema changes.
  throw new Error("location must include at least one identity anchor");
}

function candidateKey(candidate: FindingIdentityCandidate): string {
  return canonicalJson({
    lens: normalizeIdentityPart(candidate.lens),
    issueType: normalizeIdentityPart(candidate.issueType),
    anchorKind: candidate.anchorKind,
    locationAnchor: normalizeAnchorForKind(candidate.anchorKind, candidate.locationAnchor),
  });
}

function isCoarseAnchor(candidate: FindingIdentityCandidate): boolean {
  return candidate.anchorKind === "component" || candidate.anchorKind === "file";
}

function stableEvidenceAnchor(evidence: Evidence): Record<string, unknown> | undefined {
  switch (evidence.kind) {
    case "dom":
      return {
        kind: evidence.kind,
        elementRef:
          evidence.elementRef === undefined
            ? ""
            : normalizeAnchorForKind("element-ref", evidence.elementRef),
        selector:
          evidence.selector === undefined
            ? ""
            : normalizeAnchorForKind("selector", evidence.selector),
      };
    case "screenshot-region":
      return {
        kind: evidence.kind,
        artifactId: normalizePart(evidence.artifactId),
        rect: evidence.rect,
      };
    case "tool-result":
    case "cited-heuristic":
      return undefined;
  }
}

function secondaryAnchorSignature(finding: Finding): string | undefined {
  const evidenceAnchors = finding.evidence
    .map(stableEvidenceAnchor)
    .filter((anchor) => anchor !== undefined)
    .map((anchor) => canonicalJson(anchor))
    .sort(compareStableStrings);

  if (evidenceAnchors.length === 0) {
    return undefined;
  }

  return canonicalJson({
    evidenceAnchors,
  });
}

function secondaryDiscriminatorFor(
  finding: Finding,
  candidate: FindingIdentityCandidate,
): string | undefined {
  if (!isCoarseAnchor(candidate)) {
    return undefined;
  }

  const signature = secondaryAnchorSignature(finding);

  return signature === undefined ? undefined : `sd_${hashIdentityInput(signature)}`;
}

function identityInputWithDiscriminator(
  candidate: FindingIdentityCandidate,
  discriminator: string | undefined,
): FindingIdentityInput {
  return discriminator === undefined ? candidate : { ...candidate, discriminator };
}

function materializeIdentity(candidate: FindingIdentityInput): FindingIdentity {
  return FindingIdentitySchema.parse({
    ...candidate,
    identityKey: identityKeyForCandidate(candidate),
  });
}

function deriveFindingIdentityCandidateFromParsed(finding: Finding): FindingIdentityCandidate {
  const anchor = locationAnchorFrom(finding.location);

  return FindingIdentityCandidateSchema.parse({
    lens: normalizeIdentityPart(finding.lens),
    issueType: normalizeIdentityPart(finding.issueType),
    ...anchor,
  });
}

function validateUniqueFindingIds(findings: readonly Finding[]): void {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const finding of findings) {
    if (seenIds.has(finding.id)) {
      duplicateIds.add(finding.id);
      continue;
    }

    seenIds.add(finding.id);
  }

  if (duplicateIds.size > 0) {
    throw new Error(
      `finding ids must be unique per identity assignment run: ${[...duplicateIds]
        .sort(compareStableStrings)
        .join(", ")}`,
    );
  }
}

/**
 * Derives the ADR-010 identity candidate from lens, issue type, and the most stable location
 * anchor. Element refs win over selectors, selectors win over components, and components win
 * over file-only anchors. Invalid findings raise ZodError from FindingSchema. The stored lens,
 * issue type, and anchor values are normalized so display casing/path casing does not change keys.
 */
export function deriveFindingIdentityCandidate(finding: Finding): FindingIdentityCandidate {
  return deriveFindingIdentityCandidateFromParsed(FindingSchema.parse(finding));
}

/**
 * Derives a stable key for a single finding. Use assignFindingIdentities for a full run so
 * same-anchor collisions can be marked identity-broken. The key is based only on lens, issue
 * type, and location anchor so wording, evidence, and other mutable details do not churn identity.
 */
export function deriveFindingIdentity(finding: Finding): FindingIdentity {
  const parsedFinding = FindingSchema.parse(finding);
  const candidate = deriveFindingIdentityCandidateFromParsed(parsedFinding);

  return materializeIdentity(
    identityInputWithDiscriminator(candidate, secondaryDiscriminatorFor(parsedFinding, candidate)),
  );
}

/**
 * Assigns stable identities for a run.
 *
 * Findings with unique anchors get stable hashes. Coarse component/file anchors include stable
 * secondary anchors when location-like evidence is available, so identity does not depend on
 * whether another same-anchor finding exists in the current run. Same precise-anchor collisions
 * are marked identity-broken. Same coarse-anchor collisions are disambiguated only when secondary
 * anchors differ; duplicate secondary anchors are identity-broken because assigning ordinals would
 * make closed-loop state shift when another indistinguishable finding appears or disappears.
 *
 * Example:
 * assignFindingIdentities(findings).filter((entry) => entry.status === "stable")
 * returns entries whose identityKey can be used by the closed-loop state machine.
 */
export function assignFindingIdentities(findings: readonly Finding[]): FindingIdentityAssignment[] {
  const parsedFindings = z.array(FindingSchema).parse(findings);
  validateUniqueFindingIds(parsedFindings);
  const assignments: FindingIdentityAssignment[] = [];
  const groups = new Map<
    string,
    Array<{
      readonly finding: Finding;
      readonly candidate: FindingIdentityCandidate;
      readonly discriminator: string | undefined;
    }>
  >();

  for (const finding of parsedFindings) {
    const candidate = deriveFindingIdentityCandidateFromParsed(finding);
    const key = candidateKey(candidate);
    const group = groups.get(key) ?? [];

    group.push({
      finding,
      candidate,
      discriminator: secondaryDiscriminatorFor(finding, candidate),
    });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      const entry = group[0]!;

      assignments.push(
        StableFindingIdentityAssignmentSchema.parse({
          findingId: entry.finding.id,
          status: "stable",
          identity: materializeIdentity(
            identityInputWithDiscriminator(entry.candidate, entry.discriminator),
          ),
          reason: "stable-anchor",
        }),
      );
      continue;
    }

    if (isCoarseAnchor(group[0]!.candidate)) {
      const discriminatorCounts = new Map<string, number>();

      for (const entry of group) {
        if (entry.discriminator !== undefined) {
          discriminatorCounts.set(
            entry.discriminator,
            (discriminatorCounts.get(entry.discriminator) ?? 0) + 1,
          );
        }
      }

      assignments.push(
        ...group.map((entry) => {
          if (
            entry.discriminator !== undefined &&
            discriminatorCounts.get(entry.discriminator) === 1
          ) {
            return StableFindingIdentityAssignmentSchema.parse({
              findingId: entry.finding.id,
              status: "stable",
              identity: materializeIdentity(
                identityInputWithDiscriminator(entry.candidate, entry.discriminator),
              ),
              reason: "disambiguated-collision",
            });
          }

          return BrokenFindingIdentityAssignmentSchema.parse({
            findingId: entry.finding.id,
            status: "identity-broken",
            candidate: entry.candidate,
            reason: "ambiguous-collision",
          });
        }),
      );
      continue;
    }

    assignments.push(
      ...group.map((entry) =>
        BrokenFindingIdentityAssignmentSchema.parse({
          findingId: entry.finding.id,
          status: "identity-broken",
          candidate: entry.candidate,
          reason: "ambiguous-collision",
        }),
      ),
    );
  }

  return assignments.sort((left, right) => compareStableStrings(left.findingId, right.findingId));
}

/**
 * Compares a previous identity with a current finding occurrence.
 *
 * Matching anchors are stable. Any changed anchor is identity-broken, and callers must not infer
 * resolved/regressed from it.
 */
export function matchFindingIdentity(
  previousIdentity: FindingIdentity,
  currentFinding: Finding,
): IdentityDriftResult {
  const parsedPreviousIdentity = FindingIdentitySchema.parse(previousIdentity);
  const parsedFinding = FindingSchema.parse(currentFinding);
  const currentCandidate = deriveFindingIdentityCandidateFromParsed(parsedFinding);

  if (sameBaseCandidate(parsedPreviousIdentity, currentCandidate)) {
    const currentDiscriminator = secondaryDiscriminatorFor(parsedFinding, currentCandidate);

    if (
      isCoarseAnchor(currentCandidate) &&
      currentDiscriminator !== parsedPreviousIdentity.discriminator
    ) {
      return IdentityDriftResultSchema.parse({
        currentFindingId: parsedFinding.id,
        status: "identity-broken",
        previousIdentity: parsedPreviousIdentity,
        candidate: currentCandidate,
        reason: "anchor-drift",
      });
    }

    return IdentityDriftResultSchema.parse({
      currentFindingId: parsedFinding.id,
      status: "stable",
      identity: parsedPreviousIdentity,
      reason: "stable-anchor",
    });
  }

  return IdentityDriftResultSchema.parse({
    currentFindingId: parsedFinding.id,
    status: "identity-broken",
    previousIdentity: parsedPreviousIdentity,
    candidate: currentCandidate,
    reason: "anchor-drift",
  });
}

export const identityInternalsForTesting = Object.freeze({
  canonicalJson,
  normalizeAnchorForKind,
  stableEvidenceAnchor,
});
