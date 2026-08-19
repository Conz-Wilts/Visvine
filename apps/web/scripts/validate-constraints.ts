/**
 * Validate every NOT VALID constraint — CHECK and FOREIGN KEY — and show what fails.
 *
 *   pnpm db:constraints:validate          # validate, reporting any violations
 *   pnpm db:constraints:validate --dry    # report status only, change nothing
 *
 * Two migrations add constraints as NOT VALID —
 * 20260824120200_enum_check_constraints (CHECK) and
 * 20260824120100_user_reference_keys (FOREIGN KEY). NOT VALID means Postgres
 * creates the constraint's triggers in full — every insert and update is
 * checked, and ON DELETE CASCADE fires exactly as it would otherwise — and skips
 * only the one-time scan proving EXISTING rows comply.
 *
 * That split is deliberate. deploy.yml migrates production BEFORE it builds the
 * image, so a migration that aborts on one unexpected legacy row leaves
 * production half-migrated with the old image serving. Adding the constraint is
 * the part that must never fail; PROVING the old rows comply is the part that is
 * allowed to. The alternative — deleting the offending rows inside the migration
 * so it can be added valid — is destructive, unattended, and runs on a count
 * nobody has seen.
 *
 * This is that second part, moved somewhere it can fail safely. For each
 * unvalidated constraint it runs VALIDATE CONSTRAINT, and when a CHECK fails it
 * re-queries the table to show exactly which values are the problem — because
 * "constraint violated" without the offending value is a puzzle, and the answer
 * is usually a legacy spelling that belongs on the constraint rather than a bug.
 * (That is not hypothetical: it is how `identity_resolutions.decision` was found
 * to be missing 'created', a value 624 rows legitimately held.)
 *
 * A failing FOREIGN KEY means rows point at a user that no longer exists. This
 * reports them and stops there — deleting is a deliberate act to take with the
 * rows in front of you, not something a validation script should do for you.
 *
 * Idempotent and cheap to re-run: Postgres records a validated constraint as
 * validated, and this skips those. VALIDATE takes only a SHARE UPDATE EXCLUSIVE
 * lock, so reads and writes continue while it scans.
 */
import 'dotenv/config'
import prisma from '../lib/prisma'

interface PendingConstraint {
  table: string
  name: string
  definition: string
  /** 'c' = CHECK, 'f' = FOREIGN KEY. */
  kind: string
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

/** Every CHECK or FOREIGN KEY constraint in public that has not been validated. */
async function pending(): Promise<PendingConstraint[]> {
  return prisma.$queryRaw<PendingConstraint[]>`
    SELECT rel.relname AS table, con.conname AS name,
           pg_get_constraintdef(con.oid) AS definition, con.contype::text AS kind
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND con.contype IN ('c', 'f') AND NOT con.convalidated
    ORDER BY rel.relname, con.conname`
}

/**
 * The column a CHECK constraint is about, pulled out of its definition.
 * Good enough for the reporting path: every constraint this validates is of the
 * form CHECK ((col = ANY (...))) or CHECK ((col IS NULL) OR ...).
 */
function columnOf(definition: string): string | null {
  const m = definition.match(/\(\((\w+)\)?::/) ?? definition.match(/\(\((\w+)\s/)
  return m ? m[1] : null
}

/** The distinct values in `column` that the constraint rejects, with counts. */
async function offenders(
  table: string,
  column: string,
  name: string,
): Promise<Array<{ value: string | null; rows: bigint }>> {
  // The constraint name is interpolated into a NOT clause via its own
  // definition rather than rebuilt, so the report can never disagree with what
  // Postgres actually checked.
  const [row] = await prisma.$queryRawUnsafe<Array<{ definition: string }>>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = $1`,
    name,
  )
  const check = row.definition.replace(/^CHECK\s*/i, '').replace(/\s+NOT VALID$/i, '')
  return prisma.$queryRawUnsafe(
    `SELECT ${column}::text AS value, count(*) AS rows
     FROM ${table}
     WHERE NOT (${check})
     GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  )
}

async function main(): Promise<void> {
  const dry = flag('dry')
  const todo = await pending()

  if (todo.length === 0) {
    console.log('Every constraint is validated. The database agrees with the schema.')
    return
  }

  console.log(`${todo.length} constraint(s) not yet validated against existing rows.\n`)
  if (dry) {
    for (const c of todo) console.log(`  ${c.table}.${c.name}`)
    console.log('\n--dry: nothing was validated. Re-run without it to check the rows.')
    return
  }

  let ok = 0
  let bad = 0
  for (const c of todo) {
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${c.table}" VALIDATE CONSTRAINT "${c.name}"`,
      )
      console.log(`  ok       ${c.table}.${c.name}`)
      ok++
    } catch {
      // The failure detail is the offending VALUES, queried below — the raw
      // constraint-violation message names the constraint we already know.
      bad++
      console.log(`  VIOLATED ${c.table}.${c.name}`)
      console.log(`           ${c.definition}`)
      if (c.kind === 'f') {
        // A failing FK means rows reference a row that is gone. Report and stop:
        // what to do about them is a judgement call with the rows in front of you.
        console.log(
          '           → rows here reference a user that no longer exists.\n' +
            '             Inspect them before deciding; this script never deletes.',
        )
        continue
      }
      const column = columnOf(c.definition)
      if (!column) {
        console.log('           (could not identify the column to report offending values)')
        continue
      }
      try {
        const rows = await offenders(c.table, column, c.name)
        for (const r of rows) {
          console.log(`           ${r.rows} row(s) hold ${JSON.stringify(r.value)}`)
        }
        console.log(
          '           → either the value is legitimate and belongs on the constraint,\n' +
            '             or it is a bug and those rows need correcting. Fix, then re-run.',
        )
      } catch (reportErr) {
        console.log(`           (could not list offending values: ${String(reportErr)})`)
      }
    }
  }

  console.log(`\n${ok} validated, ${bad} still violated.`)
  if (bad > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
