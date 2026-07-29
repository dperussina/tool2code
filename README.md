# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

> **Read this before the numbers.** Two claims this project made are withdrawn.
>
> **1. Rendering as code is worth nothing.** Measured directly: the same compiled semantics as
> Python and as plain English scored 46/48 each. A typed module with the annotations stripped scores
> the raw-schema baseline.
>
> **2. The headline accuracy gain was carried by a grading rule, and it did not replicate.** Every
> sweep failed a run for touching a lookalike tool at all, even when the right tool was called first
> and the task completed. Graded on task completion instead, the annotation-stripped arm ties the
> full one (46/48 vs 46/48), and on a suite written by a model that had never seen this library, the
> **baseline wins** (73/84 vs 72/84). See Round 7 in [`docs/RESULTS.md`](docs/RESULTS.md).

**What survives, stated narrowly:** compiled contrast annotations **reduce unnecessary and wrong
extra tool calls** on catalogues containing confusable pairs. On the clean corpus, runs where a model
reached for the wrong sibling *first* fell from 4 to 0, and total lookalike touches from 7 to 2. That
matters — accidentally triggering a warehouse-scale CSV export is expensive — but it is not the same
as models completing more tasks, and the evidence for it comes from a suite whose author also built
the mechanism.

**What is solid, because it needs no model and is checkable against ground truth:** structure repair.
On a catalogue with zero declared types, **101 of 101 enums recovered from English prose with zero
false positives**, 90.2% of inferred types exactly right, and `Any` rather than a guess where the
evidence is absent. That part is deterministic, verified, and independent of any accuracy claim.

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
