/**
 * tool2code — compile a tool catalogue into something a model chooses from correctly.
 *
 * Read this before reaching for it, because the measured result is narrower than the name:
 *
 *   - Rendering a catalogue as typed code is worth **0.0 points** of accuracy. Measured directly:
 *     the same compiled semantics as Python and as plain English scored 46/48 each over 192 runs.
 *   - Compiling **what each tool returns and what it must not be confused with** is worth
 *     **+12.5 points** over raw JSON Schema on a badly-structured catalogue, and +14.6 on a clean
 *     one. A typed module with those annotations stripped scores exactly the baseline.
 *
 * So this is a compiled-disambiguation library. Both renderers are first-class because the format
 * genuinely does not matter to accuracy; choose Python when you want the artifact parsed and
 * diffed in CI, text when prose suits the consumer better.
 *
 * Everything the model writes is verified against the source before it ships: tool names must
 * exist, enum values must appear in the parameter's own description, superset claims may not form
 * cycles, and a declared type always beats an inference. Nothing structural is ever guessed when
 * the schema states it.
 *
 * Typical use:
 *
 *   import { diagnose, compileTools, renderModule } from "tool2code";
 *
 *   const report = diagnose(tools);          // will this help me at all?
 *   const { semantics } = await compileTools(tools, { complete });   // your model, your key
 *   const module = renderModule(tools, { semantics });               // put in the system prompt
 *
 * `complete` is a function you supply, so this library never imports an SDK and never sees a key.
 */
export { diagnose, type Diagnosis } from "./diagnose.js";
export { compileTools, verify, parseLine, attachInferredParams, attachReturnShape, SYSTEM as COMPILE_PROMPT, INFERABLE_TYPES, type Semantics, type Completion, type CompileResult, type Rejection } from "./compile.js";
export { renderModule, renderTool, type RenderOptions } from "./render.js";
export { renderText, type TextOptions } from "./render-text.js";
export { lookalikeClusters, subjectKey, contradictorySupersets } from "./cluster.js";
export { collectShapes, shapeNameOf, type NamedShape } from "./shapes.js";
export { GLOSSARY, accessClass, hoistedFormats, enumFromProse } from "./shorthand.js";
export type { Tool, JsonSchema } from "./types.js";
