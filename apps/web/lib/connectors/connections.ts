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
 *     should leave behind which connection broke and why, so somebody can see
 *     it needs reconnecting. Deleting the row loses that.
 */
import prisma from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import { ConnectorError } from './config'
import { connectionOwner, type ConnectorAuth } from './auth'
import { refreshTokens, resolveEndpoints, type TokenSet } from './oauth'
import { platformClientRef, resolvePlatformClient } from './platformClients'

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
  await prisma.connectorConnection
    .update({ where: { id }, data: { brokenAt: new Date(), brokenReason: reason.slice(0, 500) } })
    .catch(() => null)
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

/** The columns a stored token row has, whichever table holds it. */
interface TokenRow {
  id: string
  userId: string
  accountLabel: string | null
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string[]
  brokenAt: Date | null
  brokenReason: string | null
  updatedAt: Date
}

/** What a refresh writes back. */
interface TokenRowPatch {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  scopes: string[]
  accountLabel: string | null
  brokenAt: null
  brokenReason: null
}

/**
 * Where a connection's row lives. A space's connections and a person's own
 * accounts (./accounts.ts) are two tables with one lifecycle, so the lifecycle
 * is written once against this.
 */
export interface TokenStore {
  read(): Promise<TokenRow | null>
  markBroken(id: string, reason: string): Promise<void>
  /** Compare-and-swap on `updatedAt`; the number of rows written. */
  swap(row: TokenRow, data: TokenRowPatch): Promise<number>
  /** The registered client for a non-platform `auth`, or null. */
  client(issuer: string): Promise<{ clientId: string; clientSecret: string | null } | null>
  /** Refuse a row the note no longer describes. Null to accept. */
  mismatch?(row: TokenRow): string | null
}

function spaceStore(spaceId: string, auth: ConnectorAuth, owner: string): TokenStore {
  let storedMode: string | null = null
  return {
    async read() {
      const row = await prisma.connectorConnection.findUnique({
        where: { connection_identity: { spaceId, provider: auth.provider, userId: owner } },
      })
      storedMode = row?.mode ?? null
      return row
    },
    markBroken,
    async swap(row, data) {
      const written = await prisma.connectorConnection.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data,
      })
      return written.count
    },
    async client() {
      const client = await prisma.connectorOAuthClient.findFirst({ where: { spaceId, provider: auth.provider } })
      if (!client) return null
      return { clientId: client.clientId, clientSecret: client.clientSecret ? decryptSecret(client.clientSecret) : null }
    },
    // The note changed mode after the connection was made. Using a space token
    // where the note now says per-user would hand one person's access to
    // everybody, so refuse rather than guess.
    mismatch() {
      return storedMode !== null && storedMode !== auth.mode
        ? `The ${auth.provider} connector changed to mode "${auth.mode}" since this was connected.`
        : null
    },
  }
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
  const owner = connectionOwner(args.auth, args.userId)
  return resolveStored(spaceStore(args.spaceId, args.auth, owner), args.auth, args.connectUrl, {
    none:
      args.auth.mode === 'user'
        ? `No ${args.auth.provider} account is connected for you.`
        : `No ${args.auth.provider} account is connected for this space.`,
  })
}

/** The lifecycle over any store: read, refuse what is dead, renew what is stale. */
export async function resolveStored(
  store: TokenStore,
  auth: ConnectorAuth,
  connectUrl: string,
  words: { none: string },
): Promise<ResolvedConnection> {
  const row = await store.read()
  if (!row) throw stepUp(auth, connectUrl, words.none)
  if (row.brokenAt) {
    throw stepUp(
      auth,
      connectUrl,
      `The ${auth.provider} connection stopped working (${row.brokenReason ?? 'reason unknown'}).`,
    )
  }
  const mismatch = store.mismatch?.(row) ?? null
  if (mismatch) throw stepUp(auth, connectUrl, mismatch)

  const stillFresh = !row.expiresAt || row.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()
  if (stillFresh) return resolved(auth, row, decryptSecret(row.accessToken))
  return renew(store, row, auth, connectUrl)
}

function resolved(auth: ConnectorAuth, row: TokenRow, accessToken: string, label?: string | null): ResolvedConnection {
  return {
    provider: auth.provider,
    accessToken,
    userId: row.userId,
    mode: auth.mode,
    accountLabel: label ?? row.accountLabel,
  }
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
  store: TokenStore,
  row: TokenRow,
  auth: ConnectorAuth,
  connectUrl: string,
): Promise<ResolvedConnection> {
  if (!row.refreshToken) {
    await store.markBroken(row.id, 'the access token expired and the provider issued no refresh token')
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection expired.`)
  }

  const endpoints = await resolveEndpoints(auth)

  // A platform client's credentials live in env, not in a client row — this is
  // the path an unattended agent renews a member's Google token on.
  const platformRef = platformClientRef(auth.clientId)
  let clientId: string
  let clientSecret: string | null
  if (platformRef) {
    const platform = resolvePlatformClient(platformRef)
    if (!platform) {
      await store.markBroken(row.id, 'the platform OAuth client is not configured on this deployment')
      throw stepUp(auth, connectUrl, `The ${auth.provider} platform client is missing.`)
    }
    clientId = platform.clientId
    clientSecret = platform.clientSecret
  } else {
    const client = await store.client(endpoints.issuer)
    if (!client) {
      await store.markBroken(row.id, 'the registered OAuth client is missing')
      throw stepUp(auth, connectUrl, `The ${auth.provider} client registration is missing.`)
    }
    clientId = client.clientId
    clientSecret = client.clientSecret
  }

  let tokens: TokenSet
  try {
    tokens = await refreshTokens({
      endpoints,
      clientId,
      clientSecret,
      refreshToken: decryptSecret(row.refreshToken),
      scopes: row.scopes,
    })
  } catch (e) {
    // A refusal here is usually permanent: the person revoked us, changed their
    // password, or left. Record it so somebody can be told, rather than
    // retrying forever against a token the provider has retired.
    const reason = e instanceof Error ? e.message : String(e)
    await store.markBroken(row.id, reason)
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection could not be renewed.`)
  }

  const written = await store.swap(row, {
    accessToken: encryptSecret(tokens.accessToken),
    // ALWAYS persist: rotated refresh tokens are the norm, and keeping the old
    // one is how connections mysteriously die three days later.
    refreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes.length > 0 ? tokens.scopes : row.scopes,
    accountLabel: tokens.accountLabel ?? row.accountLabel,
    brokenAt: null,
    brokenReason: null,
  })

  if (written === 0) {
    // Lost the race. Whoever won wrote a token minted after this one, so theirs
    // is the one the provider still honours.
    const fresh = await store.read()
    if (fresh && !fresh.brokenAt) return resolved(auth, fresh, decryptSecret(fresh.accessToken))
    throw stepUp(auth, connectUrl, `The ${auth.provider} connection stopped working.`)
  }

  return resolved(auth, row, tokens.accessToken, tokens.accountLabel ?? row.accountLabel)
}
