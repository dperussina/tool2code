/**
 * Scenarios with headroom.
 *
 * The first version of this file measured nothing. Baseline scored 100% on every provider that
 * ran, because the prompts named the tool: *"I need the chronological history of status changes
 * — not the raw scan events, the timeline"* hands over the answer and rules out the rival. A
 * suite the baseline already aces cannot show an improvement, which is a trap the predecessor
 * fell into and which this project's own thesis document warned about before walking into it.
 *
 * So every prompt below describes what a person wants, never which function to call, and each
 * targets one failure mode the corpus makes genuinely hard:
 *
 *  - **discriminate** — the catalogue contains near-duplicate pairs where one is a bulk CSV
 *    export for warehouse syncing and the other answers a question about one entity:
 *    `order_notes` vs `get_order_notes`, `cost_of_sales` vs `get_cost_of_sales`,
 *    `active_locations` vs `get_active_locations`. Two prompts can want opposite members of the
 *    same pair. Picking by keyword gets it wrong half the time.
 *  - **sequence** — the identifier must come from another call, sometimes two hops deep.
 * A **restraint** category was designed and then removed, because it could not be measured
 * honestly on this corpus. The idea was to ask for something whose identifier nothing produces,
 * where the right answer is to say so rather than invent one. Both arms "failed" the first
 * attempt by calling `search_customers` first — which is correct behaviour: that tool's own
 * description says it returns customer details and exists "to find customers by name, ID". A
 * Sheets ID is likewise just a Drive file ID, reachable via `gdrive_search_by_name`. Every
 * identifier here has a plausible discovery route, so a restraint metric would score good
 * judgement as failure. Both scenarios became sequencing tests instead.
 */
export type Scenario = {
  id: string;
  prompt: string;
  kind: "sequence" | "discriminate";
  /** sequence: the call that completes the task. discriminate: the only right choice. */
  finalTool?: string;
  /** sequence: any one of these legitimately supplies the identifier. */
  producers?: string[];
  /** sequence: the argument that must carry a real identifier. */
  identifierArg?: string;
  /** discriminate: the tempting wrong sibling(s). Calling one is a failure. */
  trapTools?: string[];
};

export const SCENARIOS: Scenario[] = [
  // ---- discrimination: bulk export vs single-entity lookup ----
  {
    id: "disc-notes-single",
    kind: "discriminate",
    prompt:
      "A customer service rep says she left comments on the Johnson Manufacturing shipment yesterday. What did she write?",
    finalTool: "get_order_notes",
    trapTools: ["order_notes"],
    producers: ["quick_search_orders"],
    identifierArg: "trackingNumber",
  },
  {
    id: "disc-notes-bulk",
    kind: "discriminate",
    prompt:
      "We are standing up a Control Tower data warehouse. I need the order notes and communications feed for the last 30 days exported so it can be loaded in — all of it, not one shipment.",
    finalTool: "order_notes",
    trapTools: ["get_order_notes"],
  },
  {
    id: "disc-cos-bulk",
    kind: "discriminate",
    prompt:
      "Same warehouse project: I now need the invoice-level cost of sales feed for syncing in, with the revenue and cost breakdown per invoice.",
    finalTool: "cost_of_sales",
    trapTools: ["get_cost_of_sales"],
  },
  {
    id: "disc-cos-query",
    kind: "discriminate",
    prompt:
      "Finance is asking a one-off question: for March, what did freight and carrier charges come to for partner 4471, invoice-level detail not needed as a feed.",
    finalTool: "get_cost_of_sales",
    trapTools: ["cost_of_sales"],
  },

  // Three more trap pairs, because the first round's weakness was its base: two pairs produced
  // all nine failures. These come from other clusters `cluster.ts` finds in the same corpus.
  {
    id: "disc-loc-live",
    kind: "discriminate",
    prompt:
      "I am planning a truck route this afternoon and need the customer sites and hubs we can route through, with their coordinates.",
    finalTool: "get_active_locations",
    trapTools: ["active_locations"],
  },
  {
    id: "disc-loc-bulk",
    kind: "discriminate",
    prompt:
      "For the Control Tower warehouse load, I need the active locations data source feed — and first just its schema so I can set up the table.",
    finalTool: "active_locations",
    trapTools: ["get_active_locations"],
  },
  {
    id: "disc-cust-find",
    kind: "discriminate",
    prompt:
      "Which of our customers in the Southeast are currently on credit hold? I need to find them, not export anything.",
    finalTool: "search_customers",
    trapTools: ["customers"],
  },

  // ---- sequencing ----
  {
    id: "seq-place",
    kind: "sequence",
    prompt:
      "There is a Blue Bottle Coffee somewhere near 47.6062, -122.3321. I want everything you can tell me about that specific location — hours, phone, the works.",
    finalTool: "get_place_details",
    producers: ["search_places", "nearby_search"],
    identifierArg: "placeId",
  },
  {
    id: "seq-drive",
    kind: "sequence",
    prompt: "Somebody put a file called quarterly.xlsx in our Drive. What is actually in it?",
    finalTool: "gdrive_read_file",
    producers: ["gdrive_search_by_name", "gdrive_list_files"],
    identifierArg: "file_id",
  },
  {
    id: "seq-task",
    kind: "sequence",
    prompt:
      "Have a coding agent write a Python script that turns our shipment CSVs into a summary table, output to ./out, and then tell me what it produced when it finished.",
    finalTool: "coding_task_result",
    producers: ["coding_task_execute"],
    identifierArg: "taskId",
  },

  {
    id: "seq-scorecard",
    kind: "sequence",
    prompt:
      "How is Johnson Manufacturing performing this quarter? I want their scorecard, not a list of their orders.",
    finalTool: "get_customer_scorecard",
    producers: ["search_customers"],
    identifierArg: "partnerId",
  },
  {
    id: "seq-sheet-tabs",
    kind: "sequence",
    prompt:
      "We keep a shipment tracking spreadsheet called quarterly.xlsx in Drive. What tabs does it have?",
    finalTool: "gdrive_sheets_list_tabs",
    producers: ["gdrive_search_by_name", "gdrive_list_files"],
    identifierArg: "spreadsheet_id",
  },
];
