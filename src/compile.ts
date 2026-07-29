/**
 * The transform is a model. The library's job is the prompt, the vocabulary, and the check.
 *
 * An earlier draft of this project tried to *derive* the semantics — which tool produces
 * which identifier, inferred from names. It got 12 of 30 identifier parameters on the real
 * corpus and needed four attempts to stop proposing wrong edges (`loadId <- gdrive_upload_file`,
 * from "up-LOAD-file"). Worse, it could not touch the case that matters: four order tools that
 * all take `trackingNumber`, all start with "Get", and differ only in what comes back. Derived
 * slots rendered all four as the single character `r`.
 *
 * A model reads that difference off the descriptions in one pass. So it writes the semantics.
 *
 * What does NOT come from the model is the signature. That is the one measured rule carried
 * over: across 144 runs on a suite where only argument shape could fail, every malformed
 * argument came from a representation whose parameter list a model had written, and deriving
 * container shapes from the schema removed them by construction. The model is never asked for
 * a type, a parameter name, or an enum value — those are regenerated from the schema after it
 * answers, so it cannot get them wrong.
 *
 * And every semantic claim is verified against the real catalogue before it ships, because the
 * predecessor shipped a compiled map that pointed the model at `place_details_by_query` — a
 * tool that did not exist — and the bug was that the model would obey.
 */
import type { Tool } from "./types.js";
import { GLOSSARY } from "./shorthand.js";
import { words } from "./graph.js";
import { compileBatches, contradictorySupersets, subjectKey } from "./cluster.js";

export type Completion = (input: { system: string; user: string }) => Promise<string>;

/** What the model is asked to produce for each tool: semantics only, in the glossary's vocabulary. */
export type Semantics = {
  name: string;
  /** What comes back. The discriminating axis for lookalike tools. */
  returns: string;
  /** Sibling tools whose results this one's already include. */
  supersetOf?: string[];
  /** Tools to call first to obtain an argument. */
  needs?: string[];
  /**
   * Near-duplicate tools this one must not be mistaken for, and what each is for instead.
   *
   * The slot that exists because of measurement: every failure over 96 runs was calling the
   * wrong member of a lookalike pair, and nothing else failed at all.
   */
  notThis?: { tool: string; why: string }[];
  /**
   * Structure recovered from a schema that does not declare it.
   *
   * The reason this project exists. A well-formed catalogue needs none of this: types come from
   * the schema and are derived, never guessed. A badly-formed one — generated from an OpenAPI
   * spec, or grown endpoint by endpoint — routinely declares no `type` at all, documents its
   * allowed values in English, and ships no `required` array. On such a catalogue there is
   * nothing to derive, and a renderer that guesses `str` is confidently wrong on every array.
   *
   * So a strong model reads the mess once, offline, and writes the structure down. Every claim is
   * then **grounded**: an inferred enum value must literally appear in that parameter's own
   * description, or it is dropped. Inference that cannot be checked against the source is
   * invention, and this project has already shipped one invented tool reference.
   */
  params?: { name: string; type?: string; enum?: string[]; required?: boolean }[];
  /**
   * The shape that comes back, so the signature can carry `-> Result` instead of nothing.
   *
   * Until this existed, the module was a typed interface with no return types at all: what a
   * tool returns lived as prose inside a docstring, in a shorthand needing a glossary. That is
   * the gap between a type stub and a code translation, and a model reading code expects the
   * arrow.
   *
   * Grounded like everything else: a field name is kept only if it appears in the tool's own
   * description. Almost no MCP catalogue declares an output schema, so this is inference — and
   * inference that cannot be checked against the source is invention.
   */
  returnShape?: { list: boolean; fields: { name: string; type: string }[] };
};

/** Types an inference is allowed to claim. Anything else is rejected. */
export const INFERABLE_TYPES = new Set(["str", "int", "float", "bool", "list", "dict", "Any"]);

