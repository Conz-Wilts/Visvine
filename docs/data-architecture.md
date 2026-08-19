# Data architecture: where things live and why

The recurring question this document settles: **when something new needs to be
stored, does it become a context note, a Postgres table, or a blob in GCS?**

Most of the answer is already embodied in the codebase — agents, Tools and
connectors each landed on the same shape independently. This writes the rule
down so the next feature does not have to rediscover it, and so the cases where
we got it wrong are visible as violations rather than as taste.

---

## 1. The three tiers

### Tier 1 — Declaration: context notes

Markdown notes in `context_notes`, addressed by `{spaceId, ownerKey, path}`.

**What belongs here: anything a person or an agent DECIDES.** Intent, policy,
knowledge, configuration, identity. If a human might reasonably want to open it,
read it, argue with it in a diff, or grant someone else access to just that part
of it, it is a note.

Notes are the only tier that gets, for free:

- **Authorship and revision history** — `context_note_revisions`, with the
  origin (`edit` / `agent` / `maintenance` / …) recorded per save.
- **Per-path authorization** — `ContextGrant`, restricted folder boundaries,
  Freeze-for-AI locks, and a visibility lens that is applied *before* search
  candidates are assembled.
- **Semantic retrieval** — BM25 + pgvector + link-neighbourhood fusion.
- **A derived link graph** — a markdown mention creates an edge; deleting the
  text deletes the edge.
- **A memory lifecycle** — see §3.

Everything on that list is expensive to rebuild per-feature and impossible to
retrofit onto a bespoke table. That is the real argument for the note tier: not
that markdown is elegant, but that a note arrives with the whole platform
already attached to it.

### Tier 2 — Runtime: Postgres tables

Rows written by machines, at a rate that grows with usage, queried by predicate,
range, order or aggregate. Two distinct kinds, and the distinction matters:

**Projections** are *derived from tier 1* and rebuildable by replaying it.
`AgentState.triggersJson` (parsed from the live note), `AppToolBuild` (esbuild
output of `tools/<name>/*.md`), `ContextNoteEmbedding`, `Link` rows from
mentions, `ContextSourceChunk` rows extracted from an uploaded file. Dropping a
projection loses nothing but compute. A projection must never be the only copy of
a decision — if it is, someone put a declaration in tier 2 by mistake.

"Rebuildable" has to be an operation, not an adjective. It is
`lib/notes/projections.ts`: every note mutation writes a `NoteProjectionJob` in
the SAME transaction as the note, the six projections are rebuilt inline, and the
row is deleted only when they succeed. What fails is retried with backoff by the
drain; what nobody ever recorded is repaired by walking the notes
(`pnpm db:projections:rebuild`). Before that the fan-out was six bare awaits after
the commit, so a crash mid-save left a stored declaration with stale derived state
and nothing anywhere saying so — the promise was true in principle and unbacked in
practice for every projection above.

**Ledgers** are *first-hand records of things that happened* and are not
derivable from anything. `AgentRun`, `AgentEvent`, `ContextNoteRevision`, the
read-audit log, `Notification`. Dropping a ledger loses history permanently.

### Tier 3 — Bytes: GCS

Files that are large, binary, or opaque to text processing. Uploads, resource
files, screenshots, exports. A blob is never addressed directly by a feature —
a note or a row holds the pointer, and `ContextSource` + `ContextSourceChunk`
are how a blob's *contents* re-enter tier 1's retrieval stack.

Three rules, learned the hard way from the Drive (§5):

- **The pointer is a column, never a JSON blob and never a client input.** The
  object path is what gets signed into a download URL, so a client-supplied one
  is a request to sign an arbitrary object in a shared bucket.
- **A URL is not an identifier.** Signed URLs are minted per read. Persisting one
  stores a value that is wrong fifteen minutes later.
- **Bytes have exactly one owner.** When two records reference one object, one of
  them owns it and deletes it; the other is a projection and must not.

