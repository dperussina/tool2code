# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

**Status: 97.9% against a raw-JSON-Schema baseline's 83.3%**, over 192 live runs on four
frontier providers (sweep `2026-07-28T22-29-40`). 100% on Anthropic, Gemini and OpenAI.

| arm | completed | trap calls | prompt tokens (Anthropic) |
|---|--:|--:|--:|
| raw JSON Schema (baseline) | 83.3% | 7 | 224,894 |
| **tool2code** | **97.9%** | **1** | **83,445** |
| tool2code, semantics stripped | 83.3% | 8 | 60,845 |

The third row is the one to read: the same module with the model-written semantics removed scores
exactly the baseline. **The code shape is worth nothing on its own** — the gain is the compiled
semantics, above all `vsX(why)`, which states what a tool is *not*.

Argument construction and sequencing are saturated for every arm including the baseline, so the
whole difference is disambiguation between near-duplicate tools. Full numbers, the prediction that
was made and confirmed, and the five measurement bugs found along the way are in
[`docs/RESULTS.md`](docs/RESULTS.md).

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
