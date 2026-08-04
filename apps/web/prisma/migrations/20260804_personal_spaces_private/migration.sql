-- Personal spaces (personal_owner_id set) were created without an explicit
-- visibility, so they inherited the column default 'public'. They are meant to
-- be private — hidden from Discover and joinable by nobody but their owner.
UPDATE communities
SET visibility = 'private'
WHERE personal_owner_id IS NOT NULL
  AND visibility <> 'private';
