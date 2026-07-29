#!/usr/bin/env node
/**
 * `tool2code` — point it at a tool catalogue and get a compiled interface.
 *
 *   tool2code diagnose --tools ./tools.json
 *   tool2code compile  --tools ./tools.json --out ./semantics.json
 *   tool2code render   --tools ./tools.json --semantics ./semantics.json [--format text]
 *
 * `diagnose` runs first for a reason. The measured gain of this library is concentrated in telling
 * apart tools a model would otherwise confuse, so a catalogue with no confusable pairs should be
 * told that before anyone pays for a compile.
 *
 * The key comes from ANTHROPIC_API_KEY or OPENAI_API_KEY and is used only by `compile`. The
 * library itself never reads it — `compileTools` takes a completion function — and this file talks
 * to the provider over built-in `fetch`, so installing tool2code installs nothing else.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { diagnose } from "./diagnose.js";
import { compileTools, type Completion, type Semantics } from "./compile.js";
import { renderModule } from "./render.js";
import { renderText } from "./render-text.js";
import type { Tool } from "./types.js";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (k: string, d?: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`));
  if (!hit) return d;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (argv[argv.indexOf(hit) + 1] ?? d);
};

const USAGE = `tool2code — compile a tool catalogue into something a model chooses from correctly

  diagnose --tools <path>
      Report what the catalogue contains and whether this library will help it.

  compile  --tools <path> [--out semantics.json] [--provider anthropic|openai] [--model id]
      Read every tool once with a strong model and write down what each returns, what it must
      not be confused with, and any structure the schema failed to declare. Every claim is
      verified against the source; unverifiable ones are dropped, not shipped.

  render   --tools <path> [--semantics semantics.json] [--format python|text] [--out -]
      Emit the interface to put in your system prompt.

Accepts a bare array, { tools: [...] }, or MCP's { result: { tools: [...] } }.
Key from ANTHROPIC_API_KEY or OPENAI_API_KEY, used only by \`compile\`.

Note: the format makes no measured difference to accuracy — python and text scored identically
over 192 runs. Pick python if you want the artifact parsed and diffed in CI.`;

function fail(msg: string): never {
  console.error(`tool2code: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

function readTools(path: string | undefined): Tool[] {
  if (!path) fail("--tools is required");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    fail(`could not read ${path}: ${e.message}`);
  }
  const list =
    Array.isArray(raw) ? raw
    : Array.isArray((raw as any)?.tools) ? (raw as any).tools
    : Array.isArray((raw as any)?.result?.tools) ? (raw as any).result.tools
    : null;
  if (!list) fail(`${path} is not a tool array, { tools } or { result: { tools } }`);
  if (!list.every((t: any) => typeof t?.name === "string")) fail("every tool needs a string name");
  return list as Tool[];
}

/** Bring-your-own-model over built-in fetch. Retries only what is worth retrying. */
function completion(): Completion {
  const provider = flag("provider", "anthropic")!;
  const model = flag("model", provider === "openai" ? "gpt-5.6-sol" : "claude-opus-5")!;
  const key = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) fail(`no API key: set ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}`);

  return async ({ system, user }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res =
        provider === "openai"
          ? await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
              body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
            })
          : await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model, max_tokens: 8000, system, messages: [{ role: "user", content: user }] }),
            });
      const body: any = await res.json();
      if (res.ok) {
        return provider === "openai"
          ? (body.choices?.[0]?.message?.content ?? "")
          : (body.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      }
      // Rate limits and server faults are worth another attempt; a bad request never is.
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      fail(`${provider} returned ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    }
    fail("retries exhausted");
  };
}

const write = (path: string | undefined, text: string) => {
  if (!path || path === "-") process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  else writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
};

if (command === "diagnose") {
  const d = diagnose(readTools(flag("tools")));
  console.log(`${d.tools} tools, ${d.totalParams} parameters`);
  console.log(`  confusable groups   ${d.lookalikeClusters} covering ${d.toolsInClusters} tools`);
  console.log(`  untyped parameters  ${d.untypedParams}`);
  console.log(`  enums               ${d.declaredEnums} declared, ${d.proseEnums} stated only in prose`);
  console.log(`  nested shapes       ${d.nestedShapes}`);
  console.log(`  tools with no description  ${d.undescribedTools}`);
  console.log(`\n${d.verdict}`);
} else if (command === "compile") {
  const tools = readTools(flag("tools"));
  const result = await compileTools(tools, {
    complete: completion(),
    batchSize: Number(flag("batch", "12")),
    onProgress: undefined,
  } as any);
  const recovered = [...result.semantics.values()].filter((s: Semantics) => s.params?.length).length;
  console.error(`compiled ${result.semantics.size}/${tools.length}; structure recovered on ${recovered} tools`);
  for (const r of result.rejected) console.error(`  REJECTED ${r.name}: ${r.reason}`);
  for (const [a, b] of result.contradictions) console.error(`  DROPPED contradictory superset: ${a} <-> ${b}`);
  write(flag("out", "semantics.json"), JSON.stringify(Object.fromEntries(result.semantics), null, 1));
} else if (command === "render") {
  const tools = readTools(flag("tools"));
  const path = flag("semantics");
  const semantics = path
    ? new Map<string, Semantics>(Object.entries(JSON.parse(readFileSync(path, "utf8"))) as [string, Semantics][])
    : undefined;
  const format = flag("format", "python");
  if (format !== "python" && format !== "text") fail(`unknown --format ${format}`);
  write(flag("out", "-"), format === "text" ? renderText(tools, { semantics }) : renderModule(tools, { semantics }));
} else {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
