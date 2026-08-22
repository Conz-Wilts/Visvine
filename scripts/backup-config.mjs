// Assert — and optionally apply — the Cloud SQL backup configuration.
//
// Backups are the one part of this deployment where "it is probably on by
// default" is not an acceptable answer, and where finding out you were wrong
// happens at the worst possible moment. This script makes the intended
// configuration a thing that lives in the repo, gets diffed in review, and can
// be checked on demand:
//
//   automated backups   on, daily, in a window outside NZ working hours
//   retained backups    14 days (Cloud SQL keeps this many automated backups)
//   point-in-time recovery  on, with 7 days of transaction logs — this is what
//                       turns "restore last night" into "restore to 14:32,
//                       one minute before the bad migration"
//   deletion protection on, so nobody drops the instance by autocomplete
//
// Read-only by default. `--apply` writes the configuration; nothing here
// deletes data or touches a backup that already exists.
//
// Usage:
//   node scripts/backup-config.mjs            # check, exit 1 on drift
//   node scripts/backup-config.mjs --apply    # converge, then check
import { execFileSync } from 'node:child_process';

const PROJECT = process.env.PROJECT ?? 'visvine-platform';
const INSTANCE = process.env.SQL_INSTANCE_NAME ?? 'visvine-pgdata';
const APPLY = process.argv.includes('--apply');

// 14:00 UTC is 02:00–03:00 NZDT — outside working hours year-round, and ahead
// of the nightly maintenance sweep so a backup is never taken mid-rewrite.
const WANT = {
  backupsEnabled: true,
  startTime: '14:00',
  retainedBackups: 14,
  pointInTimeRecovery: true,
  transactionLogRetentionDays: 7,
  deletionProtection: true,
};

const gcloud = (args) =>
  execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function describe() {
  return JSON.parse(
    gcloud(['sql', 'instances', 'describe', INSTANCE, `--project=${PROJECT}`, '--format=json']),
  );
}

if (APPLY) {
  console.log(`Applying backup configuration to ${PROJECT}:${INSTANCE} …`);
  gcloud([
    'sql',
    'instances',
    'patch',
    INSTANCE,
    `--project=${PROJECT}`,
    '--backup',
    `--backup-start-time=${WANT.startTime}`,
    `--retained-backups-count=${WANT.retainedBackups}`,
    '--enable-point-in-time-recovery',
    `--retained-transaction-log-days=${WANT.transactionLogRetentionDays}`,
    '--deletion-protection',
    '--quiet',
  ]);
}

const instance = describe();
const cfg = instance.settings?.backupConfiguration ?? {};

const found = {
  backupsEnabled: cfg.enabled === true,
  startTime: cfg.startTime ?? null,
  retainedBackups: cfg.backupRetentionSettings?.retainedBackups ?? null,
  pointInTimeRecovery: cfg.pointInTimeRecoveryEnabled === true,
  transactionLogRetentionDays: cfg.transactionLogRetentionDays ?? null,
  deletionProtection: instance.settings?.deletionProtectionEnabled === true,
};

const problems = [];
for (const [key, want] of Object.entries(WANT)) {
  const got = found[key];
  // Retention longer than intended is not drift worth failing on; shorter is.
  const ok =
    typeof want === 'number' ? typeof got === 'number' && got >= want : got === want;
  if (!ok) problems.push(`  ${key}: want ${want}, found ${got ?? '<unset>'}`);
}

console.log(`\nCloud SQL ${PROJECT}:${INSTANCE}`);
for (const [key, got] of Object.entries(found)) {
  console.log(`  ${problems.some((p) => p.includes(key)) ? '✗' : '✓'} ${key}: ${got ?? '<unset>'}`);
}

if (problems.length > 0) {
  console.error(`\nBackup configuration has drifted:\n${problems.join('\n')}`);
  console.error('\nRun with --apply to converge it.');
  process.exit(1);
}

const latest = instance.settings?.backupConfiguration?.enabled
  ? JSON.parse(
      gcloud([
        'sql',
        'backups',
        'list',
        `--instance=${INSTANCE}`,
        `--project=${PROJECT}`,
        '--limit=1',
        '--format=json',
      ]),
    )[0]
  : null;

// Configuration being right is not the same as a backup having succeeded. The
// most recent one is the only evidence that it has.
if (!latest) {
  console.error('\nBackups are configured but NONE exist yet. Nothing to restore from.');
  process.exit(1);
}
const ageHours = (Date.now() - Date.parse(latest.endTime ?? latest.startTime)) / 3_600_000;
console.log(`\n  latest backup: ${latest.status}, ${ageHours.toFixed(1)}h old (${latest.id})`);
if (latest.status !== 'SUCCESSFUL' || ageHours > 36) {
  console.error('\nThe most recent backup is stale or did not succeed.');
  process.exit(1);
}

console.log('\nBackup configuration is correct and a recent backup exists.');
