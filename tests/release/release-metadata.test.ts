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
const RELEASE_VERSION = "0.2.0";

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
    expect(manifest.version).toBe(RELEASE_VERSION);
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

  it("packs release tarballs into the root publish directory", async () => {
    const workflow = await readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain("RELEASE_TAG: ${{ inputs.tag }}");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).toContain('VERSION="${RELEASE_TAG#v}"');
    expect(workflow).toContain('EXPECTED_VERSION="$VERSION"');
    expect(workflow).toContain("run: pnpm run check");
    expect(workflow).toContain("run: pnpm run release:verify");
    expect(workflow).toContain('PACK_DIR="$PWD/.release-packs"');
    for (const pkg of RELEASE_PACKAGES) {
      expect(workflow).toContain(`pnpm --dir ${pkg.dir} pack --pack-destination "$PACK_DIR"`);
    }
    expect(workflow).toContain('"$PACK_DIR/zigrivers-surface-$VERSION.tgz"');
    expect(workflow).not.toContain("-0.1.1.tgz");
    expect(workflow).not.toContain("pack --pack-destination .release-packs");
  });

  it("uses the requested semver tag safely for release publication", async () => {
    const workflow = await readFile(join(ROOT, ".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain(
      'if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then',
    );
    expect(workflow).toContain(
      'git fetch --force origin "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"',
    );
    expect(workflow).toContain('git checkout --detach "$RELEASE_TAG"');
    expect(workflow).toContain('if [[ "$TAG_COMMIT" != "$HEAD_COMMIT" ]]; then');
    expect(workflow).toContain('awk -v version="$VERSION"');
    expect(workflow).toContain('heading = "^##[[:space:]]+" escaped "([[:space:]]|$)"');
    expect(workflow).toContain("$0 ~ heading { in_section = 1; print; next }");
    expect(workflow).toContain('gh api "repos/$GITHUB_REPOSITORY" --silent');
    expect(workflow).toContain('if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then');
    expect(workflow).toContain(
      'if npm view "$package_name@$VERSION" version >/dev/null 2>&1; then',
    );
    expect(workflow).toContain("if: github.event.inputs.publish == 'true'");
    expect(workflow).toContain('gh release create "$RELEASE_TAG" --title "$RELEASE_TAG"');
    expect(workflow).not.toContain("ref: ${{ inputs.tag }}");
    expect(workflow).not.toContain('gh release create "${{ inputs.tag }}"');
    expect(workflow).not.toContain("--notes-file CHANGELOG.md");
  });
});
