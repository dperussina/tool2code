# What to do next, in order of information per dollar

This file exists because the first five rounds were run in the wrong order, and the cost was real.

## The mistake, stated plainly

**Elaborate-then-ablate.** The project's load-bearing question — does rendering a catalogue as code
improve accuracy? — was answerable on day one with two arms and roughly forty runs. Instead the
Python renderer, a shorthand DSL, a glossary, cluster detection, contrast slots, nested `TypedDict`
shapes and return types were all built first, and the ablation (`text_slots`) ran in Round 5. It
returned **0.0 points for the code form**.

Three components died to measurements that could have been taken before building them:

| built | measurement that made it moot |
|---|---|
| `graph.ts` producer inference — a file, four heuristic iterations, its own tests | sequencing had **0 failures** in every arm on every provider |
| nested shape typing (`shapes.ts`) | argument construction was already 11–12/12 for every arm, baseline included |
| the `restraint` scenario category | its premise was false; deleted after a sweep |

`shapes.ts` still earns its place — it repaired a `list[dict]` defect the renderer had introduced —
but as a fix, not as an advantage. It was built as an advantage.

Worse, `THESIS.md` had already written down two of the traps: that a suite the baseline aces cannot
show an improvement, and that scenarios must not share an author with the mechanism. Both were then
walked into.

## The rule

**Cheapest discriminating experiment first. Ablate before you elaborate.**

Before building any component, name the measurement that would make it pointless, and run that
measurement first. Before believing any component, remove it and re-measure.

Concretely, for this project that means every new idea gets an arm with the idea *absent* in the
same sweep — `code_no_slots` and `text_slots` are the two that have paid for themselves, and both
were added late.

## Queue, highest information per dollar first

### 1. Does the result survive a suite I did not write? — RUNNING

Sweep `gen-2026-07-29T01-48-55`, 252 runs, 21 model-generated scenarios on the badly-structured
corpus. This is the deepest validity gap: the hand-written suite's traps and the `vs` slot came from
the same reading of the same corpus.

**If the gain collapses, everything below is moot** and the honest write-up is "taught to the test".
Nothing else should be built until this reports.

Already informative: the generator **declined to separate `cost_of_sales` from `get_cost_of_sales`**
— the pair `disc-cos-query` was hand-written for, and the scenario that drove the Round 4 fix. If
that task had no single right answer, part of Round 4's story rests on a bad scenario.

### 2. A second corpus, from a different organisation

Everything measured so far descends from one 149-tool logistics catalogue and its degraded twin.
The 15 lookalike clusters are that company's naming convention. A catalogue with no such pairs
should show ~0 gain, and `diagnose()` predicts that — but the prediction is untested.

Cheapest version: a public MCP server's tool list, `diagnose()`, then a sweep only if it reports
clusters. Do not build anything new for it.

### 3. Can the coding-strength claim be tested at all?

Round 6 was underpowered and the suite is the reason: **Haiku 4.5 scored 11/12 on raw schemas where
Opus scored 10/12.** Every arm saturates, so capability effects are invisible.

This needs a suite that is hard for a small model — likely the generated suite (which already
produces failures the hand-written one never did) plus more reps, not a new mechanism. Test before
building.

### 4. Reps on the comparisons that are still one or two runs wide

`tool2code` versus `text_slots` is 46/48 against 46/48. `tool2code` versus the previous artifact was
47/48 against 45/48. Neither is resolvable at n=48; both are cheap to deepen once the suite is
trusted.

## Not on the queue, and why

- **More renderers or formats.** Format measured at 0.0. Adding a third is elaboration.
- **Retrieval, ranking, tool-subsetting.** Plausible, unmeasured, and would need its own baseline
  before any of it is worth writing.
- **Anything that improves a number the baseline already saturates** — argument construction and
  sequencing are both at ceiling for every arm.

## Standing discipline that has paid off, and stays

- Never pool sweeps; a comparison is only valid inside one.
- Read the raw rows before believing a table. Eight instrument bugs came out that way, every one
  mine, one of which would have shipped a false public finding.
- State the prediction before the sweep. Round 4 did, and that is why it is credible.
- A uniform result across every arm is almost always the instrument, not the models.