And the rule that makes the tier worth having at all: **a stored file whose
contents never reach tier 1 is a folder with extra steps.** Every text-bearing
upload goes through extract → chunk → embed so a model can retrieve it. A kind we
cannot extract is recorded as such (`index_state = 'unsupported'`) rather than
left silently unsearchable.

---

## 2. The placement test

Four questions, in order. The first "yes" decides it.

1. **Would a human ever want to edit this by hand?**
   → Tier 1. Not "will they often" — "could they meaningfully". Agent briefs
   qualify; agent run transcripts do not.
2. **Is it appended once per event, so its size grows with traffic rather than
   with the size of the space?**
   → Tier 2 (ledger). One row per run, per save, per webhook, per read.
3. **Is it queried by predicate, range, ordering or aggregate rather than
   retrieved by meaning?**
   → Tier 2. "All runs in the last 30 days, summed by cost" is SQL. "What did we
   decide about pricing" is retrieval.
4. **Is it non-text, or larger than a person would read in one sitting?**
   → Tier 3, with a pointer in tier 1 or 2.

Two rules that fall out of it:

- **A tier-2 row may never be the sole home of a decision.** If deleting the
  table would lose something nobody can reconstruct from notes, either it is a
  ledger (fine) or a declaration leaked downward (fix it).
- **A tier-1 note may never be written once per event.** The moment "one note
  per occurrence" appears in a design, the design wants a ledger.

---

## 3. The agent question, answered

> Should an agent be an index note with its runs and logs as sub-notes, so each
> agent has its own context environment?

**No — and the current split is already right.** But there is a real idea inside
the question, and it is worth building.

Run the test on each piece:

| Piece | Test | Home |
|---|---|---|
| The brief (what the agent is for, its model, tools, connectors) | A human writes and edits it | `agents/<name>.md` — tier 1 ✓ |
| The activation (schedule, triggers, `runs_as`) | A human (an admin) writes it | `agents/live/<name>.md` — tier 1 ✓ |
| Parsed schedule, next-run time, failure counters | Derived from the two notes above | `AgentState` — tier 2 projection ✓ |
| Runs: transcript, tokens, cost, terminal reason | One row per execution, queried by time and summed for budget | `AgentRun` — tier 2 ledger ✓ |
| The trigger mailbox | One row per event, claimed and consumed | `AgentEvent` — tier 2 ledger ✓ |

Storing run transcripts as notes would be wrong in four independent ways: every
run would need an authorization decision it does not have; monthly spend would
become a full-text scan instead of `SUM(cost_micros)`; a busy agent would flood
the retrieval index with near-identical transcripts, which is precisely the
failure mode that makes agent memory systems degrade; and `agents/**` is frozen
for AI origins (`lockedDenial` in `lib/notes/contextService.ts`), so an agent
writing into its own folder would trip the hook that deactivates an agent whose
brief changed. It would switch itself off after every run.

### The idea worth keeping: memory, not logs

"Each agent has its own context environment" is the right instinct pointed at
the wrong artifact. A run transcript is not memory — it is exhaust. Memory is
what an agent should have *concluded* from a run and want on its next one.

So the shape is a third artifact, distinct from both:

```
agents/<name>.md          brief        tier 1, human-written, AI-frozen
agents/live/<name>.md     activation   tier 1, admin-written, AI-frozen
agent_runs                exhaust      tier 2 ledger, machine-written
memory/agents/<name>/     memory       tier 1, AGENT-written  ← the missing piece
```

Agent memory must live **outside `agents/`**, because that subtree is
structurally frozen for AI writes and must stay that way. `memory/agents/<name>/`
is an ordinary context folder: it gets grants, visibility, search ranking, a
revision history that shows the agent as author, and the clean pass. It is
readable by people, correctable by people, and shareable with other agents by
granting access to the folder — which is what "shared memory" actually means
here, and it costs no new machinery.

