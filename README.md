# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

**Status: nothing is proven yet.** There is one working mechanism and no accuracy measurement.
Read [`docs/THESIS.md`](docs/THESIS.md) first — it states the claim, the baseline, and what
would falsify it, including a prior result that argues against the naive version of the idea.

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
