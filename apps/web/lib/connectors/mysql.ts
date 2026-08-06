/**
 * The MySQL capability — the postgres one's shape with the dialect swapped:
 * backtick identifiers and `#` comments in the statement guard instead of
 * dollar-quoting, `START TRANSACTION READ ONLY` plus `max_execution_time`
 * instead of `statement_timeout`, and mysql2 error numbers in place of
 * SQLSTATEs. Each query gets a fresh short-lived connection that is always
 * destroyed.
 *
 * As with postgres.ts, the perimeter gate lives in lib/connectors/hostSql and
 * has already judged the DSN before this module runs.
 */
import { createConnection, type FieldPacket } from 'mysql2/promise'
import { ConnectorError, redactSecrets } from './config'
import { toCell, type QueryResult, type SqlQueryOptions } from './postgres'

const CONNECT_TIMEOUT_MS = 5_000
const READ_KEYWORDS = new Set(['select', 'with', 'values', 'table', 'explain', 'show', 'describe', 'desc'])

/**
 * Reject multi-statement SQL and anything not SELECT-shaped, in MySQL's
 * dialect: strings are '' or "" (with backslash escapes), identifiers are
 * backticked, and comments are `--`, `#` or nestable block comments. Pure
 * and exported for tests.
 */
export function assertSingleReadOnlyMysqlStatement(sql: string): void {
  let stripped = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      while (i < n) {
        if (sql[i] === '\\') i += 2
        else if (sql[i] === quote && sql[i + 1] === quote) i += 2
        else if (sql[i] === quote) break
        else i++
      }
      i++
    } else if (ch === '`') {
      i++
      while (i < n && sql[i] !== '`') i++
      i++
    } else if (two === '--' || ch === '#') {
      while (i < n && sql[i] !== '\n') i++
    } else if (two === '/*') {
      let depth = 0
      do {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2 }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2 }
        else i++
      } while (i < n && depth > 0)
    } else {
      stripped += ch
      i++
    }
  }

  const body = stripped.trim().replace(/;+\s*$/, '')
  if (body.includes(';')) {
    throw new ConnectorError('denied', 'Only a single SQL statement is allowed')
  }
  const keyword = body.replace(/^[(\s]+/, '').match(/^([A-Za-z]+)/)?.[1]?.toLowerCase()
  if (!keyword || !READ_KEYWORDS.has(keyword)) {
    throw new ConnectorError(
      'denied',
      'Only read statements are allowed (SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW, DESCRIBE)',
    )
  }
}

export async function executeMysqlQuery(
  dsn: string,
  sql: string,
  options: SqlQueryOptions,
): Promise<QueryResult> {
  assertSingleReadOnlyMysqlStatement(sql)

  // Never let the DSN (or its password) surface in anything the model sees.
  let password = ''
  try {
    password = decodeURIComponent(new URL(dsn).password)
  } catch {
    throw new ConnectorError('config', 'The connector DSN is not a valid mysql:// URL')
  }
  const sensitive = [dsn, password].filter((s) => s.length > 0)

  let conn
  try {
    conn = await createConnection({ uri: dsn, connectTimeout: CONNECT_TIMEOUT_MS, rowsAsArray: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    throw new ConnectorError('upstream', redactSecrets(message, sensitive))
  }
  try {
    await conn.query('START TRANSACTION READ ONLY')
    // max_execution_time only bounds SELECT; the JS race below covers the rest.
    await conn.query(`SET SESSION max_execution_time = ${Math.floor(options.timeoutMs)}`)
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new ConnectorError('timeout', `Query timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs,
      ).unref?.(),
    )
    const [allRows, fields] = (await Promise.race([conn.query(sql), timeout])) as [
      unknown[][],
      FieldPacket[],
    ]
    await conn.query('ROLLBACK')

    const all = Array.isArray(allRows) ? allRows : []
    const rows = all.slice(0, options.maxRows).map((row) => (row as unknown[]).map(toCell))
    return {
      columns: (fields ?? []).map((f) => f.name),
      rows,
      row_count: rows.length,
      truncated: all.length > options.maxRows,
    }
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    const errno = (e as { errno?: number }).errno
    if (errno === 3024) {
      throw new ConnectorError('timeout', `Query timed out after ${options.timeoutMs}ms`)
    }
    const message = e instanceof Error ? e.message : String(e)
    if (errno === 1792 || /read.only/i.test(message)) {
      throw new ConnectorError('denied', 'This connector is read-only')
    }
    throw new ConnectorError('upstream', redactSecrets(message, sensitive))
  } finally {
    conn.destroy()
  }
}