The loop then reads: **brief (intent) → run (exhaust) → memory note
(knowledge) → retrieved into the next run's context.**

This is the one piece of the design that is not built yet. What exists today is
the mailbox (`AgentEvent`) that tells an agent *why it woke up*; what does not
exist is anything that tells it *what it learned last time*.

### A caution, from someone else's data

Notion published benchmarks for Lore, their Notion-backed agent memory layer:
in a pilot vault only 55–60% of stored memories were genuinely valuable and
15–20% were outright duplicates. That is the cost of automatic capture without a
gate. When agent memory is built here, it should be a deliberate tool call with
a purpose ("record what you learned that you could not have inferred"), not a
hook that dumps every session — and it inherits the clean pass, which is what
keeps the other 40% from accumulating.

---

## 4. Memory lifecycle (built)

Tier 1 is where knowledge lives, so tier 1 is where knowledge has to be allowed
to *age*. Every note carries an optional lifecycle in its frontmatter. The
vocabulary is `lib/notes/shared/lifecycle.ts`; the checks that maintain it are
in `lib/notes/shared/review.ts`; retrieval reads it in
`lib/notes/shared/retrieval.ts`.

```yaml
---
title: Trial period policy
status: accepted          # active (default) | proposed | accepted | stale
                          # superseded | deprecated | expired | archived | rejected
confidence: likely        # certain | likely | speculative
expires: 2026-12-31       # bare date = end of that day
supersedes: /decisions/trial-period-v1.md
superseded_by: /decisions/trial-period-v3.md   # written by the clean pass, not by hand
---
```

**Nothing is ever hidden.** A retired note stays readable, linkable and
searchable — the record of why something was reversed is frequently the most
valuable note in a space. What changes is its rank and how it is labelled:

- Retired statuses get a score multiplier (`superseded`/`expired`/`archived`
  0.35, `deprecated`/`rejected` 0.45, `stale` 0.7) applied after fusion, so a
  replaced answer stops outranking its replacement. Both are equally *relevant*;
  only one is still *true*, and relevance ranking alone cannot tell them apart.
- Every `search_context` hit that is not active carries `status`, and
  `read_context` returns a `lifecycle` block including a `read_instead` pointer
  to the note that superseded it.
- `confidence` is deliberately **not** a ranking factor. Confidence is a
  property of the claim, relevance is a property of the query, and multiplying
  them makes a search result impossible to explain.

The clean pass keeps it honest:

| Check | Mode | Output |
|---|---|---|
| `checkExpiry` | both | auto-fix: `status: expired` once `expires` has passed |
| `checkSupersession` | both | auto-fix: write `superseded_by` + `status: superseded` on the replaced note; report unresolvable, self- and mutual supersession |
| `checkLifecycleFields` | both | report values outside the vocabulary — a misspelled `status:` reads as *active*, which is the dangerous direction to fail |
| `checkContradictions` | full | report related notes that assert different numbers, different dates, or opposite claims |

A note is retired by *declaring its replacement*, never by deleting it: put
`supersedes: /old/path.md` on the new note and the next clean pass records the
back-pointer and retires the old one. The history of the decision survives.

### Contradictions are not duplicates

The two are opposite problems and want opposite fixes, which is why they are
separate issue kinds with separate worklist guidance:

- A **duplicate** is two notes saying the same thing. It costs storage. Merge
  one away.
- A **contradiction** is two notes saying *different* things. It costs
  correctness — an agent retrieves one of them, effectively at random, and acts
  on it. **Never merge a contradiction blindly:** a conflict usually means a
  real distinction went unrecorded. Establish which is current and declare the
  supersession, or make the distinction explicit in both.

Detection is purely mechanical, with no LLM in the path, in three kinds of
evidence: divergent scalar frontmatter fields between related notes; two lines
opening with the same four topic words that quote different numbers or dates;
and two such lines where exactly one is negated. Fenced code is skipped (a
config sample is not a claim), and pairs where one note already declares it
supersedes the other are skipped — that conflict is declared and resolved.

