import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCaptureService,
  createStaticCaptureBackend,
  type CaptureIdFactory,
} from "./capture.js";
import { DEFAULT_SURFACE_CONFIG } from "./config.js";
import { isOk, ok } from "./errors.js";
import type { ArtifactWriter, PersistArtifactIntent } from "./interfaces.js";

const tempRoots: string[] = [];

describe("capture artifact persistence", () => {
  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it("routes default static capture artifacts through the injected artifact writer", async () => {
    const root = await tempRoot();
    const sourcePath = join(root, "fixture.html");
    const writes: PersistArtifactIntent[] = [];
    const artifactWriter: ArtifactWriter = {
      writeArtifact: (intent) => {
        writes.push(intent);

        return ok({
          path: `.surface/${intent.relativePath}`,
          sha256: "sha256-fixture",
        });
      },
    };
    const idFactory: CaptureIdFactory = () => "cap-state-backed-static";
    await writeFile(sourcePath, "<main>State-backed static fixture</main>");

    const capture = await createCaptureService({
      artifactWriter,
      backends: [],
      staticFallback: createStaticCaptureBackend({ idFactory }),
    }).capture(
      { kind: "dom", ref: sourcePath },
      {
        config: DEFAULT_SURFACE_CONFIG.capture,
      },
    );

    expect(isOk(capture)).toBe(true);
    expect(writes).toEqual([
      {
        bytes: Buffer.from("<main>State-backed static fixture</main>", "utf8"),
        kind: "capture",
        relativePath: "captures/cap-state-backed-static/dom.html",
      },
    ]);
    if (capture.ok) {
      expect(capture.value.artifacts).toEqual([
        {
          id: "dom",
          path: ".surface/captures/cap-state-backed-static/dom.html",
          redacted: false,
          type: "dom-snapshot",
        },
      ]);
    }
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "surface-capture-artifacts-"));
  tempRoots.push(root);

  return root;
}
