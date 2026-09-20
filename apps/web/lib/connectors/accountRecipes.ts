/**
 * Which services a person connects for THEMSELVES, and the note such an
 * account stands for. Pure — importable from the client.
 *
 * A connector is either a space's or a person's, and what decides is whether
 * connecting it asks the space for anything. A service signed into with one
 * press — a platform OAuth client, or an MCP server that registers Visvine at
 * first connect — needs no key, no app and no admin, and the token it yields is
 * one person's. So it is that person's account: connected once in Settings,
 * spent in any space they act in, only ever by a run acting as them.
 * Everything else (a key, a login, an OAuth app the space registered) is the
 * space's connector and lives in its console.
 *
 * An account has no note. Its perimeter is the recipe's, rendered here at load,
 * so reach is decided by the catalogue and by nothing anyone can edit.
 */
import {
  CONNECTOR_CATALOG,
  connectorFromCatalog,
  connectsInOneClick,
  suggestConnector,
  type CatalogEntry,
} from './catalog'
import { safeReturnTo } from './connectUrl'

/** Where a person's accounts are listed, and where a sign-in lands by default. */
export const ACCOUNTS_SETTINGS_PATH = '/settings?section=accounts'

/** Is this service connected per person rather than per space? */
export function isAccountRecipe(entry: CatalogEntry, platformClients: readonly string[]): boolean {
  return entry.oauth?.mode === 'user' && connectsInOneClick(entry, platformClients)
}

/** The services this deployment offers as accounts, in catalogue order. */
export function accountRecipes(platformClients: readonly string[]): CatalogEntry[] {
  return CONNECTOR_CATALOG.filter((entry) => isAccountRecipe(entry, platformClients))
}

export function accountRecipe(id: string, platformClients: readonly string[]): CatalogEntry | null {
  return accountRecipes(platformClients).find((entry) => entry.id === id) ?? null
}

/** The connector note an account stands for — what the parsers and the run read. */
export function accountNoteContent(entry: CatalogEntry, name: string): string {
  const { title } = suggestConnector(entry, name === entry.id ? [] : [entry.id])
  return connectorFromCatalog(entry, { name, title, description: '', values: {} }).content
}

/** `gmail`, then `gmail-2`: what the next account to a service is called. */
export function nextAccountName(entry: CatalogEntry, taken: readonly string[]): string {
  return suggestConnector(entry, taken).name
}

/**
 * Where an account's `visvine.state` is keyed. Not a note path: a name two
 * people both hold must not share a cursor, so the person is in the key.
 */
export function accountStatePath(userId: string, name: string): string {
  return `accounts/${userId}/${name}.md`
}

/** Is this account switched on in a space? */
export function accountOnIn(offSpaces: readonly string[], spaceId: string): boolean {
  return !offSpaces.includes(spaceId)
}

/** The sign-in link for an account: a recipe to add, or a name to reconnect. */
export function accountConnectPath(target: { recipe: string } | { name: string }, returnTo?: string | null): string {
  const params = new URLSearchParams('recipe' in target ? { account: target.recipe } : { account_name: target.name })
  const safe = safeReturnTo(returnTo)
  if (safe) params.set('return', safe)
  return `/api/connectors/oauth/start?${params.toString()}`
}
