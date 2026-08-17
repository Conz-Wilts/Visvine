// Import a markdown vault on disk into a space's context.
// Reads <vault>/**/*.md (skipping dotfolders like .trash / .history) and upserts
// each as a ContextNote row, preserving the folder layout in the `path`. Once
// imported the notes live in the DB (the source-of-truth markdown is `content`).
//
// Usage (local only — guarded):
//   node scripts/import-notes-vault.mjs --space community:blackbird-ventures --vault <dir> [--scope shared|personal] [--owner <userId>] [--created-by <userId>]
//   pnpm db:notes-vault -- --space community:blackbird-ventures --vault ../vault
//
// Defaults: --scope shared, --vault $NOTES_VAULT_DIR. For --scope personal you
// must pass --owner <userId> (the context owner). created_by is resolved to a
// space admin if not given.

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import pg from 'pg'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const vaultArg = arg('vault', process.env.NOTES_VAULT_DIR)
const VAULT_ROOT = vaultArg
  ? (vaultArg.startsWith('/') ? vaultArg : join(process.cwd(), vaultArg))
  : null

const spaceId = arg('space')
const scope = arg('scope', 'shared')
const owner = arg('owner')
let createdBy = arg('created-by')

if (!spaceId) {
  console.error('import-notes-vault: --space <id> is required')
  process.exit(1)
}
if (scope !== 'shared' && scope !== 'personal') {
  console.error('import-notes-vault: --scope must be "shared" or "personal"')
  process.exit(1)
}
if (scope === 'personal' && !owner) {
  console.error('import-notes-vault: --owner <userId> is required for --scope personal')
  process.exit(1)
}
const ownerKey = scope === 'shared' ? 'shared' : owner

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD ?? '')}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME}`
    : null)
if (!connectionString) throw new Error('import-notes-vault: no DATABASE_URL resolved from apps/web/.env')

// Recursively collect .md files under the vault, skipping dotfolders.
function collect(dir, baseSegments = []) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collect(full, [...baseSegments, entry.name]))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push({ path: [...baseSegments, entry.name].join('/'), content: readFileSync(full, 'utf8') })
    }
  }
  return out
}

async function main() {
  if (!VAULT_ROOT) {
    console.error('import-notes-vault: --vault <dir> (or NOTES_VAULT_DIR) is required')
    process.exit(1)
  }
  try {
    statSync(VAULT_ROOT)
  } catch {
    console.error(`import-notes-vault: vault not found at ${VAULT_ROOT}`)
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString })
  const client = await pool.connect()
  try {
    const space = await client.query('SELECT id FROM spaces WHERE id = $1', [spaceId])
    if (space.rowCount === 0) {
      console.error(`import-notes-vault: space "${spaceId}" not found`)
      process.exit(1)
    }

    if (!createdBy) {
      // Membership carries no role — an admin is someone holding a Person
      // alias flagged `owner`/`system` in spaces.aliases
      // (lib/auth.ts#isAdmin). Prefer one of those, else the earliest member.
      const admin = await client.query(
        `SELECT uc.user_id FROM space_members uc
          WHERE uc.space_id = $1
          ORDER BY EXISTS (
            SELECT 1 FROM user_aliases ua
              JOIN spaces c ON c.id = uc.space_id
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.aliases, '[]'::jsonb)) AS a
             WHERE ua.space_id = uc.space_id
               AND ua.user_id = uc.user_id
               AND ua.alias_id = a->>'id'
               AND (a->>'owner' = 'true' OR a->>'system' = 'true')
          ) DESC, uc.joined_at ASC
          LIMIT 1`,
        [spaceId],
      )
      createdBy = admin.rows[0]?.user_id
      if (!createdBy) {
        console.error('import-notes-vault: no members found for space; pass --created-by <userId>')
        process.exit(1)
      }
    }

    // Keep the starred column in sync with the file's frontmatter `starred:` flag
    // (the app re-derives it on every write; imports must match).
    const isStarred = (content) =>
      content.startsWith('---\n') &&
      /(^|\n)starred\s*:\s*true/i.test(content.split('\n---')[0] ?? '')

    const notes = collect(VAULT_ROOT)
    let imported = 0
    for (const note of notes) {
      await client.query(
        `INSERT INTO context_notes (space_id, owner_key, path, content, created_by, starred, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (space_id, owner_key, path)
         DO UPDATE SET content = EXCLUDED.content, starred = EXCLUDED.starred, updated_at = now()`,
        [spaceId, ownerKey, note.path, note.content, createdBy, isStarred(note.content)],
      )
      imported++
    }

    console.log(
      `import-notes-vault: imported ${imported} note(s) into ${spaceId} / ${scope} context (owner_key=${ownerKey}, created_by=${createdBy}).`,
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
