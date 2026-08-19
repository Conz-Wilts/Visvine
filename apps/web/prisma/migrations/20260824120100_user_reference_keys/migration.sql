-- Foreign keys for the columns that genuinely REFERENCE a user.
--
-- The tenant axis was already sound: 27 of the 28 tables carrying `space_id`
-- had a cascading foreign key, so deleting a space is one statement and nothing
-- survives it. The user axis was the opposite -- 26 of 32 user-identity columns
-- had no key at all, and correctness depended entirely on
-- lib/account/deleteAccount.ts remembering each one by hand.
--
-- Most of that asymmetry is legitimate and stays (see the doc comment on the
-- User model in schema.prisma): polymorphic keys like `owner_key` cannot have a
-- foreign key, provenance stamps like `uploaded_by` must OUTLIVE the person
-- (cascading a space's Drive files because the uploader closed their account
-- would be a data-loss bug, not integrity), and `context_audit_entries.user_id`
-- is redacted on purpose because an audit log you can erase by leaving is not an
-- audit log.
--
-- What is left after those exclusions is ACCESS and CREDENTIALS, and there the
-- hand-sweep was the only thing standing between a deleted account and:
--
--   * `user_aliases`   -- an owner alias, i.e. admin rights over a live space,
--                        held by a user row that no longer exists.
--   * `oauth_refresh_tokens` / `oauth_auth_codes`
--                      -- an MCP credential that is still exchangeable for an
--                        access token after the account behind it is gone.
--   * `context_access_requests`
--                      -- a pending request attributed to nobody.
--   * `identities`     -- the cross-space canonical identity a deleted account
--                        had claimed.
--
-- Those are foreign keys now, so the database enforces what the sweep intends.
-- The sweep stays: it still does the ordering, the redaction and the personal
-- space, and belt-and-braces is the right posture for account deletion.
--
-- WHY NOT VALID, AND WHY NOTHING IS DELETED HERE.
--
-- An earlier draft of this migration deleted any row referencing a missing user
-- before adding each constraint, so that the constraint could be added valid.
-- That was wrong in a way worth recording, because it looked like tidiness:
--
--   * It is DESTRUCTIVE and unattended. deploy.yml runs migrations against
--     production before building the image, so those DELETEs would run with
--     nobody watching, on a count nobody had seen, and the rows would be gone
--     before anyone could look at them. A row referencing a long-gone user is
--     broken, but "broken" is a conclusion for a person to reach, not a licence
--     for a deploy step to delete data on its way past.
--   * It was not even necessary. NOT VALID creates the constraint's triggers in
--     full -- new inserts and updates are checked, and ON DELETE CASCADE fires
--     exactly as it would otherwise. The only thing skipped is the one-time scan
--     proving the EXISTING rows comply. So the entire protective benefit lands
--     immediately, and the only thing deferred is the audit of history.
--
-- That audit is `pnpm db:constraints:validate`, which validates every unvalidated
-- constraint and prints what fails. Run it after deploying: if it reports orphans
-- here, look at them and decide. Deleting them is then a deliberate act with the
-- rows in front of you, which is what it should always have been.

ALTER TABLE "user_aliases"
  ADD CONSTRAINT "user_aliases_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "context_access_requests"
  ADD CONSTRAINT "context_access_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "oauth_auth_codes"
  ADD CONSTRAINT "oauth_auth_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "identities"
  ADD CONSTRAINT "identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
