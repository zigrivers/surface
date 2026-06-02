/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Smoke checks inspect built JS and package JSON dynamically. */
/* global console, process */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}

async function main() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const distDir = path.join(packageRoot, "dist");
  if (!existsSync(distDir)) {
    console.error("Missing dist directory. Run the package build before build:smoke.");
    process.exit(1);
  }

  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  const core = await import(pathToFileURL(path.join(distDir, "index.js")).href);
  const interfacesDtsFiles = readdirSync(distDir)
    .filter((file) => /^interfaces.*\.d\.ts$/.test(file))
    .sort();
  const interfacesDts = interfacesDtsFiles
    .map((file) => readFileSync(path.join(distDir, file), "utf8"))
    .join("\n");
  const tsModule = await loadTypeScript();
  const primaryInterfacesDts = "interfaces.d.ts";

  const interfaceContracts = [
    "CaptureBackend",
    "FrameworkAdapter",
    "GroundingTool",
    "Lens",
    "ReportRenderer",
    "GateEvaluator",
    "IssueExporter",
    "KnowledgeSource",
    "StateStore",
  ];

  if (core.CORE_PACKAGE_NAME !== "@zigrivers/surface-core") {
    console.error("Unexpected CORE_PACKAGE_NAME:", core.CORE_PACKAGE_NAME);
    process.exit(1);
  }

  const interfacesExport = pkg.exports?.["./interfaces"];
  if (
    !interfacesDtsFiles.includes(primaryInterfacesDts) ||
    typeof interfacesExport !== "object" ||
    interfacesExport === null ||
    Array.isArray(interfacesExport) ||
    interfacesExport.types !== `./dist/${primaryInterfacesDts}` ||
    "default" in interfacesExport
  ) {
    console.error("Invalid ./interfaces export:", interfacesExport);
    process.exit(1);
  }

  for (const name of interfaceContracts) {
    if (!hasInterfaceDeclaration(interfacesDts, name, tsModule)) {
      console.error("Missing interface contract:", name);
      process.exit(1);
    }
  }
}

async function loadTypeScript() {
  try {
    return await import("typescript");
  } catch {
    return undefined;
  }
}

/**
 * @param {string} source
 * @param {string} name
 * @param {typeof import("typescript") | undefined} tsModule
 */
function hasInterfaceDeclaration(source, name, tsModule) {
  if (tsModule === undefined) {
    // build:smoke normally runs with devDependencies; this fallback keeps the
    // failure mode useful in stripped environments.
    return source.includes(`interface ${name}`);
  }

  const parser = tsModule;
  const sourceFile = parser.createSourceFile(
    "interfaces.d.ts",
    source,
    parser.ScriptTarget.Latest,
    false,
    parser.ScriptKind.TS,
  );
  let found = false;

  /**
   * @param {import("typescript").Node} node
   */
  function visit(node) {
    if (parser.isInterfaceDeclaration(node) && node.name.text === name) {
      found = true;
      return;
    }

    parser.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}
