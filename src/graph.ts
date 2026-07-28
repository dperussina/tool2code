/**
 * Which tool produces the identifier another tool needs.
 *
 * This is the one thing a JSON Schema structurally cannot say. A schema can tell a model
 * that `get_place_details` takes a `placeId: string`; it cannot tell it that the only way to
 * obtain one is to call `search_places` first. So a model either already knows the workflow
 * or it guesses, and guessing is what produces "called the tool with an ID it made up".
 *
 * Derived, never guessed — the same rule the predecessor project arrived at after measuring
 * that every malformed argument came from a map that omitted information the schema already
 * carried. Here the stakes are higher: a *wrong* edge actively sends the model to the wrong
 * tool, which is worse than saying nothing. A first pass at this on the 149-tool corpus
 * proposed `get_load_details.loadId <- gdrive_upload_file` (a substring hit on "up-LOAD-")
 * and `get_call_recordings.orderId <- create_order_note` (which creates a note, not an
 * order). Both are the failure this file exists to avoid.
 *
 * So the rules below are deliberately strict, and refusing to answer is a first-class
 * outcome: an identifier with no derivable producer is reported as EXOGENOUS rather than
 * attached to the nearest plausible tool. On the corpus roughly half of all identifier
 * parameters really are exogenous — `partnerId`, `serviceProviderID` — supplied by the user
 * or the environment, produced by nothing in the catalogue.
 */
import type { Tool } from "./types.js";

/** Words a tool name uses, lowercased: `gdrive_sheets_append_rows` → [gdrive,sheets,append,rows] */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const PRODUCER_VERBS = new Set([
  "list", "search", "find", "create", "upload", "add", "new", "start", "query", "register",
  "submit", "get", "fetch", "all", "execute",
]);

/** `file_id` → `file`; `serviceProviderID` → `service provider`; `taskId` → `task`. */
export function entityOf(param: string): string | null {
  const w = words(param);
  if (!w.length) return null;
  const last = w[w.length - 1];
  if (last !== "id" && last !== "ids") return null;
  const head = w.slice(0, -1);
  return head.length ? head.join(" ") : null;
}

const singular = (w: string) => w.replace(/ies$/, "y").replace(/([^s])s$/, "$1");

/** Does this tool take an identifier for the same entity, under any spelling? */
function consumesEntity(tool: Tool, entity: string): boolean {
  const props = Object.keys((tool as any).input_schema?.properties ?? (tool as any).inputSchema?.properties ?? {});
  return props.some((p) => {
    const e = entityOf(p);
    return e !== null && singular(e) === singular(entity);
  });
}

/**
 * Is the entity the thing the verb acts on?
 *
 * `create_article` produces an article; `create_order_note` produces a note and merely
 * mentions an order. Two weaker rules were tried first and both failed on the corpus:
 *
 *  - **entity last** rejected `coding_task_execute`, which does produce `taskId`, because
 *    the verb is last in object-first names.
 *  - **verb adjacent to entity, either side** admitted seven producers for `orderId`,
 *    including `get_order_details`, `get_order_notes` and `get_order_tracking` — each of
 *    which gets something *about* an order rather than an order.
 *
 * What separates them is that the name must **end** with the verb-entity pair: `get_quote`
 * and `search_places` do, `coding_task_execute` does in the other order, and
 * `get_order_details` does not, because the thing it returns is whatever follows the entity.
 */
function verbActsOnEntity(nameWords: string[], entityWords: string[]): boolean {
  const tail = (n: number) => nameWords.slice(-n);
  const eq = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);
  const n = entityWords.length;
  const verbFirst = tail(n + 1);
  const verbLast = tail(n + 1);
  return (
    // …list_files, …create_article, …search_places
    (PRODUCER_VERBS.has(verbFirst[0] ?? "") && eq(verbFirst.slice(1), entityWords)) ||
    // coding_task_execute
    (PRODUCER_VERBS.has(verbLast[n] ?? "") && eq(verbLast.slice(0, n), entityWords))
  );
}

export type Edge =
  /** `param` on `consumer` can be obtained by calling one of `producers`. */
  | { kind: "produced"; consumer: string; param: string; entity: string; producers: string[] }
  /** No tool in the catalogue produces it. The caller supplies it. */
  | { kind: "exogenous"; consumer: string; param: string; entity: string };

/**
 * The identifier-flow graph for a catalogue.
 *
 * A tool qualifies as a producer of `entity` only when all three hold:
 *
 *  1. its name contains every word of the entity — as words, not substrings, which is what
 *     "upload" matching "load" taught;
 *  2. the entity is the **object of the verb** — the last word of the name, so
 *     `create_article` produces an article and `create_order_note` produces a note; and
 *  3. it does not itself consume an identifier for that entity, because a tool that needs
 *     an `order_id` is a peer of the consumer, not its source.
 */
export function identifierFlow(tools: Tool[]): Edge[] {
  const edges: Edge[] = [];

  for (const t of tools) {
    const props = Object.keys(
      (t as any).input_schema?.properties ?? (t as any).inputSchema?.properties ?? {},
    );
    for (const param of props) {
      const entity = entityOf(param);
      if (!entity) continue;
      const entityWords = entity.split(" ").map(singular);

      const producers = tools
        .filter((c) => {
          if (c.name === t.name) return false;
          const cw = words(c.name).map(singular);
          if (!entityWords.every((w) => cw.includes(w))) return false; // (1) whole words
          if (!verbActsOnEntity(cw, entityWords)) return false; // (2) object of the verb
          if (consumesEntity(c, entity)) return false; // (3) peer, not source
          return true;
        })
        .map((c) => c.name);

      edges.push(
        producers.length
          ? { kind: "produced", consumer: t.name, param, entity, producers }
          : { kind: "exogenous", consumer: t.name, param, entity },
      );
    }
  }
  return edges;
}
