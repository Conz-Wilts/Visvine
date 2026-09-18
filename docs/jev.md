# Jev in Visvine — where a fast judge changes the product

A review of every place in the app that makes a judgement, what Jev (TypeSafe's
System One model) would change there, ranked by impact, plus the new things a
cheap judge makes possible. Researched 2026-09-19 against Jev 1.13 and the code
as it stands.

## 1. What Jev is, in the terms that matter here

Jev does not write text. It reads a `state` (text or JSON) and answers typed
questions about it, each with a probability:

| Primitive | Asks | Returns |
| --- | --- | --- |
| `noul` | Is this statement true of the state? | one number, 0–1 |
| `choice` | Which of these options (up to 255)? | the option, a probability for every option, a confidence |
| `score` | Where on this ordered rubric? | a position, probabilities, a confidence |

One request carries one state and a map of many questions.

Facts from TypeSafe's own docs:

- **API**: `POST https://api.typesafe.ai/v1/systemone`, bearer key, plain JSON. A JS SDK exists; plain `fetch` is enough.
- **Price**: $0.042 per million input tokens. Output is free.
- **Speed**: 70–500 ms per request (their figure).
- **Limits**: 64k tokens a request, 32k for `state`. 1,200 requests a minute and 250k tokens a second, both "adjusting dynamically".
- **Data**: not trained on customer requests. Zero retention is enterprise-only, on request.
- **Status**: early access. English first; other languages less accurate.

Where it is weak, again from their own jaggedness page:

- Dates and numbers. It reads a date as text, not as a point in time, and cannot count or compare quantities.
- Anything multi-hop or needing inferred intent. It is literal.
- Long, noisy state. Accuracy drops as irrelevant detail is added.
- Adversarial text. It is not resistant to prompt injection.
- Instructions that disagree with their criteria.

Their measured results, for calibration: BM25 top-1 went 5% → 18% and top-10 38% → 62% on a legal retrieval set by reranking a 30-passage shortlist, for $0.06 per 1,200 calls. Agent skill selection over 182 skills made 2.3× fewer wrong loads. Both are vendor numbers on vendor-chosen sets.

### What that means for us

