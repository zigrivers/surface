const mod = await import("../dist/index.js");

if (mod.VUE_ADAPTER_ID !== "vue" || typeof mod.createVueAdapter !== "function") {
  console.error("Invalid Vue adapter build exports.");
  process.exit(1);
}
