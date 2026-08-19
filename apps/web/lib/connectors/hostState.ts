/**
 * `visvine.state` — a connector's small memory between runs.
 *
 * Every run starts in a fresh isolate, which is right for security and wrong
 * for sync: a connector that polls an API needs a cursor, an ETag, a "last seen"
 * id, or it re-reads everything every time. State is that one place, keyed by
 * (space, connector note path, key), and deliberately nothing more — the same
 * caps as a Tool's `visvine.state` (lib/tools/state.ts): 64KB a value, 100
 * keys a connector. Past the key cap a set is REFUSED with a readable error
 * rather than evicting something the connector relies on.
 *
 * It is shared by everyone who runs the connector and it is not private data
 * storage: what belongs in the space belongs in a context note, where it can be
 * searched, shared and audited. Values round-trip through JSON, so what comes
 * back is the same shape that went in and never anything else.
 */
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { STATE_MAX_BYTES, STATE_MAX_KEYS } from '@/lib/tools/state'
import { ConnectorError } from './config'

const KEY_MAX_CHARS = 200

type Capability = (args: unknown[]) => Promise<unknown>

export interface ConnectorStateScope {
  spaceId: string
  /** The connector note's path — `connectors/<name>.md`. */
  path: string
}

function keyOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > KEY_MAX_CHARS) {
    throw new ConnectorError('config', `visvine.state: key must be a string of 1..${KEY_MAX_CHARS} characters`)
  }
  return raw
}

/** One key's value, or null when unset (indistinguishable from a stored null). */
async function getConnectorState(scope: ConnectorStateScope, key: string): Promise<unknown> {
  const row = await prisma.connectorState.findUnique({
    where: { connector_state_identity: { spaceId: scope.spaceId, path: scope.path, key } },
    select: { value: true },
  })
  return row ? (row.value as unknown) : null
}

/**
 * Set one key. `null`/`undefined` clears it. Refuses (throws) when the value
 * is over the byte cap or the connector is at its key cap.
 */
async function setConnectorState(scope: ConnectorStateScope, key: string, value: unknown): Promise<null> {
  const identity = { spaceId: scope.spaceId, path: scope.path, key }
  if (value === null || value === undefined) {
    await prisma.connectorState.deleteMany({ where: identity })
    return null
  }
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new ConnectorError('config', 'visvine.state: value is not JSON-serialisable')
  }
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > STATE_MAX_BYTES) {
    throw new ConnectorError(
      'config',
      `visvine.state: value for "${key}" is ${bytes} bytes; the cap is ${STATE_MAX_BYTES} — keep cursors and etags here, not data`,
    )
  }
  const stored = JSON.parse(json) as Prisma.InputJsonValue
  // Overwrite first: an existing key is always writable, cap or no cap, and a
  // zero count is how a genuinely new key announces itself.
  const updated = await prisma.connectorState.updateMany({ where: identity, data: { value: stored } })
  if (updated.count === 0) {
    const rows = await prisma.connectorState.count({ where: { spaceId: scope.spaceId, path: scope.path } })
    if (rows >= STATE_MAX_KEYS) {
      throw new ConnectorError(
        'config',
        `visvine.state: this connector already holds ${STATE_MAX_KEYS} keys — clear one (set it to null) before adding "${key}"`,
      )
    }
    await prisma.connectorState.create({ data: { ...identity, value: stored } })
  }
  return null
}

/** The two capabilities, installed as `visvine.state.get/set` for one run. */
export function connectorStateCapabilities(scope: ConnectorStateScope): Record<string, Capability> {
  return {
    'state.get': async (args) => getConnectorState(scope, keyOf(args[0])),
    'state.set': async (args) => setConnectorState(scope, keyOf(args[0]), args[1]),
  }
}
