import { z } from "zod";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import {
  BacklogSchema,
  FindingSchema,
  FindingsEnvelopeSchema,
  type Backlog,
  type BacklogEntry,
  type Evidence,
  type Finding,
  type FindingsEnvelope,
  type Location,
} from "./findings.js";
import type { PersistedArtifactRef, Report, ReportRenderer, StateStore } from "./interfaces.js";

const TEXT_ENCODER = new TextEncoder();

export type FindingsJsonRendererOptions = {
  readonly generatedAt: string;
  readonly degradation?: FindingsEnvelope["degradation"];
};

type OrderedFinding = {
  readonly finding: Finding;
  readonly backlogEntry?: BacklogEntry;
};

export type ReportArtifactSpec = {
  readonly renderer: ReportRenderer;
  readonly relativePath: string;
};

export type WrittenReportArtifact = {
  readonly artifact: PersistedArtifactRef;
  readonly report: Report;
  readonly relativePath: string;
};

export type RenderAndWriteReportArtifactsOptions = {
  readonly stateStore: StateStore;
  readonly findings: readonly Finding[];
  readonly backlog: Backlog;
  readonly specs?: readonly ReportArtifactSpec[];
};

export function createFindingsJsonRenderer(options: FindingsJsonRendererOptions): ReportRenderer {
  return {
    format: "findings-json",
    render: (findings, backlog) => renderFindingsJson(findings, backlog, options),
  };
}

export function createFindingsMarkdownRenderer(): ReportRenderer {
  return {
    format: "findings-md",
    render: (findings, backlog) => renderFindingsMarkdown(findings, backlog),
  };
}

export function createBacklogMarkdownRenderer(): ReportRenderer {
  return {
    format: "backlog",
    render: (findings, backlog) => renderBacklogMarkdown(findings, backlog),
  };
}

export function createAgentPlanMarkdownRenderer(): ReportRenderer {
  return {
    format: "agent-plan",
    render: (findings, backlog) => renderAgentPlanMarkdown(findings, backlog),
  };
}

export function createValidationReportMarkdownRenderer(): ReportRenderer {
  return {
    format: "validation-report",
    render: (findings, backlog) => renderValidationReportMarkdown(findings, backlog),
  };
}

export function defaultPlanningReportArtifactSpecs(): readonly ReportArtifactSpec[] {
  return [
    { renderer: createBacklogMarkdownRenderer(), relativePath: "reports/backlog.md" },
    { renderer: createAgentPlanMarkdownRenderer(), relativePath: "reports/agent-plan.md" },
    {
      renderer: createValidationReportMarkdownRenderer(),
      relativePath: "reports/validation-report.md",
    },
  ];
}

export async function renderAndWriteReportArtifacts(
  options: RenderAndWriteReportArtifactsOptions,
): Promise<Result<readonly WrittenReportArtifact[], SurfaceError>> {
  const written: WrittenReportArtifact[] = [];

  for (const spec of options.specs ?? defaultPlanningReportArtifactSpecs()) {
    const rendered = await spec.renderer.render(options.findings, options.backlog);

    if (!rendered.ok) {
      return rendered;
    }

    const artifact = await options.stateStore.writeArtifact({
      kind: "report",
      relativePath: spec.relativePath,
      bytes: rendered.value.bytes,
    });

    if (!artifact.ok) {
      return artifact;
    }

    written.push({
      artifact: artifact.value,
      report: rendered.value,
      relativePath: spec.relativePath,
    });
  }

  return ok(written);
}

function renderFindingsJson(
  findings: readonly Finding[],
  backlog: Backlog,
  options: FindingsJsonRendererOptions,
): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  const envelope = FindingsEnvelopeSchema.safeParse({
    schemaVersion: "1.0",
    runId: normalized.value.backlog.runId,
    generatedAt: options.generatedAt,
    findings: normalized.value.orderedFindings.map(({ finding }) => finding),
    degradation: options.degradation ?? { skippedLenses: [], reason: null },
  });

  if (!envelope.success) {
    return reportRenderError("findings.json envelope is invalid.", envelope.error);
  }

  return ok({
    format: "findings-json",
    bytes: encodeJson(envelope.data),
    byteStable: true,
  });
}

function renderFindingsMarkdown(
  findings: readonly Finding[],
  backlog: Backlog,
): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  return ok({
    format: "findings-md",
    bytes: encodeText(
      markdownForFindings(normalized.value.backlog, normalized.value.orderedFindings),
    ),
    byteStable: true,
  });
}

