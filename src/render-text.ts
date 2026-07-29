/**
 * The same compiled semantics as plain English. A first-class output, not a fallback.
 *
 * This exists because of a measurement that cost the project its thesis. Over 192 runs on a
 * badly-structured catalogue, this rendering and the Python one scored **identically** — 46/48
 * each, two trap calls each, zero wrong-first choices each — while a Python module with the
 * semantics stripped scored exactly the raw-schema baseline. The format contributes nothing; the
 * compiled semantics contribute everything.
 *
 * Shipping only the Python renderer would therefore be dishonest by omission: it would imply the
 * code form is the product. It is not. Choose this one when the consumer is a system that would
 * rather read prose, or when a `def` line in a system prompt is confusing to a downstream tool;
 * choose the Python one when you want the artifact parsed, diffed and type-checked in CI.
 */
import type { JsonSchema, Tool } from "./types.js";
import type { Semantics } from "./compile.js";
import { accessClass } from "./shorthand.js";

const schemaOf = (t: Tool): JsonSchema => (t as any).input_schema ?? (t as any).inputSchema ?? {};

const ACCESS_WORD: Record<"r" | "w" | "d", string> = {
  r: "read-only",
  w: "writes",
  d: "destructive",
};

export type TextOptions = {
  semantics?: Map<string, Semantics>;
  /** Heading placed above the list. Set to "" to omit. */
  heading?: string;
};

/**
 * One catalogue as an indented list.
 *
 * Deliberately not a shorthand: no glossary, no sigils. The Python rendering compresses
 * `do not confuse with X` into `vsX(...)`, which is fine for a frontier model and buys nothing
 * measurable, so there is no reason to make a reader decode anything here.
 */
export function renderText(tools: Tool[], options: TextOptions = {}): string {
  const heading =
    options.heading ??
    "The tools available to you, what each returns, and what each must not be confused with:";
  const lines: string[] = heading ? [heading, ""] : [];

  for (const t of tools) {
    const schema = schemaOf(t);
    const required = new Set(schema.required ?? []);
    const inferred = new Map(
      (options.semantics?.get(t.name)?.params ?? []).map((p) => [p.name, p]),
    );

    const params = Object.entries(schema.properties ?? {}).map(([name, raw]) => {
      const v = raw as JsonSchema;
      const guess = inferred.get(name);
      const isRequired = required.has(name) || guess?.required === true;
      const values = v.enum ?? guess?.enum;
      const shown = values?.length ? ` (one of: ${values.map(String).join(", ")})` : "";
      return `${name}${isRequired ? "" : " (optional)"}${shown}`;
    });

    const s = options.semantics?.get(t.name);
    lines.push(t.name);
    lines.push(`  takes: ${params.length ? params.join(", ") : "no parameters"}`);
    lines.push(`  ${ACCESS_WORD[accessClass(t.name)]}; returns ${s?.returns ?? "(not compiled)"}`);
    for (const n of s?.notThis ?? [])
      lines.push(`  do not confuse with ${n.tool}, which is for ${n.why}`);
    if (s?.supersetOf?.length)
      lines.push(`  its results already include those of ${s.supersetOf.join(", ")}`);
    for (const n of s?.needs ?? [])
      lines.push(
        n.startsWith("?")
          ? `  you must already have ${n.slice(1)}; nothing here produces one`
          : `  call ${n} first to obtain an argument`,
      );
    lines.push("");
  }
  return lines.join("\n");
}
