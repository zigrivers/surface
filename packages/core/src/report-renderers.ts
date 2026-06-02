import { z } from "zod";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import {
  BacklogSchema,
  FindingSchema as RuntimeFindingSchema,
  FindingsEnvelopeSchema,
  type Backlog,
  type BacklogEntry,
  type Evidence,
  type Finding,
  type FindingsEnvelope,
  type Location,
} from "./findings.js";
import type {
  KnowledgeEntry,
  KnowledgeSource,
  PersistedArtifactRef,
  Report,
  ReportRenderer,
  StateStore,
} from "./interfaces.js";

const TEXT_ENCODER = new TextEncoder();
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const ANSI_OSC_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\][\\s\\S]*?(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\)`,
  "g",
);
const C1_CSI_PATTERN = new RegExp(`${String.fromCharCode(0x9b)}[0-?]*[ -/]*[@-~]`, "g");
const C1_OSC_PATTERN = new RegExp(
  `${String.fromCharCode(0x9d)}[\\s\\S]*?(?:${String.fromCharCode(0x9c)}|${String.fromCharCode(7)})`,
  "g",
);
const DISALLOWED_CONTROL_PATTERN = /\p{Cc}/gu;
const SINGLE_LINE_SEPARATOR_PATTERN = /[\t\r\n]+/g;
const MAX_TERMINAL_SANITIZE_DEPTH = 32;

export type FindingsJsonRendererOptions = {
  readonly generatedAt: string;
  readonly degradation?: FindingsEnvelope["degradation"];
};

export const SurfaceSarifLogSchema = z
  .object({
    $schema: z.string().url(),
    version: z.literal("2.1.0"),
    runs: z
      .array(
        z
          .object({
            tool: z
              .object({
                driver: z
                  .object({
                    name: z.literal("surface"),
                    informationUri: z.string().url(),
                    rules: z.array(
                      z
                        .object({
                          id: z.string().min(1),
                          name: z.string().min(1),
                          shortDescription: z.object({ text: z.string().min(1) }).strict(),
                        })
                        .passthrough(),
                    ),
                  })
                  .passthrough(),
              })
              .passthrough(),
            results: z.array(
              z
                .object({
                  level: z.enum(["error", "warning", "note"]),
                  message: z.object({ text: z.string().min(1) }).strict(),
                  ruleId: z.string().min(1),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();
export type SurfaceSarifLog = z.infer<typeof SurfaceSarifLogSchema>;

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

export type ExplainRendererOptions = {
  readonly findingId: string;
  readonly knowledge?: KnowledgeSource;
};

type ExplanationContext = {
  readonly finding: Finding;
  readonly citedHeuristics: readonly KnowledgeEntry[];
};

export function createFindingsJsonRenderer(options: FindingsJsonRendererOptions): ReportRenderer {
  return {
    format: "findings-json",
    render: (findings, backlog) => renderFindingsJson(findings, backlog, options),
  };
}

export function createSarifRenderer(): ReportRenderer {
  return {
    format: "sarif",
    render: (findings, backlog) => renderSarif(findings, backlog),
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

export function createExplainMarkdownRenderer(options: ExplainRendererOptions): ReportRenderer {
  return {
    format: "explain-md",
    render: (findings) => renderExplainMarkdown(findings, options),
  };
}

export function createExplainJsonRenderer(options: ExplainRendererOptions): ReportRenderer {
  return {
    format: "explain-json",
    render: (findings) => renderExplainJson(findings, options),
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

function renderSarif(findings: readonly Finding[], backlog: Backlog): Result<Report, SurfaceError> {
  const normalized = normalizeReportInputs(findings, backlog);

  if (!normalized.ok) {
    return normalized;
  }

  const sarif = SurfaceSarifLogSchema.safeParse(
    sanitizeTerminalControlValue(sarifForReport(normalized.value.orderedFindings, backlog)),
  );

  if (!sarif.success) {
    return reportRenderError("SARIF report is invalid.", sarif.error);
  }

  return ok({
    format: "sarif",
    bytes: encodeStableJson(sarif.data),
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

async function renderExplainMarkdown(
  findings: readonly Finding[],
  options: ExplainRendererOptions,
): Promise<Result<Report, SurfaceError>> {
  const context = await buildExplanationContext(findings, options);

  if (!context.ok) {
    return context;
  }

  return ok({
    format: "explain-md",
    bytes: encodeText(markdownForExplanation(context.value)),
    byteStable: true,
  });
}

async function renderExplainJson(
  findings: readonly Finding[],
  options: ExplainRendererOptions,
): Promise<Result<Report, SurfaceError>> {
  const context = await buildExplanationContext(findings, options);

  if (!context.ok) {
    return context;
  }

  const { finding, citedHeuristics } = context.value;

  return ok({
    format: "explain-json",
    bytes: encodeStableJson(
      sanitizeTerminalControlValue({
        schemaVersion: "1.0",
        finding,
        rationale: finding.rationale,
        resolvedCitedHeuristics: citedHeuristics,
        evidence: finding.evidence,
      }),
    ),
    byteStable: true,
  });
}

async function buildExplanationContext(
  findings: readonly Finding[],
  options: ExplainRendererOptions,
): Promise<Result<ExplanationContext, SurfaceError>> {
  const candidate = findings.find((entry) => entry.id === options.findingId);

  if (candidate === undefined) {
    return err(
      createSurfaceError("finding_not_found", "Finding could not be explained.", {
        details: { findingId: options.findingId },
      }),
    );
  }

  if (hasEmptyEvidence(candidate)) {
    return err(
      createSurfaceError("evidence_missing", "Finding has no verifiable evidence.", {
        details: { findingId: candidateFindingId(candidate, options.findingId) },
      }),
    );
  }

  const parsedFinding = RuntimeFindingSchema.safeParse(candidate);

  if (!parsedFinding.success) {
    return reportRenderError("Explain finding is invalid.", parsedFinding.error);
  }

  const finding = parsedFinding.data;

  const citedHeuristics = await resolveCitedHeuristics(finding, options.knowledge);

  if (!citedHeuristics.ok) {
    return citedHeuristics;
  }

  return ok({ finding, citedHeuristics: citedHeuristics.value });
}

async function resolveCitedHeuristics(
  finding: Finding,
  knowledge: KnowledgeSource | undefined,
): Promise<Result<readonly KnowledgeEntry[], SurfaceError>> {
  if (knowledge === undefined) {
    return ok([]);
  }

  const entries: KnowledgeEntry[] = [];

  for (const id of finding.citedHeuristics ?? []) {
    const resolved = await knowledge.resolve(id);

    if (!resolved.ok) {
      return err(
        createSurfaceError("config_invalid", "Cited heuristic could not be resolved.", {
          cause: resolved.error,
          details: { findingId: finding.id, knowledgeEntryId: id },
        }),
      );
    }

    entries.push(resolved.value);
  }

  return ok(entries);
}

function hasEmptyEvidence(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const evidence = (value as { readonly evidence?: unknown }).evidence;

  return Array.isArray(evidence) && evidence.length === 0;
}

function candidateFindingId(value: unknown, fallback: string): string {
  if (value === null || typeof value !== "object") {
    return fallback;
  }

  const id = (value as { readonly id?: unknown }).id;

  return typeof id === "string" ? id : fallback;
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
  const parsedFindings = z.array(RuntimeFindingSchema).safeParse(findings);

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

function sarifForReport(
  orderedFindings: readonly OrderedFinding[],
  backlog: Backlog,
): SurfaceSarifLog {
  const rulesById = new Map<string, ReturnType<typeof sarifRuleForFinding>>();

  for (const { finding } of orderedFindings) {
    if (!rulesById.has(finding.issueType)) {
      rulesById.set(finding.issueType, sarifRuleForFinding(finding));
    }
  }

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "surface",
            informationUri: "https://github.com/zigrivers/surface",
            rules: [...rulesById.values()].sort((left, right) =>
              compareCodeUnit(left.id, right.id),
            ),
          },
        },
        automationDetails: { id: backlog.runId },
        results: orderedFindings.map(({ finding, backlogEntry }) =>
          sarifResultForFinding(finding, backlogEntry),
        ),
      },
    ],
  };
}

function sarifRuleForFinding(finding: Finding) {
  return {
    id: finding.issueType,
    name: finding.issueType,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.rationale },
    properties: {
      lens: finding.lens,
      citedHeuristics: finding.citedHeuristics ?? [],
    },
  };
}

function sarifResultForFinding(finding: Finding, backlogEntry: BacklogEntry | undefined) {
  return {
    ruleId: finding.issueType,
    level: sarifLevelFor(finding.severityBand),
    message: { text: finding.rationale },
    locations: [sarifLocationFor(finding)],
    partialFingerprints: {
      "surface.findingId": finding.id,
      "surface.issueType": finding.issueType,
    },
    properties: {
      findingId: finding.id,
      confidenceBand: finding.confidenceBand,
      gatedForHuman: finding.gatedForHuman,
      lens: finding.lens,
      method: finding.method,
      severityBand: finding.severityBand,
      ...(backlogEntry === undefined ? {} : { backlogRank: backlogEntry.rank }),
    },
  };
}

function sarifLocationFor(finding: Finding) {
  return {
    physicalLocation: {
      artifactLocation: {
        uri: finding.location.file ?? `surface://${finding.id}`,
      },
    },
    logicalLocations: [
      {
        name:
          finding.location.component ??
          finding.location.selector ??
          finding.location.elementRef ??
          finding.id,
        fullyQualifiedName: [
          finding.location.file,
          finding.location.component,
          finding.location.selector,
          finding.location.elementRef,
        ]
          .filter((part): part is string => part !== undefined)
          .join(" "),
      },
    ],
  };
}