export const SYSTEM = `You are turning a tool catalogue into a Python module another model will read to decide which tool to call.

${GLOSSARY}

For each tool, output one line:

<name> | >RETURNS | ^SUPERSET | !NEEDS | vsOTHER(why)

- RETURNS: what comes back. **Lead with the SUBJECT MATTER — what the data is about — and only
  then how it arrives.** This is the field that decides everything, and getting the order wrong
  loses the decision.
  A measured failure: get_cost_of_sales is described as "detailed cost of sales data for a date
  range with optional filters. Includes freight costs, carrier charges, and heatmap data...
  Results are offloaded to files and returned as manifest with batch metadata." It was compiled
  as ">file manifest of batched cost rows with batch metadata and aggregated heatmap data" --
  every word about delivery, not one about freight or carrier charges. A user asking "what did
  freight and carrier charges come to for partner 4471" could not match that, and the model
  reached for the bulk export instead. Correct: ">freight and carrier charges per invoice for a
  date range, delivered as batched files plus heatmap aggregates".
  Name the nouns a person would use when they want this tool. Delivery mechanism, pagination and
  batching go last and only when they change how you would use it. Tools in a catalogue are often near-identical in name and parameters and differ
  ONLY in what they return — four tools may all be "get X for an order" taking the same
  tracking number, where one returns notes, one a chronological timeline, one EDI scan events
  and one everything at once. Say which. Never restate the tool's name back to me.
- SUPERSET: names of other tools in the inventory whose results this tool's results already
  contain. Omit unless true. This is what stops a model reaching for the comprehensive tool
  every time; it is also what tells it when the comprehensive one is the right single call.
- Some parameters below arrive with NO declared type, shown as \`type: any\`. For each of those,
  add a separate line AFTER the tool's line, inferring the structure from the parameter name, its
  description and the tool's purpose:
      @<tool>.<param> | <type> | <allowed,values,if,any> | required
  <type> must be exactly one of: str int float bool list dict Any. Use Any when you genuinely
  cannot tell — that is a real answer and better than a confident wrong one.
  In particular, for an IDENTIFIER or CURSOR parameter — anything named like an id, a number, a
  code, a key, or a pagination cursor — answer Any unless the description shows an example value
  or states the type outright. Measured against ground truth, every remaining type error was this:
  "Partner/Customer ID" and "Keyset cursor for pagination" were called str when the schema says
  number. A wrong scalar type is not a harmless miss — the module tells the model to send "4471"
  where the API demands 4471, and the call is rejected. Any is honest and costs nothing, because
  the value almost always arrives from another call rather than being written by hand.
  List allowed values ONLY when the parameter's own description states them; they are checked
  against it and dropped if they do not appear. Mark \`required\` only when the description or the
  tool's purpose makes the call impossible without it.
  Do not emit these lines for parameters whose type is already declared.
- vsOTHER: when two tools in this batch are easy to confuse, EACH must say what it is not.
  Write \`vsother_tool(what that one is for)\`. This is the most valuable field you can fill:
  measured over 96 runs, every single failure was a model calling the wrong member of a
  near-identical pair, and no other kind of failure occurred at all.
  Find the ONE axis the pair differs on and name it on both sides. Common axes, but do not force
  a catalogue into any of them — read the parameters, they usually give it away:
    * scope: everything vs one record (a date range and paging on one side, an ID on the other)
    * destination: a bulk feed or file export vs an answer returned inline
    * depth: a summary vs a full detail record
    * lifecycle: create vs update vs read
    * subject: two tools about genuinely different things that merely share a word
  Shape of the answer, in whatever domain you are given:
    list_files | >every file in a folder with ids and mime types | | ?folderId | vsread_file(one file's contents by id)
    read_file  | >one file's contents | | !list_files | vslist_files(finding which file, not reading it)
- After each tool's line, add ONE return-shape line naming the fields that come back:
      =<tool> | list OR one | field:type, field:type, ...
  Use the field names the description actually uses — they are checked against it and dropped if
  absent, so guessing gains nothing. \`list\` when the tool returns many records, \`one\` for a
  single object. Types from the same vocabulary: str int float bool list dict Any. Omit the line
  entirely if the description does not say what comes back.
- SUPERSET is for containment ONLY, and it is directional: use it when this tool's result
  genuinely includes the other's. It cannot go both ways. Two tools returning the same subject
  at different granularity are NOT a superset pair — that is \`vs\`, not \`^\`.
- NEEDS: names of tools that must be called first to obtain one of this tool's arguments —
  a place ID comes from a place search, a task ID from the call that started the task. If an
  argument is an identifier the caller must already possess and nothing in the inventory
  produces it, write ?argname instead.

Rules:
- Only ever name tools that appear in the inventory, spelled exactly. If you want to describe
  a tool that is not there, describe the situation instead of naming anything.
- Never describe parameters, types, shapes or allowed values. The signature is regenerated
  from the JSON Schema after you answer, so you cannot help and cannot hurt there.
- No prose, no fences, no blank lines. One line per tool, in the order given.

Example:
  get_order_notes | >notes only | | ?trackingNumber
  get_order_details | >everything: header, partner, freight, refs, notes, children, gallery | ^get_order_notes,get_order_timeline | ?trackingNumber`;

