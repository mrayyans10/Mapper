/**
 * Domain invariants for Rule / RuleGroup (enforced by validation engine later).
 * Listed here as executable documentation of expected checks.
 */

export const RULE_INVARIANTS = [
  "INV-G1: Every Rule.sourceNode must equal its parent RuleGroup.sourceNode.",
  "INV-G2: RuleGroup.rules are unique by Rule.id within the group.",
  "INV-G3: Rule ids are unique across the entire project.",
  "INV-G4: ChildMapping ids are unique within their owning Rule.",
  "INV-R1: category === 'direct' ⇒ kind === 'unconditional' AND childMappings.length === 0 AND condition is absent.",
  "INV-R2: category === 'routing' AND kind === 'conditional' ⇒ condition is present and well-formed.",
  "INV-R3: kind === 'unconditional' | 'fallback' ⇒ condition is absent.",
  "INV-R4: kind === 'fallback' ⇒ category === 'routing'.",
  "INV-R5: migrationSource === 'FIELD_MAPPING_V1' ⇒ category === 'direct'.",
  "INV-R6: Child mapping sourcePath/targetPath are relative (canonical); they must not start with '$.' as stored form.",
  "INV-R7: priority is a finite number; lower wins (D1).",
  "INV-E1: first-match groups may have at most one enabled fallback (D6); more ⇒ validation error; fallbacks must not execute.",
  "INV-E2: Fallback executes only when no non-fallback enabled rule matched in that group/context (D6).",
  "INV-E3: all-match evaluates all matching non-fallback rules; fallback only if zero non-fallback matches (D6 spirit).",
  "INV-M1: v1→v2 migration creates one RuleGroup per FieldMapping (no automatic grouping) (D2).",
  "INV-M2: Migrated rules set migrationSource = 'FIELD_MAPPING_V1' and preserve id/status/rationale/notes (D2).",
  "INV-M3: Migrated projects use executionMode = 'all-match' on each legacy group (D3).",
] as const;

export type RuleInvariantId =
  | "INV-G1"
  | "INV-G2"
  | "INV-G3"
  | "INV-G4"
  | "INV-R1"
  | "INV-R2"
  | "INV-R3"
  | "INV-R4"
  | "INV-R5"
  | "INV-R6"
  | "INV-R7"
  | "INV-E1"
  | "INV-E2"
  | "INV-E3"
  | "INV-M1"
  | "INV-M2"
  | "INV-M3";
