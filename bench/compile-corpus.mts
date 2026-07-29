import { readFileSync, writeFileSync } from "node:fs";
import { compile } from "../src/compile.js";
const flag = (k: string, d: string) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(hit.indexOf("=") + 1) : d;
};
const corpusPath = flag("corpus", "corpus/real-mcp-149.json");
const outPath = flag("out", "corpus/semantics.json");
const raw = JSON.parse(readFileSync(corpusPath,"utf8"));
const tools = Array.isArray(raw)?raw:raw.tools;

const complete = async ({system,user}:{system:string;user:string}) => {
  for (let attempt=0; attempt<3; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages",{ method:"POST",
      headers:{ "x-api-key":process.env.ANTHROPIC_API_KEY!, "anthropic-version":"2023-06-01","content-type":"application/json"},
      body: JSON.stringify({ model:"claude-opus-5", max_tokens:8000, system, messages:[{role:"user",content:user}] }) });
    const j:any = await r.json();
    if (r.ok) return (j.content??[]).filter((b:any)=>b.type==="text").map((b:any)=>b.text).join("");
    if (r.status===429 || r.status>=500) { await new Promise(s=>setTimeout(s, 2000*(attempt+1))); continue; }
    throw new Error(JSON.stringify(j).slice(0,300));
  }
  throw new Error("retries exhausted");
};

const t0 = Number(process.env.T0 ?? 0);
const { semantics, rejected, contradictions } = await compile(tools, { complete, batchSize: 12 });
console.log(`compiled ${semantics.size}/${tools.length}`);
for (const [a, b] of contradictions) console.log(`  DROPPED contradictory superset: ${a} <-> ${b}`);
const vs = [...semantics.values()].filter((s: any) => s.notThis?.length);
console.log(`  ${vs.length} tools carry a contrast slot`);
for (const s of vs.slice(0, 8) as any[]) console.log(`    ${s.name}: ${s.notThis.map((n: any) => `vs${n.tool}(${n.why})`).join(" ")}`);
for (const r of rejected) console.log(`  REJECTED ${r.name}: ${r.reason}`);
const inferred = [...semantics.values()].filter((s: any) => s.params?.length);
const inferredParams = inferred.reduce((n, s: any) => n + s.params.length, 0);
const withEnums = inferred.reduce((n, s: any) => n + s.params.filter((p: any) => p.enum?.length).length, 0);
console.log(`  structure recovered: ${inferredParams} parameters on ${inferred.length} tools, ${withEnums} with grounded enum values`);
writeFileSync(outPath, JSON.stringify(Object.fromEntries(semantics), null, 1) + "\n");
console.log(`wrote ${outPath} (${JSON.stringify(Object.fromEntries(semantics)).length} chars)`);
