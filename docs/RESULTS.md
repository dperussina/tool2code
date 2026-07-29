# Results

Every figure here names the sweep it came from. Reproduce with
`npx tsx bench/analyze.mts --sweep=<id>`. Raw JSONL in `bench/results/` is evidence and is
never edited in place.

---

## Round 6 — the weak-model question, and the seventh instrument bug

Sweep `weak2-haiku`. 48 runs, Haiku 4.5, badly-structured corpus, same twelve scenarios.

The goal this project serves claims models "really great at coding" leverage a typed interface
better. Four frontier providers cannot test that — they are all strong, so a constant advantage
across them is equally consistent with the code form doing nothing. A materially weaker tier
separates the two.

| arm | completed | discriminate | arguments | sequence |
|---|--:|--:|--:|--:|
| `schemas` | 11/12 | 6/7 | 3/3 | 2/2 |
| `tool2code` | 12/12 | 7/7 | 3/3 | 2/2 |
| `text_slots` | 11/12 | 6/7 | 3/3 | 2/2 |
| `code_no_slots` | 11/12 | 6/7 | 3/3 | 2/2 |

**Underpowered, not answered.** All four arms sit within one run. And the suite cannot settle the
question at all, because it does not discriminate by capability: **Haiku scored 11/12 on raw
schemas where Opus scored 10/12.** Every arm saturates. Answering the coding-strength claim needs
a harder suite, not more repetitions of this one.

### The finding this round nearly produced

The first attempt reported Haiku at 8/12 with the Python module against 12/12 with the same
semantics in English, and **0/2 on sequencing**. That is a clean story with a plausible mechanism:
a compressed shorthand needs decoding capacity a small model lacks. It was wrong.

Both arms called the identical tools in the identical order. The raw provider payload, which the
harness had not been recording, shows the difference:

```
tool2code   call(name, placeId, fields)   <- flattened beside `name`
text_slots  call(name, args)              <- nested
```

`resolve()` read `args.args`, found nothing, and recorded an argument-free call. The model supplied
`placeId` correctly and the harness discarded it. Four such runs turned a 12/12 into an 8/12.

Worse, the two arms' instructions differed — `text_slots` said "an object of arguments",
`tool2code` said "its function name and arguments" — so the comparison was between two phrasings
of my own prompt.

Three fixes, one of which is a real feature rather than a benchmark repair:

- **`readArgs()` treats any key that is not `name` as an argument.** A dispatcher in production
  meets flattened arguments too, and silently dropping a correct call is the worst available
  behaviour. Seen on 2 of 57 calls in the corrected sweep — rare, and decisive when it happens.
- The code arm's instruction now names `name` and `args` explicitly.
- **`rawCallShapes` is recorded on every run**, so "the model sent nothing" and "the harness
  dropped it" can never look identical in a results table again.

Also fixed: `output_config.effort` is sent only to models that accept it. Haiku returns
`400 This model does not support the effort parameter` and every run died at turn 0 — a
provider-config error wearing the costume of a model failure, the same shape as Gemini's fake 0/6
in Round 1.

### Seven instrument bugs, all mine

Gemini's missing dependency. Prompts that named the answer. An unsatisfiable `restraint` category.
A string sentinel against a numeric schema. Prompt-supplied identifiers scored as fabricated.
Sentinels invisible after renaming. A resolver discarding real arguments.

Every one was found by refusing to accept a number that looked like a model failure. The +12.5
point semantics result survived that same scrutiny across five sweeps, once against a prediction
stated in advance, which is the reason to believe it and not the others.

---

## Round 5 — the code form contributes nothing; the semantics contribute everything

Sweep `messy2-2026-07-29T00-40-15`. 192 runs on the **badly-structured** corpus: 0 declared
types, 0 declared enums, 0 `required` markers, names like `apiV2CostOfSalesGet`.

`text_slots` is the experiment this project needed and had been avoiding: the **same compiled
semantics**, the same dispatcher, the same one `call` tool, rendered as an indented English list
with no `def`, no type annotations, no `TypedDict`, and no glossary to decode.

