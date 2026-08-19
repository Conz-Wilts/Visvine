-- Connector OAuth: the tokens Visvine holds on someone's behalf, so a connector
-- can reach a service that authenticates PEOPLE rather than just callers.
--
-- Two tables because they have different lifetimes and different owners:
--
--   connector_oauth_clients   one per (space, provider, issuer). Usually created
--                             by dynamic registration at first connect. Survives
--                             every connect/disconnect after that.
--   connector_connections     one per person (or one for the whole space, in
--                             `mode: space`). Comes and goes as people connect
--                             and revoke.
--
-- Both hold ciphertext in the same `aes256gcm$iv$tag$cipher` shape as
-- connector_secrets, decrypted server-side only while a run is executing. The
-- plaintext never enters the connector isolate — the host stamps the bearer on
-- outbound requests instead (lib/connectors/hostFetch.ts).

CREATE TABLE "connector_oauth_clients" (
    "id"            TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"      TEXT NOT NULL,
    "provider"      TEXT NOT NULL,
    -- Part of the key: repointing a note at a different authorization server is
    -- a different trust relationship and must re-register rather than reuse a
    -- client id the new issuer has never heard of.
    "issuer"        TEXT NOT NULL,
    "client_id"     TEXT NOT NULL,
    -- NULL for a public client (PKCE only, no secret) — the normal case for a
    -- dynamically registered MCP client.
    "client_secret" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_oauth_clients_identity"
    ON "connector_oauth_clients" ("space_id", "provider", "issuer");

ALTER TABLE "connector_oauth_clients"
    ADD CONSTRAINT "connector_oauth_clients_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "connector_connections" (
    "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "space_id"       TEXT NOT NULL,
    "provider"       TEXT NOT NULL,
    -- '' for a space-wide connection, the member's user id for a per-user one.
    -- Deliberately NOT NULL with an empty-string sentinel: Postgres treats NULLs
    -- as distinct in a unique index, so a nullable column would silently allow
    -- two space connections for the same provider.
    "user_id"        TEXT NOT NULL DEFAULT '',
    "mode"           TEXT NOT NULL,
    -- What the far side calls this account ("sarah@…", a workspace name). Shown
    -- in the UI as "acts as …", which is the only thing that makes a shared
    -- space connection honest about whose access it is handing out.
    "account_label"  TEXT,
    "access_token"   TEXT NOT NULL,
    "refresh_token"  TEXT,
    "expires_at"     TIMESTAMP(3),
    "scopes"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- A connection whose refresh failed unrecoverably is kept, not deleted, so
    -- the UI can say which one needs reconnecting and why. An agent that dies at
    -- 3am should leave an explanation, not a mystery 401.
    "broken_at"      TIMESTAMP(3),
    "broken_reason"  TEXT,
    "connected_by"   TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_connections_identity"
    ON "connector_connections" ("space_id", "provider", "user_id");

CREATE INDEX "connector_connections_space_provider_idx"
    ON "connector_connections" ("space_id", "provider");

ALTER TABLE "connector_connections"
    ADD CONSTRAINT "connector_connections_space_id_fkey"
    FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
