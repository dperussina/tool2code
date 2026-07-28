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
import { readFileSync, appendFileSync } from "node:fs";
import { anthropicProvider } from "./providers/anthropic.js";
import { openaiProvider } from "./providers/openai.js";
import { geminiProvider } from "./providers/gemini.js";
import { xaiProvider } from "./providers/xai.js";
import type { ChatMessage, Provider, ToolResult } from "./providers/types.js";
import { schemasArm, codeArm, type Arm } from "./arms.js";
import { SCENARIOS } from "./scenarios.js";
import { execute, ALL_SENTINELS, IDENTIFIER_ARG } from "./mock.js";
import type { Tool } from "../src/types.js";
import type { Semantics } from "../src/compile.js";

const flag = (k: string, d = "") => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(hit.indexOf("=") + 1) : d;
};

const raw = JSON.parse(readFileSync("corpus/real-mcp-149.json", "utf8"));
const TOOLS: Tool[] = Array.isArray(raw) ? raw : raw.tools;
const semantics = new Map<string, Semantics>(
  Object.entries(JSON.parse(readFileSync("corpus/semantics.json", "utf8"))) as [string, Semantics][],
);

const ALL_PROVIDERS: Record<string, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  xai: xaiProvider,
};

const ARMS: Record<string, () => Arm> = {
  schemas: () => schemasArm(TOOLS),
  tool2code: () => codeArm(TOOLS, semantics),
  code_no_slots: () => codeArm(TOOLS, undefined, "code_no_slots"),
};

const providers = flag("providers", "anthropic,openai,gemini,xai").split(",").filter(Boolean);
const armIds = flag("arms", "schemas,tool2code").split(",").filter(Boolean);
const only = flag("scenarios");
const reps = Number(flag("reps", "1"));
const scenarios = only ? SCENARIOS.filter((s) => only.split(",").includes(s.id)) : SCENARIOS;
const sweep = flag("sweep") || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const MAX_TURNS = 8;

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
              const resolved = arm.resolve(c);
              if (!resolved) {
                unresolved++;
                results.push({ id: c.id, name: c.name, content: JSON.stringify({ error: "no such tool" }), isError: true });
                continue;
              }
              called.push(resolved);
              const out = execute(resolved.name, resolved.args);
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

        /** Did any call pass an identifier the mock never issued? */
        const fabricated = called.some((c) =>
          Object.entries(c.args ?? {}).some(
            ([k, v]) => IDENTIFIER_ARG.test(k) && typeof v === "string" && v !== "" && !ALL_SENTINELS.has(v),
          ),
        );

        const producerIdx = names.findIndex((n) => (scenario.producers ?? []).includes(n));
        const finalIdx = scenario.finalTool ? names.indexOf(scenario.finalTool) : -1;
        const trapped = (scenario.trapTools ?? []).filter((t) => names.includes(t));

        let correct: boolean;
        let outOfOrder = false;

        if (scenario.kind === "discriminate") {
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
          sweep, provider: pid, model: provider.model, arm: armId, scenario: scenario.id, rep,
          kind: scenario.kind,
          correct, fabricated, outOfOrder,
          trapped,
          calledProducer: producerIdx !== -1,
          calledFinal: finalIdx !== -1,
          sequence: called.map((c) => c.name),
          // The arguments of the graded call, so a failure can be diagnosed without a rerun.
          finalArgs: called.filter((c) => c.name === scenario.finalTool).map((c) => c.args),
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
