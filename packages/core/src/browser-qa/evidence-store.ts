import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

import { createSurfaceError, err, ok, type Result, type SurfaceError } from "../errors.js";
import { isNodeErrorWithCode, isSameOrChildPath } from "../path-safety.js";
import { SURFACE_STATE_DIR } from "../state-store.js";
import type { StateStore } from "../interfaces.js";
import {
  type CandidateFinding,
  type CandidateFlow,
  type EvidenceBundle,
  type PromotedFindingSidecar,
  type QaEvidenceArtifact,
} from "./schemas.js";
import { createFileQaRunStore, type QaRunStore } from "./state-store.js";

export type FileQaEvidenceStoreOptions = {
  readonly projectRoot?: string;
  readonly stateDir?: string;
  readonly stateStore: StateStore;
};

export type QaEvidenceArtifactInput = {
  readonly bytes: Uint8Array;
  readonly id: string;
  readonly mcpReadable?: boolean;
  readonly mediaType: string;
  readonly qaKind: QaEvidenceArtifact["kind"];
  readonly sensitiveRaw?: boolean;
};

export type WriteEvidenceBundleInput = {
  readonly artifacts: readonly QaEvidenceArtifactInput[];
  readonly bundle: EvidenceBundle;
};

export type ReadArtifactByRegisteredRefInput = {
  readonly artifactId: string;
  readonly maxBytes?: number;
  readonly refId: string;
};

export type QaArtifactReadResult = {
  readonly artifactId: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly text?: string;
  readonly truncated: boolean;
};

export type QaEvidenceStore = {
  writeBundle(input: WriteEvidenceBundleInput): Promise<Result<EvidenceBundle, SurfaceError>>;
  readBundle(id: string): Promise<Result<EvidenceBundle, SurfaceError>>;
  readArtifactByRegisteredRef(
    input: ReadArtifactByRegisteredRefInput,
  ): Promise<Result<QaArtifactReadResult, SurfaceError>>;
};

type StoredArtifact = {
  readonly bytes: Uint8Array;
  readonly metadata: QaEvidenceArtifact;
};

class FileQaEvidenceStore implements QaEvidenceStore {
  readonly #projectRoot: string;
  readonly #stateDir: string;
  readonly #qaDir: string;
  readonly #artifactDir: string;
  readonly #tmpQaDir: string;
  readonly #qaStore: QaRunStore;

