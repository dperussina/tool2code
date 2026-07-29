/**
 * Deterministic tool execution, so "the model made up an ID" is a fact rather than an opinion.
 *
 * This is the measurement instrument the whole benchmark rests on. Every producer returns
 * records containing **sentinel identifiers** that appear nowhere in the prompt, the tool
 * definitions, or the compiled module. So when a tool is called with an identifier argument,
 * exactly one of three things is true and each is mechanically checkable:
 *
 *   - the value is a sentinel the model received from an earlier call  → sequenced correctly
 *   - the value is not a sentinel at all                              → fabricated
 *   - no producer was called before this one                          → out of order
 *
 * Without this, grading "did it invent an ID" means reading transcripts and arguing. With it,
 * the failure is a set-membership test.
 *
 * Sentinels are deliberately unguessable — `TN-4417-QX` rather than `123` — because a model
 * that emits a plausible-looking `999U123` from the format hint in the schema has still not
 * called the search tool, and a grader that accepts it would score fabrication as success.
 * There is no `Math.random()`: identical inputs must produce identical bytes, or a rerun is
 * not a rerun.
 */

import { validateArgs } from "./validate.js";

/** Every identifier this mock will ever hand out, by the tool that hands it out. */
export const SENTINELS: Record<string, string[]> = {
  quick_search_orders: ["TN-4417-QX"],
  search_places: ["place_8HTZ2K"],
  nearby_search: ["place_8HTZ2K"],
  coding_task_execute: ["task_R7WM31"],
  gdrive_search_by_name: ["file_2KD9PL"],
  gdrive_list_files: ["file_2KD9PL"],
  create_article: ["art_QJ4T80"],
  get_quote: ["quote_MZ6X15"],
  // Numeric, because `get_customer_scorecard.partnerId` is `type: "number"` ("e.g., 737") and
  // ten identifier parameters in this corpus are. A string sentinel made that scenario
  // unsatisfiable: every model correctly sent a number, and the grader called every one wrong.
  search_customers: ["990417"],
};

/** Flat set of every sentinel, for membership tests. */
export const ALL_SENTINELS = new Set(Object.values(SENTINELS).flat());

/** Arguments whose value is an identifier — the ones worth checking. */
export const IDENTIFIER_ARG =
  /(^|[a-z])(id|ids|number|no|key|code|ref|reference)$/i;

/**
 * What a tool returns.
 *
 * Producers return a small record carrying their sentinel. Consumers echo back whether the
 * identifier they were given is one the mock ever issued: a consumer called with a fabricated
 * ID gets an error, exactly as a real API would, so the model has the chance to recover and
 * the transcript records that it needed to.
 */
/**
 * Bind the mock to the real catalogue so arguments can be checked against real schemas.
 *
 * Without this the mock accepted anything, and only tool *selection* was ever measured.
 */
export function makeExecutor(
  tools: { name: string; input_schema?: any; inputSchema?: any }[],
  /**
   * Maps a live tool name back to the name the sentinel table is keyed by.
   *
   * Needed because a degraded catalogue renames everything. Without it, `SENTINELS` never matched
   * on the badly-structured corpus, no producer ever handed out an identifier, and every
   * sequencing scenario was unsatisfiable — all three arms scored 0/8 and the harness reported it
   * as a model failure. A uniform zero across every arm is almost always the instrument.
   */
  canonical: (name: string) => string = (n) => n,
) {
  const schemas = new Map(tools.map((t) => [t.name, t.input_schema ?? t.inputSchema ?? {}]));
  return (liveName: string, args: Record<string, any>) => {
    const name = canonical(liveName);
    const schema = schemas.get(liveName);
    const problems = schema ? validateArgs(args ?? {}, schema) : [];
    if (problems.length) {
      return {
        content: JSON.stringify({ error: problems.slice(0, 3).join("; ") }),
        isError: true,
        malformed: problems,
      };
    }
    return { ...execute(name, args), malformed: [] as string[] };
  };
}

export function execute(name: string, args: Record<string, any>): { content: string; isError?: boolean } {
  const own = SENTINELS[name];
  if (own) {
    switch (name) {
      case "quick_search_orders":
        return json({ results: [{ trackingNumber: own[0], customer: "Johnson Manufacturing", status: "in transit" }] });
      case "search_places":
      case "nearby_search":
        return json({ results: [{ placeId: own[0], name: "Blue Bottle Coffee", rating: 4.6 }] });
      case "coding_task_execute":
        return json({ taskId: own[0], state: "running" });
      case "gdrive_search_by_name":
      case "gdrive_list_files":
        return json({ files: [{ file_id: own[0], name: "quarterly.xlsx", mimeType: "application/vnd.ms-excel" }] });
      case "create_article":
        return json({ article_id: own[0], status: "draft" });
      case "get_quote":
        return json({ quoteId: own[0], total: 412.5, currency: "USD" });
      case "search_customers":
        return json({ customers: [{ partnerId: Number(own[0]), name: "Johnson Manufacturing", status: "active" }] });
    }
  }

  // A consumer: check every identifier-shaped argument it was handed.
  const supplied = Object.entries(args ?? {}).filter(([k]) => IDENTIFIER_ARG.test(k));
  // Compared as text, so a numeric identifier is judged the same as a string one.
  const invented = supplied.filter(([, v]) => (typeof v === "string" || typeof v === "number") && !ALL_SENTINELS.has(String(v)));
  if (invented.length) {
    return {
      content: JSON.stringify({
        error: `No such ${invented[0][0]}: ${JSON.stringify(invented[0][1])}. Look it up first.`,
      }),
      isError: true,
    };
  }
  return json({ ok: true, tool: name, note: "result body omitted; this benchmark grades the call, not the payload" });
}

const json = (o: unknown) => ({ content: JSON.stringify(o) });

/** Identifier values a run has legitimately been given, harvested from results so far. */
export function seenIdentifiers(resultBodies: string[]): Set<string> {
  const seen = new Set<string>();
  for (const body of resultBodies) for (const s of ALL_SENTINELS) if (body.includes(s)) seen.add(s);
  return seen;
}