/**
 * How a tool is shown to the model: the full contract, then the prose.
 *
 * The first version showed parameter *names* only. That hid 30,287 characters of per-parameter
 * description across 573 of 799 parameters, plus every type and every nested structure — and then
 * asked the model to say what the tool returns and how it differs from its neighbours. The single
 * most discriminating fact about `cost_of_sales` is that it takes `csv_mode`, `csv_path` and
 * `schema_only`, which is what a warehouse export looks like; `get_cost_of_sales` takes a date
 * range and a partner. Shape is the evidence, and it was being withheld.
 */
export function describe(t: Tool): string {
  const schema: any = (t as any).input_schema ?? (t as any).inputSchema ?? {};
  const required = new Set<string>(schema.required ?? []);
  const lines = Object.entries(schema.properties ?? {}).map(([p, raw]) => {
    const v: any = raw ?? {};
    const type = typeSummary(v);
    const note = (v.description ?? "").replace(/\s+/g, " ").slice(0, 160);
    return `    ${p}${required.has(p) ? "*" : ""}: ${type}${note ? ` — ${note}` : ""}`;
  });
  const prose = (t.description ?? "").replace(/\s+/g, " ").slice(0, 600);
  const out: string[] = [`${t.name} — "${prose}"`];
  out.push(lines.length ? `  params:\n${lines.join("\n")}` : "  params: (none)");

  // An output schema, where a catalogue provides one, is the direct answer to the `>returns`
  // slot rather than an inference from prose. This corpus has none; MCP allows them.
  const output = (t as any).outputSchema ?? (t as any).output_schema;
  if (output) out.push(`  returns: ${typeSummary(output)}`);
  return out.join("\n");
}

/** A compact but complete type, including nested fields and enum values. */
function typeSummary(v: any, depth = 0): string {
  if (!v || typeof v !== "object") return "any";
  if (Array.isArray(v.enum)) return v.enum.map((e: unknown) => JSON.stringify(e)).join("|");
  const t = Array.isArray(v.type) ? v.type[0] : v.type;
  if (t === "array") return `${v.items ? typeSummary(v.items, depth + 1) : "any"}[]`;
  if (t === "object" && v.properties && depth < 2) {
    const fields = Object.entries(v.properties).map(
      ([k, spec]) => `${k}:${typeSummary(spec, depth + 1)}`,
    );
    return `{${fields.join(", ")}}`;
  }
  return t ?? "any";
}

export type Rejection = { name: string; reason: string };

