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
mentions, `ContextSourceChunk` rows extracted from an uploaded file,
`ContextRecord` / `ContextRecordField` — an invented type's records and their
typed field values, read off the notes that declare it (`lib/records/`) so a
type's records can be queried by predicate, range and order. Dropping a
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
read-audit log. Dropping a ledger loses history permanently.

### Tier 3 — Bytes: GCS

Files that are large, binary, or opaque to text processing. Uploads, resource
files, screenshots, exports. A blob is never addressed directly by a feature —
a note or a row holds the pointer, and `ContextSource` + `ContextSourceChunk`
are how a blob's *contents* re-enter tier 1's retrieval stack.

Five rules, learned the hard way from the Drive (§5) and from the bulk-delete
audit (§8):

- **The pointer is a column, never a JSON blob and never a client input.** The
  object path is what gets signed into a download URL, so a client-supplied one
  is a request to sign an arbitrary object in a shared bucket.
- **A URL is not an identifier.** Signed URLs are minted per read. Persisting one
  stores a value that is wrong fifteen minutes later.
- **Bytes have exactly one owner.** When two records reference one object, one of
  them owns it and deletes it; the other is a projection and must not.
- **The path begins with the tenant.** Every object path is minted in
  `lib/storage/objectPaths.ts` and starts with the space that owns it. That is
  what makes "delete this tenant's bytes" expressible as a prefix, which is the
  only form a bulk delete can take — a per-row delete cannot be reached from a
  `deleteMany`. It is a checked property (`tests/storage-objects.test.ts`), not a
  convention, because it is the boundary a prefix delete must never cross.
