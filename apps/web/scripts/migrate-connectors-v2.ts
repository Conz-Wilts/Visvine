/**
 * Rewrite legacy connector notes (alias: http | postgres | mysql | mcp with
 * per-alias fields) into the v2 perimeter shape (hosts / env / allow /
 * timeout_ms — docs/connectors-v2.md), and append a "Calling this connector"
 * section teaching the agent the commands the old executor used to imply.
 *
 * `alias` is kept verbatim: in v2 it is display metadata (the chip colour),
 * no longer an executor selector.
 *
 * SQL connectors hide their database host inside the DSN secret, which a v2
 * perimeter must state literally — so this script decrypts the DSN (it runs
 * server-side with SECRETS_KEY, exactly like the executors did) and writes the
 * host:port into `hosts:`. The DSN value itself stays a secret reference.
 *
 * Dry-run by default; nothing is written without --write.
 *
 * Usage:
 *   pnpm db:connectors:migrate                # every community, dry-run
 *   pnpm db:connectors:migrate --write
 *   pnpm db:connectors:migrate <communityId> --write
 */

import 'dotenv/config'
import prisma from '../lib/prisma'
import { decryptSecret } from '../lib/crypto/secrets'
import {
  parseConnectorConfig,
  perimeterFromLegacy,
  type ConnectorConfig,
  type ConnectorPerimeter,
} from '../lib/connectors/config'
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from '../lib/notes/shared/markdown'
import { syncContextLinksBulk } from '../lib/notes/entityLinks'
import type { NoteFrontmatter } from '../lib/notes/shared/types'

const WRITE = process.argv.includes('--write')
const communityArg = process.argv[2]?.startsWith('--') ? undefined : process.argv[2]

/**
 * A template as a JS expression: a bare `{{secret:X}}` becomes `env.X`, and
 * anything with surrounding literal text becomes a template literal.
 */
function asJsExpression(template: string): string {
  const bare = template.match(/^\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}$/)
  if (bare) return `env.${bare[1]}`
  const interpolated = template.replace(/\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}/g, '${env.$1}')
  return `\`${interpolated}\``
}

function dsnHost(dsn: string, fallbackPort: number): string {
  const url = new URL(dsn)
  return `${url.hostname}:${url.port || fallbackPort}`
}

/** Headers object literal for a fetch init, with secrets as env references. */
function headersLiteral(headers: Record<string, string>): string {
  const entries = Object.entries(headers)
  if (entries.length === 0) return ''
  return `\n  headers: {\n${entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${asJsExpression(v)},`).join('\n')}\n  },`
}

/** The v2 usage section appended to the body — worked examples per legacy alias. */
function usageSection(config: ConnectorConfig, communityDsnName?: string): string {
  const lines: string[] = ['## Calling this connector', '']
  switch (config.alias) {
    case 'http': {
      const path = config.allow[0] ? config.allow[0].path : '/'
      lines.push(
        'Requests go out through `fetch`, with the secrets below available on `env`.',
        'The response `body` is a string — parse it yourself.',
        '',
        '```js',
        `const res = await fetch('${config.baseUrl}${path}', {${headersLiteral(config.headers)}\n})`,
        'return JSON.parse(res.body)',
        '```',
      )
      if (config.oauth) {
        lines.push(
          '',
          'This API uses OAuth2 client credentials — fetch a token first:',
          '',
          '```js',
          `const tokenRes = await fetch('${config.oauth.tokenUrl}', {`,
          "  method: 'POST',",
          '  body: new URLSearchParams({',
          "    grant_type: 'client_credentials',",
          `    client_id: ${asJsExpression(config.oauth.clientId)},`,
          `    client_secret: ${asJsExpression(config.oauth.clientSecret)},`,
          ...(config.oauth.scope ? [`    scope: ${JSON.stringify(config.oauth.scope)},`] : []),
          '  }).toString(),',
          '})',
          'const { access_token } = JSON.parse(tokenRes.body)',
          '```',
        )
      }
      break
    }
    case 'postgres':
      lines.push(
        'Query with `sql()`; the DSN is on `env` and the session is read-only,',
        'one statement at a time.',
        '',
        '```js',
        `return await sql(env.${communityDsnName}, 'SELECT 1')`,
        '```',
      )
      break
    case 'mysql':
      lines.push(
        `The DSN is on env as env.${communityDsnName} (mysql://user:pass@host:port/db).`,
        '`sql()` reads the scheme and picks the driver; statements stay read-only.',
        '',
        '```js',
        `return await sql(env.${communityDsnName}, 'SELECT 1')`,
        '```',
      )
      break
    case 'mcp': {
      const headerArg = Object.keys(config.headers).length > 0
        ? `, {${Object.entries(config.headers).map(([k, v]) => ` ${JSON.stringify(k)}: ${asJsExpression(v)}`).join(',')} }`
        : ''
      lines.push(
        `A remote MCP server at ${config.url} (streamable HTTP):`,
        '',
        '```js',
        `const server = mcp('${config.url}'${headerArg})`,
        'return await server.listTools()',
        '```',
        '',
        'Call one with `await server.callTool(name, args)`.',
      )
      if (config.allow.length > 0) {
        lines.push('', `Stick to these tools: ${config.allow.join(', ')}.`)
      }
      break
    }
  }
  return lines.join('\n')
}