function renderBacklogMarkdown(
  findings: readonly Finding[],
  backlog: Backlog,
): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  return ok({
    format: "backlog",
    bytes: encodeText(
      markdownForBacklog(normalized.value.backlog, normalized.value.backlogFindings),
    ),
    byteStable: true,
  });
}

function renderAgentPlanMarkdown(
  findings: readonly Finding[],
  backlog: Backlog,
): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  return ok({
    format: "agent-plan",
    bytes: encodeText(
      markdownForAgentPlan(normalized.value.backlog, normalized.value.backlogFindings),
    ),
    byteStable: true,
  });
}

function renderValidationReportMarkdown(
  findings: readonly Finding[],
  backlog: Backlog,
): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  return ok({
    format: "validation-report",
    bytes: encodeText(
      markdownForValidationReport(normalized.value.backlog, normalized.value.backlogFindings),
    ),
    byteStable: true,
  });
}

function normalizeReportInputs(
  findings: readonly Finding[],
  backlog: Backlog,
): Result<
  {
    readonly findings: readonly Finding[];
    readonly backlog: Backlog;
    readonly backlogFindings: OrderedFinding[];
    readonly orderedFindings: OrderedFinding[];
  },
  SurfaceError
> {
  const parsedFindings = z.array(FindingSchema).safeParse(findings);

  if (!parsedFindings.success) {
    return reportRenderError("Report findings are invalid.", parsedFindings.error);
  }

  const parsedBacklog = BacklogSchema.safeParse(backlog);

  if (!parsedBacklog.success) {
    return reportRenderError("Report backlog is invalid.", parsedBacklog.error);
  }

  const findingById = new Map<string, Finding>();

  for (const finding of parsedFindings.data) {
    if (findingById.has(finding.id)) {
      return reportRenderError(`Report findings contain duplicate id "${finding.id}".`);
    }

    findingById.set(finding.id, finding);
  }

  const backlogFindings: OrderedFinding[] = [];
  const seenBacklogFindingIds = new Set<string>();

  for (const entry of parsedBacklog.data.entries) {
    if (seenBacklogFindingIds.has(entry.findingId)) {
      return reportRenderError(`Backlog contains duplicate finding "${entry.findingId}".`);
    }

    const finding = findingById.get(entry.findingId);

    if (finding === undefined) {
      return reportRenderError(`Backlog entry references missing finding "${entry.findingId}".`);
    }

    backlogFindings.push({ finding, backlogEntry: entry });
    seenBacklogFindingIds.add(entry.findingId);
  }

  const orderedFindings: OrderedFinding[] = [...backlogFindings];
  const remainingFindings = parsedFindings.data
    .filter((finding) => !seenBacklogFindingIds.has(finding.id))
    .sort((left, right) => compareCodeUnit(left.id, right.id));

  for (const finding of remainingFindings) {
    orderedFindings.push({ finding });
  }

  return ok({
    findings: parsedFindings.data,
    backlog: parsedBacklog.data,
    backlogFindings,
    orderedFindings,
  });
}

