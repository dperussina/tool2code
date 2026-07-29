# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

> **The name overclaims, and the measurements say so.** Rendering a catalogue as code is worth
> **0.0 points** of accuracy. What is worth **+12.5 points** is compiling each tool's purpose and,
> above all, what it must not be confused with. See Round 5 in [`docs/RESULTS.md`](docs/RESULTS.md).

**Status: measured over five rounds, ~800 live runs, four frontier providers.**

On a deliberately **badly-structured** catalogue — no declared types, no enums, no `required`
markers, names like `apiV2CostOfSalesGet` (sweep `messy2-2026-07-29T00-40-15`):

| arm | completed | trap calls |
|---|--:|--:|
| raw JSON Schema (baseline) | 83.3% | 7 |
| **compiled semantics, as a Python module** | **95.8%** | 2 |
| **compiled semantics, as plain English** | **95.8%** | 2 |
| Python module, semantics stripped | 83.3% | 8 |

Rows 2 and 3 are the finding: **the format does not matter.** Rows 1 and 4 are the other half:
**a typed code module with nothing compiled into it scores exactly the baseline.** All of the gain
comes from a strong model reading the catalogue once, offline, and writing down what each tool
returns and what it is not — every claim verified against the source before it ships.

What the code form still earns, on grounds other than accuracy: it is parsed by a real Python
parser in CI (which caught two `SyntaxError`s prose never would have), its types are derived from
the schema rather than paraphrased, and it is deterministic and diffable.

**Repair**, for catalogues that need it: 101 of 101 enums recovered from English prose
deterministically with zero false positives, and 90.2% of inferred types exactly right against
ground truth — with `Any` where the evidence is absent rather than a confident guess.

Run `diagnose()` against your catalogue first; it tells you whether either value proposition
applies to you, or that neither does.

## Install and use

```bash
npm i tool2code
```

```bash
# 1. Will this help my catalogue at all? No model, no network, no cost.
npx tool2code diagnose --tools ./tools.json

# 2. Read every tool once with a strong model. Your key, your provider.
npx tool2code compile --tools ./tools.json --out ./semantics.json

# 3. Emit the interface for your system prompt.
npx tool2code render --tools ./tools.json --semantics ./semantics.json > catalogue.py
```

`diagnose` comes first deliberately — it tells you whether either value proposition applies to
you, or that neither does:

```
149 tools, 799 parameters
  confusable groups   15 covering 31 tools
  untyped parameters  700
  enums               0 declared, 101 stated only in prose
  nested shapes       10

31 of 149 tools (21%) sit in a confusable group. This is the case the contrast slot is for,
and where the measured gain came from.
```

From code, with your own model so the library never imports an SDK or sees a key:

```ts
import { diagnose, compileTools, renderModule, renderText } from "tool2code";

const { semantics } = await compileTools(tools, {
  complete: async ({ system, user }) => callYourModel(system, user),
});

const forSystemPrompt = renderModule(tools, { semantics });   // typed Python
const orAsProse       = renderText(tools, { semantics });     // identical accuracy
```

Both renderers ship because they measured **identically** — 46/48 each. Choose Python when you
want the artifact parsed, diffed and type-checked in CI; text when prose suits the consumer.

Accepts a bare array, `{ tools }`, or MCP's `{ result: { tools } }`. Zero runtime dependencies.

## Why not just "put the schemas in a code block"

Because that was measured, and it lost. A predecessor project compiled catalogues into
minified Python across 4,031 live runs on four providers; on a sequencing-heavy corpus it
scored **64.4% against 71.1%** for a representation carrying only signatures, at 1,639 more
tokens. More code was not more accuracy.

What is left, after types are derived from the schema rather than described by a model, is
**selection among lookalike tools** and **sequencing**. Sequencing is the one a JSON Schema
cannot express at all:

```python
def get_place_details(placeId: str, language: str = None) -> PlaceDetails:
    """Place information, by known place ID."""
    # placeId ← search_places()
```

A schema can say `placeId` is a string. It cannot say where you get one. So the model either
knows the workflow already or invents an ID.

## What works today

`identifierFlow()` derives producer→consumer edges from names and schemas, with no model
involved. On a 149-tool real MCP corpus: **12 resolved edges, 18 identifiers correctly marked
exogenous** — produced by nothing in the catalogue, because the caller already has them.

Refusing to answer is deliberate. A wrong edge sends the model to the wrong tool, which is
worse than silence; three plausible heuristics were rejected on real data for doing exactly
that, and each is pinned by a test.

```bash
npm test        # offline
npm run build
```
