/**
 * Stored OAuth connections: reading them, refreshing them, and saying something
 * useful when there isn't one.
 *
 * This is the half of connector OAuth that runs on every call, as opposed to
 * lib/connectors/oauth.ts which runs once when somebody clicks Connect.
 *
 * Three behaviours here are load-bearing rather than incidental:
 *
 *  1. NO CONNECTION IS NOT AN ERROR, IT IS AN INSTRUCTION. A connector isolate
 *     cannot open a browser, so the only thing that helps a caller sitting in
 *     an MCP client is a message naming the link to click. `ConnectorError`
 *     surfaces to the model as catchable text, so a step-up reads as a next
 *     step rather than a failure.
 *  2. REFRESH IS COMPARE-AND-SWAP. Providers commonly rotate refresh tokens and
 *     invalidate the old one on use, so two concurrent runs refreshing the same
 *     connection can leave one holding a retired token and the connection dead.
 *     The write is therefore conditional on the row not having moved since it
 *     was read; the loser re-reads and uses the winner's token. A lock is the
 *     obvious alternative and is the wrong tool here — holding one across an
 *     HTTP round trip to the provider means holding a pooled connection across
 *     it too, and lock/unlock would not even be guaranteed the same connection.
 *  3. A DEAD CONNECTION IS RECORDED, NOT DELETED. An agent failing at 3am
 *     should leave behind which connection broke and why, so somebody can be
 *     told to reconnect. Deleting the row loses that.
 */
import prisma from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { spaceAdminUserIds } from '@/lib/auth'
import { notify } from '@/lib/notifications/service'
import { ConnectorError } from './config'
import { connectionOwner, type ConnectorAuth } from './auth'
import { refreshTokens, resolveEndpoints, type TokenSet } from './oauth'

/** Renew this far ahead of expiry, so a long run doesn't age out mid-flight. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** A live bearer plus the label the UI shows. */
export interface ResolvedConnection {
  provider: string
  accessToken: string
  /** '' for a space connection. */
  userId: string
  mode: 'user' | 'space'
  /** "sarah@…", or null when the provider told us nothing. */
  accountLabel: string | null
}

interface ConnectionSummary {
  provider: string
  mode: string
  userId: string
  accountLabel: string | null
  scopes: string[]
  expiresAt: Date | null
  broken: { at: Date; reason: string | null } | null
  connectedBy: string | null
  connectedAt: Date
}

