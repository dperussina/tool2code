# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

**Status: measured once, and the thesis lost.** Over 96 live runs on four frontier providers,
raw JSON Schema completed 96.9% against this library's 90.6% — 2 runs apart at n=32, so
directional rather than settled, but not support. Full numbers and the three measurement bugs
found along the way are in [`docs/RESULTS.md`](docs/RESULTS.md); the claim and what would
falsify it are in [`docs/THESIS.md`](docs/THESIS.md).

Two findings are more useful than the headline:

- **Every failure, in all three arms, was picking the wrong near-duplicate sibling.** Zero
  fabricated identifiers, zero out-of-order calls, zero failures to reach the target tool.
  Sequencing — the thing this project was built around — was already solved by every model.
- **The shorthand slots earn their place**: stripping them costs ~2 runs and doubles trap
  calls, so the semantics are doing work rather than decorating the code shape.

It costs about **4× fewer prompt tokens** than passing schemas, which is the trade actually on
offer.

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
