-- Retrieval indexes for the fused search stack.
--
-- Applied out of band by scripts/apply-sql-functions.mjs on db:migrate, because
-- the expression index below is not expressible in schema.prisma. (This file
-- used to say the project "does not use prisma migrate" — it has since 2026-08;
-- both mechanisms run, in that order.) Everything here is idempotent.
--
-- The GIN index backs the chunk keyword stage. Its expression must stay
-- character-identical to the one in sourceStage.keyword() or the planner will
-- ignore it and fall back to a scan.
--
-- NO ANN INDEXES LIVE HERE ANY MORE. Two HNSW indexes did, and neither was ever
-- used: the stages write `ORDER BY 1 - (embedding <=> $1) DESC`, which the
-- planner does not recognise as an indexable ordering, and both queries filter
-- on `path IN (<visible paths>)`, which is more selective than the ANN index
-- anyway. Migration 20260824120000_retrieval_index_correction drops them and
-- records the full reasoning, including what would have to be true to want one
-- back. Do not re-add one here without reading it.

CREATE INDEX IF NOT EXISTS "context_source_chunks_text_fts"
    ON "context_source_chunks" USING gin (to_tsvector('english', "text"));