  constructor(options: FileQaEvidenceStoreOptions) {
    this.#projectRoot = path.resolve(options.projectRoot ?? process.cwd());
    this.#stateDir = resolveStateDir(this.#projectRoot, options.stateDir ?? SURFACE_STATE_DIR);
    this.#qaDir = path.join(this.#stateDir, "qa");
    this.#artifactDir = path.join(this.#qaDir, "artifacts", "sha256");
    this.#tmpQaDir = path.join(this.#stateDir, "tmp", "qa");
    this.#qaStore = createFileQaRunStore({
      projectRoot: this.#projectRoot,
      stateStore: options.stateStore,
      ...(options.stateDir === undefined ? {} : { stateDir: options.stateDir }),
    });
  }

  async writeBundle(
    input: WriteEvidenceBundleInput,
  ): Promise<Result<EvidenceBundle, SurfaceError>> {
    try {
      const artifacts = await Promise.all(
        input.artifacts.map(async (artifact) => this.#writeArtifact(artifact)),
      );
      const metadata = artifacts.map((artifact) => artifact.metadata);
      const checksums = Object.fromEntries(
        metadata.map((artifact) => [artifact.id, artifact.sha256] as const),
      );
      const bundle: EvidenceBundle = {
        ...input.bundle,
        artifacts: metadata,
        checksums,
        containsSensitiveRaw: metadata.some((artifact) => artifact.sensitiveRaw),
        manifestPath: this.#projectRelativePath(
          path.join(this.#qaDir, "evidence", `${input.bundle.id}.json`),
        ),
        redacted: true,
        sanitizedAtCapture: true,
      };

      return this.#qaStore.writeEvidenceBundle(bundle);
    } catch (error) {
      return err(createEvidenceUnavailableError("Failed to write QA evidence bundle.", error));
    }
  }

  async readBundle(id: string): Promise<Result<EvidenceBundle, SurfaceError>> {
    return this.#qaStore.readEvidenceBundle(id);
  }

  async readArtifactByRegisteredRef(
    input: ReadArtifactByRegisteredRefInput,
  ): Promise<Result<QaArtifactReadResult, SurfaceError>> {
    if (!isSafeRegisteredRef(input.refId) || !isSafeLeafId(input.artifactId)) {
      return err(createEvidenceUnavailableError("Evidence artifact refs must be registered ids."));
    }

    const bundle = await this.#resolveBundleForRef(input.refId, input.artifactId);
    if (!bundle.ok) {
      return bundle;
    }

    const artifact = bundle.value.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (artifact === undefined) {
      return err(createEvidenceUnavailableError("Evidence artifact is not registered."));
    }

    if (artifact.sensitiveRaw || !artifact.mcpReadable || !isAllowedMcpReadableArtifact(artifact)) {
      return err(createEvidenceUnavailableError("Evidence artifact is not MCP-readable."));
    }

    const expectedChecksum = bundle.value.checksums[artifact.id];
    if (expectedChecksum !== artifact.sha256) {
      return err(
        createEvidenceUnavailableError("Evidence artifact checksum registration is invalid."),
      );
    }

    try {
      const artifactPath = path.resolve(this.#projectRoot, artifact.path);
      await this.#assertRealArtifactPath(artifactPath);
      const bytes = await readFile(artifactPath);
      const actualDigest = digestBytes(bytes);

      if (actualDigest !== artifact.sha256) {
        return err(
          createEvidenceUnavailableError("Evidence artifact checksum verification failed."),
        );
      }

      const maxBytes = Math.max(0, input.maxBytes ?? 8192);
      const sliced = bytes.subarray(0, maxBytes);
      const truncated = bytes.byteLength > sliced.byteLength;
      const text = isTextMediaType(artifact.mediaType)
        ? new TextDecoder().decode(sliced)
        : undefined;

      return ok({
        artifactId: artifact.id,
        mediaType: artifact.mediaType,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
        truncated,
        ...(text === undefined ? {} : { text }),
      });
    } catch (error) {
      return err(createEvidenceUnavailableError("Failed to read evidence artifact.", error));
    }
  }

  async #writeArtifact(input: QaEvidenceArtifactInput): Promise<StoredArtifact> {
    const sanitizedBytes = sanitizeArtifactBytes(input.bytes, input.mediaType);
    const digest = digestBytes(sanitizedBytes);
    const digestHex = digest.replace("sha256:", "");
    const artifactPath = path.join(this.#artifactDir, digestHex);
    const containsRawDiagnosticFields = containsNeverMcpReadableRawFields(
      sanitizedBytes,
      input.mediaType,
    );
    const metadata: QaEvidenceArtifact = {
      id: input.id,
      kind: input.qaKind,
      mcpReadable:
        input.mcpReadable === true && input.sensitiveRaw !== true && !containsRawDiagnosticFields,
      mediaType: input.mediaType,
      path: this.#projectRelativePath(artifactPath),
      redacted: true,
      sensitiveRaw: input.sensitiveRaw === true,
      sha256: digest,
      sizeBytes: sanitizedBytes.byteLength,
    };

    await this.#commitArtifactFile(artifactPath, input.id, sanitizedBytes);
    return { bytes: sanitizedBytes, metadata };
  }

  async #commitArtifactFile(
    finalPath: string,
    artifactId: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const tempDir = path.join(this.#tmpQaDir, `${artifactId}-${randomUUID()}`);
    const tempPath = path.join(tempDir, "artifact");

    await mkdir(tempDir, { recursive: true });
    await writeAndSyncFile(tempPath, bytes);
    await syncDirectory(tempDir);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tempPath, finalPath);
    await syncDirectory(path.dirname(finalPath));
    await rm(tempDir, { force: true, recursive: true });
  }

  async #resolveBundleForRef(
    refId: string,
    artifactId: string,
  ): Promise<Result<EvidenceBundle, SurfaceError>> {
    if (refId.startsWith("ev_")) {
      const bundle = await this.#qaStore.readEvidenceBundle(refId);
      if (!bundle.ok) {
        return bundle;
      }

      const run = await this.#qaStore.readRun(bundle.value.qaRunId);
      if (!run.ok) {
        return err(
          createEvidenceUnavailableError("QA run evidence owner is unavailable.", run.error),
        );
      }

      return bundle.value.qaRunId === run.value.id &&
        run.value.evidenceBundles.includes(bundle.value.id)
        ? bundle
        : err(createEvidenceUnavailableError("QA run evidence ownership is invalid."));
    }

    if (refId.startsWith("qfc_")) {
      const candidate = await this.#qaStore.readCandidate(refId);
      if (!candidate.ok) {
        return err(candidate.error);
      }

      const bundle = await this.#qaStore.readEvidenceBundle(candidate.value.evidenceBundleId);
      if (!bundle.ok) {
        return bundle;
      }

      return bundle.value.qaRunId === candidate.value.qaRunId &&
        (await this.#candidateOwnershipIsRegistered(candidate.value, bundle.value))
        ? bundle
        : err(createEvidenceUnavailableError("Candidate evidence ownership is invalid."));
    }

    if (refId.startsWith("qflow_")) {
      const flow = await this.#qaStore.readCandidateFlow(refId);
      if (!flow.ok) {
        return err(flow.error);
      }

      if (flow.value.evidenceBundleId === undefined) {
        return err(createEvidenceUnavailableError("Candidate flow does not reference evidence."));
      }

      const bundle = await this.#qaStore.readEvidenceBundle(flow.value.evidenceBundleId);
      if (!bundle.ok) {
        return bundle;
      }

      return bundle.value.qaRunId === flow.value.qaRunId &&
        (await this.#candidateFlowOwnershipIsRegistered(flow.value, bundle.value))
        ? bundle
        : err(createEvidenceUnavailableError("Candidate flow evidence ownership is invalid."));
    }

    if (refId.startsWith("qa_")) {
      const run = await this.#qaStore.readRun(refId);
      if (!run.ok) {
        return err(run.error);
      }

      for (const evidenceBundleId of run.value.evidenceBundles) {
        const bundle = await this.#qaStore.readEvidenceBundle(evidenceBundleId);
        if (
          bundle.ok &&
          bundle.value.qaRunId === run.value.id &&
          bundle.value.artifacts.some((artifact) => artifact.id === artifactId)
        ) {
          return bundle;
        }
      }

      return err(createEvidenceUnavailableError("QA run does not register the evidence artifact."));
    }

    if (refId.startsWith("f_")) {
      const promoted = await this.#qaStore.readPromotedFinding(refId);
      if (!promoted.ok) {
        return err(promoted.error);
      }

      const bundle = await this.#qaStore.readEvidenceBundle(promoted.value.evidenceBundleId);
      if (!bundle.ok) {
        return bundle;
      }

      return bundle.value.qaRunId === promoted.value.qaRunId &&
        bundle.value.id === promoted.value.evidenceBundleId &&
        (await this.#promotedFindingOwnershipIsRegistered(promoted.value, bundle.value))
        ? bundle
        : err(createEvidenceUnavailableError("Promoted finding evidence ownership is invalid."));
    }

    return err(createEvidenceUnavailableError("Unsupported evidence ref id."));
  }

  async #assertRealArtifactPath(candidatePath: string): Promise<void> {
    const [realArtifactDir, realCandidate] = await Promise.all([
      realpath(this.#artifactDir),
      realpath(candidatePath),
    ]);

    if (!isSameOrChildPath(realCandidate, realArtifactDir)) {
      throw new Error("Evidence artifact path escaped .surface/qa/artifacts.");
    }
  }

  #projectRelativePath(value: string): string {
    return toPosixPath(path.relative(this.#projectRoot, value));
  }

  async #candidateOwnershipIsRegistered(
    candidate: CandidateFinding,
    bundle: EvidenceBundle,
  ): Promise<boolean> {
    const run = await this.#qaStore.readRun(candidate.qaRunId);
    const runRef = await this.#qaStore.readRunManifestRef(candidate.qaRunId);

    return (
      run.ok &&
      runRef.ok &&
      run.value.candidateFindings.includes(candidate.id) &&
      run.value.evidenceBundles.includes(bundle.id) &&
      candidate.sourceRunManifestDigest === runRef.value.manifestDigest
    );
  }

  async #candidateFlowOwnershipIsRegistered(
    flow: CandidateFlow,
    bundle: EvidenceBundle,
  ): Promise<boolean> {
    const run = await this.#qaStore.readRun(flow.qaRunId);
    const runRef = await this.#qaStore.readRunManifestRef(flow.qaRunId);

    return (
      run.ok &&
      runRef.ok &&
      run.value.candidateFlows.includes(flow.id) &&
      run.value.evidenceBundles.includes(bundle.id) &&
      flow.sourceRunManifestDigest === runRef.value.manifestDigest
    );
  }

  async #promotedFindingOwnershipIsRegistered(
    promoted: PromotedFindingSidecar,
    bundle: EvidenceBundle,
  ): Promise<boolean> {
    const run = await this.#qaStore.readRun(promoted.qaRunId);
    const runRef = await this.#qaStore.readRunManifestRef(promoted.qaRunId);

    return (
      run.ok &&
      runRef.ok &&
      (run.value.findings.includes(promoted.findingId) ||
        run.value.candidateFindings.includes(promoted.candidateFindingId)) &&
      run.value.evidenceBundles.includes(bundle.id) &&
      promoted.sourceRunManifestDigest === runRef.value.manifestDigest
    );
  }
}