/**
 * Check one line against the real catalogue.
 *
 * The three failure modes are all ones a model has actually committed in this project's
 * history: naming a tool that does not exist, naming itself, and claiming to be a superset of
 * a tool that shares none of its arguments (a superset claim across unrelated tools is the
 * `^` equivalent of a wrong producer edge — it will send the model to the wrong single call).
 */
export function verify(s: Semantics, tools: Tool[]): string | null {
  /**
   * A contrast is only meaningful between tools that are actually confusable.
   *
   * Asked for `vs`, the model wrote one for 143 of 147 tools — including tools with no
   * lookalike anywhere — which nearly doubled the artifact (21,350 to 39,286 characters) and
   * buried the 31 contrasts that matter under 112 that do not. Two tools are confusable here
   * when they share a subject once access verbs are stripped, which is the definition
   * `cluster.ts` uses to batch them in the first place.
   */
  if (s.notThis?.length) {
    const mine = subjectKey(s.name);
    s.notThis = s.notThis.filter((n) => subjectKey(n.tool) === mine && n.tool !== s.name);
    if (!s.notThis.length) delete s.notThis;
  }
  const known = new Map(tools.map((t) => [t.name, t]));
  const self = known.get(s.name);
  if (!self) return `not a tool in this catalogue`;
  if (!s.returns.trim()) return `empty returns slot — the field that does the work`;

  for (const n of [...(s.supersetOf ?? []), ...(s.needs ?? []), ...(s.notThis ?? []).map((x) => x.tool)]) {
    if (n.startsWith("?")) continue;
    if (n === s.name) return `names itself`;
    if (!known.has(n)) return `names ${n}, which is not in this catalogue`;
  }

  /**
   * A superset claim is checked only when there is something to check it against.
   *
   * The first version required the two tools to share an argument, which rejected six of 149
   * and two of those wrongly: `get_active_locations` takes **no parameters at all**, so the
   * test could never pass, and `compute_distance_matrix` really is a superset of
   * `calculate_route_distance` despite naming its inputs in the plural. Absence of overlap is
   * not evidence of unrelatedness when one side has nothing to overlap with, and a check that
   * fires on missing evidence rejects correct work.
   *
   * It still catches the real error: `get_order_details` claimed to be a superset of
   * `order_notes`, a bulk CSV export tool, when it meant `get_order_notes`. Both have
   * arguments, and they share none.
   */
  for (const n of s.supersetOf ?? []) {
    const other = known.get(n)!;
    if (!propsOf(self).length || !propsOf(other).length) continue; // nothing to compare
    if (!sharesAnArgument(self, other) && !sharesANameWord(self, other))
      return `claims to be a superset of ${n}, which takes none of its arguments and shares no name`;
  }

  // A `needs` edge pointing at a tool that requires the very same identifier is a peer, not a
  // source. Kept from the deleted inference engine because it is a real error class — and
  // widened, because that engine only recognised a `_id` suffix and so could not see
  // `trackingNumber`, which is the identifier this corpus actually turns on.
  for (const n of s.needs ?? []) {
    if (n.startsWith("?")) continue;
    const shared = sharedIdentifierArgs(self, known.get(n)!);
    if (shared.length) return `names ${n} as a producer, but ${n} needs the same ${shared[0]}`;
  }
  return null;
}

const propsOf = (t: Tool) =>
  Object.keys(((t as any).input_schema ?? (t as any).inputSchema ?? {}).properties ?? {});

/** Do the names share a content word? `compute_distance_matrix` / `calculate_route_distance`. */
function sharesANameWord(a: Tool, b: Tool): boolean {
  const stop = new Set(["get", "list", "search", "compute", "calculate", "all", "data", "info"]);
  const wa = new Set(words(a.name).filter((w) => !stop.has(w) && w.length > 3));
  return words(b.name).some((w) => wa.has(w));
}

