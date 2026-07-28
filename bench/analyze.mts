/**
 * Read one sweep. Never more than one.
 *
 * `--sweep=` is required, because pooling sweeps is how the predecessor produced comparisons
 * that could not be reproduced: different runs, different scenario sets, different days, summed
 * into one table. A comparison is only valid inside a single sweep.
 *
 * Cost is deliberately absent. Providers here differ by roughly 10x in price, so a mean across
 * them measures the mix, not the arm — and this project is about accuracy anyway.
 *
 *   npx tsx bench/analyze.mts --sweep=2026-07-28T14-53-43
 */
import { readFileSync, readdirSync } from "node:fs";

const flag = (k: string, d = "") => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(hit.indexOf("=") + 1) : d;
};
const sweep = flag("sweep");
if (!sweep) {
  const seen = new Set<string>();
  for (const f of readdirSync("bench/results").filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(`bench/results/${f}`, "utf8").split("\n").filter(Boolean))
      seen.add(JSON.parse(line).sweep);
  }
  console.error(`--sweep= is required. Available:\n  ${[...seen].sort().join("\n  ")}`);
  process.exit(1);
}

const exclude = flag("exclude").split(",").filter(Boolean);

type Row = {
  sweep: string; provider: string; arm: string; scenario: string; rep: number;
  correct: boolean; fabricated: boolean; outOfOrder: boolean; trapped?: string[];
  malformedCalls?: number; malformedFirst?: string | null;
  calledProducer: boolean; calledFinal: boolean; sequence: string[];
  turns: number; unresolved: number; promptTokens: number; outputTokens: number; error: string | null;
};

const rows: Row[] = [];
for (const f of readdirSync("bench/results").filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(`bench/results/${f}`, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as Row;
    if (r.sweep === sweep && !exclude.includes(r.scenario)) rows.push(r);
  }
}
if (!rows.length) { console.error(`no rows for sweep ${sweep}`); process.exit(1); }

const arms = [...new Set(rows.map((r) => r.arm))];
const providers = [...new Set(rows.map((r) => r.provider))];
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

console.log(
  `sweep ${sweep} — ${rows.length} runs, ${providers.length} providers, ${arms.length} arms` +
    (exclude.length ? `, excluding ${exclude.join(", ")}` : "") + "\n",
);

console.log("| arm | n | completed | malformed calls | runs w/ malformed | fabricated ID | trap calls | errors | avg turns |");
console.log("|---|--:|--:|--:|--:|--:|--:|--:|--:|");
for (const arm of arms) {
  const a = rows.filter((r) => r.arm === arm);
  const ok = a.filter((r) => r.correct).length;
  console.log(
    `| \`${arm}\` | ${a.length} | **${pct(ok, a.length)}** (${ok}/${a.length}) | ` +
      `${a.reduce((s, r) => s + (r.malformedCalls ?? 0), 0)} | ` +
      `${a.filter((r) => (r.malformedCalls ?? 0) > 0).length} | ` +
      `${a.filter((r) => r.fabricated).length} | ` +
      `${a.filter((r) => r.trapped?.length).length} | ${a.filter((r) => r.error).length} | ` +
      `${(a.reduce((s, r) => s + r.turns, 0) / a.length).toFixed(1)} |`,
  );
}

console.log("\n**Per provider** (completed):\n");
console.log(`| arm | ${providers.join(" | ")} |`);
console.log(`|---|${providers.map(() => "--:").join("|")}|`);
for (const arm of arms) {
  const cells = providers.map((p) => {
    const a = rows.filter((r) => r.arm === arm && r.provider === p);
    return `${pct(a.filter((r) => r.correct).length, a.length)} (${a.filter((r) => r.correct).length}/${a.length})`;
  });
  console.log(`| \`${arm}\` | ${cells.join(" | ")} |`);
}

console.log("\n**Per scenario** (completed):\n");
const scenarios = [...new Set(rows.map((r) => r.scenario))];
console.log(`| scenario | ${arms.map((a) => `\`${a}\``).join(" | ")} |`);
console.log(`|---|${arms.map(() => "--:").join("|")}|`);
for (const s of scenarios) {
  const cells = arms.map((arm) => {
    const a = rows.filter((r) => r.arm === arm && r.scenario === s);
    return `${a.filter((r) => r.correct).length}/${a.length}`;
  });
  console.log(`| ${s} | ${cells.join(" | ")} |`);
}

console.log("\n**Prompt tokens per run** (mean; never averaged across providers):\n");
console.log(`| provider | ${arms.map((a) => `\`${a}\``).join(" | ")} |`);
console.log(`|---|${arms.map(() => "--:").join("|")}|`);
for (const p of providers) {
  const cells = arms.map((arm) => {
    const a = rows.filter((r) => r.arm === arm && r.provider === p && !r.error);
    return a.length ? Math.round(a.reduce((s, r) => s + r.promptTokens, 0) / a.length).toLocaleString() : "—";
  });
  console.log(`| ${p} | ${cells.join(" | ")} |`);
}

const failures = rows.filter((r) => !r.correct);
if (failures.length) {
  console.log(`\n**Every failure** (${failures.length}):\n`);
  for (const r of failures) {
    // Trap first: a run that called the wrong sibling was mislabelled "wrong identifier",
    // which hid the failure mode the discrimination scenarios exist to measure.
    const why = r.error
      ? `ERROR ${r.error}`
      : r.trapped?.length
        ? `called the trap (${r.trapped.join(", ")})`
        : r.fabricated
          ? "fabricated ID"
          : r.outOfOrder
            ? "out of order"
            : !r.calledFinal
              ? `never called the target tool`
              : "wrong identifier";
    console.log(`- \`${r.provider}\` / \`${r.arm}\` / ${r.scenario}: ${why} — sequence: ${r.sequence.join(" → ") || "(no calls)"}`);
  }
}
