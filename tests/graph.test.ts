/**
 * Every case here is a heuristic that looked reasonable and was wrong on the real corpus.
 *
 * The thing being protected is precision. An edge that says "call `search_places` to get a
 * `placeId`" is the whole value of this project; an edge that says "call `gdrive_upload_file`
 * to get a `loadId`" is worse than silence, because the model will do it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { identifierFlow, entityOf, words, type Edge } from "../src/graph.js";
import type { Tool } from "../src/types.js";

const tool = (name: string, params: string[] = []): Tool => ({
  name,
  description: name,
  input_schema: {
    type: "object",
    properties: Object.fromEntries(params.map((p) => [p, { type: "string" }])),
  },
});

const edgeFor = (edges: Edge[], consumer: string, param: string) =>
  edges.find((e) => e.consumer === consumer && e.param === param);

describe("entity extraction", () => {
  it("reads the entity out of an identifier parameter", () => {
    expect(entityOf("file_id")).toBe("file");
    expect(entityOf("spreadsheet_id")).toBe("spreadsheet");
    expect(entityOf("taskId")).toBe("task");
    expect(entityOf("serviceProviderID")).toBe("service provider");
    expect(entityOf("partnerIds")).toBe("partner");
  });

  it("ignores parameters that are not identifiers", () => {
    expect(entityOf("subject")).toBeNull();
    expect(entityOf("id")).toBeNull(); // no entity to name
    expect(entityOf("valid")).toBeNull(); // ends in "id" but is one word
  });

  it("splits names into words, not substrings", () => {
    expect(words("gdrive_upload_file")).toEqual(["gdrive", "upload", "file"]);
    expect(words("serviceProviderID")).toEqual(["service", "provider", "id"]);
  });
});

describe("edges it must find", () => {
  const tools = [
    tool("search_places"),
    tool("get_place_details", ["placeId"]),
    tool("create_article", ["title"]),
    tool("update_article", ["article_id"]),
    tool("coding_task_execute", ["prompt"]),
    tool("coding_task_status", ["taskId"]),
  ];
  const edges = identifierFlow(tools);

  it("finds the producer for a verb-object name", () => {
    expect(edgeFor(edges, "get_place_details", "placeId")).toMatchObject({
      kind: "produced",
      producers: ["search_places"],
    });
  });

  it("finds it for an object-verb name too", () => {
    // `coding_task_execute` puts the verb last. An earlier rule required the entity to come
    // last and so reported this identifier as exogenous, which is plainly wrong.
    expect(edgeFor(edges, "coding_task_status", "taskId")).toMatchObject({
      kind: "produced",
      producers: ["coding_task_execute"],
    });
  });

  it("matches singular against plural", () => {
    expect(edgeFor(edges, "update_article", "article_id")).toMatchObject({
      producers: ["create_article"],
    });
  });
});

describe("edges it must refuse", () => {
  it('does not match "load" inside "upload"', () => {
    // The first version of this proposed `get_load_details.loadId <- gdrive_upload_file`.
    const edges = identifierFlow([tool("gdrive_upload_file", ["path"]), tool("get_load_details", ["loadId"])]);
    expect(edgeFor(edges, "get_load_details", "loadId")).toMatchObject({ kind: "exogenous" });
  });

  it("does not treat a tool that acts on a sub-object as the producer", () => {
    // `create_order_note` creates a note. The order is an input to it, not its output.
    const edges = identifierFlow([tool("create_order_note", ["text"]), tool("get_call_recordings", ["orderId"])]);
    expect(edgeFor(edges, "get_call_recordings", "orderId")).toMatchObject({ kind: "exogenous" });
  });

  it("does not treat a retriever of details as a producer of the thing", () => {
    // Adjacency alone admitted seven producers for `orderId`, these among them.
    const edges = identifierFlow([
      tool("get_order_details", ["orderNumber"]),
      tool("get_order_notes", ["orderNumber"]),
      tool("get_order_tracking", ["orderNumber"]),
      tool("get_call_recordings", ["orderId"]),
    ]);
    expect(edgeFor(edges, "get_call_recordings", "orderId")).toMatchObject({ kind: "exogenous" });
  });

  it("does not treat a peer consumer as a producer", () => {
    // Two tools that both need a spreadsheet_id are siblings; neither is a source.
    const edges = identifierFlow([
      tool("gdrive_sheets_list_tabs", ["spreadsheet_id"]),
      tool("gdrive_sheets_get_range", ["spreadsheet_id"]),
    ]);
    expect(edgeFor(edges, "gdrive_sheets_get_range", "spreadsheet_id")).toMatchObject({
      kind: "exogenous",
    });
  });

  it("reports exogenous rather than guessing when nothing produces it", () => {
    const edges = identifierFlow([tool("get_customer_details", ["partnerId"])]);
    expect(edgeFor(edges, "get_customer_details", "partnerId")).toEqual({
      kind: "exogenous",
      consumer: "get_customer_details",
      param: "partnerId",
      entity: "partner",
    });
  });
});

describe("the 149-tool corpus", () => {
  const raw = JSON.parse(readFileSync("corpus/real-mcp-149.json", "utf8"));
  const tools: Tool[] = Array.isArray(raw) ? raw : raw.tools;
  const edges = identifierFlow(tools);

  it("finds the identifier parameters", () => {
    expect(edges.length).toBe(30);
  });

  it("resolves the ones with a producer and refuses the rest", () => {
    const produced = edges.filter((e) => e.kind === "produced");
    const exogenous = edges.filter((e) => e.kind === "exogenous");
    expect(produced.length).toBe(12);
    expect(exogenous.length).toBe(18);
  });

  it("proposes no producer that is obviously wrong", () => {
    // The specific false positives from the first three attempts, asserted absent on the
    // real data rather than only on fixtures.
    const flat = edges
      .filter((e): e is Extract<Edge, { kind: "produced" }> => e.kind === "produced")
      .flatMap((e) => e.producers.map((p) => `${e.consumer}.${e.param} <- ${p}`));
    expect(flat).not.toContain("get_load_details.loadId <- gdrive_upload_file");
    expect(flat).not.toContain("get_call_recordings.orderId <- create_order_note");
    expect(flat).not.toContain("get_call_recordings.orderId <- get_order_details");
  });

  it("marks the entities nothing in the catalogue produces", () => {
    const exo = new Set(
      edges.filter((e) => e.kind === "exogenous").map((e) => e.entity),
    );
    // A spreadsheet, a folder, a partner and a service provider are all things the caller
    // already has. No tool here creates or lists them.
    for (const e of ["spreadsheet", "folder", "partner", "service provider"]) {
      expect(exo.has(e), `${e} should be exogenous`).toBe(true);
    }
  });
});
