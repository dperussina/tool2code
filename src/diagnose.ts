/**
 * Will this help my catalogue? Answerable before spending anything on a compile.
 *
 * The measured gain of this project is concentrated in one place: telling apart tools a model
 * would otherwise confuse. On a catalogue with no confusable pairs there is nothing for the
 * `vs` slot to say, and the honest expectation is no improvement at all — the code shape by
 * itself scored *exactly* the raw-schema baseline over 192 runs.
 *
 * So rather than let someone find that out after paying for a compile, this reports what a
 * catalogue actually contains. Pure inspection: no model, no network.
 */
import type { JsonSchema, Tool } from "./types.js";
import { lookalikeClusters } from "./cluster.js";
import { enumFromProse } from "./shorthand.js";
import { collectShapes } from "./shapes.js";

const schemaOf = (t: Tool): JsonSchema => (t as any).input_schema ?? (t as any).inputSchema ?? {};

export type Diagnosis = {
  tools: number;
  /** Groups of tools sharing a subject once access verbs are stripped — where the gain lives. */
  lookalikeClusters: number;
  toolsInClusters: number;
  /** Parameters with no declared type. These need repair, and a model, to be usable. */
  untypedParams: number;
  totalParams: number;
  /** Enums stated only in English. Recovered deterministically, so this is free precision. */
  proseEnums: number;
  declaredEnums: number;
  /** Nested object shapes that would otherwise render as an opaque `dict`. */
  nestedShapes: number;
  /** Tools with no description at all — nothing for a compiler to work from. */
  undescribedTools: number;
  verdict: string;
};

export function diagnose(tools: Tool[]): Diagnosis {
  const clusters = lookalikeClusters(tools);
  let untypedParams = 0, totalParams = 0, proseEnums = 0, declaredEnums = 0;
  let undescribedTools = 0;

  for (const t of tools) {
    if (!String(t.description ?? "").trim()) undescribedTools++;
    for (const spec of Object.values(schemaOf(t).properties ?? {})) {
      const v = spec as JsonSchema;
      totalParams++;
      if (!v.type && !v.items && !v.properties && !v.enum) untypedParams++;
      if (Array.isArray(v.enum)) declaredEnums++;
      else if (enumFromProse(v.description as string | undefined)) proseEnums++;
    }
  }

  const toolsInClusters = clusters.flat().length;
  const clusterShare = tools.length ? toolsInClusters / tools.length : 0;

  /**
   * Deliberately conservative. The measured 14-point gain came from a catalogue where 21% of
   * tools sat in a lookalike cluster; claiming it for a catalogue with none would be dishonest.
   */
  const verdict =
    clusterShare >= 0.15
      ? `${toolsInClusters} of ${tools.length} tools (${Math.round(clusterShare * 100)}%) sit in a confusable group. This is the case the contrast slot is for, and where the measured gain came from.`
      : clusterShare > 0
        ? `Only ${toolsInClusters} of ${tools.length} tools sit in a confusable group. Expect a smaller gain than the published figure, which came from a catalogue at ${21}%.`
        : `No confusable groups found. The measured advantage of this approach does not apply here — a compiled module scored exactly the raw-schema baseline when it had no disambiguation to do. Repair (${untypedParams} untyped parameters, ${proseEnums} prose enums) may still be worth it.`;

  return {
    tools: tools.length,
    lookalikeClusters: clusters.length,
    toolsInClusters,
    untypedParams,
    totalParams,
    proseEnums,
    declaredEnums,
    nestedShapes: collectShapes(tools).size,
    undescribedTools,
    verdict,
  };
}