function markdownForFindings(backlog: Backlog, orderedFindings: readonly OrderedFinding[]): string {
  const lines = [
    "# Surface Findings",
    "",
    `Run: ${inlineCode(backlog.runId)}`,
    `Findings: ${orderedFindings.length}`,
    "",
  ];

  if (orderedFindings.length === 0) {
    lines.push("No findings.", "");
    return lines.join("\n");
  }

  for (let index = 0; index < orderedFindings.length; index += 1) {
    const { finding, backlogEntry } = orderedFindings[index]!;
    const displayNumber = index + 1;

    lines.push(
      `## ${displayNumber}. [${finding.severityBand}] ${escapeMarkdownLine(finding.title)}`,
      "",
      `- ID: ${inlineCode(finding.id)}`,
      `- Lens: ${escapeMarkdownLine(finding.lens)}`,
      `- Method: ${finding.method}`,
      `- Confidence: ${finding.confidenceBand}`,
      `- Location: ${formatLocation(finding.location)}`,
      `- Human gate: ${finding.gatedForHuman ? "yes" : "no"}`,
    );

    if (backlogEntry !== undefined) {
      lines.push(`- Backlog rank: ${backlogEntry.rank}`);
    }

    if (backlogEntry?.demotedAsDuplicateOf !== undefined) {
      lines.push(`- Duplicate of: ${inlineCode(backlogEntry.demotedAsDuplicateOf)}`);
    }

    lines.push("", "Rationale:", escapeMarkdownBlock(finding.rationale));

    if (finding.evidence.length > 0) {
      lines.push(
        "",
        "Evidence:",
        ...finding.evidence.map((evidence) => `- ${formatEvidence(evidence)}`),
      );
    }

    if (finding.citedHeuristics.length > 0) {
      lines.push(
        "",
        "Cited heuristics:",
        ...finding.citedHeuristics.map((id) => `- ${inlineCode(id)}`),
      );
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function markdownForBacklog(backlog: Backlog, orderedFindings: readonly OrderedFinding[]): string {
  const lines = [
    "# Surface Backlog",
    "",
    `Run: ${inlineCode(backlog.runId)}`,
    `Backlog: ${inlineCode(backlog.id)}`,
    `Items: ${orderedFindings.length}`,
    "",
  ];

  if (orderedFindings.length === 0) {
    lines.push("No backlog items.", "");
    return lines.join("\n");
  }

  for (let index = 0; index < orderedFindings.length; index += 1) {
    const { finding, backlogEntry } = orderedFindings[index]!;
    const rank = backlogEntry?.rank ?? index + 1;

    lines.push(
      `## ${rank}. [${finding.severityBand}] ${escapeMarkdownLine(finding.title)}`,
      "",
      `- Finding: ${inlineCode(finding.id)}`,
      `- Issue type: ${inlineCode(finding.issueType)}`,
      `- Method: ${finding.method}`,
      `- Confidence: ${finding.confidenceBand}`,
      `- Location: ${formatLocation(finding.location)}`,
      `- Human gate: ${finding.gatedForHuman ? "yes" : "no"}`,
    );

    if (backlogEntry !== undefined) {
      lines.push(`- Priority: ${backlogEntry.priority}`);
    }

    if (backlogEntry?.demotedAsDuplicateOf !== undefined) {
      lines.push(`- Duplicate of: ${inlineCode(backlogEntry.demotedAsDuplicateOf)}`);
    }

    if (finding.suggestedPatch !== undefined) {
      lines.push(
        `- Suggested patch: ${finding.suggestedPatch.kind}`,
        fencedCodeBlock(finding.suggestedPatch.change),
      );
    }

    lines.push("", "Why it matters:", escapeMarkdownBlock(finding.rationale), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function markdownForAgentPlan(
  backlog: Backlog,
  orderedFindings: readonly OrderedFinding[],
): string {
  const lines = [
    "# Surface Agent Plan",
    "",
    `Run: ${inlineCode(backlog.runId)}`,
    `Backlog: ${inlineCode(backlog.id)}`,
    "",
  ];

  if (orderedFindings.length === 0) {
    lines.push("No implementation tasks.", "");
    return lines.join("\n");
  }

  for (let index = 0; index < orderedFindings.length; index += 1) {
    const { finding, backlogEntry } = orderedFindings[index]!;

    lines.push(
      `## Task ${index + 1}: ${escapeMarkdownLine(finding.title)}`,
      "",
      `- Finding: ${inlineCode(finding.id)}`,
      `- Backlog rank: ${backlogEntry?.rank ?? index + 1}`,
      `- Target: ${formatLocation(finding.location)}`,
      `- Severity: ${finding.severityBand}`,
      `- Execution: ${finding.gatedForHuman ? "ask for human decision before code changes" : "agent-executable"}`,
      "- Acceptance: re-run the relevant audit or validation check and confirm the finding is resolved, waived, or still reported with updated evidence.",
    );

    if (finding.suggestedPatch !== undefined) {
      lines.push(
        `- Suggested patch: ${finding.suggestedPatch.kind}`,
        fencedCodeBlock(finding.suggestedPatch.change),
      );
    }

    if (backlogEntry?.demotedAsDuplicateOf !== undefined) {
      lines.push(`- Related duplicate: ${inlineCode(backlogEntry.demotedAsDuplicateOf)}`);
    }

    lines.push("", "Context:", escapeMarkdownBlock(finding.rationale), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatValidationEvidence(
  evidence: readonly Finding["evidence"][number][] | undefined,
): string {
  if (evidence === undefined || evidence.length === 0) {
    return "none";
  }

  return evidence.map(formatValidationEvidenceEntry).join("; ");
}

function formatValidationEvidenceEntry(evidence: Finding["evidence"][number]): string {
  switch (evidence.kind) {
    case "tool-result":
      return [
        `tool ${inlineCode(String(evidence.tool))}`,
        `rule ${inlineCode(String(evidence.rule))}`,
        `measured ${inlineCode(String(evidence.measuredValue))}`,
        evidence.threshold === undefined
          ? undefined
          : `threshold ${inlineCode(String(evidence.threshold))}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join("; ");
    case "dom":
      return [
        `dom selector ${inlineCode(String(evidence.selector))}`,
        evidence.elementRef === undefined
          ? undefined
          : `element ${inlineCode(String(evidence.elementRef))}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join("; ");
    case "screenshot-region":
      return `screenshot ${inlineCode(String(evidence.artifactId))} x:${evidence.rect.x}, y:${evidence.rect.y}, w:${evidence.rect.width}, h:${evidence.rect.height}`;
    case "cited-heuristic":
      return `heuristic ${inlineCode(String(evidence.knowledgeEntryId))}`;
  }
}

function markdownForValidationReport(
  backlog: Backlog,
  orderedFindings: readonly OrderedFinding[],
): string {
  const lines = [
    "# Surface Validation Report",
    "",
    `Run: ${inlineCode(backlog.runId)}`,
    `Backlog: ${inlineCode(backlog.id)}`,
    "Status: not run",
    "",
  ];

  if (orderedFindings.length === 0) {
    lines.push("No findings require validation.", "");
    return lines.join("\n");
  }

  lines.push("## Required Checks", "");

  for (let index = 0; index < orderedFindings.length; index += 1) {
    const { finding, backlogEntry } = orderedFindings[index]!;

    lines.push(
      `### ${backlogEntry?.rank ?? index + 1}. ${escapeMarkdownLine(finding.title)}`,
      "",
      `- Finding: ${inlineCode(finding.id)}`,
      `- Expected status: ${finding.gatedForHuman ? "human-reviewed" : "resolved-or-reported"}`,
      `- Evidence to re-check: ${formatValidationEvidence(finding.evidence)}`,
      `- Location: ${formatLocation(finding.location)}`,
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatLocation(location: Location): string {
  return [
    location.file === undefined ? undefined : `file ${inlineCode(location.file)}`,
    location.component === undefined ? undefined : `component ${inlineCode(location.component)}`,
    location.selector === undefined ? undefined : `selector ${inlineCode(location.selector)}`,
    location.elementRef === undefined ? undefined : `element ${inlineCode(location.elementRef)}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
}

function formatEvidence(evidence: Evidence): string {
  switch (evidence.kind) {
    case "tool-result":
      return [
        `tool ${inlineCode(evidence.tool)}`,
        `rule ${inlineCode(evidence.rule)}`,
        `measured ${inlineCode(evidence.measuredValue)}`,
        evidence.threshold === undefined
          ? undefined
          : `threshold ${inlineCode(evidence.threshold)}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join("; ");
    case "dom":
      return [
        `dom selector ${inlineCode(evidence.selector)}`,
        evidence.elementRef === undefined
          ? undefined
          : `element ${inlineCode(evidence.elementRef)}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join("; ");
    case "screenshot-region":
      return `screenshot ${inlineCode(evidence.artifactId)} x:${evidence.rect.x}, y:${evidence.rect.y}, w:${evidence.rect.width}, h:${evidence.rect.height}`;
    case "cited-heuristic":
      return `heuristic ${inlineCode(evidence.knowledgeEntryId)}`;
  }
}

function inlineCode(value: string): string {
  const normalized = normalizeSingleLine(value);
  const delimiter = "`".repeat(longestBacktickRun(normalized) + 1);
  const needsPadding =
    normalized.includes("`") || normalized.startsWith(" ") || normalized.endsWith(" ");
  const content = needsPadding ? ` ${normalized} ` : normalized;

  return `${delimiter}${content}${delimiter}`;
}

function fencedCodeBlock(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const delimiter = "`".repeat(Math.max(3, longestBacktickRun(normalized) + 1));

  return ["", delimiter, normalized, delimiter].join("\n");
}

function escapeMarkdownLine(value: string): string {
  return escapeMarkdown(value);
}

function escapeMarkdownBlock(value: string): string {
  return value.replace(/\r\n/g, "\n").split("\n").map(escapeMarkdown).join("\n");
}

function escapeMarkdown(value: string): string {
  return normalizeSingleLine(value)
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/!/g, "\\!")
    .replace(/\|/g, "\\|");
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}

function encodeJson(value: FindingsEnvelope): Uint8Array {
  return encodeText(`${JSON.stringify(toStableJsonValue(value), null, 2)}\n`);
}

function encodeText(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

function reportRenderError(message: string, cause?: unknown): Result<never, SurfaceError> {
  return err(createSurfaceError("export_failed", message, cause === undefined ? {} : { cause }));
}

function compareCodeUnit(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function toStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodeUnit(left, right))
        .map(([key, entry]) => [key, toStableJsonValue(entry)]),
    );
  }

  return value;
}
