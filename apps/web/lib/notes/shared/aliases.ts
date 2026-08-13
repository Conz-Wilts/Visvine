// Person aliases — one concept doing two jobs, on purpose.
//
// A space's aliases are created on the Types page and live in
// `Space.aliases` (lib/types/context.ts#SpaceAlias). The ones
// scoped to the PERSON type are also the permission model: everyone who joins a
// space is a Person, so the same vocabulary that colours their chip in the
// directory is what says what they can do. "Engineering" is a directory chip, a
// set of holders, and a set of BrainGrants — not three separate things.
//
// A person holds any number of them, with no restrictions. An alias marked
// `owner` means its holders manage the space; the built-in Owner alias
// always does and can never be removed or un-owned (lib/types/context.ts
// #OWNER_ALIAS), so a space can never be left with nothing that owns it.
// The four mutations that could otherwise break that ask `ownerSurvives` first.
//
// Pure — no Prisma/Node/DOM imports; usable from server, client, and tests.
// The DB side lives in lib/notes/aliases.ts.

import { OWNER_ALIAS_NAME, type SpaceAlias } from '@/lib/types/context'

export { OWNER_ALIAS_NAME } from '@/lib/types/context'

/** A Person alias plus who holds it — what the owner invariant reasons over. */
export interface AliasSummary {
  name: string
  color: string
  owner: boolean
  /** The built-in Owner alias: fixed, and rendered in gold. */
  system: boolean
  holderIds: string[]
}

/** A mutation that could leave the space with nobody able to manage it. */
export type AliasChange =
  | { kind: 'removeAlias'; name: string }
  | { kind: 'setOwner'; name: string; owner: boolean }
  | { kind: 'removeHolder'; name: string; userId: string }
  /** People leaving the space entirely — every alias loses them. */
  | { kind: 'removeMember'; userIds: string[] }

/** Pair a space's Person aliases with the holders of each. */
export function summarize(
  aliases: SpaceAlias[],
  holders: Array<{ aliasName: string; userId: string }>,
): AliasSummary[] {
  return aliases.map((a) => ({
    name: a.name,
    color: a.color,
    owner: a.owner === true || a.system === true,
    system: a.system === true,
    holderIds: holders.filter((h) => h.aliasName === a.name).map((h) => h.userId),
  }))
}

/** Whether this person manages the space: holds any alias with `owner`. */
export function holdsOwner(aliases: AliasSummary[], userId: string): boolean {
  return aliases.some((a) => a.owner && a.holderIds.includes(userId))
}

/** Everyone who manages the space, deduplicated. */
export function ownerHolderIds(aliases: AliasSummary[]): string[] {
  const ids = new Set<string>()
  for (const a of aliases) if (a.owner) for (const id of a.holderIds) ids.add(id)
  return [...ids]
}

/** The alias list as it would be AFTER `change` — the basis for the check. */
function applyChange(aliases: AliasSummary[], change: AliasChange): AliasSummary[] {
  switch (change.kind) {
    case 'removeAlias':
      return aliases.filter((a) => a.name !== change.name)
    case 'setOwner':
      return aliases.map((a) => (a.name === change.name ? { ...a, owner: change.owner } : a))
    case 'removeHolder':
      return aliases.map((a) =>
        a.name === change.name
          ? { ...a, holderIds: a.holderIds.filter((id) => id !== change.userId) }
          : a,
      )
    case 'removeMember': {
      const leaving = new Set(change.userIds)
      return aliases.map((a) => ({
        ...a,
        holderIds: a.holderIds.filter((id) => !leaving.has(id)),
      }))
    }
  }
}

/**
 * Whether at least one person would still manage the space after `change`.
 * False is a refusal, not an error — the caller turns it into a 400 explaining
 * that somebody has to be able to let the others back in.
 */
export function ownerSurvives(aliases: AliasSummary[], change: AliasChange): boolean {
  return ownerHolderIds(applyChange(aliases, change)).length > 0
}

/** The refusal copy, shared by every caller so the wording never drifts. */
export const LAST_OWNER_MESSAGE =
  'Someone has to be able to manage this space — give another person an alias that owns it first.'

/** The refusal for any attempt to remove or un-own the built-in alias. */
export const SYSTEM_ALIAS_MESSAGE = `${OWNER_ALIAS_NAME} is built in — it can't be removed, recoloured, or stop owning the space. You can still choose who holds it and what it reaches.`

/** The longest an alias name may be — matches the console's input maxLength. */
export const MAX_ALIAS_NAME = 40

/**
 * Whether `name` is usable as a new (or renamed) Person alias, given the names
 * already in use. Returns the refusal copy, or null when it's fine.
 *
 * `except` is the current name when renaming, so an alias doesn't collide with
 * itself — which also lets a rename change only the casing.
 */
export function aliasNameError(
  name: string,
  existingNames: string[],
  except?: string,
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'An alias needs a name.'
  if (trimmed.length > MAX_ALIAS_NAME) {
    return `Alias names are at most ${MAX_ALIAS_NAME} characters.`
  }
  const lower = trimmed.toLowerCase()
  if (lower === OWNER_ALIAS_NAME.toLowerCase() && except !== OWNER_ALIAS_NAME) {
    return `"${OWNER_ALIAS_NAME}" is the built-in alias — pick another name.`
  }
  const taken = existingNames.some(
    (n) => n.toLowerCase() === lower && n.toLowerCase() !== except?.toLowerCase(),
  )
  if (taken) return `This space already has an alias called "${trimmed}".`
  return null
}

/** A #rrggbb colour, or null if `value` isn't one. Alias chips carry no alpha. */
export function normalizeAliasColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null
}

/** Alias names for a chip row or summary line: at most `max`, then "+n". */
export function describeAliases(names: string[], max = 3): string {
  if (names.length === 0) return 'None'
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} +${names.length - max}`
}