/** Every connection for a provider in a space — for the console list. */
export async function listConnections(spaceId: string, provider: string): Promise<ConnectionSummary[]> {
  const rows = await prisma.connectorConnection.findMany({
    where: { spaceId, provider },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((row) => ({
    provider: row.provider,
    mode: row.mode,
    userId: row.userId,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    broken: row.brokenAt ? { at: row.brokenAt, reason: row.brokenReason } : null,
    connectedBy: row.connectedBy,
    connectedAt: row.createdAt,
  }))
}

/** Store the result of a completed authorization. Replaces any existing row. */
export async function saveConnection(args: {
  spaceId: string
  provider: string
  mode: 'user' | 'space'
  userId: string
  tokens: TokenSet
  connectedBy: string | null
}): Promise<void> {
  const data = {
    mode: args.mode,
    accountLabel: args.tokens.accountLabel,
    accessToken: encryptSecret(args.tokens.accessToken),
    refreshToken: args.tokens.refreshToken ? encryptSecret(args.tokens.refreshToken) : null,
    expiresAt: args.tokens.expiresAt,
    scopes: args.tokens.scopes,
    // Reconnecting is how a broken connection is repaired, so always clear it.
    brokenAt: null,
    brokenReason: null,
    connectedBy: args.connectedBy,
  }
  await prisma.connectorConnection.upsert({
    where: { connection_identity: { spaceId: args.spaceId, provider: args.provider, userId: args.userId } },
    create: { spaceId: args.spaceId, provider: args.provider, userId: args.userId, ...data },
    update: data,
  })
}

export async function deleteConnection(spaceId: string, provider: string, userId: string): Promise<void> {
  await prisma.connectorConnection
    .delete({ where: { connection_identity: { spaceId, provider, userId } } })
    .catch(() => undefined)
}

async function markBroken(id: string, reason: string): Promise<void> {
  const row = await prisma.connectorConnection
    .update({ where: { id }, data: { brokenAt: new Date(), brokenReason: reason.slice(0, 500) } })
    .catch(() => null)
  if (!row) return
  // Tell whoever can reconnect it: the member whose account it is, or — for a
  // space connection — the admins. A courtesy on top of the flag; never awaited
  // by the caller's failure path. Deduped while the last one is unread.
  void (async () => {
    const recipients = row.userId ? [row.userId] : await spaceAdminUserIds(row.spaceId)
    await notify(recipients, {
      spaceId: row.spaceId,
      kind: 'connection_broken',
      title: `${row.provider} connection broken`,
      body: `The ${row.provider} connection${row.accountLabel ? ` (${row.accountLabel})` : ''} needs reconnecting: ${reason.slice(0, 500)}`,
      // The connectors page: `provider` names a SERVICE (notion, linear), not a
      // connector note, so there is no single connector page to send them to.
      href: '/connectors',
      dedupeKey: `connection:${row.id}:broken`,
    })
  })().catch(() => {})
}

/**
 * The message a caller gets when there is no usable connection.
 *
 * Worded for whoever is reading it in an MCP client: name the service, say what
 * to do, and give the URL. "Unauthorized" would be true and useless.
 */
function stepUp(auth: ConnectorAuth, connectUrl: string, why: string): ConnectorError {
  const whose =
    auth.mode === 'user'
      ? 'Connect your own account to continue'
      : 'A space admin needs to connect this account'
  return new ConnectorError('config', `${why} ${whose}: ${connectUrl}`)
}

/**
 * Resolve the bearer for this run, refreshing if needed.
 *
 * `connectUrl` is passed in rather than built here because the base origin is a
 * request-time concern and this module is also reached from the agent tick,
 * which has no request.
 */
export async function resolveConnection(args: {
  spaceId: string
  auth: ConnectorAuth
  userId: string
  connectUrl: string
}): Promise<ResolvedConnection> {
  const { auth, spaceId } = args
  const owner = connectionOwner(auth, args.userId)

  const row = await prisma.connectorConnection.findUnique({
    where: { connection_identity: { spaceId, provider: auth.provider, userId: owner } },
  })

  if (!row) {
    throw stepUp(
      auth,
      args.connectUrl,
      auth.mode === 'user'
        ? `No ${auth.provider} account is connected for you.`
        : `No ${auth.provider} account is connected for this space.`,
    )
  }
  if (row.brokenAt) {
    throw stepUp(
      auth,
      args.connectUrl,
      `The ${auth.provider} connection stopped working (${row.brokenReason ?? 'reason unknown'}).`,
    )
  }
  // The note changed mode after the connection was made. Using a space token
  // where the note now says per-user would hand one person's access to
  // everybody, so refuse rather than guess.
  if (row.mode !== auth.mode) {
    throw stepUp(
      auth,
      args.connectUrl,
      `The ${auth.provider} connector changed to mode "${auth.mode}" since this was connected.`,
    )
  }

  const stillFresh = !row.expiresAt || row.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()
  if (stillFresh) {
    return {
      provider: auth.provider,
      accessToken: decryptSecret(row.accessToken),
      userId: row.userId,
      mode: auth.mode,
      accountLabel: row.accountLabel,
    }
  }

  return renew(row.id, auth, spaceId, args.connectUrl)
}

/**
 * Renew one connection.
 *
 * The provider call happens outside any transaction — it is a network round
 * trip and must not hold a pooled connection — so the write that follows is
 * conditional on `updatedAt` still being what was read. If another worker
 * refreshed while this one was away, the update matches nothing, and the right
 * answer is to use THEIR token: this one was minted from a refresh token the
 * provider has by then very likely retired.
 */
async function renew(
  rowId: string,
  auth: ConnectorAuth,
  spaceId: string,
  connectUrl: string,
): Promise<ResolvedConnection> {
  const row = await prisma.connectorConnection.findUnique({ where: { id: rowId } })
  if (!row) throw stepUp(auth, connectUrl, `The ${auth.provider} connection was removed.`)
  if (!row.refreshToken) {
    await markBroken(row.id, 'the access token expired and the provider issued no refresh token')
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection expired.`)
  }

  const client = await prisma.connectorOAuthClient.findFirst({ where: { spaceId, provider: auth.provider } })
  if (!client) {
    await markBroken(row.id, 'the registered OAuth client is missing')
    throw stepUp(auth, connectUrl, `The ${auth.provider} client registration is missing.`)
  }

  const endpoints = await resolveEndpoints(auth)
  let tokens: TokenSet
  try {
    tokens = await refreshTokens({
      endpoints,
      clientId: client.clientId,
      clientSecret: client.clientSecret ? decryptSecret(client.clientSecret) : null,
      refreshToken: decryptSecret(row.refreshToken),
      scopes: row.scopes,
    })
  } catch (e) {
    // A refusal here is usually permanent: the person revoked us, changed their
    // password, or left. Record it so somebody can be told, rather than
    // retrying forever against a token the provider has retired.
    const reason = e instanceof Error ? e.message : String(e)
    await markBroken(row.id, reason)
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection could not be renewed.`)
  }

  const written = await prisma.connectorConnection.updateMany({
    // The compare-and-swap: only if nobody else has touched this row.
    where: { id: row.id, updatedAt: row.updatedAt },
    data: {
      accessToken: encryptSecret(tokens.accessToken),
      // ALWAYS persist: rotated refresh tokens are the norm, and keeping the old
      // one is how connections mysteriously die three days later.
      refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes.length > 0 ? tokens.scopes : row.scopes,
      accountLabel: tokens.accountLabel ?? row.accountLabel,
      brokenAt: null,
      brokenReason: null,
    },
  })

  if (written.count === 0) {
    // Lost the race. Whoever won wrote a token minted after this one, so theirs
    // is the one the provider still honours.
    const fresh = await prisma.connectorConnection.findUnique({ where: { id: row.id } })
    if (fresh && !fresh.brokenAt) {
      return {
        provider: auth.provider,
        accessToken: decryptSecret(fresh.accessToken),
        userId: fresh.userId,
        mode: auth.mode,
        accountLabel: fresh.accountLabel,
      }
    }
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection stopped working.`)
  }

  return {
    provider: auth.provider,
    accessToken: tokens.accessToken,
    userId: row.userId,
    mode: auth.mode,
    accountLabel: tokens.accountLabel ?? row.accountLabel,
  }
}
