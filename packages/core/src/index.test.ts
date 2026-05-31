import { describe, expect, it } from "vitest";

import { CORE_PACKAGE_NAME } from "./index.js";

describe("@surface/core package identity", () => {
  it("exports the core package identity from the public entry point", () => {
    expect(CORE_PACKAGE_NAME).toBe("@surface/core");
  });
});