export function createFileQaEvidenceStore(options: FileQaEvidenceStoreOptions): QaEvidenceStore {
  return new FileQaEvidenceStore(options);
}

function sanitizeArtifactBytes(bytes: Uint8Array, mediaType: string): Uint8Array {
  if (!isTextMediaType(mediaType)) {
    return bytes;
  }

  const text = new TextDecoder().decode(bytes);
  const jsonRedacted = redactJsonText(text);
  const sanitized = redactSensitiveText(jsonRedacted)
    .replace(/^(Authorization|Cookie|Set-Cookie|X-CSRF-Token|CSRF-Token):.*$/gimu, "$1: [REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gu, "$1 [REDACTED]");

  return new TextEncoder().encode(sanitized);
}

function redactJsonText(text: string): string {
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(text) as unknown), null, 2);
  } catch {
    return text;
  }
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(entry));
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveEvidenceKey(key) ? "[REDACTED]" : redactJsonValue(entry),
    ]),
  );
}

const NEVER_MCP_READABLE_RAW_FIELD_PATTERN =
  /^(authorization|cookie|cookies|headers|requestheaders|responseheaders|requestbody|responsebody|body|authstate|localstorage|sessionstorage|indexeddb|storage)$/iu;

function containsNeverMcpReadableRawFields(bytes: Uint8Array, mediaType: string): boolean {
  if (!isTextMediaType(mediaType)) {
    return true;
  }

  const text = new TextDecoder().decode(bytes);
  try {
    return jsonValueContainsNeverMcpReadableRawField(JSON.parse(text) as unknown);
  } catch {
    return /(^|\n)\s*(headers|requestHeaders|responseHeaders|cookies|cookie|body|requestBody|responseBody|authState|localStorage|sessionStorage|indexedDB|storage)\s*[:=]/iu.test(
      text,
    );
  }
}

