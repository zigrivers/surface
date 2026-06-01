import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { Octokit } from "@octokit/rest";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import { BacklogSchema, type Backlog, type BacklogEntry } from "./findings.js";
import type { IssueExport, IssueExporter, LocalBacklogRef } from "./interfaces.js";

type GitHubIssueCreateInput = {
  readonly owner: string;
  readonly repo: string;
  readonly title: string;
  readonly body: string;
  labels?: string[];
};

type GitHubIssueClient = {
  readonly issues: {
    create(input: GitHubIssueCreateInput): Promise<unknown>;
  };
};

const DEFAULT_GITHUB_USER_AGENT =
  process.env.npm_package_version === undefined
    ? "surface"
    : `surface/${process.env.npm_package_version}`;
const RETRYABLE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export type GitHubIssueExporterOptions = {
  readonly owner: string;
  readonly repo: string;
  readonly token?: string;
  readonly userAgent?: string;
  readonly projectRoot?: string;
  readonly labels?: readonly string[];
  readonly client?: GitHubIssueClient;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
};

export function createGitHubIssueExporter(options: GitHubIssueExporterOptions): IssueExporter {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const initialBackoffMs = Math.max(0, options.initialBackoffMs ?? 250);
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const client = createClient(options);

  return {
    target: "github",
    export: async (backlogRef) => {
      const backlog = await readBacklog(backlogRef, projectRoot);

      if (!backlog.ok) {
        return backlog;
      }

      const synced: string[] = [];
      const unsynced: string[] = [];
      const retryConfig =
        options.wait === undefined
          ? { initialBackoffMs, maxAttempts }
          : { initialBackoffMs, maxAttempts, wait: options.wait };

      for (const [index, entry] of backlog.value.entries.entries()) {
        const input = issueCreateInput(options, backlog.value, entry, backlogRef);
        const issue = await retry(() => client.issues.create(input), retryConfig);

        if (issue.ok) {
          synced.push(entry.findingId);
        } else {
          unsynced.push(entry.findingId);

          if (isNonRetryableGitHubExportError(issue.error.cause)) {
            unsynced.push(
              ...backlog.value.entries.slice(index + 1).map((remaining) => remaining.findingId),
            );
            break;
          }
        }
      }

      return ok({
        id: `github:${backlogRef.backlogId}`,
        target: "github",
        synced,
        unsynced,
        status: statusForExport(synced, unsynced),
      });
    },
  };
}

function createClient(options: GitHubIssueExporterOptions): GitHubIssueClient {
  if (options.client !== undefined) {
    return options.client;
  }

  const octokit = new Octokit({
    auth: options.token,
    userAgent: options.userAgent ?? DEFAULT_GITHUB_USER_AGENT,
  });

  return {
    issues: {
      create: async (input) => octokit.issues.create(input),
    },
  };
}

function issueCreateInput(
  options: GitHubIssueExporterOptions,
  backlog: Backlog,
  entry: BacklogEntry,
  backlogRef: LocalBacklogRef,
): GitHubIssueCreateInput {
  const input: GitHubIssueCreateInput = {
    owner: options.owner,
    repo: options.repo,
    title: issueTitle(entry),
    body: issueBody(backlog, entry, backlogRef),
  };

  if (options.labels !== undefined) {
    input.labels = [...options.labels];
  }

  return input;
}

async function readBacklog(
  backlogRef: LocalBacklogRef,
  projectRoot: string,
): Promise<Result<Backlog, SurfaceError>> {
  let backlogPath: string | undefined;

  try {
    backlogPath = await resolveBacklogPath(projectRoot, backlogRef.path);
  } catch (cause) {
    return err(
      createSurfaceError("export_failed", "Local backlog artifact could not be read.", {
        cause,
      }),
    );
  }

  if (backlogPath === undefined) {
    return err(
      createSurfaceError("export_failed", "Backlog path must resolve inside the project root.", {
        details: { path: backlogRef.path },
      }),
    );
  }

  try {
    const parsedJson = JSON.parse(await readFile(backlogPath, "utf8")) as unknown;
    const parsedBacklog = BacklogSchema.safeParse(unwrapBacklog(parsedJson));

    if (!parsedBacklog.success) {
      return err(
        createSurfaceError("export_failed", "Local backlog artifact is invalid.", {
          cause: parsedBacklog.error,
        }),
      );
    }

    if (parsedBacklog.data.id !== backlogRef.backlogId) {
      return err(
        createSurfaceError("export_failed", "Local backlog artifact id does not match ref.", {
          details: {
            actual: parsedBacklog.data.id,
            expected: backlogRef.backlogId,
          },
        }),
      );
    }

    return ok(parsedBacklog.data);
  } catch (cause) {
    return err(
      createSurfaceError("export_failed", "Local backlog artifact could not be read.", {
        cause,
      }),
    );
  }
}