Visvine makes hundreds of small judgements. Today each one is either **a rule we
hard-coded** (a cosine floor of 0.55, "the first four words match", "the title
appears in the text", "the glob matches") or **a chat-model call we ration**
because it costs seconds and money (the reranker is off; memory extraction is 50
notes a night). Jev is a third option: a judgement that reads meaning, costs
almost nothing, and returns a number we can threshold. Every item below is one
of those two kinds being replaced or backed up.

It is a judge, never an author and never a gate on authority. Writing claims,
summaries and notes stays with the chat model. Permissions, perimeters and scopes
stay in code.

## 2. The ranking

Ranked by what the product gains, weighed against effort and risk. Details for
each follow in section 3.

| # | Change | Area | Gain | Effort |
| --- | --- | --- | --- | --- |
| 1 | Relevance filter after fusion, with an honest "nothing here answers this" | Search | Very high | Small |
| 2 | Wake gate: is this save relevant to this agent's brief? | Agents | Very high (money) | Small |
| 3 | Semantic contradiction and duplicate verdicts on the pairs clean already finds | Clean | High | Medium |
| 4 | Check before write: does a note already say this? | Writing | High | Medium |
| 5 | Verify derived memories; skip re-extraction when meaning did not change | Embed / memories | High | Medium |
| 6 | Claim-level truth maintenance: a newer claim retires an older one | New | High | Large |
| 7 | Veto on auto-linked mentions; pick the target for ambiguous ones | Clean | Medium-high | Small |
| 8 | Skill and recipe selection by meaning, keywords as fallback | Agents / MCP | Medium-high | Small |
| 9 | "Said it did" vs "did it": check a run's final message against its trace | Agents | Medium-high | Small |
| 10 | Widen recall upstream once precision is handled downstream | Search | Medium | Small |
| 11 | One calibrated scale for cross-space search | Search | Medium | Small |
| 12 | Durability score replaces the blanket 180-day stale rule | Clean | Medium | Medium |
| 13 | Trim fetched pages and tool output to the lines that matter | Agents | Medium (tokens) | Medium |
| 14 | Injection signal on everything untrusted an agent reads | Agents / connectors | Medium | Small |
| 15 | Type, folder and tag suggestions for a new note | Writing | Medium | Small |
| 16 | Fill tracked select fields from the note's prose | Directory | Medium | Medium |
| 17 | Rank same-name identity suggestions | Identity | Medium | Small |
| 18 | Implied services in a brief's needs | Agents | Low-medium | Small |
| 19 | Default allow / ask / deny proposals for MCP tools | Connectors | Low-medium | Small |
| 20 | Gate the query rewrite and the link-reason call | Search / links | Low | Small |
| 21 | Run outcome classification for the roster | Agents | Low | Small |

Do 1 and 2 first. They are small, independent, and each proves a different half
of the case: 1 proves quality, 2 proves cost.

## 3. Each change

### 1. Relevance filter after fusion — and abstention

**Today.** `fusedSearch` (`lib/notes/shared/retrieval.ts`) fuses six stages by
rank and returns the top `k`, always. There is no way for a search to say
"nothing in this space answers that": a query with no good match still returns
ten results, and an agent reads them as evidence. The one precision stage,
`rerankHead`, reorders and never drops, reads only 600 characters per
candidate, costs a full chat round trip, and is off unless
`CONTEXT_RERANK=llm` (`lib/notes/rerank.ts`).

**With Jev.** Keep the `Reranker` seam, add a Jev implementation that scores the
over-fetched head pointwise and in parallel. Per candidate, state is
`{ query, passage: { title, heading, text } }` using the hit's `claim` or
`passage` — the answer-sized text the chunk and memory stages already keep —
with two nouls:

- `is_relevant` — does this passage address the subject of the query?
- `has_answer` — does it state information usable in a direct answer?

Then, in code: drop under a relevance floor, order by the judge's score times
the lifecycle weight (as `rerankHead` does now), return at most `k`.

**What changes for callers.** `search_context` may return fewer than `k` hits,
or none, with a field saying so (`answerable: false`). That is the largest
single behaviour change in this document: agents stop building answers on
noise. Each hit can carry its `relevance`.

**Care.**
- History queries (`plan.intent === 'history'`) and lifecycle: a superseded note
  is relevant by design. The judge scores relevance only; lifecycle stays the
  code's.
- Temporal-only plans skip the judge — there is no topic to judge against.
- Fail open. A timeout (bound it near 1.5 s), a 429 or a 529 leaves the fused
  order as it is, exactly as the chat reranker does today.
- Thirty candidates is thirty requests. At 1,200 requests a minute for the whole
  deployment that is a ceiling of 40 searches a minute. Two ways down: judge the
  top 12, not 30; or one coarse `choice` over all candidates in a single request
  first, then pointwise nouls on the survivors. Measure both.
- Cost: about 250 tokens a candidate, so a 30-candidate search is roughly
  $0.0003.

### 2. The wake gate

**Today.** `fireNoteTriggers` → `matchNoteTriggers` (`lib/agents/events.ts`)
wakes every active agent whose `on.context` glob matches the saved path. An
agent watching `subspaces/**` or `people/**` starts a paid model run for every
save under it, including typo fixes and saves about something else entirely.
Debounce coalesces bursts; nothing asks whether the change matters.

**With Jev.** One noul before a note-triggered run is claimed: state is the
brief's instructions (trimmed) plus the note's title and changed text;
the question is "does this change give this agent something to do?". Below the
floor the event is consumed and recorded as skipped, with the score.

**Where.** At the tick, when the event is about to become a run — not inside the
save. A save must never wait on or fail because of a judge, and the tick is
already a request on a clock, which suits the scale-to-zero rule.

**Care.**
- Fail open: no judge, no gate, the run happens.
- A brief may opt out (`wake: always`) for agents that must see every save.
- Only `note_written` events. Webhooks, replies, schedules and manual runs are
  a person's or a system's explicit ask.
- The skipped event shows on the agent's page as a step, so an admin can see
  what the gate declined and at what score. Silent drops would be undebuggable.

### 3. Contradictions and duplicates that read meaning

**Today.** `lib/notes/shared/review.ts`:

- `checkDuplicates` flags any pair with TF-IDF cosine ≥ 0.65. Word overlap, so
  two meeting notes from the same template look like duplicates and two notes
  saying the same thing in different words do not.
- `checkContradictions` compares frontmatter scalars, then lines that **open
  with the same four words** and differ in numbers, dates or negation. It
  catches "Budget for Q3 is $40k" vs "Budget for Q3 is $60k". It cannot catch
  "Ana owns the Acme account" vs "Sam took over Acme in June".
- Both only ever produce a worklist, and both run only in `full` mode. The
  nightly clean is `light`, so a space never learns about either unless someone
  runs a full clean by hand.

**With Jev.** `nearPairs` stays as the candidate generator (lower its floor —
see change 10). For each pair:

- a three-level `score` — different subject / related / same thing — in the
  shape of TypeSafe's entity-alignment cookbook, which needed no tuned
  threshold: only "same thing" becomes a duplicate issue;
- for related pairs, compare their **derived memories** (`context_memories`)
  rather than raw lines: claims are already one self-contained sentence each,
  which is exactly the input a noul wants — "do these two sentences disagree
  about the same fact?".

**Keep the mechanical check.** It is good at exactly what Jev is bad at:
numbers and dates. The two are complementary, and a pair flagged by both is the
strongest item on the worklist.

**What it unlocks.** A pass this cheap (a thousand pairs is a few cents) can run
nightly, in `light` mode, instead of on demand. Still worklist-only: resolving a
conflict is a judgement that belongs to a person or an agent with a brief.

### 4. Check before write

**Today.** Duplicates are created freely and discovered later, if ever.
`add_context` writes what it is given. The `writing_notes` guide tells a model
to search first; nothing checks that it did.

**With Jev.** On `add_context` (and the draft surface), run the fused search on
the new note's title and first paragraph, judge the top five with "is this note
about the same subject as the one being written?", and return the matches in
the action's response as `similar: [{ path, title, score }]` with the advice to
`append_context` instead. Never a refusal — the write still happens unless the
caller chose otherwise; a `check_only` argument lets an agent ask first.

This is cheaper than cleaning: a duplicate that was never written costs nothing
to merge.

### 5. Derived memories: verified, and extracted less often

**Today.** `memorySweep` (`lib/notes/memorySweep.ts`) asks the chat model for up
to 12 claims per note and stores whatever passes `coerceClaims`, which checks
shape only. Nothing checks that a claim is actually stated in the note. A
hallucinated claim is then ranked at weight 1 and returned to agents as
`claim` — "usually the answer", says the action's own description. Re-extraction
fires on any mtime change, capped at 50 notes a night, so a busy space falls
behind and a typo fix spends a chat call.

**With Jev.** Two checks, the pattern TypeSafe call a cascade (cheap model
extracts, judge verifies, only failures escalate):

- After extraction, per claim, state is the note body: "is this stated in the
  note?" and "does this sentence name its subject without needing the note?".
  Failing claims are dropped before they are stored.
- Before extraction, for a note whose mtime moved: "does the note still state
  each stored claim?" and "does it state a fact none of these cover?". All yes
  and no → restamp the rows to the new mtime and skip the chat call.

The second check is what lifts the 50-a-night ceiling in practice: most edits
are small.

### 6. Truth maintenance (new)

The lifecycle fields exist — `status`, `supersedes`, `superseded_by`, `expires`
(`lib/notes/shared/lifecycle.ts`) — and search already down-ranks a retired
note. But they are only ever set by hand. In practice nobody writes
`supersedes:`; they write a new note, and the old one goes on being retrieved
as present truth.

With claims as the unit and a cheap contradiction judge, the nightly pass can
notice it: a claim in a newer note contradicts a claim in an older note about
the same subject. Code, not Jev, decides which is newer (mtime or `date:`). The
output is a worklist item — "`decisions/pricing-2026.md` appears to replace
`decisions/pricing.md`: *'Pro is $49'* vs *'Pro is $39'*" — with the one-press
fix being the existing `linkSupersession`.

At query time the same judgement is cheaper still: when two of the top hits
contradict each other, say so in the result (`conflicts_with`) rather than
letting the caller pick one at random. TypeSafe's RAG cookbook routes such
passages into a separate "conflicting evidence" block for the same reason.

This is the change that most alters what the context IS: from a pile of notes
that are each individually true-when-written to a record that knows what it
currently believes.

### 7. Mentions: a veto, and a pick

**Today.** `checkUnlinkedMentions` auto-links any plain-text occurrence of a
note's title when exactly one note has that name. It is on the nightly
allow-list (`CLEAN_FIX_KINDS`), so it writes unattended. A person note titled
"Will" or a space record titled "Apple" links every "will" and "apple" in the
space. Ambiguous names go to the worklist with no suggestion.

**With Jev.** A noul on the containing block — "does this mention refer to
*<title, type, description>*?" — as a **veto** on the auto-fix: it can only
remove fixes, so it cannot make the clean less safe. For ambiguous names, a
`choice` among the candidates (plus "none of these") attaches a suggested
target and confidence to the worklist item.

### 8. Skills and recipes by meaning

**Today.** Both `lib/actions/shared/match.ts` (recipes, behind the MCP router's
`{ request }` mode) and `lib/agents/shared/skills.ts` (an agent's taught
skills) select by weighted keyword overlap. Deterministic and free, and blind
to a request that uses different words than the author predicted.

**With Jev.** A `choice` over the candidates' one-line summaries, plus "none
fits". This is TypeSafe's skill-suggestion cookbook nearly verbatim; their
result was 2.3× fewer wrong loads, with the warning that a wrong suggestion can
break a request that was fine without one — so keep a floor and prefer "none".

Everything the keyword matcher's header comment says stays true: the judge only
ranks candidates that exist, every action is resolved against the registry, a
recipe is advice and never authorization. Keywords stay as the fallback, so
deploy order and a missing key never decide whether the surface routes.

### 9. Said it did vs did it

**Today.** `narratedToolCall.ts` catches a model that wrote a tool call out as
text, by shape. It cannot catch a model that finishes with "I've updated the
note and emailed the summary" having called neither — a run recorded as a
success, and a false line in `memory.md`'s `Last run`.

**With Jev.** After a run, nouls over the final message — "does this claim to
have written or changed a note?", "…sent a message?", "…called an external
service?" — compared **in code** against the trace in `agent_runs.events`. A
claim with no matching step marks the run `unverified` and keeps its summary
out of memory. The trace is the truth; Jev only reads the prose.

### 10. Loosen recall upstream

**Today.** The floors are set for a pipeline with no precision stage:
`vectorStage.ts` drops cosine hits under 85% of the top and under 0.55
absolute; the link-context stage sits at weight 0.4 so neighbours do not
outrank real matches; alternates at 0.7; rerank window 30.

**With Jev.** Once something downstream removes the irrelevant, the upstream
stages should let more through: a lower absolute floor, a larger over-fetch, a
heavier link-context stage. Reranking cannot add what retrieval never found —
TypeSafe say so themselves — so this is where the recall gain is. Do it only
after change 1, and only against the eval.

### 11. One scale across spaces

`search_context` without a `space_id` runs in every space and folds the
rankings (`lib/actions/shared/everywhere.ts`). RRF scores from two different
corpora are not comparable: the best hit in a ten-note space ties with the best
hit in a ten-thousand-note one. A judged relevance is the same question asked
of every hit, so it is comparable by construction. Use it as the fold key when
present.

### 12. Durability, not a blanket 180 days

`checkStaleness` marks any note untouched for 180 days, and the clean has to
carve out entity and index notes by path so a directory of people is not
blanket-staled. The real question is what KIND of content it is. A three-level
`score` at write time — ephemeral (logistics, status updates) / working /
durable (a bio, a decision, a policy) — stored in frontmatter or a derived
column, lets staleness be per kind: weeks for ephemeral, never for durable. The
same value is a sensible retrieval weight.

### 13. Trim what an agent reads

`fetch_url` returns truncated page text; `read_context` up to 160k characters;
`run_connector` output up to 48k. All of it goes to the space's paid model.
TypeSafe's line-by-line cookbook scores up to 255 lines against a plain-language
query in one request, with a separate noul for "is the answer here at all".
Offered as an optional `find:` argument on `fetch_url` and `read_context`, an
agent gets the matching lines and their neighbours instead of the page.

### 14. An injection signal on untrusted text

Jev is explicitly **not** injection-resistant and this must never be a
boundary. The perimeter (`hosts:`, `allow:`, scopes, the machine's `taskAllow`)
stays the enforcement. As a signal it is still worth having: TypeSafe's RAG
cookbook scored a planted passage 0.99 while it ranked first by similarity. A
noul on fetched pages, connector output, inbound webhook payloads and — most
relevant to us — context read across a boundary (`subspaces/<id>/`, `parent/`,
the global space), stamped on the tool result as `risk`, and recorded in the
trace. It earns its place by making an attack visible afterwards.

### 15. Filing a new note

The node-type vocabulary is closed and the writable folders are a known list —
both are exactly a `choice`. On `add_context` with no `type:` or an unclear
path, return a suggested type, folder and tags with confidences. Same for the
draft surface's Type menu. Suggestion only; an agent may already only *suggest*
a new type in prose.

### 16. Tracked select fields from prose

A tracked field of kind `select` has closed options (`NodeTypeConfig.fields[]`).
"Stage: lead / customer / churned" can be read from a person or space note's
body as a `choice` with confidence, offered in the table cell as a suggestion a
person accepts. Never written unattended: a refused value is never stored as
text, and a guessed one should not be stored as data.

### 17. Same-name identities

`lib/identity/match.ts` auto-links on strong ids and name + company; Tier C
(same name only) is suggest-only, and `family.ts` gives up when two identities
share a name. A three-level `score` over the two records' context (company,
role, note excerpts) orders those suggestions and breaks family ties as a
suggestion. The auto-merge policy does not change: a wrong merge costs far more
than a missed one.

### 18–21. Smaller ones

- **Implied needs.** `needs.ts#mentions` finds catalogue services the
  instructions name. A noul per catalogue entry finds the ones they imply
  ("post it to the team channel"). A soft need only.
- **MCP tool defaults.** On the permissions screen, a `choice` per tool
  description — reads / writes / destructive — proposes `allow` / `ask` /
  `deny`. The admin still saves.
- **Rewrite gate.** `planSearch` spends a chat call on every query over three
  words. A noul — "would different wording find more?" — skips it for the
  literal ones. With change 1 in place, the gate could also run the other way:
  rewrite only when the first pass came back `answerable: false`.
- **Link reasons.** `linkReasons.ts` asks the chat model for a reason and
  accepts an empty string when there is none. A noul first — "does this passage
  say why they are connected?" — saves the call.
- **Run outcome.** A `choice` over a run's final message — done / partly done /
  blocked / nothing to do — for the roster and for `MAX_CONSECUTIVE_FAILURES`,
  which today counts only hard failures.

## 4. Where not to use it

- **Dates and numbers.** `queryPlan.ts` parses time deterministically and must
  keep doing so; expiry and supersession order stay in code; the numeric half of
  the contradiction check stays mechanical.
- **Authority.** No permission, scope, perimeter, write gate or tool policy
  verdict may depend on a judge's answer. A judge removes noise; it never grants
  reach. Anywhere its answer would widen what happens, it is a suggestion a
  person accepts.
- **Writing.** Claims, reasons, summaries, memory lines, notes.
- **Multi-hop questions.** "Who manages the person who ran the Acme event" is
  the agent's job across several searches.
- **Whole notes as state.** Accuracy drops with noise; feed it the chunk, the
  claim or the block, which we already have.

## 5. How to build it

**One seam: `lib/judge/`.** An interface with `noul`, `choice` and `score`, and
three drivers picked by env, the way `lib/gcs.ts` picks storage:

- `jev` — `fetch` to the TypeSafe endpoint, `TYPESAFE_API_KEY`.
- `chat` — the same questions asked of the OpenRouter chat model as structured
  JSON. Slower and uncalibrated, but it means nothing depends on a vendor in
  early access, and it is the honest baseline for the eval.
- `none` — every caller behaves exactly as today.

Rules the seam keeps, so callers do not have to:

- **Every call is bounded and fails open.** A deadline per use (about 1.5 s on
  the search path, longer in the nightly), and any error returns "no verdict",
  which every caller must treat as today's behaviour. `logger.warn`, not
  `error`: a judge being down is the app working as designed.
- **The rate limit is a row**, not a Map (`lib/rateLimit/`): ten instances
  share one 1,200-a-minute allowance. The nightly passes take a fraction of it
  so a big clean cannot starve search.
- **Questions and thresholds live in one pure file**, `lib/judge/shared/`, each
  question a named constant with its criteria and its floor. Thresholds are
  corpus-specific by TypeSafe's own account; they are tuned against the eval,
  not guessed and scattered.
- **State is built from the smallest unit that answers the question** — claim,
  chunk, block — and treated as untrusted on the way back (the `coerce*`
  pattern).
- **Every verdict that changes an outcome is recorded where a person can see
  it**: on the search result, the event row, the clean run, the run trace.

**Configuration.** One deployment key. Because the judge sends note text to a
second vendor, a space needs a switch — the natural home is beside
`embed_enabled` on the Nightly row, where "off means off everywhere" is already
the rule for the semantic half. The line in `AGENTS.md` that the deployment's
own AI is one key becomes two.

**Measure before and after.** `pnpm eval:retrieval` deliberately grades the
stack without its semantic half, so it cannot see this change. It needs a
second, slower harness with live stages, and graded queries that include the
two cases that matter most here: a query the corpus **cannot** answer (expects
nothing back) and a query whose best lexical match is wrong. Grade with human
labels or the chat judge — grading Jev's filter with Jev is circular.

**Order.**

1. `lib/judge/` with the three drivers, the row limiter, the live eval harness.
2. Change 1 behind the existing `Reranker` seam. Ship only if the eval moves.
3. Change 2. Measure skipped wakes against runs that would have done nothing.
4. Changes 7 and 5 — both make existing unattended writes safer.
5. Changes 3 and 4, then 6 on top of them.
6. The rest as they come up.

## 6. Risks

- **Early access, one vendor.** Rate limits "adjust dynamically", the model is
  at 1.13, pricing is an introductory number. The `chat` driver and fail-open
  are what make that tolerable. Nothing may be built that only works with Jev.
- **Privacy.** Tenant text leaves for a second processor. No training on
  requests; zero retention is enterprise-only. Private spaces are the hard case
  and the reason for the per-space switch. Read the DPA before any of this
  ships to production.
- **A filter can delete the right answer.** Reordering is forgiving; dropping is
  not. Start with a low floor, return the judge's score with each hit, and log
  what was dropped so a bad threshold can be found from real queries.
- **Literalness.** Questions must be written as plain statements with criteria
  that agree with them. A cleverly worded question is a wrong answer.
- **Language.** English first. A space writing in another language should be
  measured separately before its results are filtered.
- **Request count, not token count, is the constraint.** Pointwise judging is
  one request per candidate. Every design above should be costed in requests a
  minute at the deployment level.

## Sources

- TypeSafe docs: [models](https://docs.typesafe.ai/models), [API](https://docs.typesafe.ai/api), [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [confidence](https://docs.typesafe.ai/confidence), [legal](https://docs.typesafe.ai/legal)
- Cookbooks: [classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages), [re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe), [entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment), [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion), [function calling](https://docs.typesafe.ai/cookbooks/function_calling), [citation check](https://docs.typesafe.ai/cookbooks/citation_check), [line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find), [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade), [guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails)
- [awesome-jev-by-typesafe](https://github.com/Anil-matcha/awesome-jev-by-typesafe)
