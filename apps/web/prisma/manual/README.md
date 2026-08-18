# Manual migrations

SQL that must **not** run automatically.

`prisma migrate deploy` applies every pending migration in one go, and the deploy
pipeline (`.github/workflows/deploy.yml`) migrates **before** the new image is
serving. That ordering is right for additive changes and wrong for destructive
ones: a `DROP COLUMN` applied there lands while the *old* image is still handling
traffic and still selecting that column.

So anything that breaks the currently-deployed code lives here instead, and a
person runs it once the new image is live.

## The pattern

Split a destructive schema change in two:

1. **Expand** — additive only (add the new column, backfill it, leave the old one
   alone). Goes in `prisma/migrations/` and rides the normal deploy. Safe to run
   against production while the old code is still serving.
2. **Contract** — the drops and any content rewrite that would confuse the old
   UI. Goes here. Run by hand after the deploy, once nothing reads the old shape.

Write both idempotently (`IF EXISTS` / `IF NOT EXISTS`, guarded `UPDATE`s) so a
re-run is a no-op and a partially-applied state can be finished off.

## Running one

```bash
# 1. Take a backup — these are one-way.
gcloud sql backups create --instance=visvine-pgdata

# 2. Point DATABASE_URL at the target, then, from apps/web:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/<file>.sql
```

Afterwards, `prisma migrate diff` should report no drift against
`schema.prisma`. Optionally fold it into prisma's history with
`prisma migrate dev --create-only` and paste the SQL in.

## Pending

Nothing.

## Applied

| File | Applied | What it did |
|---|---|---|
| `20260818140000_icons_drop_emoji_columns.sql` | prod 2026-08-18 | Converted `conversations.icon` from emoji to owned icon names, then dropped `channel_sections.emoji` and `spaces.emoji`. Phase 2 of `20260818120000_icons_replace_emoji`. See `docs/icons.md`. |

Files are kept after they run: they are idempotent, and a database restored from
an older backup may still need them.