function jsonValueContainsNeverMcpReadableRawField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => jsonValueContainsNeverMcpReadableRawField(entry));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.entries(value).some(
    ([key, entry]) =>
      NEVER_MCP_READABLE_RAW_FIELD_PATTERN.test(key.replace(/[-_\s]/gu, "")) ||
      jsonValueContainsNeverMcpReadableRawField(entry),
  );
}

function isSensitiveEvidenceKey(key: string): boolean {
  return /(authorization|cookie|csrf|password|secret|token|api[-_]?key|session)/iu.test(key);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /([?&](?:token|secret|password|api_key|apikey|session|auth|key)=)[^&#\s"]+/giu,
      "$1[REDACTED]",
    )
    .replace(
      /\b(token|secret|password|api_key|apikey|session|auth|key)=([^&\s"]+)/giu,
      "$1=[REDACTED]",
    );
}

function isTextMediaType(mediaType: string): boolean {
  return (
    mediaType.startsWith("text/") || mediaType === "application/json" || mediaType.endsWith("+json")
  );
}

const NEVER_MCP_READABLE_ARTIFACT_KINDS = new Set<QaEvidenceArtifact["kind"]>([
  "annotated-screenshot",
  "har",
  "repro-video",
  "step-screenshot",
  "trace",
]);

function isAllowedMcpReadableArtifact(artifact: QaEvidenceArtifact): boolean {
  if (NEVER_MCP_READABLE_ARTIFACT_KINDS.has(artifact.kind)) {
    return false;
  }

  return (
    isTextMediaType(artifact.mediaType) &&
    !artifact.mediaType.startsWith("image/") &&
    !artifact.mediaType.startsWith("video/") &&
    artifact.mediaType !== "application/octet-stream"
  );
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function createEvidenceUnavailableError(message: string, cause?: unknown): SurfaceError {
  return createSurfaceError("evidence_unavailable", message, {
    ...(cause === undefined ? {} : { cause }),
  });
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

function isSafeRegisteredRef(refId: string): boolean {
  return /^(ev|qfc|qflow|qa|f)_[A-Za-z0-9_-]+$/.test(refId);
}

function isSafeLeafId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
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

function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}
