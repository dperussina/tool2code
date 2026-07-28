# tool2code

Represent a tool catalogue as **code**, so a model reads it the way it reads code — and calls
it more accurately.

The goal is accuracy, not compression. The baseline to beat is raw JSON Schema passed straight
to the provider, which is what every agent does today and which keeps the provider's own
constrained decoding — a real advantage this approach gives up and therefore has to earn back.

**Status: measured twice. Round 1 lost to the baseline; Round 2 beats it by 22 points.**

Over 180 live runs on four frontier providers (sweep `2026-07-28T18-32-04`):

| arm | strict | trap calls | prompt tokens (Anthropic) |
|---|--:|--:|--:|
| raw JSON Schema (baseline) | 75.0% | 8 | 261,435 |
| **tool2code** | **97.2%** | **1** | **61,900** |
| tool2code, semantics stripped | 72.2% | 10 | 55,299 |

**4× fewer prompt tokens and 22 points more accurate.** The third row is the important one: the
same module with the model-written semantics removed scores the same as the baseline, so the code
*shape* is worth nothing and the whole gain is the semantic slots — above all `vsX(why)`, which
states what a tool is **not**. Trap calls, the only failure mode this corpus produces, fell from 8
to 1.

The honest limit: the scenarios and the mechanism were both derived from my reading of the same
corpus, which risks teaching to the test. Full numbers, the four measurement bugs found along the
way, and what would falsify this are in [`docs/RESULTS.md`](docs/RESULTS.md) and
[`docs/THESIS.md`](docs/THESIS.md).

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