function sharesAnArgument(a: Tool, b: Tool): boolean {
  const pa = new Set(propsOf(a).map((p) => p.toLowerCase()));
  return propsOf(b).some((p) => pa.has(p.toLowerCase()));
}

/** Parameters that name an identifier: `file_id`, `taskId`, `trackingNumber`, `orderNumber`. */
const IDENTIFIER_ARG = /(^|[a-z])(id|ids|number|no|key|code|ref|reference)$/i;

function sharedIdentifierArgs(a: Tool, b: Tool): string[] {
  const ids = (t: Tool) =>
    propsOf(t).filter((p) => IDENTIFIER_ARG.test(p)).map((p) => p.toLowerCase());
  const ia = new Set(ids(a));
  return ids(b).filter((p) => ia.has(p));
}

/**
 * Attach `@tool.param | type | values | required` lines, keeping only what the source supports.
 *
 * Three checks, each of which has a counterpart failure in this project's history:
 *   - the parameter must exist on the tool (invented parameters were a real defect);
 *   - the type must be one the vocabulary allows (a free-text type is unusable downstream);
 *   - every claimed enum value must appear in that parameter's own description (invented tool
 *     names shipped once already, and an invented enum value is the same error class).
 */
export function attachInferredParams(s: Semantics, paramLines: string[], tool: Tool): void {
  const schema: any = (tool as any).input_schema ?? (tool as any).inputSchema ?? {};
  const props: Record<string, any> = schema.properties ?? {};

  for (const line of paramLines) {
    const [head, typeCell, valuesCell, flagCell] = line.slice(1).split("|").map((c) => c.trim());
    const dot = head.lastIndexOf(".");
    if (dot < 0) continue;
    if (head.slice(0, dot) !== tool.name) continue;

    const param = head.slice(dot + 1);
    const spec = props[param];
    if (!spec) continue;                       // not a parameter of this tool
    if (spec.type) continue;                   // the schema already says; never override it
    if (!INFERABLE_TYPES.has(typeCell)) continue;

    const haystack = String(spec.description ?? "").toLowerCase();
    const claimed = (valuesCell ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const grounded = claimed.filter((v) => haystack.includes(v.toLowerCase()));

    (s.params ??= []).push({
      name: param,
      type: typeCell,
      ...(grounded.length ? { enum: grounded } : {}),
      ...(/required/i.test(flagCell ?? "") ? { required: true } : {}),
    });
  }
}

/**
 * Attach `=tool | list|one | field:type, ...`, keeping only fields the description mentions.
 *
 * A return type a model invented is worse than no return type: it tells a reader to index a key
 * that does not exist. So each field must appear in the tool's own text, and a shape with no
 * surviving fields is dropped rather than emitted empty.
 */
export function attachReturnShape(s: Semantics, returnLines: string[], tool: Tool): void {
  const haystack = `${tool.description ?? ""}`.toLowerCase();
  for (const line of returnLines) {
    const [head, cardinality, fieldCell] = line.slice(1).split("|").map((c) => c.trim());
    if (head !== tool.name) continue;
    const fields = (fieldCell ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => {
        const [name, type] = f.split(":").map((x) => x.trim());
        return { name, type: INFERABLE_TYPES.has(type) ? type : "Any" };
      })
      .filter((f) => f.name && haystack.includes(f.name.toLowerCase()));
    if (!fields.length) continue;
    s.returnShape = { list: /^list$/i.test(cardinality ?? ""), fields };
  }
}

/** Parse `name | >returns | ^a,b | !c` — tolerant of missing slots and stray spaces. */
export function parseLine(line: string): Semantics | null {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 2 || !cells[0]) return null;
  const out: Semantics = { name: cells[0], returns: "" };
  for (const cell of cells.slice(1)) {
    if (!cell) continue;
    const body = cell.slice(1).trim();
    if (cell.startsWith(">")) out.returns = body;
    else if (cell.startsWith("^")) out.supersetOf = body.split(",").map((x) => x.trim()).filter(Boolean);
    else if (cell.startsWith("vs")) {
      for (const m of cell.matchAll(/vs([A-Za-z_][\w]*)\s*\(([^)]*)\)/g))
        (out.notThis ??= []).push({ tool: m[1], why: m[2].trim() });
    } else if (cell.startsWith("!") || cell.startsWith("?"))
      out.needs = cell.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith("!") ? x.slice(1) : x));
    else if (!out.returns) out.returns = cell; // a model that forgot the > on the first slot
  }
  return out;
}

