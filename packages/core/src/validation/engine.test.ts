import { describe, expect, it } from "vitest";
import { createMapping } from "../mapping/model.js";
import { applyRequiredOverrides, inferSchema } from "../schema/infer.js";
import { validateMappings } from "./engine.js";

describe("validateMappings", () => {
  it("detects primitive datatype mismatches", () => {
    const source = inferSchema({ id: 42 });
    const target = inferSchema({ id: "forty-two" });
    const mappings = [
      createMapping({ sourcePath: "$.id", targetPath: "$.id" }),
    ];

    const report = validateMappings(source, target, mappings);
    const conflict = report.issues.find(
      (i) => i.issueType === "primitive_datatype_conflict",
    );
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe("error");
    expect(report.summary.datatypeConflicts).toBeGreaterThanOrEqual(1);
  });

  it("detects required target fields that are unmapped", () => {
    const source = inferSchema({ name: "Ada" });
    let target = inferSchema({ name: "Ada", tier: "gold" });
    target = applyRequiredOverrides(target, { "$.tier": true });

    const report = validateMappings(source, target, [
      createMapping({ sourcePath: "$.name", targetPath: "$.name" }),
    ]);

    const missing = report.issues.find(
      (i) =>
        i.issueType === "unmapped_required_target" && i.targetPath === "$.tier",
    );
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("error");
    expect(report.summary.requiredTargetFieldsMissing).toBe(1);
  });

  it("detects duplicate target mappings", () => {
    const source = inferSchema({ a: "1", b: "2" });
    const target = inferSchema({ name: "x" });
    const mappings = [
      createMapping({ sourcePath: "$.a", targetPath: "$.name" }),
      createMapping({ sourcePath: "$.b", targetPath: "$.name" }),
    ];

    const report = validateMappings(source, target, mappings);
    const dup = report.issues.find(
      (i) => i.issueType === "duplicate_target_mapping",
    );
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("warning");
    expect(report.summary.potentialDuplicateMappings).toBe(1);
  });

  it("detects object-to-primitive and array conflicts", () => {
    const source = inferSchema({ meta: { created: true }, values: [1, 2] });
    const target = inferSchema({ meta: "created", values: { a: 1 } });
    const mappings = [
      createMapping({ sourcePath: "$.meta", targetPath: "$.meta" }),
      createMapping({ sourcePath: "$.values", targetPath: "$.values" }),
    ];

    const report = validateMappings(source, target, mappings);
    expect(
      report.issues.some((i) => i.issueType === "object_to_primitive_conflict"),
    ).toBe(true);
    expect(
      report.issues.some((i) => i.issueType === "array_to_non_array_conflict"),
    ).toBe(true);
  });

  it("flags structurally unreachable child mappings when required parent is unmapped", () => {
    const source = inferSchema({
      person: { city: "London" },
    });
    let target = inferSchema({
      customer: { mailingAddress: { locality: "London" } },
    });
    target = applyRequiredOverrides(target, {
      "$.customer": true,
      "$.customer.mailingAddress": true,
    });

    const report = validateMappings(source, target, [
      createMapping({
        sourcePath: "$.person.city",
        targetPath: "$.customer.mailingAddress.locality",
      }),
    ]);

    const unreachable = report.issues.filter(
      (i) => i.issueType === "structurally_unreachable",
    );
    expect(unreachable.length).toBeGreaterThanOrEqual(1);
    expect(unreachable[0]?.severity).toBe("error");
  });

  it("reports unused source fields as info", () => {
    const source = inferSchema({ a: 1, b: 2 });
    const target = inferSchema({ x: 1 });
    const report = validateMappings(source, target, [
      createMapping({ sourcePath: "$.a", targetPath: "$.x" }),
    ]);
    expect(
      report.issues.some(
        (i) => i.issueType === "unused_source" && i.sourcePath === "$.b",
      ),
    ).toBe(true);
  });

  it("flags source mapped to multiple targets", () => {
    const source = inferSchema({ name: "Ada" });
    const target = inferSchema({ first: "Ada", second: "Ada" });
    const report = validateMappings(source, target, [
      createMapping({ sourcePath: "$.name", targetPath: "$.first" }),
      createMapping({ sourcePath: "$.name", targetPath: "$.second" }),
    ]);
    expect(
      report.issues.some((i) => i.issueType === "source_multi_target_conflict"),
    ).toBe(true);
  });
});
