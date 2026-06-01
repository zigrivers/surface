import { readFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const packageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
);

for (const exportedPath of [packageJson.main, packageJson.types]) {
  readFileSync(join(dist, exportedPath.replace(/^\.\/dist\//u, "")));
}
