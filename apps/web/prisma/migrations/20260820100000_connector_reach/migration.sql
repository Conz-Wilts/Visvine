-- Connector reach (wave 1): a connector's memory between runs.
--
-- Every connector run starts in a fresh isolate. That is right for security and
-- wrong for sync — a connector polling an API needs a cursor, an ETag or a
-- "last seen" id, or it re-reads the world every time. `connector_state` is
-- that one place: `visvine.state.get(key)` / `visvine.state.set(key, value)`
-- inside the isolate (lib/connectors/hostState.ts).
--
-- Keyed by (space, connector NOTE path, key) — a connector is a note, so the
-- note's path is its identity; renaming the note starts it fresh, which is the
-- honest outcome. Same caps as a Tool's state (lib/tools/state.ts): 16KB a
-- value, 100 keys a connector — enforced in code, and a set past the key cap is
-- REFUSED rather than evicting a key the connector relies on.
--
-- The rest of the wave (visvine.crypto, named `actions:`, per-space quotas,
-- fetch `follow`) is code and note frontmatter; nothing else in the schema
-- changes. Additive only: safe on a re-run and safe ahead of the code.

CREATE TABLE "connector_state" (
    "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"    TEXT NOT NULL,
    -- `connectors/<name>.md`
    "path"        TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "value"       JSONB NOT NULL,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_state_pkey" PRIMARY KEY ("id")
);

-- One value per key per connector; also the lookup index for get/set.
CREATE UNIQUE INDEX "connector_state_space_id_path_key_key"
    ON "connector_state" ("space_id", "path", "key");

-- Deleting a space takes its connectors' memory with it.
ALTER TABLE "connector_state"
    ADD CONSTRAINT "connector_state_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
