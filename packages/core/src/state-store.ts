import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import lockfile, { type LockOptions } from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "./errors.js";
import { BacklogSchema, FindingSchema } from "./findings.js";
import {
  CaptureArtifactSchema,
  CaptureArtifactTypeSchema,
  type ArtifactRedactionMetadata,
  type Capture,
  type CaptureArtifact,
  type PersistArtifactIntent,
  type PersistedArtifactRef,
  type ProjectRunRecord,
  type ProjectStateSnapshot,
  type StateStore,
  type Target,
} from "./interfaces.js";
import { ReconciliationQuestionSchema } from "./reconciliation.js";
import { BaselineSchema, TrackedFindingSchema } from "./tracked-findings.js";
import { VerdictSchema } from "./verdicts.js";
import { isNodeErrorWithCode, isSameOrChildPath } from "./path-safety.js";

/** Default project-local directory used for Surface state and artifacts. */
export const SURFACE_STATE_DIR = ".surface";
/** Aggregate JSON file name inside the Surface state directory. */
export const SURFACE_STATE_FILE = "state.json";
/** Current persisted state schema version.
 *
 * Optional pipeline metadata is additive and parsed with passthrough semantics,
 * so existing 1.0 readers remain compatible.
 */
export const SURFACE_STATE_VERSION = "1.0";

const nonEmptyStringSchema = z.string().trim().min(1);

const ProjectStateViewportSchema = z
  .object({
    height: z.number().positive(),
    label: z.enum(["mobile", "tablet", "desktop"]),
    width: z.number().positive(),
  })
  .strict();

const ProjectStateTargetSchema = z
  .object({
    kind: z.enum(["url", "localhost", "route", "screenshot", "component", "dom"]),
    ref: nonEmptyStringSchema,
    theme: z.enum(["light", "dark"]).optional(),
    viewport: ProjectStateViewportSchema.optional(),
  })
  .strict();
type ParsedProjectStateTarget = z.infer<typeof ProjectStateTargetSchema>;
type ParsedCaptureArtifact = z.infer<typeof CaptureArtifactSchema>;

