-- The derived memory tier: one row per claim extracted from a context note.
--
-- Search returns notes, and a note is about a kilobyte; the claims are the
-- sentences inside it that actually answer things. Ranking over them (and
-- folding each hit back onto its note) is what lets a result carry a
-- fifty-token answer instead of an excerpt. Keyed exactly like
-- context_note_embeddings — (space_id, owner_key, path), no foreign key, since a
-- note's identity is a unique constraint that moves on rename — with `seq` for
-- the claim's position and `mtime` for the note version it came from.
CREATE TABLE IF NOT EXISTS "context_memories" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"    TEXT NOT NULL,
    "owner_key"   TEXT NOT NULL,
    "path"        TEXT NOT NULL,
    "seq"         INTEGER NOT NULL,
    "text"        TEXT NOT NULL,
    "model"       TEXT NOT NULL,
    "mtime"       BIGINT NOT NULL,
    "embed_model" TEXT,
    "embedding"   vector(768),
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "context_memories_space_id_owner_key_path_seq_key"
    ON "context_memories" ("space_id", "owner_key", "path", "seq");

ALTER TABLE "context_memories"
    ADD CONSTRAINT "context_memories_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The stages filter (space_id, owner_key, (path, mtime) IN <visible>) — the
-- unique index above already leads with exactly that. No ANN index, for the
-- reason migration 20260824120000 gives: the visible-path filter is far more
-- selective than an HNSW scan, and HNSW post-filters.