function unwrapBacklog(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "backlog" in value) {
    return (value as { readonly backlog: unknown }).backlog;
  }

  return value;
}

async function resolveBacklogPath(
  projectRoot: string,
  backlogPath: string,
): Promise<string | undefined> {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, backlogPath);

  if (!isPathInside(root, resolved)) {
    return undefined;
  }

  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(resolved)]);

  return isPathInside(realRoot, realTarget) ? realTarget : undefined;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);

  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function issueTitle(entry: BacklogEntry): string {
  return `[Surface] ${entry.rank}. ${entry.findingId}`;
}

function issueBody(backlog: Backlog, entry: BacklogEntry, backlogRef: LocalBacklogRef): string {
  return [
    "Surface finding export",
    "",
    `- Backlog: \`${backlog.id}\``,
    `- Run: \`${backlog.runId}\``,
    `- Finding: \`${entry.findingId}\``,
    entry.title === undefined ? undefined : `- Title: ${entry.title}`,
    entry.rationale === undefined ? undefined : `- Rationale: ${entry.rationale}`,
    entry.severityBand === undefined ? undefined : `- Severity: ${entry.severityBand}`,
    entry.location === undefined ? undefined : `- Location: ${formatLocation(entry.location)}`,
    `- Rank: ${entry.rank}`,
    `- Priority: ${entry.priority}`,
    entry.suggestedPatch === undefined
      ? undefined
      : `- Suggested patch: ${entry.suggestedPatch.kind} - ${entry.suggestedPatch.change}`,
    entry.demotedAsDuplicateOf === undefined
      ? undefined
      : `- Demoted duplicate of: \`${entry.demotedAsDuplicateOf}\``,
    `- Local backlog artifact: \`${backlogRef.path}\``,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatLocation(location: BacklogEntry["location"]): string {
  if (location === undefined) {
    return "unknown";
  }

  return Object.entries(location)
    .map(([key, value]) => `${key}=\`${value}\``)
    .join(", ");
}

async function retry<T>(
  operation: () => Promise<T>,
  options: {
    readonly initialBackoffMs: number;
    readonly maxAttempts: number;
    readonly wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<Result<T, SurfaceError>> {
  let lastCause: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return ok(await operation());
    } catch (cause) {
      lastCause = cause;

      if (attempt === options.maxAttempts || !isRetryableGitHubError(cause)) {
        break;
      }

      await (options.wait ?? defaultWait)(options.initialBackoffMs * 2 ** (attempt - 1));
    }
  }

  return err(
    createSurfaceError("export_failed", "GitHub issue export failed after retry.", {
      cause: lastCause,
    }),
  );
}

function isRetryableGitHubError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }

  if ("status" in cause) {
    const status = (cause as { readonly status?: unknown }).status;

    if (
      typeof status === "number" &&
      (status === 429 || status >= 500 || (status === 403 && isGitHubRateLimitError(cause)))
    ) {
      return true;
    }
  }

  if ("code" in cause) {
    const code = (cause as { readonly code?: unknown }).code;

    return typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code);
  }

  return false;
}

function isNonRetryableGitHubExportError(cause: unknown): boolean {
  if (isRetryableGitHubError(cause)) {
    return false;
  }

  if (typeof cause !== "object" || cause === null || !("status" in cause)) {
    return false;
  }

  const status = (cause as { readonly status?: unknown }).status;

  return status === 401 || status === 403 || status === 404;
}

function isGitHubRateLimitError(cause: object): boolean {
  const retryAfter = readHeader(cause, "retry-after");

  if (retryAfter !== undefined) {
    return true;
  }

  const message =
    "message" in cause ? (cause as { readonly message?: unknown }).message : undefined;

  return typeof message === "string" && /rate limit|abuse/i.test(message);
}

function readHeader(cause: object, name: string): unknown {
  const headers =
    "headers" in cause
      ? (cause as { readonly headers?: unknown }).headers
      : "response" in cause &&
          typeof (cause as { readonly response?: unknown }).response === "object" &&
          (cause as { readonly response?: unknown }).response !== null &&
          "headers" in (cause as { readonly response: { readonly headers?: unknown } }).response
        ? (cause as { readonly response: { readonly headers?: unknown } }).response.headers
        : undefined;

  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }

  const value = (headers as Record<string, unknown>)[name];

  return value ?? (headers as Record<string, unknown>)[name.toLowerCase()];
}

function statusForExport(
  synced: readonly string[],
  unsynced: readonly string[],
): IssueExport["status"] {
  if (unsynced.length === 0) {
    return "complete";
  }

  if (synced.length === 0) {
    return "failed";
  }

  return "partial";
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