const ProjectStateCaptureSchema = z
  .object({
    artifacts: z.array(CaptureArtifactSchema),
    authUsed: z.boolean().optional(),
    backend: nonEmptyStringSchema,
    capturedAt: nonEmptyStringSchema,
    degradation: z
      .object({
        skippedArtifacts: z.array(CaptureArtifactTypeSchema),
        skippedReason: nonEmptyStringSchema,
      })
      .strict()
      .optional(),
    id: nonEmptyStringSchema,
    status: z.enum(["requested", "completed", "degraded", "auth-failed", "unreachable"]),
    target: ProjectStateTargetSchema,
    verification: z
      .object({
        authInjectedBeforeNavigation: z.boolean(),
        isRequestedTarget: z.boolean(),
        landedUrl: nonEmptyStringSchema,
        requestedUrl: nonEmptyStringSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const ProjectStatePipelineSchema = z
  .object({
    lastCompletedStage: nonEmptyStringSchema.optional(),
    nextEventSequence: z.number().int().nonnegative().optional(),
    runId: nonEmptyStringSchema,
    stageIds: z.array(nonEmptyStringSchema),
  })
  .passthrough();

const ProjectStateSkippedLensSchema = z
  .object({
    lensId: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
    reason: nonEmptyStringSchema,
  })
  .strict();

const ProjectStateRunRecordSchema = z
  .object({
    backlog: BacklogSchema.optional(),
    capture: ProjectStateCaptureSchema.optional(),
    findings: z.array(FindingSchema).optional(),
    reconciliationQuestions: z.array(ReconciliationQuestionSchema).optional(),
    runId: nonEmptyStringSchema,
    skippedLenses: z.array(ProjectStateSkippedLensSchema).optional(),
    status: z.enum(["completed", "failed"]).optional(),
    trackedFindings: z.array(TrackedFindingSchema),
  })
  .strict();
type ParsedProjectStateCapture = z.infer<typeof ProjectStateCaptureSchema>;
type ParsedProjectStateRunRecord = z.infer<typeof ProjectStateRunRecordSchema>;

const ProjectStateSnapshotSchema = z
  .object({
    version: nonEmptyStringSchema,
    backlog: BacklogSchema.optional(),
    baselines: z.array(BaselineSchema).optional(),
    currentStage: nonEmptyStringSchema.optional(),
    findings: z.array(FindingSchema).optional(),
    pipeline: ProjectStatePipelineSchema.optional(),
    runRecords: z.array(ProjectStateRunRecordSchema).optional(),
    trackedFindings: z.array(TrackedFindingSchema).optional(),
    verdicts: z.array(VerdictSchema).optional(),
  })
  .passthrough();

const LegacyProjectStateSnapshotSchema = z
  .object({
    schemaVersion: nonEmptyStringSchema.optional(),
    version: nonEmptyStringSchema.optional(),
    backlog: z.unknown().optional(),
    baselines: z.array(z.unknown()).optional(),
    currentStage: nonEmptyStringSchema.optional(),
    findings: z.array(z.unknown()).optional(),
    pipeline: ProjectStatePipelineSchema.optional(),
    runRecords: z.array(z.unknown()).optional(),
    trackedFindings: z.array(z.unknown()).optional(),
    verdicts: z.array(z.unknown()).optional(),
  })
  .passthrough();

type FileStateStoreOptions = {
  readonly projectRoot?: string;
  /** Project-root-relative child directory for state; invalid paths throw at construction time. */
  readonly stateDir?: string;
  readonly stateVersion?: string;
  readonly lockOptions?: LockOptions;
};

type StateOperation<T> = () => Promise<T>;
type MigrationOptions = {
  readonly forceVersion?: boolean;
};

type MigrationResult = {
  readonly hadSchemaVersion: boolean;
  readonly hadVersion: boolean;
  readonly state: ProjectStateSnapshot;
};

class SurfaceOperationError extends Error {
  constructor(readonly surfaceError: SurfaceError) {
    super(surfaceError.message);
    this.name = "SurfaceOperationError";
  }
}

/*
 * Security model: the store only accepts project-root-relative state dirs and
 * artifact paths, rejects reserved state metadata paths case-insensitively, and
 * rejects all existing symlink components in the state directory or artifact
 * parent path before writing. The case-insensitive comparisons are
 * intentionally conservative so macOS/Windows state-file aliases are reserved
 * even when tests run on case-sensitive filesystems. It serializes writes
 * through both an in-process queue and a proper-lockfile
 * lock before using write-file-atomic for final persistence. The lock path is
 * derived from the real state directory after validation so casing differences
 * for the same directory converge on one lock on case-insensitive filesystems.
 */
/** @internal File-backed StateStore implementation; prefer createFileStateStore(). */
class FileStateStore implements StateStore {
  readonly #projectRoot: string;
  readonly #stateDir: string;
  readonly #stateFile: string;
  readonly #lockFile: string;
  readonly #stateVersion: string;
  readonly #lockOptions: LockOptions;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: FileStateStoreOptions = {}) {
    this.#projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.#stateDir = resolveStateDir(this.#projectRoot, options.stateDir ?? SURFACE_STATE_DIR);
    this.#stateFile = path.join(this.#stateDir, SURFACE_STATE_FILE);
    this.#lockFile = path.join(this.#stateDir, ".state.lock");
    this.#stateVersion = options.stateVersion ?? SURFACE_STATE_VERSION;
    const defaultRetries = {
      factor: 1.2,
      maxTimeout: 100,
      minTimeout: 10,
      retries: 50,
    };
    const retries =
      typeof options.lockOptions?.retries === "object"
        ? {
            ...defaultRetries,
            ...options.lockOptions.retries,
          }
        : (options.lockOptions?.retries ?? defaultRetries);

    this.#lockOptions = {
      stale: 10_000,
      update: 1_000,
      ...options.lockOptions,
      retries,
      lockfilePath: this.#lockFile,
      realpath: false,
    };
  }

  /**
   * Read the current project state, migrating legacy schemaVersion records when possible.
   * The coordination lock lives inside the state directory, so first read initializes it.
   */
  async readState(): Promise<Result<ProjectStateSnapshot, SurfaceError>> {
    return this.#withStateLock("state_read_failed", async () => {
      try {
        const bytes = await readFile(this.#stateFile, "utf8");
        const parsed = JSON.parse(bytes) as unknown;
        const migration = migrateProjectState(parsed, this.#stateVersion);

        if (migration.hadSchemaVersion || !migration.hadVersion) {
          await tryWriteMigratedState(this.#stateFile, migration.state);
        }

        return migration.state;
      } catch (error) {
        if (isNodeErrorWithCode(error, "ENOENT")) {
          return { version: this.#stateVersion };
        }

        if (error instanceof SyntaxError || error instanceof z.ZodError) {
          throw new SurfaceOperationError(
            createSurfaceError("state_corrupt", "Surface state is corrupt or unsupported.", {
              cause: error,
              details: { path: this.#stateFile },
            }),
          );
        }

        throw error;
      }
    });
  }

  async writeState(
    state: ProjectStateSnapshot,
  ): Promise<Result<ProjectStateSnapshot, SurfaceError>> {
    return this.#withStateLock("state_write_failed", async () => {
      const { state: migrated } = migrateProjectState(state, this.#stateVersion, {
        forceVersion: true,
      });
      await writeJsonFileAtomic(this.#stateFile, migrated);
      return migrated;
    });
  }

  async updateState(
    updater: (state: ProjectStateSnapshot) => ProjectStateSnapshot,
  ): Promise<Result<ProjectStateSnapshot, SurfaceError>> {
    return this.#withStateLock("state_write_failed", async () => {
      let current: ProjectStateSnapshot;

      try {
        const bytes = await readFile(this.#stateFile, "utf8");
        current = migrateProjectState(JSON.parse(bytes) as unknown, this.#stateVersion).state;
      } catch (error) {
        if (isNodeErrorWithCode(error, "ENOENT")) {
          current = { version: this.#stateVersion };
        } else if (error instanceof SyntaxError || error instanceof z.ZodError) {
          throw new SurfaceOperationError(
            createSurfaceError("state_corrupt", "Surface state is corrupt or unsupported.", {
              cause: error,
              details: { path: this.#stateFile },
            }),
          );
        } else {
          throw error;
        }
      }

      const { state: migrated } = migrateProjectState(updater(current), this.#stateVersion, {
        forceVersion: true,
      });
      await writeJsonFileAtomic(this.#stateFile, migrated);
      return migrated;
    });
  }

  /** Persist artifact bytes below the configured state directory and return a project-relative ref. */
  async writeArtifact(
    intent: PersistArtifactIntent,
  ): Promise<Result<PersistedArtifactRef, SurfaceError>> {
    return this.#withStateLock("state_write_failed", async () => {
      const artifactPath = this.#resolveSurfacePath(intent.relativePath);
      await this.#assertNoSymlinkArtifactParentPrefix(artifactPath);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      // Re-check after mkdir so newly created parents resolve inside the real state dir.
      await this.#assertRealArtifactParentInsideStateDir(artifactPath);
      await this.#assertArtifactLeafIsNotSymlink(artifactPath);
      await writeFileAtomic(artifactPath, Buffer.from(intent.bytes));

      return {
        path: toPosixPath(path.relative(this.#projectRoot, artifactPath)),
        sha256: createHash("sha256").update(intent.bytes).digest("hex"),
      };
    });
  }

  async #withStateLock<T>(
    errorCode: "state_read_failed" | "state_write_failed",
    operation: StateOperation<T>,
  ): Promise<Result<T, SurfaceError>> {
    const releaseQueue = await this.#enterProcessQueue();

    try {
      await this.#assertNoSymlinkStateDirPrefix(errorCode);
      await mkdir(this.#stateDir, { recursive: true });
      const realStateDir = await this.#assertRealStateDirInsideProjectRoot(errorCode);
      await this.#assertStateMetadataIsNotSymlink(errorCode);

      const release = await lockfile.lock(this.#stateDir, {
        ...this.#lockOptions,
        lockfilePath: path.join(realStateDir, ".state.lock"),
      });

      try {
        await this.#assertRealStateDirInsideProjectRoot(errorCode);
        await this.#assertStateMetadataIsNotSymlink(errorCode);
        return ok(await operation());
      } finally {
        await releaseLock(release);
      }
    } catch (error) {
      if (error instanceof SurfaceOperationError) {
        return err(error.surfaceError);
      }

      return err(
        createSurfaceError(
          errorCode,
          errorCode === "state_read_failed"
            ? "Failed to read Surface state."
            : "Failed to write Surface state.",
          {
            cause: error,
            details: { stateDir: this.#stateDir },
          },
        ),
      );
    } finally {
      releaseQueue();
    }
  }

  #resolveSurfacePath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new SurfaceOperationError(
        createSurfaceError("state_write_failed", "Artifact path must be relative.", {
          details: { relativePath },
        }),
      );
    }

    const resolved = path.resolve(this.#stateDir, relativePath);
    const relativeToStateDir = path.relative(this.#stateDir, resolved);

    if (
      relativeToStateDir === "" ||
      relativeToStateDir === ".." ||
      relativeToStateDir.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToStateDir)
    ) {
      throw new SurfaceOperationError(
        createSurfaceError(
          "state_write_failed",
          "Artifact path must stay inside the configured Surface state directory.",
          {
            details: { relativePath },
          },
        ),
      );
    }

    if (
      isSameOrChildPathCaseInsensitive(resolved, this.#stateFile) ||
      isSameOrChildPathCaseInsensitive(resolved, this.#lockFile)
    ) {
      throw new SurfaceOperationError(
        createSurfaceError("state_write_failed", "Artifact path must not target state metadata.", {
          details: { relativePath },
        }),
      );
    }

    return resolved;
  }

  async #assertNoSymlinkStateDirPrefix(
    errorCode: "state_read_failed" | "state_write_failed",
  ): Promise<void> {
    await assertNoSymlinkPathPrefix({
      baseDir: this.#projectRoot,
      errorCode,
      message: "Surface state directory must not traverse symlinked project directories.",
      targetPath: this.#stateDir,
    });
  }

  async #assertNoSymlinkArtifactParentPrefix(artifactPath: string): Promise<void> {
    await assertNoSymlinkPathPrefix({
      baseDir: this.#stateDir,
      errorCode: "state_write_failed",
      message: "Artifact path must not traverse symlinked state directories.",
      targetPath: path.dirname(artifactPath),
    });
  }

  async #assertRealArtifactParentInsideStateDir(artifactPath: string): Promise<void> {
    const parentDir = path.dirname(artifactPath);

    const realStateDir = await realpath(this.#stateDir);
    const realParentDir = await realpath(parentDir);

    if (!isSameOrChildPathCaseInsensitive(realParentDir, realStateDir)) {
      throw new SurfaceOperationError(
        createSurfaceError(
          "state_write_failed",
          "Artifact path must stay inside the real Surface state directory.",
          {
            details: { parentDir },
          },
        ),
      );
    }
  }

  async #assertArtifactLeafIsNotSymlink(artifactPath: string): Promise<void> {
    await assertPathIsNotSymlink({
      errorCode: "state_write_failed",
      message: "Artifact path must not target a symlink.",
      targetPath: artifactPath,
    });
  }

  async #assertRealStateDirInsideProjectRoot(
    errorCode: "state_read_failed" | "state_write_failed",
  ): Promise<string> {
    const realProjectRoot = await realpath(this.#projectRoot);
    const realStateDir = await realpath(this.#stateDir);

    if (!isSameOrChildPath(realStateDir, realProjectRoot)) {
      throw new SurfaceOperationError(
        createSurfaceError(
          errorCode,
          "Surface state directory must stay inside the real project root.",
          {
            details: { stateDir: this.#stateDir },
          },
        ),
      );
    }

    return realStateDir;
  }

  async #assertStateMetadataIsNotSymlink(
    errorCode: "state_read_failed" | "state_write_failed",
  ): Promise<void> {
    await assertPathIsNotSymlink({
      errorCode,
      message: "Surface state file must not be a symlink.",
      targetPath: this.#stateFile,
    });
    await assertPathIsNotSymlink({
      errorCode,
      message: "Surface lock file must not be a symlink.",
      targetPath: this.#lockFile,
    });
  }

  async #enterProcessQueue(): Promise<() => void> {
    const previous = this.#queue;
    let releaseQueue!: () => void;
    const next = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    this.#queue = previous.then(
      () => next,
      () => next,
    );
    await previous.catch(() => undefined);
    return releaseQueue;
  }
}

/**
 * Create a file-backed StateStore rooted at projectRoot/.surface by default.
 * Invalid configuration fails fast with TypeError; runtime IO uses Result errors.
 */
export function createFileStateStore(options: FileStateStoreOptions = {}): StateStore {
  return new FileStateStore(options);
}

function resolveStateDir(projectRoot: string, stateDir: string): string {
  if (path.isAbsolute(stateDir)) {
    throw new TypeError("stateDir must be relative to projectRoot.");
  }

  const resolved = path.resolve(projectRoot, stateDir);
  if (!isChildPath(resolved, projectRoot)) {
    throw new TypeError("stateDir must be a child directory of projectRoot.");
  }

  return resolved;
}

function isChildPath(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function assertNoSymlinkPathPrefix({
  baseDir,
  errorCode,
  message,
  targetPath,
}: {
  readonly baseDir: string;
  readonly errorCode: "state_read_failed" | "state_write_failed";
  readonly message: string;
  readonly targetPath: string;
}): Promise<void> {
  const relativeTarget = path.relative(baseDir, targetPath);
  let currentPath = baseDir;

  for (const segment of relativeTarget.split(path.sep)) {
    if (segment === "") {
      continue;
    }

    currentPath = path.join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new SurfaceOperationError(
          createSurfaceError(errorCode, message, {
            details: { path: currentPath },
          }),
        );
      }
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        break;
      }

      throw error;
    }
  }
}

