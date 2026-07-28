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
