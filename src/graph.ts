/**
 * Identifier vocabulary, used to CHECK a model's claims — not to make them.
 *
 * This file began as an inference engine: derive, from names and schemas alone, which tool
 * produces the identifier another tool needs. It reached 12 of 30 identifier parameters on the
 * real corpus and took four attempts to stop proposing wrong edges — `loadId <- gdrive_upload_file`,
 * from "up-LOAD-file".
 *
 * Then the same corpus was compiled by a model, and it was not close. The model found
 * `get_place_details <- search_places, nearby_search` where the rules refused `nearby_search`
 * for not having "place" in its name, and it found `trackingNumber <- quick_search_orders`,
 * which the rules could not see at all because `entityOf` only recognised a `_id` suffix. It
 * also discriminated the four order tools that derivation collapsed into the single character
 * `r`.
 *
 * The inference is deleted rather than kept alongside, because keeping a mechanism the
 * evidence beat is how a codebase accumulates. What survives is the vocabulary — these two
 * functions are how `verify()` checks that a model's producer edge is not a peer.
 */

/** Words a tool name uses, lowercased: `gdrive_sheets_append_rows` → [gdrive,sheets,append,rows] */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** `file_id` → `file`; `serviceProviderID` → `service provider`; `taskId` → `task`. */
export function entityOf(param: string): string | null {
  const w = words(param);
  if (!w.length) return null;
  const last = w[w.length - 1];
  if (last !== "id" && last !== "ids") return null;
  const head = w.slice(0, -1);
  return head.length ? head.join(" ") : null;
}

export const singular = (w: string) => w.replace(/ies$/, "y").replace(/([^s])s$/, "$1");
