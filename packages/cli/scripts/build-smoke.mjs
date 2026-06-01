const cli = await import("../dist/index.js");

if (typeof cli.runSurfaceCli !== "function") {
  throw new Error("runSurfaceCli export missing");
}
