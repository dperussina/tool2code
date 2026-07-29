/**
 * The runner. One row of JSONL per run, appended as it completes.
 *
 * Appended rather than buffered because the predecessor's runner buffered per provider, which
 * meant a sweep in progress was unreadable and "is it still running?" could only be answered by
 * guessing. Each row lands the moment the run ends, so byte count is liveness.
 *
 * Usage:
 *   npx tsx bench/run.mts --providers=anthropic,openai,gemini,xai --arms=schemas,tool2code --reps=1
 *   npx tsx bench/run.mts --providers=anthropic --scenarios=order-notes --reps=1
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { anthropicProvider } from "./providers/anthropic.js";
import { openaiProvider } from "./providers/openai.js";
import { geminiProvider } from "./providers/gemini.js";
import { xaiProvider } from "./providers/xai.js";
import type { ChatMessage, Provider, ToolResult } from "./providers/types.js";
import { schemasArm, codeArm, leanSchemasArm, hybridArm, textSlotsArm, type Arm } from "./arms.js";
import { SCENARIOS, remap, type Scenario } from "./scenarios.js";
import { makeExecutor, ALL_SENTINELS, IDENTIFIER_ARG } from "./mock.js";
import type { Tool } from "../src/types.js";
import type { Semantics } from "../src/compile.js";

const flag = (k: string, d = "") => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(hit.indexOf("=") + 1) : d;
};
/** Bare switches like `--generated`, which `flag()` cannot see and silently reports as absent. */
const has = (k: string) => process.argv.slice(2).includes(`--${k}`);

const corpusPath = flag("corpus", "corpus/real-mcp-149.json");
const semanticsPath = flag("semantics", "corpus/semantics.json");
const raw = JSON.parse(readFileSync(corpusPath, "utf8"));
const TOOLS: Tool[] = Array.isArray(raw) ? raw : raw.tools;
const semantics = new Map<string, Semantics>(
  Object.entries(JSON.parse(readFileSync(semanticsPath, "utf8"))) as [string, Semantics][],
);
/**
 * The previous artifact, kept so a prompt change can be measured instead of assumed.
 *
 * Comparing two artifacts across two sweeps is exactly the pooling this project forbids: the
 * scenario set, the providers and the day would all differ. Both go in one sweep as two arms.
 */
const semanticsPrev = existsSync("corpus/semantics-prev.json")
  ? new Map<string, Semantics>(
      Object.entries(JSON.parse(readFileSync("corpus/semantics-prev.json", "utf8"))) as [string, Semantics][],
    )
  : new Map<string, Semantics>();

const ALL_PROVIDERS: Record<string, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  xai: xaiProvider,
};

const ARMS: Record<string, () => Arm> = {
  schemas: () => schemasArm(TOOLS),
  schemas_lean: () => leanSchemasArm(TOOLS),
  hybrid: () => hybridArm(TOOLS, semantics),
  tool2code: () => codeArm(TOOLS, semantics),
  code_no_slots: () => codeArm(TOOLS, undefined, "code_no_slots"),
  tool2code_prev: () => codeArm(TOOLS, semanticsPrev, "tool2code_prev"),
  text_slots: () => textSlotsArm(TOOLS, semantics),
};

const providers = flag("providers", "anthropic,openai,gemini,xai").split(",").filter(Boolean);
const armIds = flag("arms", "schemas,tool2code").split(",").filter(Boolean);
const only = flag("scenarios");
const reps = Number(flag("reps", "1"));
/**
 * `--generated` swaps in the suite written by a model that never saw the compiled module.
 *
 * The hand-written suite is the project's deepest validity gap: I read the corpus, found the
 * bulk-versus-single pattern, wrote prompts targeting it, then built a slot that states exactly
 * that distinction. More repetitions cannot fix authorship. bench/generated-scenarios.json is
 * produced from raw names, descriptions and parameter lists alone, with prompts rejected
 * mechanically if they name any tool or echo the target's distinctive words.
 */
const pool: Scenario[] = has("generated")
  ? (JSON.parse(readFileSync("bench/generated-scenarios.json", "utf8")) as Scenario[])
  : SCENARIOS;
let scenarios = only ? pool.filter((s) => only.split(",").includes(s.id)) : pool;
// Running zero scenarios used to look exactly like a completed sweep. It cost one silent no-op run.
if (!scenarios.length)
  throw new Error(`no scenarios matched${only ? ` --scenarios=${only}` : ""} in the ${has("generated") ? "generated" : "hand-written"} suite`);
