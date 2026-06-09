#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const destinationArg = process.argv[2];

if (destinationArg === undefined) {
  console.error("usage: node scripts/copy-knowledge.mjs <destination>");
  process.exitCode = 2;
} else {
  const source = resolve(root, "content/knowledge");
  const destination = resolve(process.cwd(), destinationArg);

  await rm(destination, { force: true, recursive: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}
