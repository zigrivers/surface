import { describe, expect, it } from "vitest";

import { CORE_PACKAGE_NAME, createStaticCaptureBackend } from "./index.js";

describe("@zigrivers/surface-core package identity", () => {
  it("exports the core package identity from the public entry point", () => {
    expect(CORE_PACKAGE_NAME).toBe("@zigrivers/surface-core");
  });

  it("exports the static capture backend from the public entry point", () => {
    expect(createStaticCaptureBackend).toBeTypeOf("function");
  });
});
