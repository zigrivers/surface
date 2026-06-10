import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { type ZodType } from "zod";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { isNodeErrorWithCode, isSameOrChildPath } from "../path-safety.js";
import { SURFACE_STATE_DIR } from "../state-store.js";
import type { StateStore } from "../interfaces.js";
import {
  CandidateFindingIdSchema,
  CandidateFindingSchema,
  CandidateFlowIdSchema,
  CandidateFlowSchema,
  EvidenceBundleIdSchema,
  EvidenceBundleSchema,
  FlowRunIdSchema,
  FlowRunSchema,
  PromotedFindingSidecarSchema,
  QaRunIdSchema,
  QaRunSchema,
  type CandidateFinding,
  type CandidateFlow,
  type EvidenceBundle,
  type FlowRun,
  type PromotedFindingSidecar,
  type QaRun,
} from "./schemas.js";

export type FileQaRunStoreOptions = {
  readonly projectRoot?: string;
  readonly stateDir?: string;
  readonly stateStore: StateStore;
};

export type QaRunStore = {
  writeRun(run: QaRun): Promise<Result<QaRun, SurfaceError>>;
  readRun(id: string): Promise<Result<QaRun, SurfaceError>>;
  readRunManifestRef(id: string): Promise<Result<SharedRunRef, SurfaceError>>;
  writeCandidate(candidate: CandidateFinding): Promise<Result<CandidateFinding, SurfaceError>>;
  readCandidate(id: string): Promise<Result<CandidateFinding, SurfaceError>>;
  writeCandidateFlow(flow: CandidateFlow): Promise<Result<CandidateFlow, SurfaceError>>;
  readCandidateFlow(id: string): Promise<Result<CandidateFlow, SurfaceError>>;
  listCandidateFlows(): Promise<Result<readonly CandidateFlow[], SurfaceError>>;
  writeFlowRun(flowRun: FlowRun): Promise<Result<FlowRun, SurfaceError>>;
  readFlowRun(id: string): Promise<Result<FlowRun, SurfaceError>>;
  listFlowRuns(): Promise<Result<readonly FlowRun[], SurfaceError>>;
  writeEvidenceBundle(bundle: EvidenceBundle): Promise<Result<EvidenceBundle, SurfaceError>>;
  readEvidenceBundle(id: string): Promise<Result<EvidenceBundle, SurfaceError>>;
  writePromotedFinding(
    promotedFinding: PromotedFindingSidecar,
  ): Promise<Result<PromotedFindingSidecar, SurfaceError>>;
  readPromotedFinding(id: string): Promise<Result<PromotedFindingSidecar, SurfaceError>>;
};

type WriteSidecarInput<T> = {
  readonly id: string;
  readonly relativePath: string;
  readonly schema: ZodType<T>;
  readonly value: T;
};

type ReadSidecarInput<T> = {
  readonly id: string;
  readonly relativePath: string;
  readonly schema: ZodType<T>;
};

export type SharedRunRef = {
  readonly id: string;
  readonly manifestDigest: string;
  readonly manifestPath: string;
};

class FileQaRunStore implements QaRunStore {
  readonly #projectRoot: string;
  readonly #stateDir: string;
  readonly #qaDir: string;
  readonly #tmpQaDir: string;
  readonly #stateStore: StateStore;

  constructor(options: FileQaRunStoreOptions) {
    this.#projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.#stateDir = resolveStateDir(this.#projectRoot, options.stateDir ?? SURFACE_STATE_DIR);
    this.#qaDir = path.join(this.#stateDir, "qa");
    this.#tmpQaDir = path.join(this.#stateDir, "tmp", "qa");
    this.#stateStore = options.stateStore;
  }

