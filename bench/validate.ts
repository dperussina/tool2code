/**
 * Validate arguments against the real schema, so malformed calls are counted rather than accepted.
 *
 * The benchmark measured tool *selection* and nothing else: the mock returned `{ok:true}` for any
 * arguments at all. So a model could call the right tool with a filter object of the wrong shape,
 * an enum value that does not exist, or a string where an array belongs, and score a success.
 *
 * That is half the question missing. The predecessor project's entire argument-shape finding came
 * from catching 14 malformed calls that a permissive harness would have scored as correct — and
 * this project's headline improvement, naming nested shapes instead of rendering them `dict`, is
 * precisely a bet about argument correctness. A bet nothing measures is not a result.
 *
 * Deliberately small: types, enums, required fields, array items, nested objects. Enough to catch
 * what models actually get wrong, with no dependency.
 */
import type { JsonSchema } from "../src/types.js";

/** Every problem with these arguments, or an empty array. */
export function validateArgs(args: Record<string, any>, schema: JsonSchema, path = ""): string[] {
  const problems: string[] = [];
  const props = schema.properties ?? {};
  const required: string[] = (schema.required as string[]) ?? [];

  for (const key of required) {
    if (args?.[key] === undefined || args?.[key] === null) problems.push(`missing required ${path}${key}`);
  }
  for (const [key, value] of Object.entries(args ?? {})) {
    const spec = props[key] as JsonSchema | undefined;
    if (!spec) {
      // Unknown parameters are what a provider rejects outright, so they count.
      if (Object.keys(props).length) problems.push(`unknown parameter ${path}${key}`);
      continue;
    }
    problems.push(...validateValue(value, spec, `${path}${key}`));
  }
  return problems;
}

function validateValue(value: any, spec: JsonSchema, path: string): string[] {
  if (value === undefined || value === null) return [];
  const problems: string[] = [];

  if (Array.isArray(spec.enum)) {
    if (!spec.enum.some((e) => e === value)) {
      problems.push(`${path}=${JSON.stringify(value)} is not one of ${spec.enum.map((e) => JSON.stringify(e)).join("|")}`);
    }
    return problems;
  }

  const types = Array.isArray(spec.type) ? spec.type : spec.type ? [spec.type] : [];
  if (!types.length) return problems;

  const actual =
    Array.isArray(value) ? "array"
    : value === null ? "null"
    : typeof value === "object" ? "object"
    : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number")
    : typeof value;

  const ok = types.some((t) => {
    if (t === actual) return true;
    if (t === "number" && actual === "integer") return true;
    // A schema declaring `["string","array"]` accepts either; handled by the some().
    return false;
  });
  if (!ok) {
    problems.push(`${path} should be ${types.join("|")}, got ${actual}`);
    return problems; // no point descending into the wrong type
  }

  if (actual === "array" && spec.items) {
    (value as any[]).forEach((item, i) => problems.push(...validateValue(item, spec.items!, `${path}[${i}]`)));
  }
  if (actual === "object" && spec.properties) {
    problems.push(...validateArgs(value, spec, `${path}.`));
  }
  return problems;
}