The check is deliberately conservative. A false "these two disagree" is more
expensive than a missed one, because it invites a merge that destroys a
distinction.

---

## 5. Where the doctrine is applied

Two of the three violations found in the first audit are fixed; the third is a
rule rather than a migration.

**Ledgers are tables now.** `audit.jsonl` became `context_audit_entries` and
`move-proposals.jsonl` became `context_move_proposals`, joining `folders.json →
context_grants` and `join-requests.jsonl → context_access_requests`. That is
every append-per-event sidecar, so `appendJsonl` is gone from
`lib/notes/sidecar.ts` entirely — the primitive that made the bug possible
cannot be reached for again. The sidecar keeps only small whole-document state
(`folders.json`, `enrichment-state.json`).

Account deletion treats the two new tables differently, and the difference is
the point: move proposals are DELETED (the row holds a snapshot of the person's
own personal note), while audit entries are REDACTED — the actor becomes a
tombstone and the event survives. If deleting an account erased its audit
entries, deleting an account would be how you erase your own trail.

**Space config is a declaration with a projection.** `nodeTypes`, `linkTypes`,
`aliases`, `featureConfig` and `designConfig` now have notes beside them under
`settings/` (`lib/spaces/configNote.ts`), kept in step in both directions:
`updateSpaceConfig` writes the notes after it commits, and the store hook
(`lib/spaces/configHook.ts`) projects a hand-edited note back into the columns.
Neither direction writes when the other already says the same thing, which is
what makes the pair terminate.

The read path is untouched — every caller still reads `space.featureConfig`
from a row it already has — so this buys revision history, diffs, per-folder
grants and agent legibility at no request-time cost.

Three rules hold it together:

- `settings/` is **admin-only** to write. Editing one of those notes changes the
  space, including the `owner: true` alias flags that decide who administers it,
  so a folder grant must not be a way around the console's own gate.
- `settings/` is **frozen for AI**, like `agents/` and `tools/`. An agent may
  READ a space's settings — that is most of the value of having them as notes —
  but an autonomous pass that "tidied" them could switch a surface off for
  everyone. (This narrows something an earlier draft of this document implied:
  an agent cannot propose a config change by editing the note. A proposal
  belongs in an ordinary note a person then applies.)
- A settings note that is not a valid configuration is **refused at the write
  gate**, before it is saved. The projection hook runs after the write, so the
  gate is the only place a bad edit can be stopped rather than merely ignored —
  and being stopped is what keeps the note and the columns from disagreeing.

The one rule that cannot be judged from a note alone is a transition:
`ownerAliasDenial` refuses an edit that removes the LAST `owner: true` alias.
Having none is fine and common — plenty of spaces are administered by super
admins — so what is refused is going from some to none, which would leave nobody
allowed to put it back.

**The Drive is a tier-3 record now, not a card with a URL.** `Resource` was
built before any of this and kept its own half of a file system: no foreign key
to `spaces`, the GCS object path stored inside the `metadata` JSON blob *and
supplied by the browser*, a 15-minute signed URL persisted in `file_url` forever,
and contents that never reached retrieval. All four are closed (migration
`20260823120100_resources_drive`, `lib/resources/service.ts`): `gcs_path` is a
server-minted column, the FK cascades, the download URL is signed per read, and
every text-bearing upload runs the same extract → chunk → embed pipeline
`ContextSource` already had, so a Drive file's contents rank in `search_context`
beside notes. The client-supplied object path was the sharpest of the four — the
listing signed a download URL for whatever path the create had named, which
included another space's originals.