  async writeRun(run: QaRun): Promise<Result<QaRun, SurfaceError>> {
    const parsedId = QaRunIdSchema.safeParse(run.id);

    if (!parsedId.success) {
      return err(createStateWriteError("QA run id is invalid.", parsedId.error));
    }

    const manifestPath = this.#projectRelativePath(
      path.join(this.#qaDir, "runs", run.id, "manifest.json"),
    );
    const parsed = QaRunSchema.safeParse({ ...run, manifestPath });

    if (!parsed.success) {
      return err(createStateWriteError("QA run manifest is invalid.", parsed.error));
    }

    const manifest = parsed.data;
    const finalDir = path.join(this.#qaDir, "runs", manifest.id);
    const manifestBytes = encodeJson(manifest);
    const manifestDigest = digestBytes(manifestBytes);

    try {
      await this.#commitDirectoryManifest({
        bytes: manifestBytes,
        finalDir,
        id: manifest.id,
      });
      await this.#refreshRunLinkedSidecarDigests(manifest, manifestDigest);
      await this.#writeSharedRunRefs({
        id: manifest.id,
        manifestDigest,
        manifestPath,
      }).catch(() => undefined);
      return ok(manifest);
    } catch (error) {
      return err(createStateWriteError("Failed to write QA run manifest.", error));
    }
  }

  async readRun(id: string): Promise<Result<QaRun, SurfaceError>> {
    const parsed = QaRunIdSchema.safeParse(id);

    if (!parsed.success) {
      return err(createStateReadError("QA run id is invalid.", parsed.error));
    }

    return this.#readSidecar({
      id: parsed.data,
      relativePath: path.join("runs", parsed.data, "manifest.json"),
      schema: QaRunSchema,
    });
  }

  async readRunManifestRef(id: string): Promise<Result<SharedRunRef, SurfaceError>> {
    const parsed = QaRunIdSchema.safeParse(id);

    if (!parsed.success) {
      return err(createStateReadError("QA run id is invalid.", parsed.error));
    }

    const sidecarPath = path.join(this.#qaDir, "runs", parsed.data, "manifest.json");

    try {
      await this.#assertRealPathInsideQaDir(sidecarPath);
      const bytes = await readFile(sidecarPath);
      const manifest = QaRunSchema.safeParse(
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      );

      if (!manifest.success) {
        return err(
          createStateReadError("QA run manifest is corrupt or unsupported.", manifest.error),
        );
      }

      return ok({
        id: manifest.data.id,
        manifestDigest: digestBytes(bytes),
        manifestPath: manifest.data.manifestPath,
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(createStateReadError("QA run manifest is corrupt or unsupported.", error));
      }

      return err(createStateReadError("Failed to read QA run manifest ref.", error));
    }
  }

  async writeCandidate(
    candidate: CandidateFinding,
  ): Promise<Result<CandidateFinding, SurfaceError>> {
    const parsedId = CandidateFindingIdSchema.safeParse(candidate.id);
    if (!parsedId.success) {
      return err(createStateWriteError("Candidate finding id is invalid.", parsedId.error));
    }

    return this.#writeSidecar({
      id: candidate.id,
      relativePath: path.join("candidates", `${candidate.id}.json`),
      schema: CandidateFindingSchema,
      value: candidate,
    });
  }

  async readCandidate(id: string): Promise<Result<CandidateFinding, SurfaceError>> {
    const parsed = CandidateFindingIdSchema.safeParse(id);
    if (!parsed.success) {
      return err(createStateReadError("Candidate finding id is invalid.", parsed.error));
    }

    return this.#readSidecar({
      id: parsed.data,
      relativePath: path.join("candidates", `${parsed.data}.json`),
      schema: CandidateFindingSchema,
    });
  }

  async writeCandidateFlow(flow: CandidateFlow): Promise<Result<CandidateFlow, SurfaceError>> {
    const parsedId = CandidateFlowIdSchema.safeParse(flow.id);
    if (!parsedId.success) {
      return err(createStateWriteError("Candidate flow id is invalid.", parsedId.error));
    }

    return this.#writeSidecar({
      id: flow.id,
      relativePath: path.join("flows", `${flow.id}.json`),
      schema: CandidateFlowSchema,
      value: flow,
    });
  }

  async readCandidateFlow(id: string): Promise<Result<CandidateFlow, SurfaceError>> {
    const parsed = CandidateFlowIdSchema.safeParse(id);
    if (!parsed.success) {
      return err(createStateReadError("Candidate flow id is invalid.", parsed.error));
    }

    return this.#readSidecar({
      id: parsed.data,
      relativePath: path.join("flows", `${parsed.data}.json`),
      schema: CandidateFlowSchema,
    });
  }

  async listCandidateFlows(): Promise<Result<readonly CandidateFlow[], SurfaceError>> {
    const flowsDir = path.join(this.#qaDir, "flows");

    try {
      await this.#assertRealPathInsideQaDir(flowsDir);
    } catch {
      return ok([]);
    }

    try {
      const entries = await readdir(flowsDir);
      const flows: CandidateFlow[] = [];

      for (const entry of entries.toSorted()) {
        if (!entry.endsWith(".json")) {
          continue;
        }

        const id = entry.slice(0, -".json".length);
        const flow = await this.readCandidateFlow(id);

        if (flow.ok) {
          flows.push(flow.value);
        }
      }

      return ok(flows);
    } catch (error) {
      return err(createStateReadError("Failed to list QA candidate flows.", error));
    }
  }

  async writeFlowRun(flowRun: FlowRun): Promise<Result<FlowRun, SurfaceError>> {
    const parsedId = FlowRunIdSchema.safeParse(flowRun.id);
    if (!parsedId.success) {
      return err(createStateWriteError("Flow run id is invalid.", parsedId.error));
    }

    return this.#writeSidecar({
      id: flowRun.id,
      relativePath: path.join("flow-runs", `${flowRun.id}.json`),
      schema: FlowRunSchema,
      value: flowRun,
    });
  }

  async readFlowRun(id: string): Promise<Result<FlowRun, SurfaceError>> {
    const parsed = FlowRunIdSchema.safeParse(id);
    if (!parsed.success) {
      return err(createStateReadError("Flow run id is invalid.", parsed.error));
    }

    return this.#readSidecar({
      id: parsed.data,
      relativePath: path.join("flow-runs", `${parsed.data}.json`),
      schema: FlowRunSchema,
    });
  }

  async listFlowRuns(): Promise<Result<readonly FlowRun[], SurfaceError>> {
    const flowRunsDir = path.join(this.#qaDir, "flow-runs");

    try {
      await this.#assertRealPathInsideQaDir(flowRunsDir);
    } catch {
      return ok([]);
    }

    try {
      const entries = await readdir(flowRunsDir);
      const runs: FlowRun[] = [];

      for (const entry of entries.toSorted()) {
        if (!entry.endsWith(".json")) {
          continue;
        }

        const id = entry.slice(0, -".json".length);
        const run = await this.readFlowRun(id);

        if (run.ok) {
          runs.push(run.value);
        }
      }

      return ok(runs);
    } catch (error) {
      return err(createStateReadError("Failed to list QA flow runs.", error));
    }
  }

  async writeEvidenceBundle(bundle: EvidenceBundle): Promise<Result<EvidenceBundle, SurfaceError>> {
    const parsedId = EvidenceBundleIdSchema.safeParse(bundle.id);
    if (!parsedId.success) {
      return err(createStateWriteError("Evidence bundle id is invalid.", parsedId.error));
    }

    return this.#writeCreateOnlySidecar({
      id: bundle.id,
      relativePath: path.join("evidence", `${bundle.id}.json`),
      schema: EvidenceBundleSchema,
      value: bundle,
    });
  }

  async readEvidenceBundle(id: string): Promise<Result<EvidenceBundle, SurfaceError>> {
    const parsed = EvidenceBundleIdSchema.safeParse(id);
    if (!parsed.success) {
      return err(createStateReadError("Evidence bundle id is invalid.", parsed.error));
    }

    return this.#readSidecar({
      id: parsed.data,
      relativePath: path.join("evidence", `${parsed.data}.json`),
      schema: EvidenceBundleSchema,
    });
  }

  async writePromotedFinding(
    promotedFinding: PromotedFindingSidecar,
  ): Promise<Result<PromotedFindingSidecar, SurfaceError>> {
    return this.#writeSidecar({
      id: promotedFinding.findingId,
      relativePath: path.join("refs", "promoted-findings", `${promotedFinding.findingId}.json`),
      schema: PromotedFindingSidecarSchema,
      value: promotedFinding,
    });
  }

  async readPromotedFinding(id: string): Promise<Result<PromotedFindingSidecar, SurfaceError>> {
    if (!isSafeLeafId(id)) {
      return err(createStateReadError("Promoted finding id is invalid."));
    }

    return this.#readSidecar({
      id,
      relativePath: path.join("refs", "promoted-findings", `${id}.json`),
      schema: PromotedFindingSidecarSchema,
    });
  }

  async #writeSidecar<T>({
    id,
    relativePath,
    schema,
    value,
  }: WriteSidecarInput<T>): Promise<Result<T, SurfaceError>> {
    if (!isSafeLeafId(id)) {
      return err(createStateWriteError("QA sidecar id is invalid."));
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return err(createStateWriteError("QA sidecar is invalid.", parsed.error));
    }

    try {
      await this.#commitJsonFile(path.join(this.#qaDir, relativePath), id, parsed.data);
      return ok(parsed.data);
    } catch (error) {
      return err(createStateWriteError("Failed to write QA sidecar.", error));
    }
  }

  async #writeCreateOnlySidecar<T>({
    id,
    relativePath,
    schema,
    value,
  }: WriteSidecarInput<T>): Promise<Result<T, SurfaceError>> {
    if (!isSafeLeafId(id)) {
      return err(createStateWriteError("QA sidecar id is invalid."));
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return err(createStateWriteError("QA sidecar is invalid.", parsed.error));
    }

    const finalPath = path.join(this.#qaDir, relativePath);
    const nextBytes = encodeJson(parsed.data);

    try {
      await writeCreateOnlyAndSyncFile(finalPath, nextBytes);
      return ok(parsed.data);
    } catch (error) {
      if (!isNodeErrorWithCode(error, "EEXIST")) {
        return err(createStateWriteError("Failed to write QA sidecar.", error));
      }

      try {
        await this.#assertRealPathInsideQaDir(finalPath);
        const currentBytes = await readFile(finalPath);
        if (Buffer.compare(Buffer.from(currentBytes), Buffer.from(nextBytes)) === 0) {
          return ok(parsed.data);
        }
      } catch (inspectError) {
        return err(createStateWriteError("Failed to inspect QA sidecar.", inspectError));
      }

      return err(createStateWriteError("QA evidence bundle already exists."));
    }
  }

  async #readSidecar<T>({
    id,
    relativePath,
    schema,
  }: ReadSidecarInput<T>): Promise<Result<T, SurfaceError>> {
    if (!isSafeLeafId(id)) {
      return err(createStateReadError("QA sidecar id is invalid."));
    }

    const sidecarPath = path.join(this.#qaDir, relativePath);

    try {
      await this.#assertRealPathInsideQaDir(sidecarPath);
      const bytes = await readFile(sidecarPath, "utf8");
      const parsed = schema.safeParse(JSON.parse(bytes) as unknown);

      if (!parsed.success) {
        return err(createStateReadError("QA sidecar is corrupt or unsupported.", parsed.error));
      }

      return ok(parsed.data);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(createStateReadError("QA sidecar is corrupt or unsupported.", error));
      }

      return err(createStateReadError("Failed to read QA sidecar.", error));
    }
  }

  async #commitDirectoryManifest({
    bytes,
    finalDir,
    id,
  }: {
    readonly bytes: Uint8Array;
    readonly finalDir: string;
    readonly id: string;
  }): Promise<void> {
    const tempDir = path.join(this.#tmpQaDir, `${id}-${randomUUID()}`);

    await mkdir(tempDir, { recursive: true });
    await writeAndSyncFile(path.join(tempDir, "manifest.json"), bytes);
    await syncDirectory(tempDir);
    await mkdir(path.dirname(finalDir), { recursive: true });
    await rename(tempDir, finalDir);
    await syncDirectory(finalDir);
    await syncDirectory(path.dirname(finalDir));
  }

  async #commitJsonFile<T>(finalPath: string, id: string, value: T): Promise<void> {
    const tempDir = path.join(this.#tmpQaDir, `${id}-${randomUUID()}`);
    const tempPath = path.join(tempDir, "sidecar.json");

    await mkdir(tempDir, { recursive: true });
    await writeAndSyncFile(tempPath, encodeJson(value));
    await syncDirectory(tempDir);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tempPath, finalPath);
    await syncDirectory(path.dirname(finalPath));
    await rm(tempDir, { force: true, recursive: true });
  }

  async #writeSharedRunRefs(ref: SharedRunRef): Promise<void> {
    const bytes = encodeJson(ref);
    const latest = await this.#stateStore.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "qa/refs/latest.json",
    });

    if (!latest.ok) {
      throw toThrownError(latest.error);
    }

    const index = await this.#stateStore.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: `qa/index/runs/${ref.id}.json`,
    });

    if (!index.ok) {
      throw toThrownError(index.error);
    }
  }

  async #refreshRunLinkedSidecarDigests(
    run: QaRun,
    sourceRunManifestDigest: string,
  ): Promise<void> {
    for (const candidateFindingId of run.candidateFindings) {
      await this.#refreshCandidateFindingDigest({
        candidateFindingId,
        qaRunId: run.id,
        sourceRunManifestDigest,
      });
    }

    for (const candidateFlowId of run.candidateFlows) {
      await this.#refreshCandidateFlowDigest({
        candidateFlowId,
        qaRunId: run.id,
        sourceRunManifestDigest,
      });
    }

    for (const findingId of run.findings) {
      await this.#refreshPromotedFindingDigest({
        findingId,
        qaRunId: run.id,
        sourceRunManifestDigest,
      });
    }
  }

  async #refreshCandidateFindingDigest(input: {
    readonly candidateFindingId: string;
    readonly qaRunId: string;
    readonly sourceRunManifestDigest: string;
  }): Promise<void> {
    // Candidate sidecars use the same controlled post-run digest refresh as evidence bundles.
    const current = await this.readCandidate(input.candidateFindingId);
    if (!current.ok || current.value.qaRunId !== input.qaRunId) {
      return;
    }

    const written = await this.#writeSidecar({
      id: current.value.id,
      relativePath: path.join("candidates", `${current.value.id}.json`),
      schema: CandidateFindingSchema,
      value: {
        ...current.value,
        sourceRunManifestDigest: input.sourceRunManifestDigest,
      },
    });

    if (!written.ok) {
      throw toThrownError(written.error);
    }
  }

  async #refreshCandidateFlowDigest(input: {
    readonly candidateFlowId: string;
    readonly qaRunId: string;
    readonly sourceRunManifestDigest: string;
  }): Promise<void> {
    // Candidate flow sidecars use the same controlled post-run digest refresh as evidence bundles.
    const current = await this.readCandidateFlow(input.candidateFlowId);
    if (!current.ok || current.value.qaRunId !== input.qaRunId) {
      return;
    }

    const written = await this.#writeSidecar({
      id: current.value.id,
      relativePath: path.join("flows", `${current.value.id}.json`),
      schema: CandidateFlowSchema,
      value: {
        ...current.value,
        sourceRunManifestDigest: input.sourceRunManifestDigest,
      },
    });

    if (!written.ok) {
      throw toThrownError(written.error);
    }
  }

  async #refreshPromotedFindingDigest(input: {
    readonly findingId: string;
    readonly qaRunId: string;
    readonly sourceRunManifestDigest: string;
  }): Promise<void> {
    // Promoted finding refs use the same controlled post-run digest refresh as evidence bundles.
    const current = await this.readPromotedFinding(input.findingId);
    if (!current.ok || current.value.qaRunId !== input.qaRunId) {
      return;
    }

    const written = await this.#writeSidecar({
      id: current.value.findingId,
      relativePath: path.join("refs", "promoted-findings", `${current.value.findingId}.json`),
      schema: PromotedFindingSidecarSchema,
      value: {
        ...current.value,
        sourceRunManifestDigest: input.sourceRunManifestDigest,
      },
    });

    if (!written.ok) {
      throw toThrownError(written.error);
    }
  }

  async #assertRealPathInsideQaDir(candidatePath: string): Promise<void> {
    const [realQaDir, realCandidate] = await Promise.all([
      realpath(this.#qaDir),
      realpath(candidatePath),
    ]);

    if (!isSameOrChildPath(realCandidate, realQaDir)) {
      throw new Error("QA sidecar path escaped .surface/qa.");
    }
  }

  #projectRelativePath(value: string): string {
    return toPosixPath(path.relative(this.#projectRoot, value));
  }
}

