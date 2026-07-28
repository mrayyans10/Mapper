import { describe, expect, it } from "vitest";
import type { ChildMapping } from "./types.js";

describe("ChildMapping transformation extension point", () => {
  it("allows optional transformation without requiring execution support", () => {
    const child: ChildMapping = {
      id: "c1",
      sourcePath: "status",
      targetPath: "status",
      status: "draft",
      transformation: {
        type: "lookup",
        config: { table: "statusCodes" },
      },
    };
    expect(child.transformation?.type).toBe("lookup");
    // Step 2 deliberately does not execute transformation — type presence only.
  });
});
