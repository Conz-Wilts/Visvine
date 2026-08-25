-- Sign-in is Google OAuth only. There is no endpoint that sets a password and
-- none that checks one, so every hash in this column is a credential nothing
-- would honour — keeping it would only be a store of secrets with no reader.
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
