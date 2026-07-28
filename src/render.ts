/**
 * Emit the module a model reads to choose a tool.
 *
 * Two halves with two different authors, and the split is the whole design:
 *
 *   - the **signature** is regenerated from the JSON Schema, here, every time. A model never
 *     writes a parameter name, a type or an enum value. Measured reason: across 144 runs on a
 *     suite where only argument shape could fail, every malformed argument came from a
 *     representation whose parameter list a model had written.
 *   - the **docstring** is the model's shorthand, in the glossary's fixed slots, verified
 *     against the catalogue before it gets here.
 *
 * So a stale compiled artifact degrades safely: the signature is still correct because it was
 * never in the artifact, and a tool with no semantics gets `?` rather than a guess.
 */
import type { JsonSchema, Tool } from "./types.js";
import { GLOSSARY, accessClass, hoistedFormats } from "./shorthand.js";
import { collectShapes, shapeNameOf, type NamedShape } from "./shapes.js";
import type { Semantics } from "./compile.js";

const schemaOf = (t: Tool): JsonSchema => (t as any).input_schema ?? (t as any).inputSchema ?? {};

/** Python's reserved words. A schema may name a parameter `from`; Python may not. */
const PYTHON_KEYWORDS = new Set(
  ("False None True and as assert async await break class continue def del elif else except " +
    "finally for from global if import in is lambda nonlocal not or pass raise return try " +
    "while with yield match case").split(" "),
);
const isIdentifier = (n: string) => /^[A-Za-z_]\w*$/.test(n) && !PYTHON_KEYWORDS.has(n);

/**
 * A parameter's type, derived. Containers are the load-bearing part: a parameter shown as a
 * bare name gives a model no way to know it wants `[{…}]` rather than a string, and that was
 * measured as the single cause of container-type rejections.
 */
function typeOf(v: JsonSchema, alias?: string, shapes?: Map<string, NamedShape>): string {
  if (alias) return alias;
  if (v.enum) return `Literal[${v.enum.map((e) => JSON.stringify(e)).join(",")}]`;
  const t = Array.isArray(v.type) ? v.type[0] : v.type;
  // A named shape beats `dict` and `list[dict]`, which tell a model nothing it can act on.
  const named = shapes ? shapeNameOf(v, shapes) : null;
  if (t === "array") {
    const items = v.items;
    if (!items) return "list";
    return `list[${named ?? (items.properties ? "dict" : typeOf(items, undefined, shapes))}]`;
  }
  if (named) return named;
  if (t === "object") return "dict";
  if (t === "integer") return "int";
  if (t === "number") return "float";
  if (t === "boolean") return "bool";
  return "str";
}

export type RenderOptions = {
  /** Model-written slots, by tool name. Missing entries render as unknown, never invented. */
  semantics?: Map<string, Semantics>;
};

