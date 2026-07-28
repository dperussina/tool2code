# Results

Every figure here names the sweep it came from. Reproduce with
`npx tsx bench/analyze.mts --sweep=<id>`. Raw JSONL in `bench/results/` is evidence and is
never edited in place.

---

## Round 1 — the thesis does not survive first contact

Sweep `2026-07-28T15-18-17`. 108 runs: 4 providers × 3 arms × 9 scenarios × 1 rep.
**96 runs analysed**, one scenario excluded as invalid (see below).

### Headline

| arm | n | completed | fabricated ID | out of order | avg turns |
|---|--:|--:|--:|--:|--:|
| `schemas` (baseline) | 32 | **96.9%** (31/32) | 0 | 0 | 3.5 |
| `tool2code` | 32 | **90.6%** (29/32) | 0 | 0 | 2.9 |
| `code_no_slots` | 32 | **84.4%** (27/32) | 0 | 0 | 3.0 |

**Raw JSON Schema won.** Representing the catalogue as code did not improve accuracy on this
suite; it came 2 runs behind. The project's own thesis document named this outcome as the one
that would falsify the idea, and at n=32 it is directional rather than settled — 2 runs is not
a result — but it is certainly not support.

The predecessor project measured the same ordering by a different route: a compiled Python map
scored 64.4% against 71.1% for a representation carrying only signatures. Two projects, two
corpora, same direction. That is worth taking seriously.

### Where the difference actually is

**Every single failure — all 9 of them, across all three arms — was a discrimination failure.**

| failure mode | count |
|---|--:|
| called the wrong near-duplicate sibling | **9** |
| fabricated an identifier | 0 |
| called tools out of order | 0 |
| never reached the target tool | 0 |

Sequencing was solved by every arm on every provider. That matters more than the headline,
because **identifier flow is what this project was built around.** The `!X` slot — "call this
first" — bought nothing measurable, not because it is wrong but because nothing was failing
there. Four frontier models, given 149 tools, reliably search before they fetch.

So the remaining accuracy gap is entirely **selection among lookalikes**: `order_notes` (bulk
CSV export for warehouse sync) against `get_order_notes` (one order by tracking number), and
`cost_of_sales` against `get_cost_of_sales`.

### The shorthand slots do help — within the code approach

`code_no_slots` is `tool2code` with the model-written shorthand stripped and identical derived
signatures. It is the control that stops the code shape and the semantics being credited to
each other.

| arm | strict | reached target, no fabrication | trap called |
|---|--:|--:|--:|
| `schemas` | 31/32 | 31/32 | 1 |
| `tool2code` | 29/32 | 31/32 | 3 |
| `code_no_slots` | 27/32 | **32/32** | 5 |

The slots are worth roughly two runs and two fewer trap calls. An earlier sweep
(`2026-07-28T14-53-43`) pointed the same way, 75.0% against 70.8%. Two small sweeps agreeing on
direction is weak evidence, but it is consistent evidence, and it says the shorthand is doing
work rather than decorating.

Read the two gradings together and the shape is clear: under the lenient grading **all three
arms are equivalent** (31, 31, 32). Nothing failed to accomplish the task. What separates the
arms is how often they *also* called the tempting wrong sibling — 1, 3, 5. The code arms are
not worse at the job; they are worse at not being tempted.

### Cost, stated per provider because these differ ~10×

Mean prompt tokens per run:

| provider | `schemas` | `tool2code` | `code_no_slots` |
|---|--:|--:|--:|
| anthropic | 276,957 | 66,696 | 51,423 |
| gemini | 136,998 | 34,425 | 30,891 |
| openai | 186,486 | 41,175 | 40,010 |
| xai | 203,173 | 51,409 | 39,568 |

About **4× fewer prompt tokens** for 6pp less accuracy. This project is not about size, so that
is not a defence — but it is the trade on offer, and for a 149-tool catalogue it is not a small
one.

---

## What was wrong with the measurement, three times

The instrument was wrong more often than the models were. Each of these was found by
inspecting a result that looked like a model failure and was not.

**1. Gemini scored 0/6 on every arm** in the first sweep, with
`Cannot read properties of undefined (reading 'create')`. Not a model result: the project had
no `@google/genai` devDependency, so Node resolved an older copy from a home directory that
lacks `interactions.create`. All four SDKs are now pinned locally.

**2. The first scenario set had no headroom.** Baseline scored 100% on every provider that ran,
because the prompts named the tool: *"the chronological history of status changes — not the raw
scan events, the timeline"* hands over the answer and rules out the rival. Rewritten to
describe what a person wants.

**3. A `restraint` category was designed and deleted.** The premise — an identifier nothing
produces, where the right answer is to say so — was false. Both arms "failed" by calling
`search_customers` first, which that tool's own description invites: it returns customer details
and exists "to find customers by name, ID". A Sheets ID is likewise a Drive file ID reachable
via `gdrive_search_by_name`. Every identifier in this corpus has a discovery route, so the
metric would have scored good judgement as failure.

**4. `seq-scorecard` was unsatisfiable, and is excluded from every figure above.**
`get_customer_scorecard.partnerId` is `type: "number"` ("e.g., 737") and *optional*, while the
mock issued the string `partner_5QN8`. Every model correctly sent a number; the grader called
every one wrong, and the baseline's 0/4 was entirely the instrument's fault. Ten identifier
parameters in this corpus are numeric; sentinels are now type-correct and compared as text.

The pattern is worth stating plainly: **four apparent findings, and three of them were bugs in
the measurement.** A benchmark that has not been attacked this way is not evidence.

---

## What this round does not establish

- **n=32 per arm.** Differences of 2–4 runs. Enough to rule out a large effect, not enough to
  resolve a 6pp one. Reps are the obvious next spend.
- **One rep, one corpus.** 149 real MCP tools from one organisation, with a naming convention
  (`x` for bulk export, `get_x` for single lookup) that creates the only failure mode observed.
  A catalogue without those pairs would show nothing at all here.
- **Discrimination is untested at scale.** Four trap pairs exist in this corpus and two of them
  produced every failure. That is a narrow base.
- **No long-session test.** Cumulative occupancy across many turns is where a 4× prompt
  reduction would compound, and it is unmeasured.
