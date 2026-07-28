/**
 * The two things being compared.
 *
 * `schemas` is what every agent does today: hand the provider all 149 tools with their full
 * JSON Schemas. It keeps provider-side constrained decoding, which is a real advantage and the
 * thing the other arm has to earn back. It is the baseline, and if it wins, this project has no
 * result.
 *
 * `tool2code` puts the compiled module in the system prompt and exposes exactly one tool,
 * `call`. The module is the only description of the catalogue the model gets.
 *
 * A third arm, `code_no_slots`, is the control that isolates the shorthand: identical derived
 * signatures, with the model-written slots stripped out. If `tool2code` beats `schemas` but
 * `code_no_slots` does too and by the same margin, the win is the code shape and the semantic
 * slots are decoration — which is exactly the confusion the predecessor fell into by shipping
 * a bigger representation and crediting the wrong half of it.
 */
import type { Tool } from "../src/types.js";
import type { WireTool } from "./providers/types.js";
import { renderModule } from "../src/render.js";
import type { Semantics } from "../src/compile.js";

export type Arm = {
  id: string;
  tools: WireTool[];
  systemPreamble: string;
  /** How to turn a provider tool call into a (real tool name, args) pair. */
  resolve(call: { name: string; args: Record<string, any> }): { name: string; args: Record<string, any> } | null;
};

const CALL_TOOL: WireTool = {
  name: "call",
  description:
    "Call one of the tools defined in the Python module in your system prompt. `name` is the " +
    "function name exactly as written there; `args` is a JSON object of its parameters.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Function name from the module." },
      args: { type: "object", description: "Arguments, keyed by parameter name." },
    },
    required: ["name", "args"],
  },
};

const HOW_TO_CALL = `
Every tool available to you is defined in the Python module above. To use one, call the \`call\`
tool with its function name and arguments. The signatures are authoritative: parameter names,
types and allowed values are generated from the real schemas, so match them exactly.`;

/**
 * Strip every `description`, keep every constraint.
 *
 * The point of this arm is to find out what the prose is actually worth. The baseline sends
 * ~277,000 prompt tokens per run on Anthropic, and most of that is English: parameter
 * descriptions, usage notes, examples. The types, enums and required lists — the parts a
 * provider enforces — are a small fraction of it.
 *
 * If accuracy barely moves when the prose goes, then the expensive half of a tool definition is
 * decoration and the interesting product is schema pruning. If it collapses, the prose is
 * carrying the discrimination and a compiled module has to replace it, not merely accompany it.
 */
function stripProse(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(stripProse);
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "description" || k === "title" || k === "examples" || k === "example") continue;
    out[k] = typeof v === "object" ? stripProse(v) : v;
  }
  return out;
}

export function leanSchemasArm(tools: Tool[], id = "schemas_lean"): Arm {
  return {
    id,
    tools: tools.map((t) => ({
      name: t.name,
      // No description at all: the name and the parameter shapes are the entire signal.
      input_schema: stripProse((t as any).input_schema ?? (t as any).inputSchema ?? { type: "object", properties: {} }),
    })),
    systemPreamble: "",
    resolve: (c) => c,
  };
}

/**
 * The arm this project should probably have started with.
 *
 * `tool2code` changes two things against the baseline at once — how tools are *described* and
 * how they are *called* — so a loss cannot be attributed. Routing everything through one generic
 * `call(name, args)` tool discards the provider's native tool-selection machinery and its
 * constrained decoding, which is a real advantage and not one this project ever meant to fight.
 *
 * So: native tools, with the prose stripped from their schemas, plus the compiled module in the
 * system prompt as the selection guide. Enforcement is kept, the prose bill is not paid, and the
 * discriminating facts a schema cannot express — what a tool returns, what it is not to be
 * confused with — arrive in the module.
 */
export function hybridArm(tools: Tool[], semantics: Map<string, Semantics> | undefined, id = "hybrid"): Arm {
  const lean = leanSchemasArm(tools, id);
  return {
    ...lean,
    id,
    systemPreamble:
      renderModule(tools, { semantics }) +
      `

The module above is your guide to choosing between these tools: what each returns, what it
` +
      `is not to be confused with, and what to call first. The tools themselves are available
` +
      `natively — call them by name. Parameter types come from the real schemas.`,
  };
}

export function schemasArm(tools: Tool[]): Arm {
  return {
    id: "schemas",
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: ((t as any).input_schema ?? (t as any).inputSchema ?? { type: "object", properties: {} }),
    })),
    systemPreamble: "",
    resolve: (c) => c,
  };
}

export function codeArm(tools: Tool[], semantics: Map<string, Semantics> | undefined, id = "tool2code"): Arm {
  const known = new Set(tools.map((t) => t.name));
  return {
    id,
    tools: [CALL_TOOL],
    systemPreamble: renderModule(tools, { semantics }) + HOW_TO_CALL,
    resolve: (c) => {
      if (c.name !== "call") return null;
      const name = String(c.args?.name ?? "");
      if (!known.has(name)) return null;
      const args = c.args?.args;
      return { name, args: args && typeof args === "object" ? args : {} };
    },
  };
}
