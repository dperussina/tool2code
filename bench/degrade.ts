/**
 * Make a badly-structured catalogue out of a well-structured one.
 *
 * This project's target is not a clean MCP server. It is the catalogue someone generated from an
 * OpenAPI spec at 2am, or grew one endpoint at a time over three years: names that say nothing,
 * descriptions that are a URL path, parameters with no declared type, enums documented only in
 * English prose, no `required` array. Those catalogues are where a model is most likely to pick
 * wrong, and therefore where a compiled interface should be worth the most.
 *
 * Every degradation below is a pattern taken from real tool definitions, not invented to make a
 * point:
 *
 *   1. **Types deleted.** Enormous numbers of hand-written JSON Schemas omit `type` entirely.
 *   2. **Enums demoted to prose.** `"one of: equals, not_equals, ..."` in the description, with
 *      no `enum` array — so nothing can enforce it and nothing can derive it.
 *   3. **`required` dropped.** Everything looks optional; the call fails at runtime instead.
 *   4. **Descriptions gutted** to the first fragment, or to the endpoint that backs the tool.
 *   5. **Names mangled** to the shape auto-generation produces: `apiV2OrdersNotesGet`.
 *
 * The degradation is deterministic — same input, same output — so a sweep against it is
 * reproducible, and `bench/results` stays comparable across runs.
 *
 * What this measures: whether reading a mess **once, offline, with a strong model** and emitting a
 * clean typed interface beats handing the mess to every model on every call. That is the product
 * claim, and a clean corpus cannot test it.
 */
import type { JsonSchema, Tool } from "../src/types.js";

export type Degradation = "types" | "enums" | "required" | "descriptions" | "names";

const schemaOf = (t: Tool): JsonSchema => (t as any).input_schema ?? (t as any).inputSchema ?? {};

/** `get_order_notes` → `apiV2OrderNotesGet`, the way a generator would name it. */
function mangle(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const verb = parts[0];
  const rest = parts.slice(1);
  const camel = rest.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
  return `apiV2${camel}${verb[0].toUpperCase()}${verb.slice(1).toLowerCase()}`;
}

function degradeProperty(v: JsonSchema, apply: Set<Degradation>): JsonSchema {
  const out: JsonSchema = { ...v };

  if (apply.has("enums") && Array.isArray(out.enum)) {
    const values = out.enum.map(String).join(", ");
    // The constraint survives only as English, which is exactly the real failure mode: a human
    // wrote it down for a human, and no tool can enforce or derive it.
    out.description = `${out.description ?? ""}${out.description ? " " : ""}Allowed values: ${values}.`.trim();
    delete out.enum;
  }
  if (apply.has("types")) delete out.type;
  if (apply.has("descriptions") && out.description) {
    out.description = String(out.description).split(/[.;(]/)[0].trim().slice(0, 40);
  }
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, spec]) => [k, degradeProperty(spec as JsonSchema, apply)]),
    );
    if (apply.has("required")) delete (out as any).required;
  }
  if (out.items) out.items = degradeProperty(out.items as JsonSchema, apply);
  return out;
}

/** A catalogue with the named degradations applied. Deterministic. */
export function degrade(tools: Tool[], degradations: Degradation[]): Tool[] {
  const apply = new Set(degradations);
  return tools.map((t) => {
    const schema = schemaOf(t);
    const next: any = {
      name: apply.has("names") ? mangle(t.name) : t.name,
      description: apply.has("descriptions")
        ? // What an auto-generated wrapper leaves behind: a fragment, no guidance, no contrast.
          String(t.description ?? "").split(/[.\n]/)[0].trim().slice(0, 60)
        : t.description,
      input_schema: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(schema.properties ?? {}).map(([k, spec]) => [
            k,
            degradeProperty(spec as JsonSchema, apply),
          ]),
        ),
        ...(apply.has("required") ? {} : { required: schema.required ?? [] }),
      },
    };
    return next as Tool;
  });
}

/** How much information a catalogue actually carries, for reporting alongside any result. */
export function describeCatalogue(tools: Tool[]): Record<string, number> {
  let params = 0, typed = 0, enums = 0, described = 0, requiredMarked = 0, nested = 0;
  for (const t of tools) {
    const schema = schemaOf(t);
    requiredMarked += (schema.required as string[] | undefined)?.length ?? 0;
    for (const spec of Object.values(schema.properties ?? {})) {
      const v = spec as JsonSchema;
      params++;
      if (v.type) typed++;
      if (Array.isArray(v.enum)) enums++;
      if (v.description) described++;
      if (v.properties || v.items?.properties) nested++;
    }
  }
  return { tools: tools.length, params, typed, enums, described, requiredMarked, nested };
}
