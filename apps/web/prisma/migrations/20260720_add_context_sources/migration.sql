-- Context Sources: non-note files/tables attached to a brain. A source is keyed
-- (community_id, owner_key, path) exactly like community_notes so the folder
-- gate and visibility lens govern it unchanged; it never becomes a graph Node.
-- The original file lives in GCS (gcs_path); the extracted text lives chunked
-- in context_source_chunks with pgvector embeddings for the retrieval stage.

CREATE TABLE "context_sources" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "community_id" TEXT NOT NULL,
    "owner_key"    TEXT NOT NULL,
    "path"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "kind"         TEXT NOT NULL,
    "mime_type"    TEXT NOT NULL,
    "size_bytes"   INTEGER NOT NULL,
    "gcs_path"     TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "error"        TEXT,
    "truncated"    BOOLEAN NOT NULL DEFAULT false,
    "text_chars"   INTEGER,
    "chunk_count"  INTEGER NOT NULL DEFAULT 0,
    "created_by"   TEXT NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "context_sources_community_id_fkey" FOREIGN KEY ("community_id")
        REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "context_sources_community_id_owner_key_path_key"
    ON "context_sources"("community_id", "owner_key", "path");
CREATE INDEX "context_sources_community_id_owner_key_status_idx"
    ON "context_sources"("community_id", "owner_key", "status");

CREATE TABLE "context_source_chunks" (
    "id"           TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "source_id"    TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "owner_key"    TEXT NOT NULL,
    "path"         TEXT NOT NULL,
    "seq"          INTEGER NOT NULL,
    "text"         TEXT NOT NULL,
    "model"        TEXT,
    "embedding"    vector(768),

    CONSTRAINT "context_source_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "context_source_chunks_source_id_fkey" FOREIGN KEY ("source_id")
        REFERENCES "context_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "context_source_chunks_source_id_seq_key"
    ON "context_source_chunks"("source_id", "seq");
CREATE INDEX "context_source_chunks_community_id_owner_key_model_idx"
    ON "context_source_chunks"("community_id", "owner_key", "model");