function sarifLevelFor(severityBand: Finding["severityBand"]): "error" | "warning" | "note" {
  if (severityBand === "P0" || severityBand === "P1") {
    return "error";
  }

  if (severityBand === "P2") {
    return "warning";
  }

  return "note";
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

    if ((finding.citedHeuristics ?? []).length > 0) {
      lines.push(
        "",
        "Cited heuristics:",
        ...(finding.citedHeuristics ?? []).map((id) => `- ${inlineCode(id)}`),
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

function formatValidationEvidence(
  evidence: readonly Finding["evidence"][number][] | undefined,
): string {
  if (evidence === undefined || evidence.length === 0) {
    return "none";
  }

  return evidence.map(formatEvidence).join("; ");
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

function markdownForExplanation(context: ExplanationContext): string {
  const { finding, citedHeuristics } = context;
  const lines = [
    "# Surface Explain",
    "",
    `Finding: ${inlineCode(finding.id)}`,
    `Severity: ${escapeMarkdownLine(finding.severityBand)}`,
    `Confidence: ${escapeMarkdownLine(finding.confidenceBand)}`,
    `Method: ${escapeMarkdownLine(finding.method)}`,
    `Location: ${formatLocation(finding.location)}`,
    "",
    `## ${escapeMarkdownLine(finding.title)}`,
    "",
    "Why it matters:",
    escapeMarkdownBlock(finding.rationale),
    "",
    "Evidence you can verify:",
    ...finding.evidence.map((evidence) => `- ${formatEvidence(evidence)}`),
    "",
  ];

  if (citedHeuristics.length > 0) {
    lines.push("Cited guidance:", "");

    for (const entry of citedHeuristics) {
      lines.push(
        `- ${escapeMarkdownLine(entry.title)} (${inlineCode(entry.id)})`,
        `  Summary: ${escapeMarkdownLine(entry.summary)}`,
      );

      if (entry.citation !== undefined) {
        lines.push(`  Source: ${escapeMarkdownLine(entry.citation.source)}`);
      }
    }
  } else if ((finding.citedHeuristics ?? []).length > 0) {
    lines.push(
      "Cited guidance:",
      "",
      ...(finding.citedHeuristics ?? []).map((id) => `- ${inlineCode(id)}`),
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
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
  return escapeMarkdown(normalizeSingleLine(value));
}

function escapeMarkdownBlock(value: string): string {
  return stripTerminalControlPreservingWhitespace(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(escapeMarkdown)
    .join("\n");
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
  return stripTerminalControl(value.replace(SINGLE_LINE_SEPARATOR_PATTERN, " "));
}

function stripTerminalControl(value: string): string {
  return value
    .replace(ANSI_OSC_PATTERN, "")
    .replace(C1_OSC_PATTERN, "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(C1_CSI_PATTERN, "")
    .replace(DISALLOWED_CONTROL_PATTERN, "");
}

function stripTerminalControlPreservingWhitespace(value: string): string {
  return Array.from(
    value
      .replace(ANSI_OSC_PATTERN, "")
      .replace(C1_OSC_PATTERN, "")
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(C1_CSI_PATTERN, ""),
  )
    .filter((char) => {
      const code = char.charCodeAt(0);
      return (
        code === 9 ||
        code === 10 ||
        code === 13 ||
        (code >= 32 && code !== 127 && (code < 128 || code > 159))
      );
    })
    .join("");
}

function sanitizeTerminalControlValue<T>(value: T): T {
  return sanitizeTerminalControlUnknown(value) as T;
}

function sanitizeTerminalControlUnknown(value: unknown, depth = 0): unknown {
  if (depth > MAX_TERMINAL_SANITIZE_DEPTH) {
    return value;
  }

  if (typeof value === "string") {
    return stripTerminalControlPreservingWhitespace(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown) => sanitizeTerminalControlUnknown(entry, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);

    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        stripTerminalControl(key.replace(SINGLE_LINE_SEPARATOR_PATTERN, " ")),
        sanitizeTerminalControlUnknown(entry, depth + 1),
      ]),
    );
  }

  return value;
}

function encodeJson(value: FindingsEnvelope): Uint8Array {
  return encodeStableJson(value);
}

function encodeStableJson(value: unknown): Uint8Array {
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