async function assertPathIsNotSymlink({
  errorCode,
  message,
  targetPath,
}: {
  readonly errorCode: "state_read_failed" | "state_write_failed";
  readonly message: string;
  readonly targetPath: string;
}): Promise<void> {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink()) {
      throw new SurfaceOperationError(
        createSurfaceError(errorCode, message, {
          details: { path: targetPath },
        }),
      );
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }
}

function migrateProjectState(
  value: unknown,
  targetVersion: string,
  options: MigrationOptions = {},
): MigrationResult {
  // trackedFindings currently migrate with the project state version. Add explicit per-item
  // migration here before changing required tracked finding fields or history invariants.
  const legacy = LegacyProjectStateSnapshotSchema.parse(value);
  const {
    backlog,
    baselines,
    currentStage,
    findings,
    pipeline,
    runRecords,
    schemaVersion,
    trackedFindings,
    verdicts,
    version,
    ...passthrough
  } = legacy;
  const migratedBacklog = backlog === undefined ? undefined : BacklogSchema.parse(backlog);
  const migratedBaselines =
    baselines === undefined ? undefined : z.array(BaselineSchema).parse(baselines);
  const migratedFindings =
    findings === undefined ? undefined : z.array(FindingSchema).parse(findings);
  const migratedRunRecords =
    runRecords === undefined ? undefined : migrateProjectRunRecords(runRecords);
  const migratedTrackedFindings =
    trackedFindings === undefined
      ? undefined
      : z.array(TrackedFindingSchema).parse(trackedFindings);
  const migratedVerdicts =
    verdicts === undefined ? undefined : z.array(VerdictSchema).parse(verdicts);
  const hadSchemaVersion = schemaVersion !== undefined;
  const hadVersion = version !== undefined;
  const migratedVersion =
    options.forceVersion === true || hadSchemaVersion || !hadVersion ? targetVersion : version;
  const migrated: ProjectStateSnapshot = {
    ...passthrough,
    version: migratedVersion,
    ...(migratedBacklog !== undefined ? { backlog: migratedBacklog } : {}),
    ...(migratedBaselines !== undefined ? { baselines: migratedBaselines } : {}),
    ...(currentStage !== undefined ? { currentStage } : {}),
    ...(migratedFindings !== undefined ? { findings: migratedFindings } : {}),
    ...(pipeline !== undefined ? { pipeline } : {}),
    ...(migratedRunRecords !== undefined ? { runRecords: migratedRunRecords } : {}),
    ...(migratedTrackedFindings !== undefined ? { trackedFindings: migratedTrackedFindings } : {}),
    ...(migratedVerdicts !== undefined ? { verdicts: migratedVerdicts } : {}),
  };

  ProjectStateSnapshotSchema.parse(migrated);
  return { hadSchemaVersion, hadVersion, state: migrated };
}