// A degraded catalogue renames everything; the tasks are identical, the grading keys are not.
if (!TOOLS.some((t) => t.name === "get_cost_of_sales")) {
  const byMangled = new Map(TOOLS.map((t) => [t.name.toLowerCase().replace(/[^a-z0-9]/g, ""), t.name]));
  const rename = (n: string) => {
    const parts = n.split(/[^A-Za-z0-9]+/).filter(Boolean);
    const key = `apiv2${parts.slice(1).join("")}${parts[0]}`.toLowerCase();
    return byMangled.get(key) ?? n;
  };
  scenarios = remap(scenarios, rename);
  const unresolvedKeys = scenarios.filter((s) => s.finalTool && !TOOLS.some((t) => t.name === s.finalTool));
  if (unresolvedKeys.length) throw new Error(`scenario keys not found in ${corpusPath}: ${unresolvedKeys.map((s) => s.finalTool).join(", ")}`);
}
const sweep = flag("sweep") || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const MAX_TURNS = 8;
/**
 * Exact mangled→original mapping, read from a sidecar written when the corpus was degraded.
 *
 * An earlier version inverted the mangling by rule — take the last camel segment as the verb —
 * and it was wrong on names like `gdrive_search_by_name`, which does not round-trip. Guessing at
 * an inverse when the forward mapping is known and cheap to record is how a harness acquires a
 * silent bug, and this one had already produced 24 unsatisfiable runs.
 */
const aliasPath = corpusPath.replace(/\.json$/, "-aliases.json");
const aliases: Record<string, string> = existsSync(aliasPath)
  ? JSON.parse(readFileSync(aliasPath, "utf8"))
  : {};
const canonicalName = (name: string): string => aliases[name] ?? name;

const execute = makeExecutor(TOOLS as any, canonicalName);

const SYSTEM =
  "You are a logistics and operations assistant with access to a large internal tool catalogue. " +
  "Complete the user's request by calling tools. Do not ask the user for anything you could " +
  "obtain by calling a tool: if an identifier is needed, look it up first. Never guess an " +
  "identifier.";

