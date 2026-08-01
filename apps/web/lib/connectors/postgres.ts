/**
 * The Postgres connector executor. Deliberately NOT the app's Prisma
 * singleton — a connector DSN is a foreign database, so each query gets a
 * fresh short-lived pg Client that is always ended.
 *
 * Read-only is enforced in layers: a pure statement guard rejects anything
 * that isn't a single SELECT-shaped statement (cheap, clear errors), and the
 * query then runs inside `BEGIN TRANSACTION READ ONLY` with a statement
 * timeout — the transaction is what actually stops a write that slips past
 * string analysis (e.g. a writing CTE or function).
 */
import { Client } from 'pg'
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import { allowPrivateHosts, ConnectorError, redactSecrets, type PostgresConnectorConfig } from './config'

const CONNECT_TIMEOUT_MS = 5_000
const CELL_CAP_CHARS = 4_096
const READ_KEYWORDS = new Set(['select', 'with', 'values', 'table', 'explain', 'show'])

/**
 * Reject multi-statement SQL and anything not SELECT-shaped. Pure and exported
 * for tests. Strips string literals ('' escapes), dollar-quoted strings,
 * quoted identifiers, and both comment forms before looking for `;`.
 */
export function assertSingleReadOnlyStatement(sql: string): void {
  let stripped = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (ch === "'") {
      i++
      while (i < n && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1
      i++
    } else if (ch === '"') {
      i++
      while (i < n && sql[i] !== '"') i++
      i++
    } else if (ch === '$') {
      const tag = sql.slice(i).match(/^\$[A-Za-z_]*\$/)
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length)
        if (close < 0) throw new ConnectorError('denied', 'Unterminated dollar-quoted string')
        i = close + tag[0].length
      } else {
        stripped += ch
        i++
      }
    } else if (two === '--') {
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
      'Only read statements are allowed (SELECT, WITH, VALUES, TABLE, EXPLAIN, SHOW)',
    )
  }
}

export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  row_count: number
  truncated: boolean
}

/** JSON-safe, size-capped cell for the tool result. */
function toCell(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value)
            } catch {
              return String(value)
            }
          })()
  return text.length > CELL_CAP_CHARS ? text.slice(0, CELL_CAP_CHARS) + '…' : text
}

export async function executePostgresQuery(
  config: PostgresConnectorConfig,
  dsn: string,
  sql: string,
): Promise<QueryResult> {
  assertSingleReadOnlyStatement(sql)

  let host: string
  let password: string
  try {
    const url = new URL(dsn)
    host = url.hostname
    password = decodeURIComponent(url.password)
  } catch {
    throw new ConnectorError('config', 'The connector DSN is not a valid postgres:// URL')
  }
  // Never let the DSN (or its password) surface in anything the model sees.
  const sensitive = [dsn, password].filter((s) => s.length > 0)

  try {
    await assertPubliclyRoutable(host, { allowPrivate: allowPrivateHosts() })
  } catch (e) {
    if (e instanceof SsrfError) throw new ConnectorError('ssrf', e.message)
    throw e
  }

  const client = new Client({ connectionString: dsn, connectionTimeoutMillis: CONNECT_TIMEOUT_MS })
  try {
    await client.connect()
    await client.query('BEGIN TRANSACTION READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${Math.floor(config.timeoutMs)}`)
    const result = await client.query({ text: sql, rowMode: 'array' })
    await client.query('ROLLBACK')

    const all = result.rows ?? []
    const rows = all.slice(0, config.maxRows).map((row: unknown[]) => row.map(toCell))
    return {
      columns: (result.fields ?? []).map((f) => f.name),
      rows,
      row_count: rows.length,
      truncated: all.length > config.maxRows,
    }
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    const pgCode = (e as { code?: string }).code
    if (pgCode === '57014') {
      throw new ConnectorError('timeout', `Query timed out after ${config.timeoutMs}ms`)
    }
    const message = e instanceof Error ? e.message : String(e)
    if (pgCode === '25006' || /read-only transaction/i.test(message)) {
      throw new ConnectorError('denied', 'This connector is read-only')
    }
    throw new ConnectorError('upstream', redactSecrets(message, sensitive))
  } finally {
    await client.end().catch(() => {})
  }
}
