#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const PACK_ONLY = process.argv.includes("--pack-only");

const packages = [
  { name: "@zigrivers/surface-core", dir: "packages/core" },
  { name: "@zigrivers/surface-grounding", dir: "packages/grounding" },
  { name: "@zigrivers/surface-mcp", dir: "packages/mcp" },
  { name: "@zigrivers/surface-adapter-agnostic", dir: "packages/adapters/agnostic" },
  { name: "@zigrivers/surface-adapter-react", dir: "packages/adapters/react" },
  { name: "@zigrivers/surface-adapter-svelte", dir: "packages/adapters/svelte" },
  { name: "@zigrivers/surface-adapter-vue", dir: "packages/adapters/vue" },
  { name: "@zigrivers/surface", dir: "packages/cli", hasBinary: true },
];

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stderr}`));
    });
  });

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const temp = await mkdtemp(join(tmpdir(), "surface-release-"));
  const packDir = join(temp, "packs");
  const installDir = join(temp, "install");

  try {
    await mkdir(packDir, { recursive: true });
    await run("pnpm", ["run", "build"]);

    const tarballs = [];
    for (const pkg of packages) {
      const { stdout } = await run(
        "pnpm",
        ["--dir", pkg.dir, "pack", "--pack-destination", packDir, "--json"],
        { capture: true },
      );
      const parsed = JSON.parse(stdout);
      const result = Array.isArray(parsed) ? parsed[0] : parsed;
      assert(result?.filename, `pnpm pack did not return a filename for ${pkg.name}`);
      const files = result.files?.map((file) => file.path) ?? [];
      assert(files.includes("package.json"), `${pkg.name} package.json missing from tarball`);
      assert(files.includes("README.md"), `${pkg.name} README.md missing from tarball`);
      assert(files.includes("LICENSE"), `${pkg.name} LICENSE missing from tarball`);
      assert(
        files.some((file) => file.startsWith("dist/")),
        `${pkg.name} dist files missing`,
      );
      tarballs.push(isAbsolute(result.filename) ? result.filename : join(packDir, result.filename));
      console.log(`packed ${pkg.name}: ${result.filename}`);
    }

    if (PACK_ONLY) {
      return;
    }

    await mkdir(installDir, { recursive: true });
    await run("npm", ["init", "-y"], { cwd: installDir });
    await run("npm", ["install", "--ignore-scripts", ...tarballs], { cwd: installDir });
    const surfaceBin = join(installDir, "node_modules", ".bin", "surface");
    const { stdout, stderr } = await run(surfaceBin, ["--help"], {
      cwd: installDir,
      capture: true,
    });
    const helpOutput = `${stdout}\n${stderr}`;
    assert(
      helpOutput.includes("Usage:"),
      `surface --help output did not include usage text: ${JSON.stringify(helpOutput.slice(0, 500))}`,
    );
    assert(
      helpOutput.includes("audit"),
      `surface --help output did not include expected audit verb: ${JSON.stringify(helpOutput.slice(0, 500))}`,
    );
    console.log("verified CLI tarball install: surface --help");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
