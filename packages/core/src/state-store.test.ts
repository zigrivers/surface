import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { isErr, isOk } from "./errors.js";
import { createFileStateStore, SURFACE_STATE_VERSION } from "./state-store.js";

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "surface-state-store-"));
  onTestFinished(async () => {
    await rm(root, { force: true, recursive: true });
  });
  return root;
}

describe("FileStateStore", () => {
  it("returns a default state when .surface/state.json does not exist", async () => {
    const store = createFileStateStore({ projectRoot: await makeTempRoot() });

    const state = await store.readState();

    expect(isOk(state)).toBe(true);
    expect(state).toMatchObject({ value: { version: SURFACE_STATE_VERSION } });
  });

  it("writes state atomically and migrates legacy schema-version state on read", async () => {
    const root = await makeTempRoot();
    const stateDir = path.join(root, ".surface");
    const stateFile = path.join(stateDir, "state.json");
    const store = createFileStateStore({ projectRoot: root });

    const written = await store.writeState({ currentStage: "capture", version: "legacy" });

    expect(isOk(written)).toBe(true);
    expect(written).toMatchObject({
      value: { currentStage: "capture", version: SURFACE_STATE_VERSION },
    });

    await writeFile(
      stateFile,
      '{ "schemaVersion": "0.1", "version": "0.1", "currentStage": "score", "futureField": true }\n',
    );

    const migrated = await store.readState();
    const persisted = JSON.parse(await readFile(stateFile, "utf8")) as Record<string, unknown>;

    expect(isOk(migrated)).toBe(true);
    expect(migrated).toMatchObject({
      value: { currentStage: "score", version: SURFACE_STATE_VERSION },
    });
    expect(persisted).toEqual({
      currentStage: "score",
      futureField: true,
      version: SURFACE_STATE_VERSION,
    });
  });

  it("reports corrupt state without throwing", async () => {
    const root = await makeTempRoot();
    await mkdir(path.join(root, ".surface"), { recursive: true });
    await writeFile(path.join(root, ".surface", "state.json"), "{ invalid json");

    const corrupt = await createFileStateStore({ projectRoot: root }).readState();

    expect(isErr(corrupt)).toBe(true);
    expect(corrupt).toMatchObject({ error: { code: "state_corrupt" } });
  });

  it("writes artifacts inside .surface with sha256 and rejects escaping paths", async () => {
    const root = await makeTempRoot();
    const store = createFileStateStore({ projectRoot: root });
    const bytes = new TextEncoder().encode("artifact");

    const written = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "reports/result.txt",
    });
    const escaped = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "../outside.txt",
    });
    const stateOverwrite = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "state.json",
    });
    const stateDirOverwrite = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "state.json/nested.txt",
    });
    const caseVariantStateOverwrite = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "State.JSON",
    });
    const lockOverwrite = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: ".state.lock/nested.txt",
    });
    const dotPrefixed = await store.writeArtifact({
      bytes,
      kind: "generated",
      relativePath: "..valid-file.txt",
    });

    expect(isOk(written)).toBe(true);
    expect(written).toMatchObject({
      value: {
        path: path.posix.join(".surface", "reports", "result.txt"),
        sha256: "c7c5c1d70c5dec4416ab6158afd0b223ef40c29b1dc1f97ed9428b94d4cadb1c",
      },
    });
    expect(await readFile(path.join(root, ".surface", "reports", "result.txt"), "utf8")).toBe(
      "artifact",
    );
    expect(isErr(escaped)).toBe(true);
    expect(escaped).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isErr(stateOverwrite)).toBe(true);
    expect(stateOverwrite).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isErr(stateDirOverwrite)).toBe(true);
    expect(stateDirOverwrite).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isErr(caseVariantStateOverwrite)).toBe(true);
    expect(caseVariantStateOverwrite).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isErr(lockOverwrite)).toBe(true);
    expect(lockOverwrite).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isOk(dotPrefixed)).toBe(true);
    expect(dotPrefixed).toMatchObject({
      value: { path: path.posix.join(".surface", "..valid-file.txt") },
    });
  });

  it("returns artifact paths relative to the project root for custom state directories", async () => {
    const root = await makeTempRoot();
    const store = createFileStateStore({ projectRoot: root, stateDir: "var/surface-state" });

    const written = await store.writeArtifact({
      bytes: new TextEncoder().encode("artifact"),
      kind: "generated",
      relativePath: "reports/result.txt",
    });

    expect(isOk(written)).toBe(true);
    expect(written).toMatchObject({
      value: { path: path.posix.join("var", "surface-state", "reports", "result.txt") },
    });
    expect(
      await readFile(path.join(root, "var", "surface-state", "reports", "result.txt"), "utf8"),
    ).toBe("artifact");
  });

  it("rejects state directories that escape the project root", async () => {
    const root = await makeTempRoot();
    const absoluteStateDir = path.join(path.parse(root).root, "tmp", "surface-state");

    expect(() => createFileStateStore({ projectRoot: root, stateDir: absoluteStateDir })).toThrow(
      /stateDir must be relative/,
    );
    expect(() => createFileStateStore({ projectRoot: root, stateDir: "../surface-state" })).toThrow(
      /stateDir must be a child/,
    );
    expect(() => createFileStateStore({ projectRoot: root, stateDir: "." })).toThrow(
      /stateDir must be a child/,
    );

    if (process.platform !== "win32") {
      const caseVariantRoot = path.join(path.dirname(root), path.basename(root).toUpperCase());
      expect(() =>
        createFileStateStore({
          projectRoot: root,
          stateDir: path.relative(root, path.join(caseVariantRoot, ".surface")),
        }),
      ).toThrow(/stateDir must be a child/);
    }
  });

  it("rejects a base state directory symlink that escapes the project root", async () => {
    const root = await makeTempRoot();
    const outsideStateDir = `${root}-outside-state`;
    await mkdir(outsideStateDir, { recursive: true });
    onTestFinished(async () => {
      await rm(outsideStateDir, { force: true, recursive: true });
    });
    await symlink(outsideStateDir, path.join(root, ".surface"), "dir");

    const store = createFileStateStore({ projectRoot: root });
    const readState = await store.readState();
    const writeState = await store.writeState({ currentStage: "capture", version: "legacy" });
    const writeArtifact = await store.writeArtifact({
      bytes: new TextEncoder().encode("artifact"),
      kind: "generated",
      relativePath: "reports/result.txt",
    });

    expect(isErr(readState)).toBe(true);
    expect(readState).toMatchObject({ error: { code: "state_read_failed" } });
    expect(isErr(writeState)).toBe(true);
    expect(writeState).toMatchObject({ error: { code: "state_write_failed" } });
    expect(isErr(writeArtifact)).toBe(true);
    expect(writeArtifact).toMatchObject({ error: { code: "state_write_failed" } });
    await expect(readFile(path.join(outsideStateDir, "state.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(path.join(outsideStateDir, "reports", "result.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a base state directory symlink even when it points inside the project", async () => {
    const root = await makeTempRoot();
    const stateTarget = path.join(root, "state-target");
    await mkdir(stateTarget, { recursive: true });
    await symlink(stateTarget, path.join(root, ".surface"), "dir");

    const written = await createFileStateStore({ projectRoot: root }).writeState({
      currentStage: "capture",
      version: "legacy",
    });

    expect(isErr(written)).toBe(true);
    expect(written).toMatchObject({ error: { code: "state_write_failed" } });
    await expect(readFile(path.join(stateTarget, "state.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects artifacts that escape through symlinked state directories", async () => {
    const root = await makeTempRoot();
    const outsideStateDir = path.join(root, "outside-state");
    await mkdir(path.join(root, ".surface"), { recursive: true });
    await mkdir(outsideStateDir, { recursive: true });
    await symlink(outsideStateDir, path.join(root, ".surface", "linked"), "dir");

    const escaped = await createFileStateStore({ projectRoot: root }).writeArtifact({
      bytes: new TextEncoder().encode("artifact"),
      kind: "generated",
      relativePath: "linked/out.txt",
    });

    expect(isErr(escaped)).toBe(true);
    expect(escaped).toMatchObject({ error: { code: "state_write_failed" } });
    await expect(readFile(path.join(outsideStateDir, "out.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects artifacts that target an existing symlink leaf", async () => {
    const root = await makeTempRoot();
    const outsideArtifact = path.join(root, "outside-artifact.txt");
    const artifactLink = path.join(root, ".surface", "reports", "result.txt");
    await mkdir(path.dirname(artifactLink), { recursive: true });
    await writeFile(outsideArtifact, "outside");
    await symlink(outsideArtifact, artifactLink);

    const written = await createFileStateStore({ projectRoot: root }).writeArtifact({
      bytes: new TextEncoder().encode("artifact"),
      kind: "generated",
      relativePath: "reports/result.txt",
    });

    expect(isErr(written)).toBe(true);
    expect(written).toMatchObject({ error: { code: "state_write_failed" } });
    expect(await readFile(outsideArtifact, "utf8")).toBe("outside");
  });

  it("rejects a symlinked state file before reads or writes", async () => {
    const root = await makeTempRoot();
    const outsideState = path.join(root, "outside-state.json");
    await mkdir(path.join(root, ".surface"), { recursive: true });
    await writeFile(outsideState, '{ "version": "outside" }\n');
    await symlink(outsideState, path.join(root, ".surface", "state.json"));

    const store = createFileStateStore({ projectRoot: root });
    const read = await store.readState();
    const written = await store.writeState({ currentStage: "capture", version: "legacy" });

    expect(isErr(read)).toBe(true);
    expect(read).toMatchObject({ error: { code: "state_read_failed" } });
    expect(isErr(written)).toBe(true);
    expect(written).toMatchObject({ error: { code: "state_write_failed" } });
    expect(await readFile(outsideState, "utf8")).toBe('{ "version": "outside" }\n');
  });

  it("rejects a symlinked lock file before acquiring the state lock", async () => {
    const root = await makeTempRoot();
    const outsideLock = path.join(root, "outside-lock");
    await mkdir(path.join(root, ".surface"), { recursive: true });
    await writeFile(outsideLock, "lock");
    await symlink(outsideLock, path.join(root, ".surface", ".state.lock"));

    const written = await createFileStateStore({ projectRoot: root }).writeState({
      currentStage: "capture",
      version: "legacy",
    });

    expect(isErr(written)).toBe(true);
    expect(written).toMatchObject({ error: { code: "state_write_failed" } });
    expect(await readFile(outsideLock, "utf8")).toBe("lock");
  });

  it("serializes overlapping writes so state.json remains parseable", async () => {
    const root = await makeTempRoot();
    const store = createFileStateStore({ projectRoot: root });

    const writes = await Promise.all(
      Array.from({ length: 20 }, async (_value, index) =>
        store.writeState({ currentStage: `stage-${index}`, version: SURFACE_STATE_VERSION }),
      ),
    );
    const persisted = JSON.parse(
      await readFile(path.join(root, ".surface", "state.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(writes.every(isOk)).toBe(true);
    expect(persisted.version).toBe(SURFACE_STATE_VERSION);
    expect(String(persisted.currentStage)).toMatch(/^stage-\d+$/);
  });
});
