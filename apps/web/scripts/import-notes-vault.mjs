// Import the blackbird-brain markdown vault into a community's notes brain.
// Reads blackbird-brain/.data/vault/**/*.md (skipping dotfolders like .trash /
// .history) and upserts each as a CommunityNote row, preserving the folder
// layout in the `path`. The vault is the seed source; once imported, notes live
// in the DB (the source-of-truth markdown is in `content`).
//
// Usage (local only — guarded):
//   node scripts/import-notes-vault.mjs --community community:local-dev [--scope shared|personal] [--owner <userId>] [--created-by <userId>]
//   pnpm db:notes-vault -- --community community:local-dev
//
// Defaults: --scope shared. For --scope personal you must pass --owner <userId>
// (the brain owner). created_by is resolved to a community admin if not given.

import '../../../scripts/guard-local-db.mjs'
import 'dotenv/config'
import pg from 'pg'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const VAULT_ROOT = join(__dirname, '..', '..', '..', 'blackbird-brain', '.data', 'vault')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const communityId = arg('community')
const scope = arg('scope', 'shared')
const owner = arg('owner')
let createdBy = arg('created-by')

if (!communityId) {
  console.error('import-notes-vault: --community <id> is required')
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
  try {
    statSync(VAULT_ROOT)
  } catch {
    console.error(`import-notes-vault: vault not found at ${VAULT_ROOT}`)
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString })
  const client = await pool.connect()
  try {
    const community = await client.query('SELECT id FROM communities WHERE id = $1', [communityId])
    if (community.rowCount === 0) {
      console.error(`import-notes-vault: community "${communityId}" not found`)
      process.exit(1)
    }

    if (!createdBy) {
      const admin = await client.query(
        `SELECT user_id FROM user_communities WHERE community_id = $1 ORDER BY (role = 'admin') DESC, joined_at ASC LIMIT 1`,
        [communityId],
      )
      createdBy = admin.rows[0]?.user_id
      if (!createdBy) {
        console.error('import-notes-vault: no members found for community; pass --created-by <userId>')
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
        `INSERT INTO community_notes (community_id, owner_key, path, content, created_by, starred, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (community_id, owner_key, path)
         DO UPDATE SET content = EXCLUDED.content, starred = EXCLUDED.starred, updated_at = now()`,
        [communityId, ownerKey, note.path, note.content, createdBy, isStarred(note.content)],
      )
      imported++
    }

    console.log(
      `import-notes-vault: imported ${imported} note(s) into ${communityId} / ${scope} brain (owner_key=${ownerKey}, created_by=${createdBy}).`,
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
