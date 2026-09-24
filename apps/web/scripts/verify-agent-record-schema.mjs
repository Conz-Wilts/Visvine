// Read-only check that a database carries the agent-record release: the four
// migrations applied, agent_state's record columns in and schedule_hash out,
// the runs-for and change-log tables in shape, and what still needs the
// db:agents:to-rows backfill or a new model provider.
//
// Every statement is a SELECT inside a READ ONLY transaction.
//
//   node scripts/verify-agent-record-schema.mjs "$PROD_DATABASE_URL"   (Cloud SQL proxy on 127.0.0.1:5433)
//   node scripts/verify-agent-record-schema.mjs                        (DATABASE_URL, local)
import 'dotenv/config';
import pg from 'pg';

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) throw new Error('pass a URL or set DATABASE_URL');
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('BEGIN READ ONLY');
const rows = async (sql, params = []) => (await client.query(sql, params)).rows;
let problems = 0;
const check = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) problems++;
};

const MIGRATIONS = [
  '20260925000000_agent_record',
  '20260925000001_agent_record_checks',
  '20260926000000_agent_fallback_model',
  '20260926000001_drop_openrouter_prices',
];
const applied = new Set(
  (await rows(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name),
);
for (const m of MIGRATIONS) check(applied.has(m), `migration ${m}`);

const columns = async (table) =>
  new Set((await rows(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).map((r) => r.column_name));
const state = await columns('agent_state');
for (const c of ['model', 'fallback_model', 'connectors', 'tools', 'agents', 'schedule', 'timezone', 'runs_as', 'share_mode', 'share_rooms', 'share_as', 'dry_run', 'max_turns', 'configured_at', 'updated_by']) {
  check(state.has(c), `agent_state.${c}`);
}
check(!state.has('schedule_hash'), 'agent_state.schedule_hash dropped');
const subs = await columns('agent_subscriptions');
for (const c of ['at', 'timezone', 'model']) check(subs.has(c), `agent_subscriptions.${c}`);
const changes = await columns('agent_config_changes');
for (const c of ['id', 'space_id', 'name', 'user_id', 'patch', 'at']) check(changes.has(c), `agent_config_changes.${c}`);
const constraints = new Set((await rows(`SELECT conname FROM pg_constraint WHERE conrelid = 'agent_state'::regclass`)).map((r) => r.conname));
check(constraints.has('agent_state_share_mode_check'), 'CHECK agent_state_share_mode_check');
check(constraints.has('agent_state_share_as_check'), 'CHECK agent_state_share_as_check');
const [prices] = await rows(`SELECT count(*)::int AS n FROM agent_model_prices WHERE source = 'openrouter'`);
check(prices.n === 0, `no OpenRouter price rows (${prices.n})`);

console.log('\nData');
const [agents] = await rows(
  `SELECT count(*)::int AS total, count(*) FILTER (WHERE configured_at IS NULL AND shared_from IS NULL)::int AS unrecorded FROM agent_state`,
);
console.log(`  agents: ${agents.total}, still read from their notes (need db:agents:to-rows): ${agents.unrecorded}`);
const openrouterModels = await rows(
  `SELECT space_id, path FROM context_notes WHERE owner_key = 'shared' AND deleted_at IS NULL AND (path LIKE 'models/%' OR path LIKE 'connectors/%') AND content ~* '\\nprovider:\\s*openrouter'`,
);
console.log(`  model notes on OpenRouter (now invalid, need another provider): ${openrouterModels.length}`);
for (const r of openrouterModels) console.log(`    ${r.space_id} ${r.path}`);
const openrouterPins = await rows(
  `SELECT space_id, name, model, fallback_model FROM agent_state WHERE model LIKE 'openrouter/%' OR fallback_model LIKE 'openrouter/%'`,
);
console.log(`  agents pinning an OpenRouter model: ${openrouterPins.length}`);
for (const r of openrouterPins) console.log(`    ${r.space_id} ${r.name} ${r.model ?? ''} ${r.fallback_model ?? ''}`);

await client.query('ROLLBACK');
await client.end();
console.log(problems ? `\n${problems} problem(s)` : '\nSchema OK');
process.exitCode = problems ? 1 : 0;
