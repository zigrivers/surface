import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type { RedactionRule } from "./config.js";
import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import { redactExportValue } from "./export-redaction.js";
import { BacklogSchema, type Backlog, type BacklogEntry } from "./findings.js";
import type { IssueExport, IssueExporter, LocalBacklogRef } from "./interfaces.js";

type LinearIssueInput = {
  readonly description: string;
  readonly labels?: readonly string[];
  readonly teamId: string;
  readonly title: string;
};

type JiraIssueInput = {
  readonly fields: {
    readonly description: string;
    readonly issuetype: { readonly name: string };
    readonly labels?: readonly string[];
    readonly project: { readonly key: string };
    readonly summary: string;
  };
};

export type LinearIssueClient = {
  createIssue(input: LinearIssueInput): Promise<unknown>;
};

export type JiraIssueClient = {
  createIssue(input: JiraIssueInput): Promise<unknown>;
};

export type LinearIssueExporterOptions = {
  readonly teamId: string;
  readonly apiKey?: string;
  readonly endpointUrl?: string;
  readonly labels?: readonly string[];
  readonly projectRoot?: string;
  readonly client?: LinearIssueClient;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly redactionRules?: readonly RedactionRule[];
};

export type JiraIssueExporterOptions = {
  readonly projectKey: string;
  readonly siteUrl?: string;
  readonly email?: string;
  readonly apiToken?: string;
  readonly issueType?: string;
  readonly labels?: readonly string[];
  readonly projectRoot?: string;
  readonly client?: JiraIssueClient;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly redactionRules?: readonly RedactionRule[];
};

const RETRYABLE_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export function createLinearIssueExporter(options: LinearIssueExporterOptions): IssueExporter {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const client = options.client ?? createDefaultLinearClient(options);
  const retryOptions = retryOptionsFor(options);

  return createVendorExporter({
    target: "linear",
    projectRoot,
    retryOptions,
    ...(options.redactionRules === undefined ? {} : { redactionRules: options.redactionRules }),
    createInput: (backlog, entry, backlogRef) => ({
      teamId: options.teamId,
      title: issueTitle(entry),
      description: issueBody(backlog, entry, backlogRef),
      ...(options.labels === undefined ? {} : { labels: [...options.labels] }),
    }),
    createIssue: (input) => client.createIssue(input as LinearIssueInput),
  });
}

export function createJiraIssueExporter(options: JiraIssueExporterOptions): IssueExporter {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const client = options.client ?? createDefaultJiraClient(options);
  const retryOptions = retryOptionsFor(options);

  return createVendorExporter({
    target: "jira",
    projectRoot,
    retryOptions,
    ...(options.redactionRules === undefined ? {} : { redactionRules: options.redactionRules }),
    createInput: (backlog, entry, backlogRef) => ({
      fields: {
        project: { key: options.projectKey },
        issuetype: { name: options.issueType ?? "Task" },
        summary: issueTitle(entry),
        description: issueBody(backlog, entry, backlogRef),
        ...(options.labels === undefined ? {} : { labels: [...options.labels] }),
      },
    }),
    createIssue: (input) => client.createIssue(input as JiraIssueInput),
  });
}

function createVendorExporter(input: {
  readonly target: "linear" | "jira";
  readonly projectRoot: string;
  readonly redactionRules?: readonly RedactionRule[];
  readonly retryOptions: RetryOptions;
  readonly createInput: (
    backlog: Backlog,
    entry: BacklogEntry,
    backlogRef: LocalBacklogRef,
  ) => unknown;
  readonly createIssue: (input: unknown) => Promise<unknown>;
}): IssueExporter {
  return {
    target: input.target,
    export: async (backlogRef) => {
      const backlog = await readBacklog(backlogRef, input.projectRoot);

      if (!backlog.ok) {
        return backlog;
      }

      const synced: string[] = [];
      const unsynced: string[] = [];

      for (const entry of backlog.value.entries) {
        const payload = redactExportValue(
          input.createInput(backlog.value, entry, backlogRef),
          input.redactionRules,
        );

        if (!payload.ok) {
          return payload;
        }

        const exported = await retry(() => input.createIssue(payload.value), input.retryOptions);

        if (exported.ok) {
          synced.push(entry.findingId);
        } else {
          unsynced.push(entry.findingId);
        }
      }

      return ok({
        id: `${input.target}:${backlogRef.backlogId}`,
        target: input.target,
        synced,
        unsynced,
        status: statusForExport(synced, unsynced),
      });
    },
  };
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
      createSurfaceError("export_failed", "Local backlog artifact could not be read.", { cause }),
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
      createSurfaceError("export_failed", "Local backlog artifact could not be read.", { cause }),
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

type RetryOptions = {
  readonly initialBackoffMs: number;
  readonly maxAttempts: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
};

function retryOptionsFor(options: {
  readonly initialBackoffMs?: number;
  readonly maxAttempts?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): RetryOptions {
  return {
    initialBackoffMs: Math.max(0, options.initialBackoffMs ?? 250),
    maxAttempts: Math.max(1, options.maxAttempts ?? 3),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
  };
}

async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<Result<T, SurfaceError>> {
  let lastCause: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return ok(await operation());
    } catch (cause) {
      lastCause = cause;

      if (attempt === options.maxAttempts || !isRetryableError(cause)) {
        break;
      }

      await (options.wait ?? defaultWait)(options.initialBackoffMs * 2 ** (attempt - 1));
    }
  }

  return err(
    createSurfaceError("export_failed", "Issue export failed after retry.", {
      cause: lastCause,
    }),
  );
}

function isRetryableError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) {
    return false;
  }

  if ("status" in cause) {
    const status = (cause as { readonly status?: unknown }).status;

    return typeof status === "number" && (status === 429 || status >= 500);
  }

  if ("code" in cause) {
    const code = (cause as { readonly code?: unknown }).code;

    return typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code);
  }

  return false;
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

function createDefaultLinearClient(options: LinearIssueExporterOptions): LinearIssueClient {
  return {
    createIssue: async (input) => {
      const response = await fetch(options.endpointUrl ?? "https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey === undefined ? {} : { Authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          query:
            "mutation SurfaceCreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success } }",
          variables: { input },
        }),
      });

      if (!response.ok) {
        throw Object.assign(new Error("Linear issue export failed."), { status: response.status });
      }

      return await response.json();
    },
  };
}

function createDefaultJiraClient(options: JiraIssueExporterOptions): JiraIssueClient {
  return {
    createIssue: async (input) => {
      const siteUrl = options.siteUrl ?? "https://example.atlassian.net";
      const auth =
        options.email === undefined || options.apiToken === undefined
          ? undefined
          : Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
      const response = await fetch(`${siteUrl.replace(/\/+$/, "")}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth === undefined ? {} : { Authorization: `Basic ${auth}` }),
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw Object.assign(new Error("Jira issue export failed."), { status: response.status });
      }

      return await response.json();
    },
  };
}

async function defaultWait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
