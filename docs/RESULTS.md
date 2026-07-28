# Results

Every figure here names the sweep it came from. Reproduce with
`npx tsx bench/analyze.mts --sweep=<id>`. Raw JSONL in `bench/results/` is evidence and is
never edited in place.

---

## Round 2 — the contrast slot wins, and the code shape is worth nothing without it

Sweep `2026-07-28T18-32-04`. 180 runs: 4 providers × 5 arms × 9 scenarios × 1 rep. Seven
discrimination scenarios over seven trap pairs, two sequencing scenarios as a regression check.

Round 1's scenario set was easier, so **the baseline's own score moved** (96.9% → 75.0%) and the
two rounds must not be compared. Everything below is within this sweep.

### Headline

| arm | n | strict | lenient | trap calls | mean turns |
|---|--:|--:|--:|--:|--:|
| `schemas` (baseline) | 36 | 75.0% (27/36) | 32/36 | 8 | 2.9 |
| `schemas_lean` | 36 | 66.7% (24/36) | 34/36 | 12 | 3.0 |
| `hybrid` | 36 | 91.7% (33/36) | 34/36 | **1** | 2.4 |
| **`tool2code`** | 36 | **97.2% (35/36)** | **36/36** | **1** | 2.4 |
| `code_no_slots` | 36 | 72.2% (26/36) | 35/36 | 10 | 2.9 |

**The code representation now beats raw JSON Schema by 22 points**, and it wins under the lenient
grading too (36/36 against 32/36) — which Round 1's result did not. It also uses fewer turns.

### The attribution is clean, and it is not the code

`code_no_slots` is the same module with the model-written semantics stripped: identical derived
signatures, identical calling convention. It scores **72.2%, statistically indistinguishable from
the baseline's 75.0%**, with 10 trap calls against the baseline's 8.

So the code shape, on its own, is worth nothing. The entire 22-point gain is the semantic slots —
above all `vsX(why)`, which states what a tool is *not*:

```python
def get_order_notes(trackingNumber:TrackingNumber):
    "r >notes on one order vsorder_notes(bulk note/communication feed for Control Tower sync)"
def order_notes(date_column:...,csv_path:str=None):
    "r >bulk note/communication rows... vsget_order_notes(notes for one order by tracking number)"
```

The single number that matters: **trap calls fell from 8 to 1.** Every arm without contrast slots
sits at 8–12; both arms with them sit at 1. That is the mechanism working, measured directly, and
it is the only failure mode this corpus produces.

Two scenarios show it starkly. `disc-cust-find` (`search_customers` against the `customers` bulk
export) went 1/4 on the baseline and 4/4 with slots. `disc-loc-live` went 1/4 to 4/4.

### Prose carries real signal — and the module replaces more than it

`schemas_lean` is the baseline with every `description`, `title` and `example` stripped and all
types, enums and required lists intact. It drops to 66.7% with 12 trap calls, so the English in a
tool definition is not decoration.

But the module beats *full* prose, not just its absence. The discriminating fact exists in the
source descriptions — `order_notes` says "data source for syncing into Control Tower" — and the
baseline has it. What the baseline does not do is put it **where the choice is made**, one line
long, beside the tool it distinguishes. Condensation is the win, not new information.

### A hypothesis of mine that the data refuted

I expected the dispatcher to be a handicap: `tool2code` routes every call through one generic
`call(name, args)` tool, giving up the provider's native tool selection and constrained decoding.
`hybrid` was built to remove that confound — native tools with pruned schemas *plus* the module.

It scored **91.7% against `tool2code`'s 97.2%, for 2.5× the prompt tokens** (156,726 against
61,900 on Anthropic). Two runs apart is not a real difference in accuracy, but the token cost is
unambiguous, and the direction is the opposite of what I predicted. Carrying the schemas
alongside the module buys nothing. **The dispatcher was not the handicap.**

### Cost, per provider because these differ ~10×

Mean prompt tokens per run:

| provider | `schemas` | `schemas_lean` | `hybrid` | `tool2code` | `code_no_slots` |
|---|--:|--:|--:|--:|--:|
| anthropic | 261,435 | 102,486 | 156,726 | **61,900** | 55,299 |
| gemini | 126,810 | 59,513 | 86,746 | **31,791** | 30,957 |
| openai | 137,389 | 45,211 | 80,096 | **38,314** | 33,826 |
| xai | 201,334 | 107,634 | 117,446 | **43,523** | 39,608 |

**About 4× fewer prompt tokens and 22 points more accurate**, on every provider.

### The limitation that matters most

**The scenarios and the mechanism were derived from the same reading of the corpus.** I found the
bulk-export-versus-single-lookup pattern, wrote prompts that target it, and then built a slot that
states exactly that distinction. That is a real risk of teaching to the test, and it is not
answered by more reps.

What would answer it: trap pairs and prompts written by someone who has not seen the compiled
module, or a second corpus from a different organisation. Until then the honest claim is narrow —
**the contrast slot fixes the confusions I was able to identify**, which is weaker than "fixes
lookalike confusion".

Also unresolved:

- **One rep per cell.** 36 runs per arm; a 22-point gap is 8 runs and safe, but the
  `tool2code`-versus-`hybrid` difference is 2 runs and is not.
- **Six of seven trap pairs are the same shape** (bulk feed against per-entity lookup). One
  pattern, repeated.
- **`get_order_notes` compiled as `?trackingNumber`** — "yours to supply" — when
  `quick_search_orders` produces one. Wrong, and harmless only because sequencing never failed.
- One `gemini`/`hybrid` run died on provider-side invalid JSON and is counted as a failure.

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
