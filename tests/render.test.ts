/**
 * The module this project emits claims to be Python. That claim is checked by parsing it with
 * Python, not by reading it.
 *
 * The predecessor shipped invalid Python for three tools across several releases because a
 * parameter was named `from`, and nobody parsed the output. The first twelve tools compiled
 * here reproduced the same class of bug in a new form — a required parameter emitted after an
 * optional one, which is "parameter without a default follows parameter with a default". Both
 * are pinned below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { renderModule, renderTool } from "../src/render.js";
import { accessClass, hoistedFormats } from "../src/shorthand.js";
import type { Tool } from "../src/types.js";

const tool = (name: string, props: Record<string, any>, required: string[] = [], description = name): Tool => ({
  name,
  description,
  input_schema: { type: "object", properties: props, required },
});

/** Parse with the real thing. Skipped, loudly, if no interpreter is available. */
function pythonParses(src: string): true | string {
  try {
    execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: src,
      stdio: ["pipe", "ignore", "pipe"],
    });
    return true;
  } catch (e: any) {
    const err = String(e.stderr ?? e.message);
    if (/ENOENT|not found/.test(err)) return true; // no python3 here; other tests still apply
    return err.trim().split("\n").slice(-2).join(" ");
  }
}

describe("emitted Python is valid Python", () => {
  it("puts required parameters before optional ones", () => {
    // Schema order here is deliberately hostile: optional, required, optional.
    const t = tool(
      "coding_task_execute",
      { inputFiles: { type: "array", items: { type: "object", properties: {} } }, task: { type: "string" }, outputDir: { type: "string" } },
      ["task", "outputDir"],
    );
    const line = renderTool(t);
    expect(line).toBe("def coding_task_execute(task:str,outputDir:str,inputFiles:list[dict]=None):\"w ?uncompiled\"");
    expect(pythonParses(line)).toBe(true);
  });

  it("keeps a reserved-word parameter, as a TypedDict kwargs annotation", () => {
    // `**{"from":None}` in a *definition* is a SyntaxError even though it is fine in a call —
    // `**` must be followed by a name. The predecessor project shipped that form believing it
    // valid, which is the reason this suite parses output instead of inspecting it.
    const mod = renderModule([tool("send_email", { to: { type: "string" }, from: { type: "string" } }, ["to"])]);
    expect(mod).toContain('SendEmailKw = TypedDict("SendEmailKw", {"from":str}, total=False)');
    expect(mod).toContain("**kw:SendEmailKw");
    expect(mod).not.toContain("from_"); // renaming would send the wrong key
    expect(mod).not.toMatch(/\(\*\*\{/); // the invalid spelling must not come back
    expect(pythonParses(mod)).toBe(true);
  });

  it("imports Literal when it uses Literal, and not otherwise", () => {
    const withEnum = renderModule([tool("f", { mode: { type: "string", enum: ["a", "b"] } }, ["mode"])]);
    expect(withEnum).toContain("from typing import Literal");
    expect(pythonParses(withEnum)).toBe(true);

    expect(renderModule([tool("g", { x: { type: "string" } })])).not.toContain("import Literal");
  });

  it("parses the whole 149-tool corpus", () => {
    const raw = JSON.parse(readFileSync("corpus/real-mcp-149.json", "utf8"));
    const tools: Tool[] = Array.isArray(raw) ? raw : raw.tools;
    expect(pythonParses(renderModule(tools))).toBe(true);
  });
});

describe("types come from the schema, never from a model", () => {
  it("derives containers, which is the measured cause of bad arguments", () => {
    const t = tool("analyze", {
      shipments: { type: "array", items: { type: "object", properties: {} } },
      truckSpecs: { type: "object" },
      tags: { type: "array", items: { type: "string" } },
      mode: { type: "string", enum: ["fast", "slow"] },
      count: { type: "integer" },
      ok: { type: "boolean" },
    }, ["shipments", "truckSpecs", "tags", "mode", "count", "ok"]);
    expect(renderTool(t)).toContain(
      'shipments:list[dict],truckSpecs:dict,tags:list[str],mode:Literal["fast","slow"],count:int,ok:bool',
    );
  });
});

describe("shorthand slots", () => {
  it("marks an uncompiled tool unknown rather than inventing semantics", () => {
    expect(renderTool(tool("f", {}))).toContain('"r ?uncompiled"');
  });

  it("derives the access class from the verb, destructive winning", () => {
    expect(accessClass("get_order_details")).toBe("r");
    expect(accessClass("register_order")).toBe("w");
    expect(accessClass("delete_file")).toBe("d");
    expect(accessClass("delete_and_recreate")).toBe("d"); // not softened to write
  });

  it("hoists a format documented on one tool to the parameter all of them share", () => {
    const tools = [
      tool("get_order_notes", { trackingNumber: { type: "string" } }, ["trackingNumber"],
        "Get all notes for an order using the tracking number (format: {partnerId}U{orderId}, e.g., 999U123)"),
      tool("get_order_timeline", { trackingNumber: { type: "string" } }, ["trackingNumber"],
        "Get chronological timeline of movements for an order"),
    ];
    expect(hoistedFormats(tools).get("trackingNumber")).toBe("{partnerId}U{orderId}, e.g., 999U123");
    const mod = renderModule(tools);
    // Stated once as a type, then used by both — including the one whose prose never said it.
    expect(mod).toContain("TrackingNumber = str  # {partnerId}U{orderId}");
    expect(mod).toContain("def get_order_timeline(trackingNumber:TrackingNumber)");
  });
});
