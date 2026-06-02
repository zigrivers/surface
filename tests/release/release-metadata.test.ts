import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

const RELEASE_PACKAGES = [
  {
    dir: "packages/cli",
    name: "@zigrivers/surface",
    dependencies: ["@zigrivers/surface-core"],
  },
  { dir: "packages/core", name: "@zigrivers/surface-core", dependencies: [] },
  {
    dir: "packages/mcp",
    name: "@zigrivers/surface-mcp",
    dependencies: ["@zigrivers/surface-core"],
  },
  {
    dir: "packages/grounding",
    name: "@zigrivers/surface-grounding",
    dependencies: ["@zigrivers/surface-core"],
  },
  {
    dir: "packages/adapters/agnostic",
    name: "@zigrivers/surface-adapter-agnostic",
    dependencies: ["@zigrivers/surface-core"],
  },
  {
    dir: "packages/adapters/react",
    name: "@zigrivers/surface-adapter-react",
    dependencies: ["@zigrivers/surface-core"],
  },
  {
    dir: "packages/adapters/svelte",
    name: "@zigrivers/surface-adapter-svelte",
    dependencies: ["@zigrivers/surface-core"],
  },
  {
    dir: "packages/adapters/vue",
    name: "@zigrivers/surface-adapter-vue",
    dependencies: ["@zigrivers/surface-core"],
  },
] as const;

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  license?: string;
  description?: string;
  homepage?: string;
  repository?: { type?: string; url?: string; directory?: string };
  bugs?: { url?: string };
  publishConfig?: { access?: string; provenance?: boolean };
  files?: string[];
  dependencies?: Record<string, string>;
  bin?: Record<string, string>;
};

const readPackageJson = async (dir: string): Promise<PackageJson> => {
  const raw = await readFile(join(ROOT, dir, "package.json"), "utf8");
  return JSON.parse(raw) as PackageJson;
};

describe("release package metadata", () => {
  it.each(RELEASE_PACKAGES)("$name is publishable with public npm metadata", async (pkg) => {
    const manifest = await readPackageJson(pkg.dir);

    expect(manifest.name).toBe(pkg.name);
    expect(manifest.version).toMatch(/^0\.1\.0$/);
    expect(manifest.private).not.toBe(true);
    expect(manifest.license).toBe("MIT");
    expect(manifest.description).toBeTruthy();
    expect(manifest.homepage).toBe("https://github.com/zigrivers/surface#readme");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/zigrivers/surface.git",
      directory: pkg.dir,
    });
    expect(manifest.bugs?.url).toBe("https://github.com/zigrivers/surface/issues");
    expect(manifest.publishConfig).toEqual({ access: "public", provenance: true });
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));

    for (const dependency of pkg.dependencies) {
      expect(manifest.dependencies?.[dependency]).toBe("workspace:*");
    }
  });

  it("publishes the surface CLI binary from the main package", async () => {
    const manifest = await readPackageJson("packages/cli");

    expect(manifest.bin).toEqual({ surface: "./dist/index.js" });
  });
});
