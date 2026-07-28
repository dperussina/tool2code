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
};

export const SYSTEM = `You are turning a tool catalogue into a Python module another model will read to decide which tool to call.

${GLOSSARY}

For each tool, output one line:

<name> | >RETURNS | ^SUPERSET | !NEEDS

- RETURNS: what comes back, in as few words as possible. This is the field that decides
  everything. Tools in a catalogue are often near-identical in name and parameters and differ
  ONLY in what they return — four tools may all be "get X for an order" taking the same
  tracking number, where one returns notes, one a chronological timeline, one EDI scan events
  and one everything at once. Say which. Never restate the tool's name back to me.
- SUPERSET: names of other tools in the inventory whose results this tool's results already
  contain. Omit unless true. This is what stops a model reaching for the comprehensive tool
  every time; it is also what tells it when the comprehensive one is the right single call.
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

/** How a tool is shown to the model: contract first, prose second, no schema noise. */
export function describe(t: Tool): string {
  const schema: any = (t as any).input_schema ?? (t as any).inputSchema ?? {};
  const required = new Set<string>(schema.required ?? []);
  const params = Object.keys(schema.properties ?? {})
    .map((p) => `${p}${required.has(p) ? "*" : ""}`)
    .join(", ");
  const prose = (t.description ?? "").replace(/\s+/g, " ").slice(0, 600);
  return `${t.name} — "${prose}" params: ${params || "(none)"}`;
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
  const known = new Map(tools.map((t) => [t.name, t]));
  const self = known.get(s.name);
  if (!self) return `not a tool in this catalogue`;
  if (!s.returns.trim()) return `empty returns slot — the field that does the work`;

  for (const n of [...(s.supersetOf ?? []), ...(s.needs ?? [])]) {
    if (n.startsWith("?")) continue;
    if (n === s.name) return `names itself`;
    if (!known.has(n)) return `names ${n}, which is not in this catalogue`;
  }

  // A superset must plausibly be reachable from the same inputs. `get_order_details` and
  // `get_order_notes` both take trackingNumber, so one can contain the other; a tool sharing
  // no argument at all cannot be answering the same question.
  for (const n of s.supersetOf ?? []) {
    const other = known.get(n)!;
    if (!sharesAnArgument(self, other)) return `claims to be a superset of ${n}, which takes none of its arguments`;
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
    else if (cell.startsWith("!") || cell.startsWith("?"))
      out.needs = cell.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (x.startsWith("!") ? x.slice(1) : x));
    else if (!out.returns) out.returns = cell; // a model that forgot the > on the first slot
  }
  return out;
}

export type CompileResult = {
  semantics: Map<string, Semantics>;
  rejected: Rejection[];
};

export async function compile(
  tools: Tool[],
  opts: { complete: Completion; batchSize?: number },
): Promise<CompileResult> {
  const batchSize = opts.batchSize ?? 12;
  const roster = `Inventory (every tool you may name, spelled exactly):\n${tools
    .map((t) => t.name)
    .join(", ")}\n\nDescribe these:\n\n`;

  const semantics = new Map<string, Semantics>();
  const rejected: Rejection[] = [];

  for (let i = 0; i < tools.length; i += batchSize) {
    const batch = tools.slice(i, i + batchSize);
    const text = await opts.complete({
      system: SYSTEM,
      user: roster + batch.map(describe).join("\n\n"),
    });
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const t of batch) {
      const line = lines.find((l) => l.split("|")[0].trim() === t.name);
      if (!line) {
        rejected.push({ name: t.name, reason: "no line returned" });
        continue;
      }
      const parsed = parseLine(line);
      if (!parsed) {
        rejected.push({ name: t.name, reason: "unparseable line" });
        continue;
      }
      const problem = verify(parsed, tools);
      if (problem) rejected.push({ name: t.name, reason: problem });
      else semantics.set(t.name, parsed);
    }
  }
  return { semantics, rejected };
}

export { words };