| arm | n | completed | discriminate | arguments | trap calls | trap first |
|---|--:|--:|--:|--:|--:|--:|
| `schemas` (baseline) | 48 | 83.3% (40/48) | 21/28 | 11/12 | 7 | 2 |
| `tool2code` (Python) | 48 | **95.8% (46/48)** | 26/28 | 12/12 | 2 | 0 |
| `text_slots` (English) | 48 | **95.8% (46/48)** | 26/28 | 12/12 | 2 | 0 |
| `code_no_slots` (Python, no semantics) | 48 | 83.3% (40/48) | 20/28 | 12/12 | 8 | 2 |

**Compiled semantics: +12.5 points. The code form: 0.0 points.**

The two are identical on every axis, and they do not even fail on the same runs — `tool2code` lost
`xai/disc-notes-single` and `xai/disc-cust-find`, `text_slots` lost `anthropic/disc-notes-single`
and `xai/disc-cust-find`. One overlap out of two apiece is noise in both directions, not a
concealed advantage.

From the other side, `code_no_slots` — a fully typed Python module with the semantics stripped —
scores **exactly** the raw-schema baseline for the third sweep running, and on this corpus its
discrimination is marginally *worse* (20/28 against 21/28).

### What this means for the thesis

The founding claim was that **a tool catalogue expressed as code is called more accurately than
the same catalogue expressed as JSON Schema.** That claim is now falsified in its own terms. What
is true is narrower and different:

> A catalogue whose tools have been **read once by a strong model and annotated with what each
> returns and what it must not be confused with** is called more accurately. The format those
> annotations arrive in does not matter.

The project is a **compiled-disambiguation** product. Python is one delivery format.

### What the code form is still worth, on grounds other than accuracy

None of this is an argument for deleting the renderer, but the reasons are now honest ones:

- **It is verifiable.** The output is parsed with a real Python parser in the test suite, which
  caught two defects prose never would have: a required parameter emitted after an optional one,
  and `def f(**{"from":None})`, which is a `SyntaxError` despite `**{...}` being legal in a call.
- **Types are derived rather than described.** `filters:list[Filter]` with an eleven-value
  operator enum comes from the schema; the English rendering has to spell the same thing out in
  prose, which is exactly where a model would be tempted to paraphrase.
- **It is deterministic and diffable**, so a compiled artifact can be reviewed and cached.
- **The repair pipeline feeds both.** The semantics `text_slots` uses were compiled by a model that
  could see recovered types, nested shapes and prose-recovered enums. Strip that and both arms get
  worse — the shape work is upstream of the win, not an alternative to it.

### What genuinely moved on the badly-structured corpus

Against the same suite on the clean corpus, the baseline fell from 97.9%-competitive to 83.3%,
while `tool2code` held at 95.8%. Repair is doing real work: **101 of 101 enums recovered from
English prose, deterministically, with zero false positives**, and 90.2% of inferred types exactly
right against ground truth with 9.2% honest `Any` and 0.6% wrong.

Argument construction finally separated, if barely — 11/12 for the baseline against 12/12 for
every arm carrying recovered structure.

### Still open

- **Coding strength as the mechanism is untested.** Four frontier models cannot distinguish
  "code helps coding-strong models" from "code does nothing", because they are all strong. A
  weaker tier is now runnable via `ANTHROPIC_MODEL`.
- **One rep per cell.** 46/48 against 40/48 is a 6-run gap; 46 against 46 is a tie that more reps
  could still separate, though nothing suggests they would.
- **One corpus, and its degraded twin.** Both descend from the same 149 tools.

---

## Round 4 — a diagnosis, a prediction, and a confirmation

Sweep `2026-07-28T22-29-40`. 192 runs: 4 providers × 4 arms × 12 scenarios × 1 rep.

`tool2code_prev` is the previous compiled artifact, run as its own arm **in the same sweep**.
Comparing two artifacts across two sweeps is exactly the pooling this project forbids — different
scenarios, different day — so the only honest way to measure a prompt change is side by side.

