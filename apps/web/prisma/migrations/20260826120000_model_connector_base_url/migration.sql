-- The custom model endpoint moved from a Space column to the `base_url:` of
-- the Space's `provider: custom` model connector note (lib/connectors/model.ts).
-- The column's only field, { customEndpoint: { baseURL } }, is dropped with it;
-- an admin re-enters the URL on the connector's page.
ALTER TABLE "spaces" DROP COLUMN "agent_config";
