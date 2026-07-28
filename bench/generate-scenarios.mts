/**
 * Generate the scenario suite from raw schemas, so the suite is not written by whoever built
 * the mechanism.
 *
 * Round 2's headline was 97.2% against a 75.0% baseline, and its most serious weakness was that
 * I wrote the trap prompts *after* reading the corpus and identifying exactly the distinction the
 * `vs` slot ended up stating. More repetitions cannot fix that; only a suite produced
 * independently of the mechanism can.
 *
 * So the generator is given, for one cluster of confusable tools, **only their raw names,
 * descriptions and parameter lists** — never the compiled module, never the glossary, never the
 * arms. It writes what a person would actually say when they need one of them and not the others.
 *
 * Then the output is checked mechanically, because a generator is as capable of leaking the
 * answer as I am:
 *
 *   - a prompt containing the target's name, or the distinctive words of it, is rejected;
 *   - a prompt that names any tool in the catalogue is rejected;
 *   - a cluster where the generator cannot separate the members is dropped, not forced. If two
 *     tools genuinely answer the same request, neither choice is wrong and the scenario is
 *     invalid — the same reason the `restraint` category was deleted in Round 1.
 *
 * Output goes to bench/generated-scenarios.json, committed as evidence, so a sweep can be
 * reproduced against the exact suite it ran on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { lookalikeClusters } from "../src/cluster.js";
import { words } from "../src/graph.js";
import type { Tool } from "../src/types.js";

const raw = JSON.parse(readFileSync("corpus/real-mcp-149.json", "utf8"));
const TOOLS: Tool[] = Array.isArray(raw) ? raw : raw.tools;
const ALL_NAMES = new Set(TOOLS.map((t) => t.name));

const SYSTEM = `You write realistic user requests for testing an AI agent's tool selection.

You will be shown a small group of tools from one company's internal catalogue that are easy to
confuse with each other. For EACH tool, write one request that a real person at that company
would type, which that tool and ONLY that tool should answer.

Hard rules:
- NEVER mention any tool name, function name, or anything resembling one. Write like a person who
  has no idea what the tools are called. "I need last month's invoices exported for the warehouse
  load" — not "run cost_of_sales".
- The request must be genuinely decidable: someone who understood all these tools would agree on
  exactly one. If two of the tools would both reasonably satisfy any request you can think of,
  write SKIP for both instead of forcing it.
- Include whatever a real request would include — a customer name, a date range, a file name — but
  no identifiers you have invented that the agent could not know.
- One line per tool: <tool_name> | <the request>
- Or: <tool_name> | SKIP

Write nothing else.`;

function describe(t: Tool): string {
  const schema: any = (t as any).input_schema ?? (t as any).inputSchema ?? {};
  const required = new Set<string>(schema.required ?? []);
  const params = Object.keys(schema.properties ?? {})
    .map((p) => `${p}${required.has(p) ? "*" : ""}`)
    .join(", ");
  return `${t.name}\n  description: "${(t.description ?? "").replace(/\s+/g, " ").slice(0, 500)}"\n  params: ${params || "(none)"}`;
}

async function complete(system: string, user: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "claude-opus-5", max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
    });
    const j: any = await r.json();
    if (r.ok) return (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    throw new Error(JSON.stringify(j).slice(0, 300));
  }
  throw new Error("retries exhausted");
}

/** Words that identify this tool specifically, rather than its subject area. */
function leakWords(name: string): string[] {
  return words(name).filter((w) => w.length > 3);
}

const STOP_LEAK = new Set(["order", "customer", "cost", "sale", "sales", "location", "locations", "note", "notes", "health", "model", "load", "place", "report"]);

type Generated = {
  id: string;
  kind: "discriminate";
  prompt: string;
  finalTool: string;
  trapTools: string[];
};

const out: Generated[] = [];
const rejected: string[] = [];
const clusters = lookalikeClusters(TOOLS);
console.log(`${clusters.length} clusters, ${clusters.flat().length} tools\n`);

for (const cluster of clusters) {
  const text = await complete(SYSTEM, cluster.map(describe).join("\n\n"));
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, ...rest] = line.split("|");
    const toolName = name.trim();
    const prompt = rest.join("|").trim();
    const tool = cluster.find((t) => t.name === toolName);
    if (!tool) continue;
    if (!prompt || /^SKIP$/i.test(prompt)) { rejected.push(`${toolName}: generator declined (indistinguishable)`); continue; }

    // --- leak checks, because a generator leaks answers as readily as a person does ---
    const flat = prompt.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (flat.includes(toolName.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      rejected.push(`${toolName}: prompt contains the tool name`); continue;
    }
    const named = [...ALL_NAMES].find((n) => flat.includes(n.toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (named) { rejected.push(`${toolName}: prompt names ${named}`); continue; }
    const distinctive = leakWords(toolName).filter((w) => !STOP_LEAK.has(w));
    const leaked = distinctive.filter((w) => flat.includes(w));
    if (leaked.length >= 2) { rejected.push(`${toolName}: prompt echoes ${leaked.join("+")}`); continue; }

    out.push({
      id: `gen-${toolName}`,
      kind: "discriminate",
      prompt,
      finalTool: toolName,
      trapTools: cluster.filter((t) => t.name !== toolName).map((t) => t.name),
    });
  }
  console.log(`  [${cluster.map((t) => t.name).join(", ")}] → ${out.filter((o) => cluster.some((c) => c.name === o.finalTool)).length} kept`);
}

writeFileSync("bench/generated-scenarios.json", JSON.stringify(out, null, 1) + "\n");
console.log(`\n${out.length} scenarios kept, ${rejected.length} rejected`);
for (const r of rejected) console.log(`  ${r}`);
