/* global console, process */

try {
  const mod = await import("../dist/index.js");

  if (mod.AGNOSTIC_ADAPTER_ID !== "agnostic" || typeof mod.createAgnosticAdapter !== "function") {
    console.error("Invalid agnostic adapter build exports.");
    process.exit(1);
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
