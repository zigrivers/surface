import type {
  EvidenceBundle,
  QaDegradation,
  QaEvidenceArtifact,
  QaRun,
  QaTarget,
} from "./schemas.js";

export type QaReportArtifactSummary = {
  readonly checksum: string;
  readonly id: string;
  readonly kind: QaEvidenceArtifact["kind"];
  readonly mcpReadable: boolean;
  readonly mediaType: string;
  readonly path: string;
  readonly redacted: boolean;
  readonly sensitiveRaw: boolean;
  readonly sizeBytes: number;
};

export type QaReportEvidenceBundleSummary = {
  readonly artifacts: readonly QaReportArtifactSummary[];
  readonly containsSensitiveRaw: boolean;
  readonly id: string;
  readonly manifestPath: string;
  readonly qaRunId: string;
  readonly redacted: boolean;
  readonly sanitizedAtCapture: boolean;
  readonly sourceRunManifestDigest: string;
};

export type QaReportManifest = {
  readonly candidateFindings: readonly string[];
  readonly candidateFlows: readonly string[];
  readonly completedAt?: string;
  readonly degradation: readonly QaDegradation[];
  readonly evidenceBundles: readonly QaReportEvidenceBundleSummary[];
  readonly flowRuns: QaRun["flowRuns"];
  readonly findings: readonly string[];
  readonly mode: QaRun["mode"];
  readonly qaRunId: string;
  readonly reportId: string;
  readonly startedAt: string;
  readonly status: QaRun["status"];
  readonly target: QaTarget;
};

export type QaReportInput = {
  readonly artifactSummaries?: readonly string[];
  readonly evidenceBundles: readonly EvidenceBundle[];
  readonly qaRun: QaRun;
  readonly reportId: string;
};

const SENSITIVE_LINE_PATTERNS = [
  /\bAuthorization\s*:[^\n\r]*/gi,
  /\bSet-Cookie\s*:[^\n\r]*/gi,
  /\bCookie\s*:[^\n\r]*/gi,
  /\blocalStorage\b\s*[:=][^\n\r]*/gi,
  /\bsessionStorage\b\s*[:=][^\n\r]*/gi,
  /data:(?:image|video)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=_-]+/gi,
] as const;

export function createQaReportManifest(input: QaReportInput): QaReportManifest {
  const qaRun = input.qaRun;

  return {
    candidateFindings: [...qaRun.candidateFindings],
    candidateFlows: [...qaRun.candidateFlows],
    ...(qaRun.completedAt === undefined ? {} : { completedAt: qaRun.completedAt }),
    degradation: qaRun.degradation.map((entry) => ({ ...entry })),
    evidenceBundles: input.evidenceBundles.map(evidenceBundleSummaryFor),
    flowRuns: qaRun.flowRuns.map((flowRun) => ({ ...flowRun })),
    findings: [...qaRun.findings],
    mode: qaRun.mode,
    qaRunId: qaRun.id,
    reportId: input.reportId,
    startedAt: qaRun.startedAt,
    status: qaRun.status,
    target: { ...qaRun.target },
  };
}

export function createQaJsonReport(input: QaReportInput): string {
  return `${JSON.stringify(createQaReportManifest(input), null, 2)}\n`;
}

export function createQaMarkdownReport(input: QaReportInput): string {
  const manifest = createQaReportManifest(input);
  const lines = [
    `# Browser QA Report ${manifest.reportId}`,
    "",
    `- QA run: ${manifest.qaRunId}`,
    `- Status: ${manifest.status}`,
    `- Mode: ${manifest.mode}`,
    `- Target: ${manifest.target.kind} ${manifest.target.ref}`,
    `- Flow runs: ${manifest.flowRuns.length}`,
    `- Findings: ${manifest.findings.length}`,
    `- Candidate findings: ${manifest.candidateFindings.length}`,
    `- Evidence bundles: ${manifest.evidenceBundles.length}`,
  ];

  if (manifest.degradation.length > 0) {
    lines.push("", "## Degradation");
    for (const degradation of manifest.degradation) {
      lines.push(`- ${degradation.severity}: ${degradation.code} - ${degradation.message}`);
    }
  }

  if (input.artifactSummaries !== undefined && input.artifactSummaries.length > 0) {
    lines.push("", "## Redacted Summaries");
    for (const summary of input.artifactSummaries) {
      lines.push(`- ${redactQaReportText(summary)}`);
    }
  }

  lines.push("", "## Evidence");
  for (const bundle of manifest.evidenceBundles) {
    lines.push(
      `- ${bundle.id}: ${bundle.artifacts.length} artifact(s), manifest ${bundle.manifestPath}`,
    );
    for (const artifact of bundle.artifacts) {
      lines.push(
        `  - ${artifact.id}: ${artifact.kind}, ${artifact.mediaType}, ${artifact.checksum}, ${artifact.path}, redacted=${artifact.redacted}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function evidenceBundleSummaryFor(bundle: EvidenceBundle): QaReportEvidenceBundleSummary {
  return {
    artifacts: bundle.artifacts.map(artifactSummaryFor),
    containsSensitiveRaw: bundle.containsSensitiveRaw,
    id: bundle.id,
    manifestPath: bundle.manifestPath,
    qaRunId: bundle.qaRunId,
    redacted: bundle.redacted,
    sanitizedAtCapture: bundle.sanitizedAtCapture,
    sourceRunManifestDigest: bundle.sourceRunManifestDigest,
  };
}

function artifactSummaryFor(artifact: QaEvidenceArtifact): QaReportArtifactSummary {
  return {
    checksum: artifact.sha256,
    id: artifact.id,
    kind: artifact.kind,
    mcpReadable: artifact.mcpReadable,
    mediaType: artifact.mediaType,
    path: artifact.path,
    redacted: artifact.redacted,
    sensitiveRaw: artifact.sensitiveRaw,
    sizeBytes: artifact.sizeBytes,
  };
}

function redactQaReportText(value: string): string {
  return SENSITIVE_LINE_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[redacted]"),
    value,
  );
}
