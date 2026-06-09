import { spawn } from "node:child_process";

const child = spawn("vitest", ["run", "tests/evals/model-cli-smoke.test.ts"], {
  env: {
    ...process.env,
    SURFACE_MODEL_CLI_SMOKE: "1",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