export function createFileQaRunStore(options: FileQaRunStoreOptions): QaRunStore {
  return new FileQaRunStore(options);
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

async function writeAndSyncFile(filePath: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(filePath, "w");

  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeCreateOnlyAndSyncFile(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const handle = await open(filePath, "wx");
  let committed = false;

  try {
    await handle.writeFile(bytes);
    await handle.sync();
    committed = true;
  } finally {
    await handle.close();
    if (!committed) {
      await rm(filePath, { force: true }).catch(() => {});
    }
  }

  await syncDirectory(path.dirname(filePath));
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle;

  try {
    handle = await open(directoryPath, "r");
  } catch (error) {
    if (isNodeErrorWithCode(error, "EACCES") || isNodeErrorWithCode(error, "EISDIR")) {
      return;
    }

    throw error;
  }

  try {
    await handle.sync().catch((error: unknown) => {
      if (!isNodeErrorWithCode(error, "EACCES") && !isNodeErrorWithCode(error, "EISDIR")) {
        throw error;
      }
    });
  } finally {
    await handle.close();
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function createStateReadError(message: string, cause?: unknown): SurfaceError {
  return createSurfaceError("state_read_failed", message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function createStateWriteError(message: string, cause?: unknown): SurfaceError {
  return createSurfaceError("state_write_failed", message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function toThrownError(error: SurfaceError): Error {
  return new Error(error.message, { cause: error });
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

function isSafeLeafId(id: string): boolean {
  return (
    /^[A-Za-z0-9_.-]+$/.test(id) && !id.includes("..") && !id.includes("/") && !id.includes("\\")
  );
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
