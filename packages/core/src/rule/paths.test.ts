import { describe, expect, it } from "vitest";
import {
  joinPath,
  isRelativePath,
  PathError,
  expandSourceContexts,
  getPathValues,
  resolveChildPaths,
} from "./paths.js";

describe("joinPath (D7)", () => {
  it("joins object node and relative field", () => {
    expect(joinPath("$.customer", "type")).toBe("$.customer.type");
  });

  it("joins array item node and relative field", () => {
    expect(joinPath("$.items[*]", "sku")).toBe("$.items[*].sku");
  });

  it("returns node path for empty relative", () => {
    expect(joinPath("$.email", "")).toBe("$.email");
  });

  it("rejects absolute relative paths", () => {
    expect(() => joinPath("$.a", "$.b")).toThrow(PathError);
  });
});

describe("isRelativePath", () => {
  it("detects relative vs absolute", () => {
    expect(isRelativePath("type")).toBe(true);
    expect(isRelativePath("$.type")).toBe(false);
  });
});

describe("resolveChildPaths", () => {
  it("resolves both sides", () => {
    expect(
      resolveChildPaths("$.src", "$.dst", {
        sourcePath: "a",
        targetPath: "b",
      }),
    ).toEqual({
      absoluteSourcePath: "$.src.a",
      absoluteTargetPath: "$.dst.b",
    });
  });
});

describe("getPathValues / expandSourceContexts", () => {
  const doc = {
    orders: { amount: 1500 },
    items: [
      { productType: "P", sku: "A" },
      { productType: "S", sku: "B" },
    ],
  };

  it("reads nested values", () => {
    expect(getPathValues(doc, "$.orders.amount")).toEqual([1500]);
  });

  it("expands [*] into per-element contexts (D4)", () => {
    const ctxs = expandSourceContexts(doc, "$.items[*]");
    expect(ctxs).toHaveLength(2);
    expect(ctxs[0]?.arrayIndex).toBe(0);
    expect(ctxs[0]?.relativeRoot).toEqual({ productType: "P", sku: "A" });
    expect(ctxs[1]?.arrayIndex).toBe(1);
  });

  it("uses object sourceNode as single context", () => {
    const ctxs = expandSourceContexts(doc, "$.orders");
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]?.relativeRoot).toEqual({ amount: 1500 });
  });
});
