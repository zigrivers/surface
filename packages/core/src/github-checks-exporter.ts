import { Octokit } from "@octokit/rest";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import type { Backlog } from "./findings.js";
import type { SurfaceSarifLog } from "./report-renderers.js";

type GitHubCheckAnnotation = {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: "failure" | "notice" | "warning";
  readonly message: string;
  readonly title?: string;
  readonly raw_details?: string;
};

type GitHubCheckCreateInput = {
  readonly owner: string;
  readonly repo: string;
  readonly name: string;
  readonly head_sha: string;
  readonly status: "completed";
  readonly conclusion: "failure" | "neutral" | "success";
  readonly output: {
    readonly title: string;
    readonly summary: string;
    readonly annotations?: GitHubCheckAnnotation[];
  };
};

type UnknownRecord = Readonly<Record<string, unknown>>;

type GitHubChecksClient = {
  readonly checks: {
    create(input: GitHubCheckCreateInput): Promise<unknown>;
  };
};

export type GitHubChecksExporterOptions = {
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
  readonly token?: string;
  readonly checkName?: string;
  readonly userAgent?: string;
  readonly client?: GitHubChecksClient;
  readonly maxAnnotations?: number;
};

export type GitHubChecksExportInput = {
  readonly backlog: Backlog;
  readonly sarif: SurfaceSarifLog;
  readonly localArtifactPath?: string;
};

export type GitHubChecksExport = {
  readonly id: string;
  readonly target: "github-checks";
  readonly status: "complete" | "failed";
  readonly synced: readonly string[];
  readonly unsynced: readonly string[];
  readonly annotationCount: number;
  readonly checkName: string;
};

const DEFAULT_GITHUB_USER_AGENT =
  process.env.npm_package_version === undefined
    ? "surface"
    : `surface/${process.env.npm_package_version}`;
const DEFAULT_CHECK_NAME = "Surface findings";
const GITHUB_CHECK_ANNOTATION_LIMIT = 50;

export function createGitHubChecksExporter(options: GitHubChecksExporterOptions) {
  const checkName = options.checkName ?? DEFAULT_CHECK_NAME;
  const maxAnnotations = Math.max(
    0,
    Math.min(
      options.maxAnnotations ?? GITHUB_CHECK_ANNOTATION_LIMIT,
      GITHUB_CHECK_ANNOTATION_LIMIT,
    ),
  );
  const client = createClient(options);

  return {
    target: "github-checks" as const,
    export: async (
      input: GitHubChecksExportInput,
    ): Promise<Result<GitHubChecksExport, SurfaceError>> => {
      const annotations = annotationsForSarif(input.sarif).slice(0, maxAnnotations);
      const synced = input.backlog.entries.map((entry) => entry.findingId);
      const createResult = await createCheckRun(client, {
        owner: options.owner,
        repo: options.repo,
        name: checkName,
        head_sha: options.headSha,
        status: "completed",
        conclusion: conclusionForSarif(input.sarif),
        output: {
          title: checkName,
          summary: summaryFor(input, annotations.length),
          ...(annotations.length === 0 ? {} : { annotations }),
        },
      });

      if (!createResult.ok) {
        return err(createResult.error);
      }

      return ok({
        id: `github-checks:${input.backlog.id}`,
        target: "github-checks",
        status: "complete",
        synced,
        unsynced: [],
        annotationCount: annotations.length,
        checkName,
      });
    },
  };
}

function createClient(options: GitHubChecksExporterOptions): GitHubChecksClient {
  if (options.client !== undefined) {
    return options.client;
  }

  const octokit = new Octokit({
    auth: options.token,
    userAgent: options.userAgent ?? DEFAULT_GITHUB_USER_AGENT,
  });

  return {
    checks: {
      create: async (input) => octokit.checks.create(input),
    },
  };
}

async function createCheckRun(
  client: GitHubChecksClient,
  input: GitHubCheckCreateInput,
): Promise<Result<unknown, SurfaceError>> {
  try {
    return ok(await client.checks.create(input));
  } catch (cause) {
    return err(
      createSurfaceError("export_failed", "GitHub Checks export failed.", {
        cause,
      }),
    );
  }
}

function annotationsForSarif(sarif: SurfaceSarifLog): GitHubCheckAnnotation[] {
  const run = sarif.runs[0];

  if (run === undefined) {
    return [];
  }

  return run.results.flatMap((result) => {
    const location = firstRecord(result.locations);
    const physicalLocation = recordValue(location?.physicalLocation);
    const artifactLocation = recordValue(physicalLocation?.artifactLocation);
    const artifactUri = stringValue(artifactLocation?.uri);

    if (
      artifactUri === undefined ||
      artifactUri.startsWith("surface://") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(artifactUri)
    ) {
      return [];
    }

    const region = recordValue(physicalLocation?.region);
    const startLine = Math.max(1, numberValue(region?.startLine) ?? 1);
    const endLine = Math.max(startLine, numberValue(region?.endLine) ?? startLine);
    const rawDetails = rawDetailsFor(result.properties);
    const annotation: GitHubCheckAnnotation = {
      path: artifactUri,
      start_line: startLine,
      end_line: endLine,
      annotation_level: annotationLevelFor(result.level),
      message: result.message.text,
      title: result.ruleId,
      ...(rawDetails === undefined ? {} : { raw_details: rawDetails }),
    };

    return [annotation];
  });
}

function annotationLevelFor(level: string): GitHubCheckAnnotation["annotation_level"] {
  if (level === "error") {
    return "failure";
  }

  if (level === "warning") {
    return "warning";
  }

  return "notice";
}

function conclusionForSarif(sarif: SurfaceSarifLog): GitHubCheckCreateInput["conclusion"] {
  const levels = sarif.runs[0]?.results.map((result) => result.level) ?? [];

  if (levels.includes("error")) {
    return "failure";
  }

  if (levels.length > 0) {
    return "neutral";
  }

  return "success";
}

function summaryFor(input: GitHubChecksExportInput, annotationCount: number): string {
  return [
    `Backlog: ${input.backlog.id}`,
    `Run: ${input.backlog.runId}`,
    `Findings: ${input.backlog.entries.length}`,
    `Annotations: ${annotationCount}`,
    input.localArtifactPath === undefined
      ? "Local artifact: state"
      : `Local artifact: ${input.localArtifactPath}`,
  ].join("\n");
}

function rawDetailsFor(properties: unknown): string | undefined {
  if (!isRecord(properties)) {
    return undefined;
  }

  const findingId = stringValue(properties.findingId);
  const severityBand = stringValue(properties.severityBand);
  const confidenceBand = stringValue(properties.confidenceBand);

  const lines = [
    findingId === undefined ? undefined : `Finding: ${findingId}`,
    severityBand === undefined ? undefined : `Severity: ${severityBand}`,
    confidenceBand === undefined ? undefined : `Confidence: ${confidenceBand}`,
  ].filter((line): line is string => line !== undefined);

  return lines.length === 0 ? undefined : lines.join("\n");
}

function firstRecord(value: unknown): UnknownRecord | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return recordValue(value[0]);
}

function recordValue(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
