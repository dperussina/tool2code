/**
 * Nested object shapes, named once and referenced everywhere.
 *
 * This exists because of a hole in the first design. The module rendered
 * `cost_of_sales(..., filters:list[dict], ...)` — and `filters` is not a dict, it is a filter DSL:
 * an array of `{column, operator, value}` where `operator` is one of eleven comparisons. **No
 * model can construct a valid filter from `list[dict]`.** The information was in the schema the
 * whole time and the renderer threw it away.
 *
 * On the 149-tool corpus there are 75 nested parameters covering **26 distinct shapes**, and one
 * of them — the filter condition — is used **40 times**. Naming it once and pointing 40
 * parameters at it is simultaneously more precise and smaller than inlining, which is the rare
 * case where accuracy and size agree.
 *
 * Two rules keep the output trustworthy:
 *
 *   - **Structural identity, not name identity.** Shapes are keyed by their fields, so the same
 *     `{column, operator, value}` gets one definition however many tools use it, and two
 *     parameters that happen to share the name `origin` while having different fields get two.
 *     The corpus has exactly that case.
 *   - **Deterministic naming.** Tools and parameters are walked in input order, so the same
 *     catalogue always produces byte-identical output. A compiled artifact that shifts with
 *     iteration order cannot be diffed or cached.
 */
import type { JsonSchema, Tool } from "./types.js";
import { singular, words } from "./graph.js";

const schemaOf = (t: Tool): JsonSchema => (t as any).input_schema ?? (t as any).inputSchema ?? {};

/** The object schema a parameter is built from, if it is built from one. */
function objectPart(v: JsonSchema): JsonSchema | null {
  if (v?.type === "object" && v.properties) return v;
  if (v?.items?.properties) return v.items as JsonSchema;
  return null;
}

/** Fields, sorted, as the identity of a shape. */
function signatureOf(schema: JsonSchema): string {
  const props = schema.properties ?? {};
  return JSON.stringify(
    Object.keys(props)
      .sort()
      .map((k) => [k, (props[k] as any)?.type ?? "any", (props[k] as any)?.enum ?? null]),
  );
}

/** `filters` → `Filter`; `origin` → `Origin`; `_meta` → `Meta`. */
function typeNameFor(param: string): string {
  const parts = words(param).map(singular);
  const name = parts.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return name || "Shape";
}

export type NamedShape = { name: string; schema: JsonSchema; uses: number };

/**
 * Every nested shape in a catalogue, keyed by structural signature.
 *
 * Includes shapes nested inside other shapes, so a filter containing a sub-object is fully
 * expressed rather than bottoming out at `dict` one level down.
 */
export function collectShapes(tools: Tool[]): Map<string, NamedShape> {
  const bySignature = new Map<string, NamedShape>();
  const takenNames = new Set<string>();

  const visit = (param: string, v: JsonSchema): void => {
    const inner = objectPart(v);
    if (!inner) return;
    const signature = signatureOf(inner);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.uses++;
    } else {
      let name = typeNameFor(param);
      // Same name, different fields — the corpus has two `origin` shapes. Both keep a name.
      if (takenNames.has(name)) {
        let n = 2;
        while (takenNames.has(`${name}${n}`)) n++;
        name = `${name}${n}`;
      }
      takenNames.add(name);
      bySignature.set(signature, { name, schema: inner, uses: 1 });
    }
    for (const [k, child] of Object.entries(inner.properties ?? {})) visit(k, child as JsonSchema);
  };

  for (const t of tools) {
    for (const [param, v] of Object.entries(schemaOf(t).properties ?? {})) {
      visit(param, v as JsonSchema);
    }
  }
  return bySignature;
}

/** The type name for a parameter, if its shape is in the registry. */
export function shapeNameOf(v: JsonSchema, shapes: Map<string, NamedShape>): string | null {
  const inner = objectPart(v);
  if (!inner) return null;
  return shapes.get(signatureOf(inner))?.name ?? null;
}