/** One `def` line: derived signature, shorthand docstring. */
export function renderTool(
  t: Tool,
  options: RenderOptions = {},
  aliases = new Map<string, string>(),
  kwAliases = new Map<string, string>(),
  shapes?: Map<string, NamedShape>,
): string {
  const schema = schemaOf(t);
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  /**
   * Required parameters first, then optional.
   *
   * Not cosmetic — `def f(a, b=None, c)` is a SyntaxError, "parameter without a default
   * follows parameter with a default". Emitting in schema order produced exactly that on two
   * of the first twelve tools compiled, which is the same defect class as the reserved-word
   * bug: a representation that claims to be Python and is not. Order carries no meaning here
   * because every argument is dispatched by name.
   */
  const req: string[] = [];
  const opt: string[] = [];
  const kwargs: string[] = [];
  for (const [name, spec] of Object.entries(props)) {
    const type = typeOf(spec, aliases.get(name), shapes);
    if (!isIdentifier(name)) {
      // A parameter named `from` cannot be a parameter at all. `def send(from=None)` is a
      // SyntaxError, and so — checked with a real parser, not by eye — is
      // `def send(**{"from":None})`: `**` in a *definition* must be followed by a name, even
      // though `**{...}` is fine in a *call*. The predecessor project shipped that second form
      // believing it valid.
      //
      // The functional TypedDict spelling is the one Python actually provides for keys that
      // are not identifiers, and `**kw: Alias` is legal, so the wire name survives verbatim.
      kwargs.push(`"${name}":${type}`);
      continue;
    }
    (required.has(name) ? req : opt).push(
      required.has(name) ? `${name}:${type}` : `${name}:${type}=None`,
    );
  }
  const positional = [...req, ...opt];
  if (kwargs.length) {
    const alias = `${t.name.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())}Kw`;
    kwAliases.set(alias, kwargs.join(","));
    positional.push(`**kw:${alias}`);
  }

  const s = options.semantics?.get(t.name);
  const slots: string[] = [accessClass(t.name)];
  if (s) {
    if (s.returns) slots.push(`>${s.returns}`);
    if (s.supersetOf?.length) slots.push(`^${s.supersetOf.join(",")}`);
    for (const n of s.notThis ?? []) slots.push(`vs${n.tool}(${n.why})`);
    for (const n of s.needs ?? []) slots.push(n.startsWith("?") ? n : `!${n}`);
  } else {
    slots.push("?uncompiled");
  }

  return `def ${t.name}(${positional.join(",")}):"${slots.join(" ")}"`;
}

/**
 * The whole module: glossary, hoisted identifier formats, then one line per tool.
 *
 * Identifier formats are hoisted to type aliases because they hide in one description and
 * apply to every tool sharing the parameter — `trackingNumber` is documented as
 * `{partnerId}U{orderId}` on one of the four tools that take it.
 */
export function renderModule(tools: Tool[], options: RenderOptions = {}): string {
  const formats = hoistedFormats(tools);
  const aliases = new Map<string, string>();
  const lines: string[] = [GLOSSARY];

  // Emitted only when used. If this module claims to be Python, `Literal` has to be imported,
  // or the claim is false the moment anyone checks — which is how the predecessor shipped
  // invalid Python for three tools across several releases.
  const body: string[] = [];

  if (formats.size) {
    lines.push("");
    for (const [param, format] of formats) {
      const alias = param[0].toUpperCase() + param.slice(1).replace(/[^A-Za-z0-9]/g, "");
      aliases.set(param, alias);
      lines.push(`${alias} = str  # ${format}`);
    }
  }

  /**
   * Nested shapes, defined before anything uses them.
   *
   * Descriptions are kept as field comments. Tokens are not the objective here — a model that
   * knows `operator` accepts eleven specific comparisons can construct the call, and one that
   * sees `dict` cannot.
   */
  const shapes = collectShapes(tools);
  const shapeLines: string[] = [];
  for (const { name, schema } of shapes.values()) {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    shapeLines.push(`${name} = TypedDict("${name}", {`);
    for (const [field, spec] of Object.entries(props)) {
      const note = [
        required.has(field) ? "required" : "",
        ((spec as any)?.description ?? "").replace(/\s+/g, " ").slice(0, 90),
      ]
        .filter(Boolean)
        .join(" — ");
      shapeLines.push(`  "${field}": ${typeOf(spec as JsonSchema, undefined, shapes)},${note ? `  # ${note}` : ""}`);
    }
    shapeLines.push(`}, total=False)`);
  }

  const kwAliases = new Map<string, string>();
  for (const t of tools) body.push(renderTool(t, options, aliases, kwAliases, shapes));

  const imports: string[] = [];
  if ([...body, ...shapeLines].some((l) => l.includes("Literal["))) imports.push("Literal");
  if (kwAliases.size || shapeLines.length) imports.push("TypedDict");
  if (imports.length) lines.splice(1, 0, `from typing import ${imports.sort().join(", ")}`);
  if (shapeLines.length) lines.push("", ...shapeLines);
  if (kwAliases.size) {
    lines.push("");
    for (const [alias, fields] of kwAliases) lines.push(`${alias} = TypedDict("${alias}", {${fields}}, total=False)`);
  }
  lines.push("", ...body);
  return lines.join("\n");
}
