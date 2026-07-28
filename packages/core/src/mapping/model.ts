import type { FieldMapping, MappingStatus } from "../types.js";

let counter = 0;

export function createMappingId(): string {
  counter += 1;
  return `map_${Date.now().toString(36)}_${counter}`;
}

export function createMapping(input: {
  sourcePath: string;
  targetPath: string;
  transformationNote?: string;
  rationale?: string;
  status?: MappingStatus;
}): FieldMapping {
  return {
    id: createMappingId(),
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    transformationNote: input.transformationNote,
    rationale: input.rationale,
    status: input.status ?? "draft",
  };
}

export function updateMapping(
  mapping: FieldMapping,
  patch: Partial<Omit<FieldMapping, "id">>,
): FieldMapping {
  return { ...mapping, ...patch, id: mapping.id };
}

export function removeMapping(
  mappings: FieldMapping[],
  id: string,
): FieldMapping[] {
  return mappings.filter((m) => m.id !== id);
}
