const mod = await import("../dist/index.js");

if (mod.SVELTE_ADAPTER_ID !== "svelte" || typeof mod.createSvelteAdapter !== "function") {
  console.error("Invalid Svelte adapter build exports.");
  process.exit(1);
}
