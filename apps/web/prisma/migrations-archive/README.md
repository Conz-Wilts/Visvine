# Archived migrations

These describe steps between schema states that no longer exist anywhere. They
were written while the project converged its schema with `prisma db push`, so
they are a changelog of deltas, not a replayable history — nothing here creates
the 37 models, and replaying them against an empty database produces nothing.

`prisma/migrations/0_init` is the baseline: the whole current schema as one
migration. Production is marked as having it applied, and every change from
here is a new migration under `prisma/migrations`.

Two of them were not history at all and have moved to `prisma/sql/`: the
retrieval indexes and the public-space-name index are hand-written SQL that
`apply-sql-functions.mjs` re-applies on every deploy, because Prisma cannot
express an HNSW, GIN, or partial expression index.

The rest are kept because the SQL is the record of what each rename actually did —
`20260814_community_to_space` in particular is where the rename map in
`scripts/prod-schema-presync.mjs` came from. Read them; don't run them.

One trap if you ever do: the directory names sort `brain_to_context` before
`channel_spaces_to_sections` and `community_to_space`, but it has to run after
both.
