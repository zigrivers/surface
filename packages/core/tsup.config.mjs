import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/interfaces.ts"],
  format: ["esm"],
  sourcemap: true,
  target: "node22",
});