**A person's profile is one row again.** Editing a person's card in a space's
directory used to mirror `tags` and `imageUrl` onto their `Person` row — their
global, cross-space profile. The gate on that route is space membership, so any
member of any space you belonged to could replace your profile photo. The mirror
is gone: a `Person` is the member's own profile (edited only by them at
`PATCH /api/profile/[personId]`), a person NODE is one space's card for them, and
neither reaches across. This is the doctrine's own rule — a declaration had leaked
into tier 2 and then been copied — but it was an authorization hole first.

**Phase 2, not done:** the console panels still write the columns and let the
notes follow. Flipping them to write the notes, and making the columns strictly
derived, is the step that makes the note unambiguously the source of truth.
Nothing in the current shape has to change for that; it is a change of caller.

## 6. The write path

One note save fans out to six subsystems. They are all projections by §1, so the
question is not whether they can be rebuilt but who guarantees they were.

```
writeNote()
 ├─ BEGIN ────────────────────────────────────────────────────┐
 │   context_notes        UPSERT   the declaration            │  one transaction
 │   note_projection_jobs INSERT   "this write owes a rebuild"│
 ├─ COMMIT ───────────────────────────────────────────────────┘
 │
 ├─ settleProjection()  ← inline, so the author sees compile errors on save
 │    syncContextLinks      directory edges from [[mentions]]
 │    agentNoteWritten      AgentState / next_run_at
 │    toolNoteWritten       AppToolBuild (esbuild)
 │    configNoteWritten     space config columns
 │    syncPublicationsOnWrite  replicas in other contexts
 │    ensureAncestorIndexes + refreshIndexesForNote
 │
 └─ success → DELETE the job    failure → leave it, with the error, for the drain
```

The drain (`drainProjections`) claims due rows by compare-and-swap on `attempts`,
so two instances cannot run one job twice, and backs off exponentially to an hour.
It rides the agent tick (every minute) and the nightly sweep, and has its own
endpoint at `/api/internal/projections/drain` if it should ever get its own
schedule. A row that burns 8 attempts is PARKED with its error rather than
retried forever — at that point it is a bug to fix, and leaving it due would
starve healthy jobs behind it.

Three design choices worth keeping:

- **Inline, not asynchronous.** The outbox buys durability, not background
  execution. A Tool author expects compile errors on save and a mention expects
  its edge immediately; making the fan-out async would have been a worse product
  in exchange for a guarantee the job row already provides.
- **No content on the job.** A retry re-reads the note and projects what it says
  NOW, so a job that lands after three further edits converges instead of
  replaying a stale snapshot.
- **Structural work stays out.** Moving grants and folder flags on a rename, and
  flipping `deletedAt` on a trash, must happen exactly once and are not
  replayable. They stay inline with the write. Only derived state is on the job —
  which is the projection/ledger line from §1, drawn one level down.

---

## 7. Known open edges

- **Agent memory** (§3) is designed but not built. The gap is real: nothing
  currently carries a conclusion from one run to the next.
- ~~**No retrieval evaluation harness.**~~ **Built.** `lib/notes/shared/evalRetrieval.ts`
  plus a graded query set in `tests/fixtures/retrievalCorpus.ts`: recall@k, MRR,
  nDCG@k and an explicit order claim per case, run as a regression gate in
  `pnpm test` and as a report from `pnpm eval:retrieval`. Current baseline —
  recall 100%, MRR 0.933, nDCG 0.939 over 10 cases. It grades the DETERMINISTIC
  half of the stack (BM25 + source keyword + link neighbourhood + lifecycle); the
  vector stage is injected and absent, so a semantic harness against a live model
  is still owed. Two things it surfaced immediately, both worth knowing:
  the stemmer handles plurals but not verb inflection (`signed`/`signing` do not
  match), and the lifecycle multiplier can push a superseded note to rank 3 even
  when the query is uniquely about the OLD policy — down-ranking is right, but
  the multiplier does not know the query is asking for history.
- **No cross-space memory.** A lesson learned in one space cannot reach another
  except by a human copying it. That is the correct default for a multi-tenant
  product and should stay a deliberate, granted act if it is ever built.