export type CompileResult = {
  semantics: Map<string, Semantics>;
  rejected: Rejection[];
  /** Superset claims dropped for contradicting each other. Reported, never silently fixed. */
  contradictions: [string, string][];
};

export async function compile(
  tools: Tool[],
  opts: { complete: Completion; batchSize?: number; retryDropped?: boolean },
): Promise<CompileResult> {
  const batchSize = opts.batchSize ?? 12;
  const roster = `Inventory (every tool you may name, spelled exactly):\n${tools
    .map((t) => t.name)
    .join(", ")}\n\nDescribe these:\n\n`;

  const semantics = new Map<string, Semantics>();
  const rejected: Rejection[] = [];
  const contradictions: [string, string][] = [];

  const ask = async (batch: Tool[]) => {
    const text = await opts.complete({
      system: SYSTEM,
      user: roster + batch.map(describe).join("\n\n"),
    });
    const allLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const lines = allLines.filter((l) => !l.startsWith("@") && !l.startsWith("="));
    const paramLines = allLines.filter((l) => l.startsWith("@"));
    const returnLines = allLines.filter((l) => l.startsWith("="));
    const failed: Rejection[] = [];
    for (const t of batch) {
      const line = lines.find((l) => l.split("|")[0].trim() === t.name);
      if (!line) {
        failed.push({ name: t.name, reason: "no line returned" });
        continue;
      }
      const parsed = parseLine(line);
      if (!parsed) {
        failed.push({ name: t.name, reason: "unparseable line" });
        continue;
      }
      attachInferredParams(parsed, paramLines, t);
      attachReturnShape(parsed, returnLines, t);
      const problem = verify(parsed, tools);
      if (problem) failed.push({ name: t.name, reason: problem });
      else semantics.set(t.name, parsed);
    }
    return failed;
  };

  // Lookalike clusters are compiled whole and alone, so the model can contrast members it can
  // actually see. Compiling in corpus order is what produced two mutually contradictory
  // superset claims: neither tool's batch contained the other.
  for (const batch of compileBatches(tools, batchSize)) {
    (await ask(batch)).forEach((f) => rejected.push(f));
  }

  // A batch occasionally drops a line; asking for that tool alone nearly always fixes it. Only
  // the dropped ones are retried — a verification failure is a judgement, not a hiccup, and
  // retrying it just spends money to be told the same thing.
  if (opts.retryDropped !== false) {
    const dropped = rejected.filter((r) => r.reason === "no line returned").map((r) => r.name);
    for (const name of dropped) {
      const t = tools.find((x) => x.name === name)!;
      const still = await ask([t]);
      if (!still.length) rejected.splice(rejected.findIndex((r) => r.name === name), 1);
    }
  }
  /**
   * A containment cycle means neither direction is trustworthy, so both claims go.
   *
   * Dropping rather than picking a side: the compiler has just demonstrated it does not know
   * which contains which, and a confident wrong answer here is what tells a model the two tools
   * are interchangeable.
   */
  for (const [a, b] of contradictorySupersets(semantics)) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const s = semantics.get(x)!;
      s.supersetOf = (s.supersetOf ?? []).filter((n) => n !== y);
      if (!s.supersetOf.length) delete s.supersetOf;
    }
    contradictions.push([a, b]);
  }

  return { semantics, rejected, contradictions };
}

export { words };
