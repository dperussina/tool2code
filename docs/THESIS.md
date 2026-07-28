# The claim, and what would falsify it

**A tool catalogue expressed as code is called more accurately than the same catalogue
expressed as JSON Schema.** Not more cheaply — more *accurately*. Size is a side effect here,
and where the two conflict, accuracy wins.

The baseline to beat is therefore **raw JSON schemas, passed straight to the provider**. That
is the thing every agent does today, and it retains the provider's own constrained decoding,
which is a real advantage this project gives up. If code representation does not beat raw
schemas on task completion, there is nothing here.

## Starting from a falsified prior

This is a second attempt, and the first one produced a result that argues *against* the naive
version of this thesis. A predecessor project measured 4,031 live runs across four frontier
providers and shipped a level that compiled a whole catalogue into minified Python. On a
sequencing-heavy external corpus at n=45 it scored **64.4% against 71.1%** for a much smaller
representation that carried nothing but signatures — while costing 1,639 more tokens.

**More code did not mean more accuracy.** Any version of "represent tools as code" that
amounts to *more prose about each tool in a code-shaped wrapper* has already been tried and
lost. So the interesting question is not whether code is a nicer format. It is:

> Which facts does a model need to call a tool correctly that a JSON Schema **cannot express
> at all**?

## What the schema already gives you, and what it cannot

The predecessor also settled the argument-shape question, and it should not be relitigated
here. Across 144 runs on a suite built so that only shape could fail, **every malformed
argument came from a representation that omitted container types** — `[]`, `{}`, `k:a|b|c` —
and every one of those is derivable from the schema. Derive them and the failure disappears.
Asking a model to describe them does not.

So types are solved, and they were never the gap. What remains, measured, is two things:

1. **Selection among lookalikes.** Failures cluster in groups of tools whose names and
   parameters are nearly identical. What separates them is *purpose*, which a schema's
   `description` carries only as prose the model must weigh against every other prose blob.
2. **Sequencing.** A schema says `get_place_details` takes a `placeId: string`. It cannot say
   that the only way to obtain one is `search_places` first. The model either knows the
   workflow or invents an ID.

Sequencing is where a schema is not merely verbose but *structurally silent*, and it is where
code has a real advantage — because a call graph is exactly the thing code is good at
expressing and JSON is not.

## The first mechanism: derived identifier flow

`src/graph.ts` derives, with no model involved, which tool produces the identifier another
tool consumes. On the 149-tool corpus: **12 resolved edges, 18 marked exogenous**, out of 30
identifier parameters.

```
get_place_details.placeId    <-  search_places
coding_task_status.taskId    <-  coding_task_execute
gdrive_read_file.file_id     <-  gdrive_list_files, gdrive_upload_file
update_article.article_id    <-  create_article
```

**Refusing to answer is a feature.** `spreadsheet`, `folder`, `partner` and `service provider`
identifiers are produced by nothing in the catalogue — the caller already has them — and are
reported as exogenous rather than attached to the nearest plausible tool. Getting this wrong
is not a missed opportunity, it is an active defect: the predecessor shipped a map that told
the model to call `place_details_by_query`, a tool that did not exist, and the whole reason it
was a bug is that the model would obey.

Three heuristics were tried and rejected on real data before the current rule:

| rule | what it did wrong |
|---|---|
| substring match | `get_load_details.loadId <- gdrive_upload_file` — "load" inside "up**load**" |
| entity must come last | missed `coding_task_execute`, which really does produce `taskId` |
| verb adjacent to entity | admitted 7 producers for `orderId`, including `get_order_details` |

The surviving rule: the tool name must **end** with the verb-entity pair in either order, the
entity must match as whole words, and a tool that itself consumes that identifier is a peer
rather than a source. Every one of those clauses exists because a simpler version produced a
wrong edge, and each is pinned by a test naming the case.

## What has to be measured before any of this is a claim

Nothing above is evidence that accuracy improved. It is evidence that a mechanism exists and
does not lie. The measurement that matters:

- **Baseline**: raw JSON schemas, provider-native, with constrained decoding intact.
- **Metric**: task completion, plus two failure counts a schema baseline can also commit —
  called a tool with a fabricated identifier, and called tools out of order.
- **Scenarios**: sequencing-heavy by construction, the way the predecessor's shape suite was
  built so that only shape could fail. A suite where the baseline already scores 100% cannot
  show an improvement, and the predecessor wasted a round learning that.
- **All four providers, every time.** Every failure found in 4,031 prior runs was
  provider-specific and none was predictable by reasoning.
- **A 5% effect floor**, and never pooling separate sweeps.

## Rules carried over, because they were each paid for

- **Derived, never guessed.** If the schema contains it, compute it; do not ask a model.
- **A wrong pointer is worse than no pointer.** Precision over recall, and "unknown" is a
  valid answer.
- **Never average cost across providers** (one is ~10× the others), and never quote a figure
  without naming the sweep it came from.
- **Zero runtime dependencies** in the core, and no network call outside the benchmark.
