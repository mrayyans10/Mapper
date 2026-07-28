import { describe, expect, it } from "vitest";
import { inferSchema, parseJsonDocument } from "./infer.js";

describe("inferSchema", () => {
  it("infers nested object schemas with parent/child paths", () => {
    const tree = inferSchema({
      person: {
        name: "Ada",
        address: { city: "London" },
      },
    });

    expect(tree.nodes["$"]?.type).toBe("object");
    expect(tree.nodes["$.person"]?.type).toBe("object");
    expect(tree.nodes["$.person.name"]?.type).toBe("string");
    expect(tree.nodes["$.person.address"]?.type).toBe("object");
    expect(tree.nodes["$.person.address.city"]?.type).toBe("string");

    expect(tree.nodes["$.person.name"]?.parentPath).toBe("$.person");
    expect(tree.nodes["$.person"]?.childPaths).toContain("$.person.name");
    expect(tree.nodes["$.person"]?.childPaths).toContain("$.person.address");
    expect(tree.nodes["$.person.address.city"]?.exampleValue).toBe("London");
    expect(tree.nodes["$.person.name"]?.required).toBe(false);
    expect(tree.nodes["$.person.name"]?.isInsideArray).toBe(false);
  });

  it("infers arrays of primitives", () => {
    const tree = inferSchema({ tags: ["a", "b"] });
    expect(tree.nodes["$.tags"]?.type).toBe("array");
    expect(tree.nodes["$.tags[*]"]?.type).toBe("string");
    expect(tree.nodes["$.tags[*]"]?.isInsideArray).toBe(true);
    expect(tree.nodes["$.tags"]?.childPaths).toEqual(["$.tags[*]"]);
  });

  it("infers arrays of objects and merges keys across items", () => {
    const tree = inferSchema({
      items: [
        { sku: "A1", qty: 2 },
        { sku: "B2", price: 9.5 },
      ],
    });

    expect(tree.nodes["$.items"]?.type).toBe("array");
    expect(tree.nodes["$.items[*]"]?.type).toBe("object");
    expect(tree.nodes["$.items[*].sku"]?.type).toBe("string");
    expect(tree.nodes["$.items[*].qty"]?.type).toBe("number");
    expect(tree.nodes["$.items[*].price"]?.type).toBe("number");
    expect(tree.nodes["$.items[*].sku"]?.isInsideArray).toBe(true);
  });

  it("handles null values", () => {
    const tree = inferSchema({ nickname: null, profile: { bio: null } });
    expect(tree.nodes["$.nickname"]?.type).toBe("null");
    expect(tree.nodes["$.profile.bio"]?.type).toBe("null");
    expect(tree.nodes["$.nickname"]?.exampleValue).toBeNull();
  });

  it("handles empty arrays as null item placeholder", () => {
    const tree = inferSchema({ empty: [] });
    expect(tree.nodes["$.empty"]?.type).toBe("array");
    expect(tree.nodes["$.empty[*]"]?.type).toBe("null");
  });
});

describe("parseJsonDocument", () => {
  it("parses valid JSON", () => {
    const result = parseJsonDocument('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("rejects empty and invalid JSON with clear errors", () => {
    expect(parseJsonDocument("").ok).toBe(false);
    const bad = parseJsonDocument("{nope}");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Invalid JSON/);
  });
});
