import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ExpandExistingFilePatternOptions = {
  readonly projectRoot?: string;
};

export async function expandExistingFilePattern(
  pattern: string,
  options: ExpandExistingFilePatternOptions = {},
): Promise<readonly string[]> {
  const projectRoot =
    options.projectRoot === undefined ? undefined : path.resolve(options.projectRoot);
  const effectivePattern =
    projectRoot === undefined || path.isAbsolute(pattern)
      ? pattern
      : path.resolve(projectRoot, pattern);

  if (!effectivePattern.includes("*")) {
    try {
      const entry = await stat(effectivePattern);
      return entry.isFile() ? [formatMatchedPath(effectivePattern, projectRoot)] : [];
    } catch {
      return [];
    }
  }

  const root = globSearchRoot(effectivePattern);
  const files = await listFilesIfPresent(root);
  const normalizedPattern = toPosixPath(effectivePattern);

  return files
    .map((file) => toPosixPath(file))
    .filter((file) => wildcardMatches(normalizedPattern, file))
    .map((file) => formatMatchedPath(file, projectRoot))
    .toSorted();
}

export function projectRelativePath(projectRoot: string, filePath: string): string {
  return toPosixPath(path.relative(projectRoot, filePath));
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep).replace(/\\/gu, path.posix.sep);
}

export function wildcardMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function formatMatchedPath(filePath: string, projectRoot: string | undefined): string {
  return projectRoot === undefined
    ? toPosixPath(filePath)
    : projectRelativePath(projectRoot, filePath);
}

function globSearchRoot(pattern: string): string {
  const firstWildcard = pattern.indexOf("*");
  const prefix = pattern.slice(0, firstWildcard);
  const slash = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));

  return slash <= 0 ? "." : prefix.slice(0, slash);
}

async function listFilesIfPresent(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(root, entry.name);

        if (entry.isDirectory()) {
          return listFilesIfPresent(entryPath);
        }

        return entry.isFile() ? [entryPath] : [];
      }),
    );

    return files.flat();
  } catch {
    return [];
  }
}
