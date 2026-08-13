-- Normalize the physical table names. Every table in this schema is snake_case
-- plural; three were not, and one of those ("user") is a SQL reserved word that
-- had to be double-quoted in every hand-written query. Prisma model names are
-- unchanged — this only moves the @@map targets.
--
--   user      -> users
--   persons   -> people
--   audit_log -> audit_logs
--
-- Indexes and constraints are renamed alongside so they keep matching the names
-- Prisma would generate for the new table, and drift checks stay quiet.

ALTER TABLE "user" RENAME TO users;
ALTER INDEX "user_pkey" RENAME TO users_pkey;
ALTER INDEX "user_email_key" RENAME TO users_email_key;
ALTER INDEX "user_claim_nonce_key" RENAME TO users_claim_nonce_key;
ALTER INDEX "user_google_id_key" RENAME TO users_google_id_key;

ALTER TABLE persons RENAME TO people;
ALTER INDEX persons_pkey RENAME TO people_pkey;
ALTER INDEX persons_user_id_key RENAME TO people_user_id_key;
ALTER TABLE people RENAME CONSTRAINT persons_user_id_fkey TO people_user_id_fkey;

ALTER TABLE audit_log RENAME TO audit_logs;
ALTER INDEX audit_log_pkey RENAME TO audit_logs_pkey;
ALTER INDEX audit_log_actor_id_idx RENAME TO audit_logs_actor_id_idx;
ALTER INDEX audit_log_community_id_idx RENAME TO audit_logs_community_id_idx;
ALTER INDEX audit_log_created_at_idx RENAME TO audit_logs_created_at_idx;
ALTER INDEX audit_log_target_id_idx RENAME TO audit_logs_target_id_idx;
