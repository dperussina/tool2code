/**
 * Guarantees about shape: what gets typed, what gets named, and what must never be guessed.
 *
 * Each of these protects a decision that was wrong in an earlier version and was found by
 * inspecting output rather than by reasoning about it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { collectShapes } from "../src/shapes.js";
import { renderModule, renderTool } from "../src/render.js";
import { attachInferredParams, type Semantics } from "../src/compile.js";
import { validateArgs } from "../bench/validate.js";
import { degrade, describeCatalogue } from "../bench/degrade.js";
import type { Tool } from "../src/types.js";

const tool = (name: string, props: Record<string, any>, required: string[] = [], description = name): Tool =>
  ({ name, description, input_schema: { type: "object", properties: props, required } }) as Tool;

const FILTER = {
  type: "array",
  items: {
    type: "object",
    properties: {
      column: { type: "string", description: "Column name" },
      operator: { type: "string", enum: ["equals", "not_equals", "contains"] },
      value: { type: "string" },
    },
    required: ["column", "operator"],
  },
};

function pythonParses(src: string): true | string {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: src, stdio: ["pipe", "ignore", "pipe"],
    });
    return true;
  } catch (e: any) {
    const err = String(e.stderr ?? e.message);
    if (/ENOENT|not found/.test(err)) return true;
    return err.trim().split("\n").slice(-2).join(" ");
  }
}

describe("nested shapes become named types", () => {
  it("names a nested shape instead of rendering dict", () => {
    // The defect: `filters:list[dict]` gives a model nothing it can build a filter from.
    const mod = renderModule([tool("query", { filters: FILTER }, [])]);
    expect(mod).toContain("filters:list[Filter]=None");
    expect(mod).not.toContain("list[dict]");
    expect(mod).toContain('"operator": Literal["equals","not_equals","contains"]');
    expect(mod).toContain("# required");
    expect(pythonParses(mod)).toBe(true);
  });

  it("shares one definition across every parameter with that shape", () => {
    const shapes = collectShapes([
      tool("a", { filters: FILTER }),
      tool("b", { filters: FILTER }),
      tool("c", { filters: FILTER }),
    ]);
    expect(shapes.size).toBe(1);
    expect([...shapes.values()][0].uses).toBe(3);
  });

  it("keys on structure, not name, so two different `origin` shapes both survive", () => {
    // The real corpus has exactly this: `origin` as lat/lng and `origin` as address/placeId.
    const shapes = collectShapes([
      tool("a", { origin: { type: "object", properties: { latitude: { type: "number" }, longitude: { type: "number" } } } }),
      tool("b", { origin: { type: "object", properties: { address: { type: "string" }, placeId: { type: "string" } } } }),
    ]);
    expect(shapes.size).toBe(2);
    expect([...shapes.values()].map((s) => s.name)).toEqual(["Origin", "Origin2"]);
  });

  it("is deterministic — same catalogue, same bytes", () => {
    const tools = [tool("a", { filters: FILTER }), tool("b", { location: { type: "object", properties: { lat: { type: "number" } } } })];
    expect(renderModule(tools)).toBe(renderModule(tools));
  });
});

describe("an undeclared type is never reported as a string", () => {
  it("renders Any, because `str` would be confidently wrong", () => {
    const t = tool("f", { thing: { description: "no type declared" } }, []);
    expect(renderTool(t)).toContain("thing:Any=None");
    expect(renderTool(t)).not.toContain("thing:str");
  });

  it("imports Any when it uses Any", () => {
    const mod = renderModule([tool("f", { thing: { description: "x" } })]);
    expect(mod).toMatch(/from typing import .*\bAny\b/);
    expect(pythonParses(mod)).toBe(true);
  });
});

describe("recovered structure must be grounded in the source", () => {
  const untyped = tool(
    "search",
    {
      mode: { description: "How to sort. Allowed values: relevance, distance." },
      limit: { description: "Maximum rows" },
      typed: { type: "string", description: "Already declared" },
    },
    [],
  );
  const fresh = (): Semantics => ({ name: "search", returns: "results" });

  it("keeps enum values the description actually states", () => {
    const s = fresh();
    attachInferredParams(s, ["@search.mode | str | relevance,distance"], untyped);
    expect(s.params).toEqual([{ name: "mode", type: "str", enum: ["relevance", "distance"] }]);
  });

  it("drops enum values the description does not state", () => {
    // Invention is the failure mode this project has already shipped once, as a tool name.
    const s = fresh();
    attachInferredParams(s, ["@search.mode | str | relevance,distance,price,rating"], untyped);
    expect(s.params?.[0].enum).toEqual(["relevance", "distance"]);
  });

  it("never overrides a type the schema declares", () => {
    const s = fresh();
    attachInferredParams(s, ["@search.typed | int"], untyped);
    expect(s.params ?? []).toEqual([]);
  });

  it("ignores a parameter the tool does not have, and a type outside the vocabulary", () => {
    const s = fresh();
    attachInferredParams(s, ["@search.nonexistent | str", "@search.limit | integer"], untyped);
    expect(s.params ?? []).toEqual([]); // "integer" is not in the allowed set; "int" would be
  });

  it("ignores lines belonging to a different tool", () => {
    const s = fresh();
    attachInferredParams(s, ["@other_tool.mode | str"], untyped);
    expect(s.params ?? []).toEqual([]);
  });

  it("is used by the renderer only where the schema is silent", () => {
    const semantics = new Map<string, Semantics>([
      ["search", { name: "search", returns: "r", params: [{ name: "limit", type: "int", required: true }] }],
    ]);
    const line = renderTool(untyped, { semantics });
    expect(line).toContain("limit:int");     // inferred, and promoted to required
    expect(line).toContain("typed:str=None"); // schema wins
  });
});

describe("arguments are checked against the real schema", () => {
  const schema = { type: "object", properties: { filters: FILTER, n: { type: "integer" } }, required: ["filters"] } as any;

  it("accepts a well-formed nested argument", () => {
    expect(validateArgs({ filters: [{ column: "c", operator: "equals", value: "x" }] }, schema)).toEqual([]);
  });

  it("catches a bad enum value inside an array item", () => {
    expect(validateArgs({ filters: [{ column: "c", operator: "eq" }] }, schema)[0]).toMatch(/operator="eq" is not one of/);
  });

  it("catches the wrong container type", () => {
    expect(validateArgs({ filters: { column: "c" } }, schema)[0]).toMatch(/filters should be array, got object/);
  });

  it("catches a missing required field, at top level and inside an item", () => {
    expect(validateArgs({}, schema)[0]).toMatch(/missing required filters/);
    expect(validateArgs({ filters: [{ operator: "equals" }] }, schema)[0]).toMatch(/missing required filters\[0\]\.column/);
  });

  it("catches an unknown parameter", () => {
    expect(validateArgs({ filters: [], carrier: "FedEx" }, schema)[0]).toMatch(/unknown parameter carrier/);
  });

  it("accepts an integer where a number is wanted, but not the reverse", () => {
    expect(validateArgs({ filters: [], n: 3 }, schema)).toEqual([]);
    expect(validateArgs({ filters: [], n: 3.5 }, schema)[0]).toMatch(/should be integer/);
  });
});

describe("the degraded corpus is genuinely degraded", () => {
  const raw = JSON.parse(readFileSync("corpus/real-mcp-149.json", "utf8"));
  const tools: Tool[] = Array.isArray(raw) ? raw : raw.tools;

  it("removes the structure a well-formed catalogue provides", () => {
    const clean = describeCatalogue(tools);
    const messy = describeCatalogue(degrade(tools, ["types", "enums", "required", "descriptions", "names"]));
    expect(clean.typed).toBeGreaterThan(700);
    expect(messy.typed).toBe(0);
    expect(messy.enums).toBe(0);
    expect(messy.requiredMarked).toBe(0);
    expect(messy.params).toBe(clean.params); // same interface, less said about it
  });

  it("demotes enums into prose rather than deleting the information", () => {
    // The realistic failure: a human documented it for a human, so nothing can enforce it.
    const messy = degrade(tools, ["enums"]);
    const withValues = messy.filter((t) =>
      Object.values((t as any).input_schema.properties ?? {}).some((p: any) =>
        /Allowed values:/.test(p.description ?? ""),
      ),
    );
    expect(withValues.length).toBeGreaterThan(10);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(degrade(tools, ["types", "names"]))).toBe(JSON.stringify(degrade(tools, ["types", "names"])));
  });

  it("still renders as valid Python", () => {
    expect(pythonParses(renderModule(degrade(tools, ["types", "enums", "required", "descriptions", "names"])))).toBe(true);
  });
});