function migrateProjectRunRecords(runRecords: readonly unknown[]): readonly ProjectRunRecord[] {
  return z.array(ProjectStateRunRecordSchema).parse(runRecords).map(projectRunRecordFromParsed);
}

function projectRunRecordFromParsed(record: ParsedProjectStateRunRecord): ProjectRunRecord {
  return {
    runId: record.runId,
    trackedFindings: record.trackedFindings,
    ...(record.backlog === undefined ? {} : { backlog: record.backlog }),
    ...(record.capture === undefined ? {} : { capture: captureFromParsed(record.capture) }),
    ...(record.findings === undefined ? {} : { findings: record.findings }),
    ...(record.reconciliationQuestions === undefined
      ? {}
      : { reconciliationQuestions: record.reconciliationQuestions }),
    ...(record.skippedLenses === undefined ? {} : { skippedLenses: record.skippedLenses }),
    ...(record.status === undefined ? {} : { status: record.status }),
  };
}

function captureFromParsed(capture: ParsedProjectStateCapture): Capture {
  return {
    artifacts: capture.artifacts.map(captureArtifactFromParsed),
    backend: capture.backend,
    capturedAt: capture.capturedAt,
    id: capture.id,
    status: capture.status,
    target: targetFromParsed(capture.target),
    ...(capture.authUsed === undefined ? {} : { authUsed: capture.authUsed }),
    ...(capture.degradation === undefined ? {} : { degradation: capture.degradation }),
    ...(capture.verification === undefined ? {} : { verification: capture.verification }),
  };
}

