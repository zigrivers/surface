#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formulaString } from "./homebrew-formula-utils.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FORMULA_PATH = resolve(ROOT, "packaging/homebrew/surface.rb");
const CLI_PACKAGE_PATH = resolve(ROOT, "packages/cli/package.json");
const ALLOW_UNPUBLISHED = process.argv.includes("--allow-unpublished");

const formula = await readFile(FORMULA_PATH, "utf8");
const cliPackage = JSON.parse(await readFile(CLI_PACKAGE_PATH, "utf8"));
const url = formulaString(formula, "url", FORMULA_PATH);
const expectedSha256 = formulaString(formula, "sha256", FORMULA_PATH).toLowerCase();
const expectedUrl = npmTarballUrl(cliPackage);

if (url !== expectedUrl) {
  throw new Error(
    `Homebrew formula URL ${url} does not match expected package tarball ${expectedUrl}.`,
  );
}

const tarball = await downloadFormulaTarball(url);
const actualSha256 = createHash("sha256").update(tarball).digest("hex").toLowerCase();

if (actualSha256 !== expectedSha256) {
  console.error(`Homebrew formula sha256 mismatch for ${url}`);
  console.error(`expected: ${expectedSha256}`);
  console.error(`actual:   ${actualSha256}`);
  process.exitCode = 1;
} else {
  console.log(`verified Homebrew formula tarball: ${url} (${actualSha256})`);
}

async function downloadFormulaTarball(url) {
  if (process.env.SURFACE_SKIP_HOMEBREW_NETWORK_VERIFY === "1") {
    console.warn(
      "skipped Homebrew formula tarball verification because SURFACE_SKIP_HOMEBREW_NETWORK_VERIFY=1",
    );
    process.exit(0);
  }

  try {
    return await download(url);
  } catch (error) {
    if (ALLOW_UNPUBLISHED && url === expectedUrl && isHttpStatusError(error, 404)) {
      console.warn(
        `skipped Homebrew formula tarball verification; tarball is not published: ${url}`,
      );
      process.exit(0);
    }

    throw error;
  }
}

async function download(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw Object.assign(new Error(`Failed to download ${url}: HTTP ${response.status}`), {
      status: response.status,
    });
  }

  return Buffer.from(await response.arrayBuffer());
}

function isHttpStatusError(error, status) {
  return (
    typeof error === "object" && error !== null && "status" in error && error.status === status
  );
}

function npmTarballUrl(manifest) {
  const packageName = stringField(manifest, "name");
  const version = stringField(manifest, "version");
  const packageBasename = packageName.split("/").at(-1);

  if (packageBasename === undefined || packageBasename.length === 0) {
    throw new Error(`Invalid package name in ${CLI_PACKAGE_PATH}: ${packageName}`);
  }

  return `https://registry.npmjs.org/${packageName}/-/${packageBasename}-${version}.tgz`;
}

function stringField(value, field) {
  if (
    typeof value !== "object" ||
    value === null ||
    !(field in value) ||
    typeof value[field] !== "string" ||
    value[field].trim().length === 0
  ) {
    throw new Error(`Missing string field ${field} in ${CLI_PACKAGE_PATH}.`);
  }

  return value[field];
}
