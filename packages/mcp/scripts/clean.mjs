import { rmSync } from "node:fs";
import { join } from "node:path";

rmSync(join(import.meta.dirname, "..", "dist"), { force: true, recursive: true });