function captureArtifactFromParsed(artifact: ParsedCaptureArtifact): CaptureArtifact {
  return {
    id: artifact.id,
    path: artifact.path,
    redacted: artifact.redacted,
    type: artifact.type,
    ...(artifact.redaction === undefined
      ? {}
      : { redaction: redactionMetadataFromParsed(artifact.redaction) }),
  };
}

function redactionMetadataFromParsed(
  redaction: NonNullable<ParsedCaptureArtifact["redaction"]>,
): ArtifactRedactionMetadata {
  return {
    maskedClasses: redaction.maskedClasses,
    safeNoSensitiveRegions: redaction.safeNoSensitiveRegions,
    status: redaction.status,
    unsafeRegions: redaction.unsafeRegions,
    ...(redaction.boundingBoxesVerified === undefined
      ? {}
      : { boundingBoxesVerified: redaction.boundingBoxesVerified }),
    ...(redaction.selectorsVerified === undefined
      ? {}
      : { selectorsVerified: redaction.selectorsVerified }),
    ...(redaction.sensitiveSelectors === undefined
      ? {}
      : { sensitiveSelectors: redaction.sensitiveSelectors }),
    ...(redaction.sensitiveTextRanges === undefined
      ? {}
      : { sensitiveTextRanges: redaction.sensitiveTextRanges }),
    ...(redaction.textRangesVerified === undefined
      ? {}
      : { textRangesVerified: redaction.textRangesVerified }),
  };
}