- **Eager deletion is best-effort; reconciliation is what converges.** There is
  no two-phase commit between Postgres and GCS, so an object delete can always
  be lost — to a crash, a transaction that rolls back after it, or a bucket
  blip. Deleting eagerly is right because it is immediate and cheap; it is not a
  guarantee. `pnpm db:gc:objects` is the guarantee: it compares both buckets
  against the live rows and reports (or, with `--apply`, deletes) what nothing
  points at. It is also the ONLY complete answer for the media bucket, whose
  objects are keyed by entity id rather than by tenant — nothing can enumerate
  the nodes of a space that has already been deleted.

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
agents/<name>/index.md    brief        tier 1, PERSON-written
agent_runs                run          tier 2, RUNNER-written
agents/<name>/memory.md   memory       tier 1, AGENT-written
```

Memory lives in the agent's own folder, which is the one place under
`agents/` a run stamped `agent:<name>` may write (`lockedDenial` in
`lib/notes/contextService.ts` reads the stamp; the rest of `agents/` stays
frozen for AI origins, so a sweep can still never switch an agent off). It is
an ordinary context note: grants, visibility, search ranking, a revision
history that shows the agent as author, and the clean pass. It is readable by
people, correctable by people, and shareable with other agents by granting
access to the folder — which is what "shared memory" actually means here,
and it costs no new machinery.

What keeps it from turning into a second transcript is a fixed shape and a
gated write (`lib/agents/shared/memory.ts`): four sections — What I know,
Decisions, Open threads, Last run — and a `remember` tool that appends one
line under one of the first three, deduped and capped per section, with the
instruction "record what you could not have inferred". The runner hands the
note to every run as a system message and writes `Last run` itself when a run
succeeds. Nothing rewrites the file.

The loop then reads: **brief (intent) → run (exhaust) → memory note
(knowledge) → handed to the next run.**

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

**A space's config is the space row, and only the space row.** `nodeTypes`,
`linkTypes`, `aliases`, `featureConfig` and `designConfig` are JSON columns
written through one door (`updateSpaceConfig`, an advisory lock per space).

For a while they were also mirrored into context as `settings/types.md`,
`settings/features.md` and `settings/design.md`, kept in step in both
directions — the columns out, a hand-edited note back in. It bought revision
history and agent legibility and cost more than it bought: two copies of one
truth, a write gate that had to validate a note before the columns could trust
it, an admin-only clause and an AI freeze on a folder, and an edit that silently
did nothing whenever either half was unavailable. Configuration is changed in
the console, by a person, under a lock — none of which a note made better.

So `settings/` is now **reserved** (`lib/notes/shared/namespaces.ts`): nothing
writes there, by anyone, at any origin — the same standing `subspaces/` has, and
for the same reason, that a note sitting there would look like something it is
not. `db:settings:drop` removes the notes spaces collected while the mirror
existed. What a type tracks is still validated before it is stored, now on the
column's own door (`PUT /api/data/spaces`), which is the only one left.

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
 │   context_notes         UPSERT  the declaration            │
 │   context_note_revisions INSERT the LEDGER (unreplayable)  │  one transaction
 │   context_folders       UPSERT  structural, if an index    │
 │   note_projection_jobs  INSERT  "this write owes a rebuild"│
 ├─ COMMIT ───────────────────────────────────────────────────┘
 │
 ├─ settleProjection()  ← inline, so the author sees compile errors on save
 │    syncContextLinks      directory edges from [[mentions]]
 │    agentNoteWritten      AgentState / next_run_at
 │    toolNoteWritten       AppToolBuild (esbuild)
 │     │    syncPublicationsOnWrite  replicas in other contexts
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

The revision row is inside the transaction, and that is the correction the
outbox itself made necessary. §1 calls `ContextNoteRevision` a LEDGER — "dropping
a ledger loses history permanently" — and it was the one table on this path
appended AFTER the commit. So the outbox made every *replayable* projection
durable and left the single *unreplayable* record bare: a crash in that window
stored the new content and lost the record of who wrote it, with nothing able to
reconstruct it. The same applies to the `context_folders` row that makes an index
note a folder: it is structural, nothing derives it, and no projection would ever
notice it missing. Both now commit with the note.

The rule that falls out: **what the outbox protects is what can be rebuilt. What
cannot be rebuilt has to be in the transaction.** Those are complementary, not
alternatives — reaching for the job row is the wrong instinct for a ledger.

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

- **Retrieval assembles candidates in memory.** `listRaw` loads every live note
  in a context — bodies and all — and BM25, the link neighbourhood and the
  visibility lens all run over that array in Node; pgvector is a *reranker over
  an in-memory candidate set*, not a first-class retrieval index. This is the
  real ceiling of tier 1. It is now bounded and observed rather than assumed:
  the vault cache has a 256 MB budget with LRU eviction (a count cap is not a
  memory bound), per-entry visibility views are capped, and a context past 32 MB
  logs `notes.vault.large_context` so the ceiling is seen before it is hit. At
  the measured ~1 KB/note this is comfortable to roughly 10–50k notes per space.
  Past that, the first-stage filter has to move into Postgres — and that is also
  the point at which an ANN index becomes worth having again (§8).
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
  match), and the lifecycle multiplier could push a superseded note to rank 3
  even when the query was uniquely about the OLD policy. The second is fixed:
  the query plan (`lib/notes/shared/queryPlan.ts`) reads a history intent out of
  the phrasing and ranks retired notes at full weight for it — the
  `history-intent` case grades exactly that. The same plan turns time words into
  the date filter (`temporal-filter-with-topic`) and answers a purely temporal
  ask by recency (`temporal-only`). Baseline is now recall 100%, MRR 0.949,
  nDCG 0.953 over 13 cases.
- ~~**The derived memory tier is not built.**~~ **Built.** `context_memories`
  holds the one-sentence claims the nightly sweep extracts from each note
  (`lib/notes/memorySweep.ts`; `lib/notes/shared/memories.ts` is the pure half).
  Search ranks over them (`lib/notes/memoryStage.ts`) and folds each hit onto
  its note, so a result carries `claim` — the sentence that answered — and an
  agent can stop there. Two things follow from keying them to the note rather
  than making them results: a claim inherits the note's lifecycle and
  visibility for free, and a claim from an older save is never served (the
  stage matches `(path, mtime)`), so the note's own text is always the truth
  the claim is measured against. Extraction is a chat call per note, bounded
  to 50 a night, so a large space catches up over nights.
- **No cross-space memory.** A lesson learned in one space cannot reach another
  except by a human copying it. That is the correct default for a multi-tenant
  product and should stay a deliberate, granted act if it is ever built.

---

## 8. The foundations audit (2026-08-19)

A pass over the three tiers as built rather than as documented — the schema, the
write path and the storage layer, checked against the rules above. Six things
were wrong. All six are fixed; what follows is what each one teaches, because
the failure modes rhyme.

**The unreplayable table was the one left outside the transaction.** §6 has the
detail. The general shape: durability machinery attracts attention to the things
it covers, and the thing it does not cover becomes *less* visible for having
machinery next to it. `ContextNoteRevision` was appended after the commit for the
same reason it looked safe — everything around it had a job row.

**Bulk deletes could not reach the code that owns bytes.** `deleteResource` and
`sourceStore.deleteSource` each removed their object correctly. Dropping a space
and closing an account used `deleteMany`, which by construction never calls
either, so every file of every deleted space stayed in the bucket permanently and
nothing collected it. The rule "bytes have exactly one owner" was written for the
one-row case and silently did not describe the many-row case. Both paths now go
through `lib/storage/purge.ts`, paths are minted in one module so a tenant's
bytes are a prefix, and `pnpm db:gc:objects` reconciles.

**Closing an account left the whole personal space behind.** The widest gap and
the least visible. A personal space's notes are `ownerKey = 'shared'` inside the
space `me:<userId>` — the ownership is in the space id, not the owner key — so
the `ownerKey = userId` sweep matched none of them, and `personalOwnerId` has no
foreign key for a cascade to follow. The coverage guard could not see it either,
because it reasons about columns on tables and this was a whole tenant. Lesson:
a guard inherits the blind spot of the abstraction it is written in.

**Two HNSW indexes were never once used.** The queries write
`ORDER BY 1 - (embedding <=> $1) DESC`, which is not an indexable ordering, and
they filter on `path IN (<visible paths>)`, which is more selective than the
index anyway — and which HNSW would apply *after* the scan, so engaging the index
would have been a recall bug rather than an optimisation. Dropped, with the
reasoning and the conditions for wanting one back recorded in migration
`20260824120000_retrieval_index_correction`. Lesson: an index is a claim about a
query plan, and a claim nobody checked with `EXPLAIN` is a comment.

**Nothing pruned embeddings.** `context_note_embeddings` is keyed by
(space_id, owner_key, path) and cannot carry a foreign key, so its lifecycle is
code's job — and the sweep only ever upserted. Every deleted and renamed note
left its vector behind for good. It was contained rather than dangerous (the
vector stage intersects with live candidate paths), which is exactly why it
survived so long. Pruned now on the write path and reconciled by the nightly
sweep, the same eager/reconcile pair as tier 3.

**Integrity was enforced on one axis and hand-written on the other.** 27 of the
28 tables carrying `space_id` had a cascading foreign key; 26 of 32
user-identity columns had none, and account deletion was correct only because
one file remembered each of them. Most of that asymmetry is legitimate and is
now written down on the `User` model: polymorphic keys (`owner_key`) cannot have
one, provenance stamps (`uploaded_by`) must *outlive* the person, and the audit
trail is redacted on purpose. What was left after those exclusions was access
and credentials — an admin alias or an exchangeable refresh token surviving a
deleted account — and those are foreign keys now.

The through-line: **every one of these was a rule that held in the case it was
written for and silently did not describe the neighbouring case.** Single-row vs
bulk. Replayable vs not. One tenant axis vs the other. Writing the rule down (§1)
was what made them findable at all; the next audit should start by asking, of
each rule, which case it was written for.

### 8.1 The follow-up pass

Four changes after the audit, aimed at the same class of problem: a rule that is
true but unenforced.

**Enum columns are constraints now, not comments.** Two dozen columns enumerated
their values in a line comment and were checked nowhere — the schema had exactly
two CHECK constraints in total. A typo committed, was durable, and surfaced later
as a reader that skipped the row. Migration
`20260824120200_enum_check_constraints` adds 27, sourced from the TypeScript
unions rather than from the comments, and `tests/schema-constraints.test.ts`
fails when a new enum-ish column arrives unconstrained.

The exercise paid for itself before it shipped. FOUR column comments were already
wrong: `context_sources.kind` (three values listed, six in the dispatch table),
`agent_runs.trigger` (two listed, five in `RunTrigger`),
`identity_resolutions.decision` (omitted `created`, which 624 rows actually hold)
and `agent_state.deactivatedReason` (omitted `config`). The third was found by
`pnpm db:constraints:validate`; the fourth by the coverage test, on its first
run. Neither was findable by reading, which is the argument.

Every constraint — the CHECKs here and the foreign keys from the audit itself —
is added `NOT VALID`. That is not a weaker form: Postgres creates the
constraint's triggers in full, so every insert and update is checked and
`ON DELETE CASCADE` fires exactly as it would otherwise. The only thing skipped
is the one-time scan proving EXISTING rows comply.

The reason is that deploy migrates production *before* building the image, so a
migration that aborts on one unexpected row leaves production half-migrated with
the old image serving. Proving old rows comply moves to
`pnpm db:constraints:validate`, where it can fail safely and print the offending
values.

**And a constraint migration must not touch data.** An earlier draft of the
foreign-key migration deleted every row referencing a missing user, so each
constraint could be added valid. It read as tidiness and was not: unattended,
destructive, and operating on a count nobody had seen. A row pointing at a
long-gone user is broken — but "broken" is a conclusion for a person to reach
with the rows in front of them, not a licence for a deploy step to delete data on
its way past. The same reasoning removed a bulk `DELETE` of orphaned embeddings
from the retrieval migration; the nightly sweep already does that job, at an hour
when it costs nothing. `tests/schema-constraints.test.ts` now fails if either
migration grows a `DELETE`, `UPDATE`, `TRUNCATE` or `DROP TABLE`.

**Converting an entity note to a folder is atomic.** `ensureEntityFolder` made
six structural writes with no transaction: the note's path, its grants, its
folder flags, the folder row, the index contract, and the node's pointer. A
crash between the first two left a note that had moved with grants still naming
its old path — a restricted note silently readable — and nothing derived it, so
no projection would ever notice. §6 said structural work stays inline with the
write; being inline was only half the requirement.

**A parked projection job now tells someone.** Eight exhausted attempts means a
note's derived state is permanently stale until a person intervenes — the one
failure the outbox cannot recover from, and the only one that wrote nothing but a
log line. Every comparable giving-up here notifies (a broken connection, a
deactivated agent, a failed run). This one now does too, deduped per note.

**The storage audit runs nightly.** `pnpm db:gc:objects` was correct and manual,
so drift was only ever found by remembering to look. The comparison moved to
`lib/storage/audit.ts` and the nightly sweep runs it in report-only mode; the
script stays the only thing that can delete. A GC you have to remember to run
reports zero for a year and then reports a surprise.
