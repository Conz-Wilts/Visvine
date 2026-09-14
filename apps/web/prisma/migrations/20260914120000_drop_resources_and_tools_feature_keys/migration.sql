-- `resources` and `tools` stop being feature keys.
--
-- Neither was ever a tool. The Drive is a TAB of the directory (Grid, Context,
-- Resources) and a Tool is one of the directory's NODES, so both are gated on
-- `directory` now, and the folders they fill — `resources/`, `tools/` — are the
-- directory's namespaces (lib/notes/shared/namespaces.ts). Both keys were core,
-- so neither could ever answer false: nothing in the app changes state here.
--
-- What is left is drift. A space carries whatever its console last wrote, and
-- rows written while the two were toggleable still name them in `enabled` and
-- in the sidebar arrays. `sanitizeFeatureConfig` drops an unknown key on the
-- next save, so those entries would linger until something unrelated saved the
-- space — a stored answer to a question the code no longer asks. This clears
-- them in one pass.
--
-- `tool:<slug>` rail keys are NOT touched: each names one INSTALLED Tool and is
-- the only Tools switch a space really has. The comparisons below are exact, so
-- `tools` goes and `tool:kanban` stays.

-- enabled: the on/off map, keyed by feature.
UPDATE "spaces"
SET "feature_config" = jsonb_set(
        "feature_config",
        '{enabled}',
        ("feature_config" -> 'enabled') - 'resources' - 'tools'
    )
WHERE jsonb_typeof("feature_config" -> 'enabled') = 'object'
  AND ("feature_config" -> 'enabled') ?| ARRAY['resources', 'tools'];

-- order: the sidebar's display order. Ordinality keeps the rest in place.
UPDATE "spaces"
SET "feature_config" = jsonb_set(
        "feature_config",
        '{order}',
        COALESCE(
            (
                SELECT jsonb_agg(key ORDER BY n)
                FROM jsonb_array_elements("feature_config" -> 'order') WITH ORDINALITY AS t(key, n)
                WHERE key NOT IN ('"resources"'::jsonb, '"tools"'::jsonb)
            ),
            '[]'::jsonb
        )
    )
WHERE jsonb_typeof("feature_config" -> 'order') = 'array'
  AND ("feature_config" -> 'order') ?| ARRAY['resources', 'tools'];

-- more: the rows tucked into the "More" popup.
UPDATE "spaces"
SET "feature_config" = jsonb_set(
        "feature_config",
        '{more}',
        COALESCE(
            (
                SELECT jsonb_agg(key ORDER BY n)
                FROM jsonb_array_elements("feature_config" -> 'more') WITH ORDINALITY AS t(key, n)
                WHERE key NOT IN ('"resources"'::jsonb, '"tools"'::jsonb)
            ),
            '[]'::jsonb
        )
    )
WHERE jsonb_typeof("feature_config" -> 'more') = 'array'
  AND ("feature_config" -> 'more') ?| ARRAY['resources', 'tools'];

-- adminOnly: the rows locked to admins. Neither key could ever be locked (both
-- were nav-hidden, which adminOnlyFeatureKeys filters out), but a client could
-- still store the name, so clear it with the others.
UPDATE "spaces"
SET "feature_config" = jsonb_set(
        "feature_config",
        '{adminOnly}',
        COALESCE(
            (
                SELECT jsonb_agg(key ORDER BY n)
                FROM jsonb_array_elements("feature_config" -> 'adminOnly') WITH ORDINALITY AS t(key, n)
                WHERE key NOT IN ('"resources"'::jsonb, '"tools"'::jsonb)
            ),
            '[]'::jsonb
        )
    )
WHERE jsonb_typeof("feature_config" -> 'adminOnly') = 'array'
  AND ("feature_config" -> 'adminOnly') ?| ARRAY['resources', 'tools'];