function targetFromParsed(target: ParsedProjectStateTarget): Target {
  return {
    kind: target.kind,
    ref: target.ref,
    ...(target.theme === undefined ? {} : { theme: target.theme }),
    ...(target.viewport === undefined ? {} : { viewport: target.viewport }),
  };
}

async function releaseLock(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch (error) {
    process.emitWarning(toWarningMessage(error), { code: "SURFACE_LOCK_RELEASE_FAILED" });
  }
}

async function writeJsonFileAtomic(filePath: string, value: ProjectStateSnapshot): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
}

async function tryWriteMigratedState(filePath: string, value: ProjectStateSnapshot): Promise<void> {
  try {
    await writeJsonFileAtomic(filePath, value);
  } catch (error) {
    process.emitWarning(toWarningMessage(error), { code: "SURFACE_STATE_MIGRATION_WRITE_FAILED" });
  }
}

/** Case-insensitive containment is only used for reserved metadata names across OSes. */
function isSameOrChildPathCaseInsensitive(candidate: string, reservedPath: string): boolean {
  const candidatePath = path.resolve(candidate).toLowerCase();
  const reserved = path.resolve(reservedPath).toLowerCase();
  const reservedPrefix = reserved.endsWith(path.sep) ? reserved : `${reserved}${path.sep}`;
  return candidatePath === reserved || candidatePath.startsWith(reservedPrefix);
}

function toWarningMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Normalize persisted artifact refs to POSIX separators for cross-platform snapshots. */
function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
