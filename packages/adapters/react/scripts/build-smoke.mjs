const mod = await import("../dist/index.js");

if (mod.REACT_ADAPTER_ID !== "react" || typeof mod.createReactAdapter !== "function") {
  console.error("Invalid React adapter build exports.");
  process.exit(1);
}