/** Legacy frontmatter + mapped perimeter → the v2 frontmatter object. */
function v2Frontmatter(fm: NoteFrontmatter, perimeter: ConnectorPerimeter): NoteFrontmatter {
  const out: NoteFrontmatter = { type: 'connector' }
  if (typeof fm.alias === 'string') out.alias = fm.alias
  if (typeof fm.title === 'string') out.title = fm.title
  if (typeof fm.description === 'string') out.description = fm.description
  out.hosts = perimeter.hosts
  if (perimeter.allow.length > 0) {
    out.allow = perimeter.allow.map((r) => `${r.method} ${r.path}${r.prefix ? '*' : ''}`)
  }
  if (Object.keys(perimeter.env).length > 0) out.env = perimeter.env
  out.timeout_ms = perimeter.timeoutMs
  return out
}

async function main() {
  const notes = await prisma.communityNote.findMany({
    where: {
      ...(communityArg ? { communityId: communityArg } : {}),
      path: { startsWith: 'connectors/' },
      deletedAt: null,
    },
    select: { communityId: true, ownerKey: true, path: true, content: true },
  })

  const rewritten: { communityId: string; ownerKey: string; path: string; content: string }[] = []
  let skipped = 0

  for (const note of notes) {
    if (!note.path.endsWith('.md')) continue
    const fm = parseFrontmatter(note.content)
    const isConnector = typeof fm.type === 'string' && fm.type.trim().toLowerCase() === 'connector'
    if (!isConnector) continue
    if (Array.isArray(fm.hosts) || (typeof fm.env === 'object' && fm.env !== null)) {
      continue // already v2
    }
    const parsed = parseConnectorConfig(fm)
    if (!parsed.ok) {
      console.log(`  skip   ${note.communityId} ${note.ownerKey}:${note.path} — invalid legacy config: ${parsed.error}`)
      skipped++
      continue
    }

    const { perimeter } = perimeterFromLegacy(parsed.config)
    let dsnName: string | undefined
    if (parsed.config.alias === 'postgres' || parsed.config.alias === 'mysql') {
      // The one thing the pure shim can't know: the DB host hides in the secret.
      dsnName = Object.keys(perimeter.env)[0]
      const row = await prisma.communitySecret.findUnique({
        where: { secret_identity: { communityId: note.communityId, name: dsnName } },
        select: { ciphertext: true },
      })
      if (!row) {
        console.log(`  skip   ${note.communityId} ${note.ownerKey}:${note.path} — secret ${dsnName} not stored, cannot derive hosts`)
        skipped++
        continue
      }
      try {
        perimeter.hosts = [dsnHost(decryptSecret(row.ciphertext), parsed.config.alias === 'postgres' ? 5432 : 3306)]
      } catch {
        console.log(`  skip   ${note.communityId} ${note.ownerKey}:${note.path} — could not read DSN from ${dsnName}`)
        skipped++
        continue
      }
      if (parsed.config.alias === 'postgres') {
        perimeter.env.PGOPTIONS = '-c default_transaction_read_only=on'
      }
    }

    const body = splitFrontmatter(note.content).body.trimEnd()
    const content = joinFrontmatter(
      v2Frontmatter(fm, perimeter),
      `${body}\n\n${usageSection(parsed.config, dsnName)}\n`,
    )
    rewritten.push({ ...note, content })
    console.log(`  ${WRITE ? 'write' : 'would '} ${note.communityId} ${note.ownerKey}:${note.path} (${parsed.config.alias} → hosts: ${perimeter.hosts.join(', ') || 'none'})`)
  }

  if (WRITE) {
    const byBrain = new Map<string, typeof rewritten>()
    for (const note of rewritten) {
      const key = `${note.communityId} ${note.ownerKey}`
      byBrain.set(key, [...(byBrain.get(key) ?? []), note])
    }
    for (const [key, group] of byBrain) {
      const [communityId, ownerKey] = key.split(' ')
      for (const note of group) {
        await prisma.communityNote.update({
          where: { note_identity: { communityId, ownerKey, path: note.path } },
          data: { content: note.content },
        })
      }
      // Direct table writes bypass the note store, so keep the connector nodes
      // (and their chips) in step ourselves, as the demo seeder does.
      await syncContextLinksBulk(
        { communityId, ownerKey },
        [],
        group.map((n) => [n.path, n.content] as [string, string]),
      )
    }
  }

  console.log(
    `\n${rewritten.length} note(s) ${WRITE ? 'migrated' : 'to migrate (dry-run — pass --write to apply)'}${skipped ? `, ${skipped} skipped` : ''}`,
  )
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