for (const pid of providers) {
  const provider = ALL_PROVIDERS[pid];
  if (!provider) throw new Error(`unknown provider ${pid}`);
  const file = `bench/results/${pid}-${sweep}.jsonl`;

  for (const armId of armIds) {
    const arm = ARMS[armId]?.();
    if (!arm) throw new Error(`unknown arm ${armId}`);

    for (const scenario of scenarios) {
      for (let rep = 0; rep < reps; rep++) {
        const messages: ChatMessage[] = [{ role: "user", content: scenario.prompt }];
        const called: { name: string; args: Record<string, any> }[] = [];
        const resultBodies: string[] = [];
        /** Every schema violation the run committed, across all calls. */
        const malformed: string[] = [];
        /** Provider-level calls exactly as returned, for diagnosing harness-versus-model. */
        const rawCalls: { name: string; keys: string[]; args: unknown }[] = [];
        let turns = 0;
        let unresolved = 0;
        let error: string | null = null;
        let promptTokens = 0;
        let outputTokens = 0;

        try {
          for (; turns < MAX_TURNS; turns++) {
            const res = await provider.chat({
              system: SYSTEM,
              systemPreamble: arm.systemPreamble,
              tools: arm.tools,
              messages,
              maxTokens: 4000,
            });
            promptTokens += res.usage.promptTokens;
            outputTokens += res.usage.outputTokens;
            if (!res.toolCalls.length) break;

            messages.push({ role: "assistant", toolCalls: res.toolCalls, text: res.text, raw: res.raw });
            const results: ToolResult[] = [];
            for (const c of res.toolCalls) {
              /**
               * Keep what the model actually sent, before the arm interprets it.
               *
               * A dispatcher arm reads arguments out of `args.args`. If a model puts them beside
               * `name` instead of inside `args`, the arm sees an empty object and the run is graded
               * as an argument-free call — indistinguishable, in the results, from a model that
               * supplied nothing. That is the difference between a model failure and the harness
               * discarding the answer, and it has to be visible.
               */
              rawCalls.push({ name: c.name, keys: Object.keys(c.args ?? {}), args: c.args });
              const resolved = arm.resolve(c);
              if (!resolved) {
                unresolved++;
                results.push({ id: c.id, name: c.name, content: JSON.stringify({ error: "no such tool" }), isError: true });
                continue;
              }
              called.push(resolved);
              const out = execute(resolved.name, resolved.args);
              if (out.malformed?.length) malformed.push(`${resolved.name}: ${out.malformed[0]}`);
              resultBodies.push(out.content);
              results.push({ id: c.id, name: c.name, content: out.content, isError: out.isError });
            }
            messages.push({ role: "tool_results", results });
          }
        } catch (e: any) {
          error = String(e?.message ?? e).slice(0, 300);
        }

        // ---- grading, all mechanical ----
        const names = called.map((c) => c.name);

        /**
         * Did any call pass an identifier that came from nowhere?
         *
         * A value is legitimate if the mock issued it OR the user put it in the prompt. The
         * second clause is not a convenience: `disc-cos-query` says "for partner 4471", so a
         * model passing partnerId 4471 is using what it was given, and the first version of this
         * check called that fabrication on every arm. Agents are handed identifiers by users
         * constantly; only a value with no source at all is invented.
         */
        const fabricated = called.some((c) =>
          Object.entries(c.args ?? {}).some(
            ([k, v]) =>
              IDENTIFIER_ARG.test(k) &&
              (typeof v === "string" || typeof v === "number") &&
              v !== "" &&
              !ALL_SENTINELS.has(String(v)) &&
              !scenario.prompt.includes(String(v)),
          ),
        );

        const producerIdx = names.findIndex((n) => (scenario.producers ?? []).includes(n));
        const finalIdx = scenario.finalTool ? names.indexOf(scenario.finalTool) : -1;
        const trapped = (scenario.trapTools ?? []).filter((t) => names.includes(t));

        let correct: boolean;
        let outOfOrder = false;

        if (scenario.kind === "arguments") {
          /**
           * Right answer: the target tool, the required nested argument actually supplied, and
           * not one schema violation anywhere in the run. Malformed-then-retried still fails:
           * a model that needed the error message to learn the shape did not know it.
           */
          const supplied = called.some(
            (c) =>
              c.name === scenario.finalTool &&
              c.args?.[scenario.requireArg!] !== undefined &&
              c.args?.[scenario.requireArg!] !== null &&
              (!Array.isArray(c.args[scenario.requireArg!]) || c.args[scenario.requireArg!].length > 0),
          );
          correct = supplied && malformed.length === 0;
        } else if (scenario.kind === "discriminate") {
          // Right answer: the correct sibling, and never the tempting one.
          const hitFinal = finalIdx !== -1;
          const needsId = Boolean(scenario.identifierArg);
          const idOk =
            !needsId ||
            called.some(
              (c) =>
                c.name === scenario.finalTool &&
                ALL_SENTINELS.has(String((c.args ?? {})[scenario.identifierArg!])),
            );
          correct = hitFinal && !trapped.length && idOk && !fabricated;
        } else {
          outOfOrder = finalIdx !== -1 && (producerIdx === -1 || finalIdx < producerIdx);
          correct = called.some(
            (c) =>
              c.name === scenario.finalTool &&
              ALL_SENTINELS.has(String((c.args ?? {})[scenario.identifierArg!])),
          );
        }

        const row = {
          sweep, corpus: corpusPath, provider: pid, model: provider.model, arm: armId, scenario: scenario.id, rep,
          kind: scenario.kind,
          correct, fabricated, outOfOrder,
          trapped,
          calledProducer: producerIdx !== -1,
          calledFinal: finalIdx !== -1,
          sequence: called.map((c) => c.name),
          // The arguments of the graded call, so a failure can be diagnosed without a rerun.
          finalArgs: called.filter((c) => c.name === scenario.finalTool).map((c) => c.args),
          rawCallShapes: rawCalls.map((c) => `${c.name}(${c.keys.join(",")})`),
          malformedCalls: malformed.length,
          malformedFirst: malformed[0] ?? null,
          turns, unresolved, promptTokens, outputTokens, error,
        };
        appendFileSync(file, JSON.stringify(row) + "\n");
        const mark: string = error ? "ERR" : correct ? "ok " : fabricated ? "FAB" : outOfOrder ? "ORD" : "no ";
        console.log(`${mark} ${pid}/${armId}/${scenario.id}#${rep} turns=${turns} ${error ?? ""}`);
      }
    }
  }
  console.log(`--- ${pid} done -> ${file}`);
}
