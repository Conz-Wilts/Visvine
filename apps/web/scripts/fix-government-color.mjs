import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); if (i < 0) return null;
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }).filter(Boolean)
);
const pool = new pg.Pool({ host: env.DB_HOST, port: +env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

// Replace any slate / dim alias colours with a vivid value, on every community.
// Currently only AU's "Government" alias uses #64748b (slate-500) which reads as grey.
const SLATE_GREY = ['#64748b', '#6b7280', '#94a3b8', '#9ca3af'];
const REPLACEMENT = '#4f46e5'; // indigo-600 — authoritative, distinct from every other alias colour

const client = await pool.connect();
try {
  await client.query('BEGIN');

  const comms = await client.query('SELECT id, name, community_aliases FROM communities');
  let updates = 0;
  for (const c of comms.rows) {
    const aliases = c.community_aliases ?? [];
    let changed = false;
    const fixed = aliases.map(a => {
      if (SLATE_GREY.includes((a.color ?? '').toLowerCase())) {
        console.log(`  [${c.id}] alias "${a.name}" (nodeType=${a.nodeType}): ${a.color} -> ${REPLACEMENT}`);
        changed = true;
        return { ...a, color: REPLACEMENT };
      }
      return a;
    });
    if (changed) {
      await client.query('UPDATE communities SET community_aliases = $1::jsonb WHERE id = $2', [JSON.stringify(fixed), c.id]);
      updates++;
    }
  }
  console.log(`\nUpdated ${updates} community/communities.`);

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ROLLED BACK:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
