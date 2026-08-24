-- Two spaces inside the same parent must have distinct names; across parents,
-- or at the root when private, a name is free (docs/sub-spaces.md).
--
-- Enforced in the app (lib/spaces/hierarchy.ts#findSiblingNameConflict) on
-- every path that creates or renames a child; this partial index is the race
-- backstop, applied out of band exactly like public-space-name-unique.sql.
-- The expression MUST stay identical to normalizePublicName().
CREATE UNIQUE INDEX IF NOT EXISTS spaces_sibling_name_unique
  ON spaces (parent_id, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
  WHERE parent_id IS NOT NULL;
