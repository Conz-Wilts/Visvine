-- Retrieval indexes for the fused search stack.
--
-- Both cosine rankings (lib/notes/vectorStage.ts, lib/notes/sourceStage.ts) were
-- sequential scans over every row for the brain: correct, but linear in corpus
-- size on the hot path of every search. HNSW with vector_cosine_ops matches the
-- `<=>` operator those queries use.
--
-- The GIN index backs the new chunk keyword stage. Its expression must stay
-- character-identical to the one in sourceStage.keyword() or the planner will
-- ignore it and fall back to a scan.
--
-- Prisma's `db push` (this project does not use `prisma migrate`) leaves these
-- alone because they are not expressible in schema.prisma — hence the raw
-- migration, applied by scripts/apply-sql-functions.mjs on db:migrate.

CREATE INDEX IF NOT EXISTS "community_note_embeddings_embedding_hnsw"
    ON "community_note_embeddings" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "context_source_chunks_embedding_hnsw"
    ON "context_source_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "context_source_chunks_text_fts"
    ON "context_source_chunks" USING gin (to_tsvector('english', "text"));
