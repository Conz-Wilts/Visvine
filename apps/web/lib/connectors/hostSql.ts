/**
 * The `sql` a connector's code calls: one read-only query against a database
 * named by a DSN, judged against the same `hosts:` perimeter as HTTP egress.
 *
 * The difference from hostFetch, and the reason this is its own module: the
 * host being judged came out of a DECRYPTED SECRET. In hostFetch the model
 * supplied the URL, so naming it in a refusal tells the model nothing it didn't
 * write. Here, naming the refused host would hand back a piece of the
 * credential. So denials name the ALLOWED hosts — already public, they're in
 * the note — and never the one that was refused.
 */
import { ConnectorError, SANDBOX_LIMITS } from './config'
import { hostAllowed, type GatePerimeter } from './perimeter'
import { assertPubliclyRoutable, SsrfError } from '@/lib/net/ssrf'
import { executePostgresQuery, type QueryResult } from './postgres'
import { executeMysqlQuery } from './mysql'
import type { HostContext } from './hostFetch'

const DEFAULT_PORTS: Record<string, number> = {
  'postgres:': 5432,
  'postgresql:': 5432,
  'mysql:': 3306,
}

/** Rows a single query may return before the rest is dropped. */
const MAX_ROWS = 1_000

/**
 * The refusal text for a DSN pointing somewhere the note doesn't list.
 *
 * Deliberately says nothing about where it DID point. The remedy is named
 * because a legacy v1 SQL note has empty `hosts:` by construction — its host
 * lived inside the DSN — so this is the error those notes hit first, and the
 * migration is what fixes them.
 */
function dsnDenial(perimeter: GatePerimeter): string {
  return perimeter.hosts.length === 0
    ? "sql denied: this connector lists no hosts, so it has no database access — add the database host to `hosts:` in the note, or run `pnpm db:connectors:migrate` to derive it"
    : `sql denied: this connector's DSN points at a host that is not in its hosts (${perimeter.hosts.join(', ')}) — add it to the note, or run \`pnpm db:connectors:migrate\``
}

/**
 * Run one read-only query. `dsn` is expected to come from `env`, i.e. from a
 * secret the admin stored; the query is whatever the connector's code built.
 */
export async function hostSql(ctx: HostContext, rawDsn: unknown, rawQuery: unknown): Promise<QueryResult> {
  if (typeof rawDsn !== 'string' || rawDsn.length === 0) {
    throw new ConnectorError('config', 'sql needs a DSN string — pass the connector env var holding it')
  }
  if (typeof rawQuery !== 'string' || rawQuery.trim().length === 0) {
    throw new ConnectorError('config', 'sql needs a query string')
  }

  let url: URL
  try {
    url = new URL(rawDsn)
  } catch {
    // Never echo the DSN, even malformed — it may still hold the password.
    throw new ConnectorError('config', 'The connector DSN is not a valid postgres:// or mysql:// URL')
  }

  const defaultPort = DEFAULT_PORTS[url.protocol]
  if (defaultPort === undefined) {
    throw new ConnectorError('config', 'sql supports postgres:// and mysql:// DSNs only')
  }

  const port = url.port ? Number(url.port) : defaultPort
  if (!hostAllowed(ctx.perimeter.hosts, url.hostname, port, defaultPort)) {
    throw new ConnectorError('denied', ctx.deny(dsnDenial(ctx.perimeter)))
  }
  try {
    await assertPubliclyRoutable(url.hostname, { allowPrivate: ctx.perimeter.allowPrivate })
  } catch (e) {
    if (e instanceof SsrfError) {
      // The SSRF message names the address it rejected, so it cannot be passed
      // through here the way hostFetch passes it — say only that it was refused.
      throw new ConnectorError('ssrf', ctx.deny('sql denied: the DSN resolves into private address space'))
    }
    throw e
  }

  // The query gets whatever wall clock the run has left, never more.
  const remaining = ctx.deadline - Date.now()
  if (remaining <= 0) throw new ConnectorError('timeout', 'The connector run ran out of time')
  const options = {
    timeoutMs: Math.min(remaining, SANDBOX_LIMITS.timeoutMs.max),
    maxRows: MAX_ROWS,
  }

  return url.protocol === 'mysql:'
    ? executeMysqlQuery(rawDsn, rawQuery, options)
    : executePostgresQuery(rawDsn, rawQuery, options)
}
