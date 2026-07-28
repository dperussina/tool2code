/**
 * Extreme shorthand, with a glossary paid for once.
 *
 * The predecessor project tried compressing prose — `terse` style: first sentence, stop-words
 * dropped, lowercased — and it was one of six map styles deleted in 0.2.0 for being smaller
 * and still worse. That is a real result and this is not that. Those styles removed words and
 * left the model to guess what was meant. This defines a fixed vocabulary in a header the
 * model reads before any tool, so the shorthand is decoded rather than guessed, and the
 * header is paid once across the whole catalogue.
 *
 * The reason to expect *accuracy* from it, not just bytes, is the shape of the measured
 * failure. Selection failures cluster among lookalikes, and this corpus has a clean one: four
 * tools that all take `trackingNumber`, all begin with "Get", and differ only in what comes
 * back. Choosing between them from prose means reading four differently-written paragraphs
 * and extracting one axis from each. In slots that axis is positional:
 *
 *   r >notes only
 *   r >entire order record: header, partner, freight, refs, notes, … ^get_order_notes
 *   r >chronological movements, status changes and events
 *   r >EDI and scan events with timestamps, locations, status codes
 *
 * `^` is the fact prose never states outright — that one of them returns a superset of
 * another — which is what stops a model reaching for the comprehensive tool every time.
 *
 * The slots are filled by a model (see `compile.ts`); `accessClass` is not. Whether a tool
 * destroys something is derived from its name, because that is a safety-relevant fact and it
 * should not depend on a model's mood.
 */
import type { Tool } from "./types.js";

/**
 * The decoder key. Emitted once per catalogue, ahead of every definition.
 *
 * Deliberately ASCII and mnemonic. The predecessor learned that providers read punctuation as
 * semantics whether you meant it or not: writing `x=0` to mean "optional" made three of four
 * providers send the integer 1 for a boolean, because a numeric default reads as a type.
 */
export const GLOSSARY = `# KEY  r=read w=write d=destructive  >X=returns X  !X=call X first
#      ^X=superset of X  ?X=X is yours to supply, nothing here makes one`;

const WRITE = new Set([
  "create", "update", "append", "add", "register", "schedule", "upload", "submit", "send",
  "execute", "replace", "batch", "set", "write", "insert", "start", "post",
]);
const DESTRUCTIVE = new Set(["delete", "remove", "clear", "drop", "purge", "cancel"]);

/**
 * `r`, `w` or `d`, from the verb.
 *
 * Destructive beats write beats read, because a name containing both — `delete_and_recreate` —
 * is the dangerous one and the shorthand must not soften it.
 */
export function accessClass(name: string): "r" | "w" | "d" {
  const w = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/);
  if (w.some((x) => DESTRUCTIVE.has(x))) return "d";
  if (w.some((x) => WRITE.has(x))) return "w";
  return "r";
}

const schemaOf = (t: Tool): any => (t as any).input_schema ?? (t as any).inputSchema ?? {};

/**
 * Format notes hiding in one description that apply to every tool sharing the parameter.
 *
 * `get_order_notes` documents `trackingNumber` as `{partnerId}U{orderId}, e.g. 999U123`; its
 * three siblings take the same parameter and say nothing. Hoisting it to a type alias states
 * it once for all of them instead of losing it three times out of four.
 *
 * The match is on flattened text, because prose names the parameter in prose: the description
 * says "the tracking number" where the schema says `trackingNumber`, and comparing literally
 * found zero of them.
 */
export function hoistedFormats(tools: Tool[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const t of tools) {
    const text = (t.description ?? "").replace(/\s+/g, " ");
    const m = text.match(/format:\s*([^)]{3,60})/i);
    if (!m) continue;
    const flat = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const p of Object.keys(schemaOf(t).properties ?? {})) {
      const key = p.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!found.has(p) && flat.includes(key)) found.set(p, m[1].trim());
    }
  }
  return found;
}