| arm | n | completed | trap calls | trap first | malformed | avg turns |
|---|--:|--:|--:|--:|--:|--:|
| `schemas` (baseline) | 48 | 83.3% (40/48) | 7 | 4 | 0 | 2.7 |
| **`tool2code`** | 48 | **97.9% (47/48)** | **1** | **0** | 1 | 2.3 |
| `tool2code_prev` | 48 | 93.8% (45/48) | 3 | 0 | 0 | 2.3 |
| `code_no_slots` | 48 | 83.3% (40/48) | 8 | 2 | 0 | 2.6 |

Per provider: **100% on Anthropic, Gemini and OpenAI**, 91.7% on xAI, against a baseline of 75.0%,
100%, 83.3% and 75.0%.

### The prediction, and what it was based on

Round 3 left three `tool2code` failures, two of them on `disc-cos-query`. Rather than add
repetitions, one JSONL row was read in full. The model called the bulk export first, then
recovered. The cause was in the artifact, not the model:

```
source:   "Get detailed cost of sales data for a date range with optional filters.
           Includes freight costs, carrier charges, and heatmap visualization data.
           ... Results are offloaded to files and returned as manifest with batch metadata."

compiled: ">file manifest of batched cost rows with batch metadata and aggregated heatmap data"
```

The compiler kept the sentence about **delivery** and dropped the one about **subject matter** —
so a request for "what did freight and carrier charges come to" had nothing to match, while the
baseline's full description still said "freight costs, carrier charges" outright. On that
scenario the compiled artifact was strictly worse-informed than raw JSON Schema.

The fix was one prompt rule: **lead with what the data is about, put delivery mechanism last.**
The recompile produced:

```
">freight costs and carrier charges per invoice for a date range, filterable to one partner,
  company, customer or invoice number, delivered as batched offload files plus heatmap totals"
```

The prediction recorded before the sweep was that `disc-cos-query` would improve from 2/4 and
that `tool2code_prev` would reproduce the old number. Result:

| scenario | `schemas` | `tool2code` | `tool2code_prev` | `code_no_slots` |
|---|--:|--:|--:|--:|
| disc-cos-query | 2/4 | **4/4** | 2/4 | 1/4 |

Both arms carrying the old line failed on the same scenario; the arm differing by one docstring
did not. That is a mechanism confirmed against a prediction, not a number found afterwards.

### What has stopped mattering

| kind | `schemas` | `tool2code` |
|---|--:|--:|
| discriminate | 25/28 | **27/28** |
| arguments | 11/12 | 12/12 |
| sequence | 8/8 | 8/8 |

Argument construction and sequencing are saturated for every arm, including the baseline. The
nested-shape typing added in Round 3 was **repair of a self-inflicted defect** — the renderer had
been emitting `list[dict]` for a filter DSL — not an advantage over raw schemas. Frontier models
handle a declared schema perfectly well. Everything that separates the arms is disambiguation.

### The one remaining failure

`xai` on `disc-cust-find`, and it is not a wrong decision — it is thrashing:

```
search_customers > search_customers > customers > customers > search_customers > customers >
customers > search_customers > customers > customers > search_customers > get_customer_details >
search_customers > customers
```

Fourteen calls alternating between the right tool and the trap. xAI has been the weakest provider
on discrimination in every round; the contrast slot did not stop it oscillating.

### Cost

| provider | `schemas` | `tool2code` |
|---|--:|--:|
| anthropic | 224,894 | 83,445 |
| gemini | 133,588 | 43,298 |
| openai | 139,725 | 44,189 |

Roughly 3× fewer prompt tokens. Secondary to the goal, and the corrected artifact is 37% larger
than the one it replaced (23,834 → 32,675 chars) — bought deliberately, for specificity.

### Still open

- **One rep per cell.** 47/48 against 40/48 is a 7-run gap and safe; the 47-versus-45 comparison
  with the previous artifact is 2 runs and is not, even though the per-scenario mechanism is clear.
- **The suite is still mine.** Scenarios and mechanism came from the same reading of the corpus.
- **Untested on a badly-structured catalogue**, which is the actual target: `bench/degrade.ts`
  builds one (0 declared types, 0 enums, 0 required markers, names like `apiV2CostOfSalesGet`) and
  nothing has been run against it yet.

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
