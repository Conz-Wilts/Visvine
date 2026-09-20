/**
 * A person's own accounts (`connector_accounts`): the rows, and the bearer a
 * run resolves from one. The rules are in ./accountRecipes.ts; the token
 * lifecycle is ./connections.ts's, over this table.
 */
import prisma from '@/lib/prisma'
import { decryptSecret, encryptSecret } from '@/lib/crypto/secrets'
import type { ConnectorAuth } from './auth'
import { resolveStored, type ResolvedConnection, type TokenStore } from './connections'
import type { TokenSet } from './oauth'
import { accountConnectPath, accountNoteContent, accountOnIn, accountRecipe, nextAccountName } from './accountRecipes'
import { availablePlatformClients } from './platformClients'
import { appOrigin } from './connectUrl'
import { parseConnectorPerimeter } from './config'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'

export interface AccountSummary {
  name: string
  recipe: string
  accountLabel: string | null
  offSpaces: string[]
  broken: string | null
  connectedAt: Date
}

export async function listAccounts(userId: string): Promise<AccountSummary[]> {
  const rows = await prisma.connectorAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.map((row) => ({
    name: row.name,
    recipe: row.recipe,
    accountLabel: row.accountLabel,
    offSpaces: row.offSpaces,
    broken: row.brokenAt ? (row.brokenReason ?? 'stopped working') : null,
    connectedAt: row.createdAt,
  }))
}

/**
 * The note an account stands for, for a run in `spaceId` — or null when the
 * person holds no such account, has switched it off there, or the deployment no
 * longer offers the service.
 */
export async function accountNoteFor(
  userId: string,
  name: string,
  spaceId: string,
): Promise<{ content: string; recipe: string } | null> {
  if (!userId) return null
  const row = await prisma.connectorAccount.findUnique({
    where: { account_identity: { userId, name } },
    select: { recipe: true, offSpaces: true },
  })
  if (!row || !accountOnIn(row.offSpaces, spaceId)) return null
  const entry = accountRecipe(row.recipe, availablePlatformClients())
  if (!entry) return null
  return { content: accountNoteContent(entry, name), recipe: row.recipe }
}

/** The names a person's accounts answer to in a space, for the listings. */
export async function accountNotesIn(
  userId: string,
  spaceId: string,
): Promise<Array<{ name: string; content: string }>> {
  if (!userId) return []
  const clients = availablePlatformClients()
  const rows = await prisma.connectorAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.flatMap((row) => {
    const entry = accountOnIn(row.offSpaces, spaceId) ? accountRecipe(row.recipe, clients) : null
    return entry ? [{ name: row.name, content: accountNoteContent(entry, row.name) }] : []
  })
}

/**
 * The `auth:` block an account signs in through — the recipe's, as the run
 * will read it. Null when the deployment does not offer the service as an
 * account.
 */
export function accountAuth(recipe: string, name: string): ConnectorAuth | null {
  const entry = accountRecipe(recipe, availablePlatformClients())
  if (!entry) return null
  const parsed = parseConnectorPerimeter(parseFrontmatter(accountNoteContent(entry, name)))
  return parsed.ok ? parsed.perimeter.auth : null
}

/**
 * Which account a sign-in is for: a named one being reconnected, or the next
 * free name for a recipe being added.
 */
export async function accountTarget(
  userId: string,
  ask: { recipe: string } | { name: string },
): Promise<{ name: string; recipe: string } | null> {
  const rows = await prisma.connectorAccount.findMany({ where: { userId }, select: { name: true, recipe: true } })
  if ('name' in ask) return rows.find((row) => row.name === ask.name) ?? null
  const entry = accountRecipe(ask.recipe, availablePlatformClients())
  if (!entry) return null
  return { name: nextAccountName(entry, rows.map((row) => row.name)), recipe: entry.id }
}

/** Store a completed sign-in. Signing in again repairs a broken account. */
export async function saveAccount(args: { userId: string; name: string; recipe: string; tokens: TokenSet }): Promise<void> {
  const data = {
    recipe: args.recipe,
    accountLabel: args.tokens.accountLabel,
    accessToken: encryptSecret(args.tokens.accessToken),
    refreshToken: args.tokens.refreshToken ? encryptSecret(args.tokens.refreshToken) : null,
    expiresAt: args.tokens.expiresAt,
    scopes: args.tokens.scopes,
    brokenAt: null,
    brokenReason: null,
  }
  await prisma.connectorAccount.upsert({
    where: { account_identity: { userId: args.userId, name: args.name } },
    create: { userId: args.userId, name: args.name, ...data },
    update: data,
  })
}

export async function removeAccount(userId: string, name: string): Promise<boolean> {
  const gone = await prisma.connectorAccount.deleteMany({ where: { userId, name } })
  return gone.count > 0
}

/** Replace the spaces an account stays out of. */
export async function setAccountOffSpaces(userId: string, name: string, offSpaces: string[]): Promise<boolean> {
  const written = await prisma.connectorAccount.updateMany({
    where: { userId, name },
    data: { offSpaces: Array.from(new Set(offSpaces)) },
  })
  return written.count > 0
}

function accountStore(userId: string, name: string, recipe: string): TokenStore {
  return {
    read: () => prisma.connectorAccount.findUnique({ where: { account_identity: { userId, name } } }),
    async markBroken(id, reason) {
      await prisma.connectorAccount
        .update({ where: { id }, data: { brokenAt: new Date(), brokenReason: reason.slice(0, 500) } })
        .catch(() => null)
    },
    async swap(row, data) {
      const written = await prisma.connectorAccount.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data })
      return written.count
    },
    async client(issuer) {
      const client = await prisma.connectorAccountClient.findUnique({
        where: { account_client_identity: { userId, recipe, issuer } },
      })
      if (!client) return null
      return { clientId: client.clientId, clientSecret: client.clientSecret ? decryptSecret(client.clientSecret) : null }
    },
  }
}

/** The bearer for a run on a person's own account, refreshed if needed. */
export function resolveAccountConnection(args: {
  userId: string
  name: string
  recipe: string
  auth: ConnectorAuth
}): Promise<ResolvedConnection> {
  return resolveStored(
    accountStore(args.userId, args.name, args.recipe),
    args.auth,
    appOrigin() + accountConnectPath({ name: args.name }),
    { none: `Your ${args.name} account is not connected.` },
  )
}
