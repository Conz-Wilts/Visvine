/**
 * Deploy keys, as rules — pure (tests/tools-deploy-keys.test.ts).
 *
 * A deploy key is how a Tool is pushed from outside the app: a CI job on every
 * pull request, a terminal with no browser. It is a bearer token for the MCP
 * server that names ONE Tool in ONE space and acts as the person who minted
 * it, narrowed to the Tool actions below. It is never a second identity and
 * never more than its minter: every call re-resolves that person's standing
 * in the space, so a key outlives neither their membership nor their edit
 * access, and a publish made with one waits for a space admin.
 */
import { createHash, randomBytes } from 'node:crypto'

export const DEPLOY_KEY_PREFIX = 'vvtk_'

/** What a key's token carries — the scopes of the actions it may ask. */
export const DEPLOY_KEY_SCOPES = ['context:read', 'tools:author'] as const

/** How many live keys one Tool may have. */
export const MAX_DEPLOY_KEYS = 10

/** How many characters of a key a list shows — `vvtk_` and eight more. */
const SHOWN = DEPLOY_KEY_PREFIX.length + 8

/**
 * The actions a key may ask, and whether each must name the key's own Tool
 * as `name`. Every one of them names the key's space as `space_id`.
 */
const DEPLOY_KEY_ACTIONS: Record<string, { namesTool: boolean }> = {
  push_tool: { namesTool: true },
  check_package: { namesTool: false },
  read_tool: { namesTool: true },
  check_tool: { namesTool: true },
  preview_tool: { namesTool: true },
  publish_tool: { namesTool: true },
}

export interface DeployKeyScope {
  spaceId: string
  tool: string
}

/** A fresh key: `vvtk_` and 32 random bytes, base64url. */
export function newDeployKey(): string {
  return `${DEPLOY_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** Could this bearer be a deploy key? Anything else goes to the OAuth verifier. */
export function isDeployKey(token: string): boolean {
  return token.startsWith(DEPLOY_KEY_PREFIX) && /^[A-Za-z0-9_-]{40,64}$/.test(token.slice(DEPLOY_KEY_PREFIX.length))
}

/** What is stored: the key's SHA-256, never the key. */
export function deployKeyHash(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** What a list shows of a key. */
export function deployKeyPrefix(key: string): string {
  return key.slice(0, SHOWN)
}

/** A label, cleaned, or the refusal. */
export function deployKeyLabel(raw: unknown): { ok: true; label: string } | { ok: false; error: string } {
  const label = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  if (!label) return { ok: true, label: 'Deploy key' }
  if (label.length > 40) return { ok: false, error: 'A key’s label is at most 40 characters.' }
  return { ok: true, label }
}

/** Why a key may not make this call, or null when it may. */
export function deployKeyDenial(key: DeployKeyScope, action: string, input: unknown): string | null {
  const rule = Object.hasOwn(DEPLOY_KEY_ACTIONS, action) ? DEPLOY_KEY_ACTIONS[action] : null
  if (!rule) return `A deploy key pushes, checks and publishes its own tool — ${action} needs you signed in.`
  const args = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  if (args.space_id !== key.spaceId) return 'This deploy key is for another space.'
  if (rule.namesTool && args.name !== key.tool) return `This deploy key is for the tool ${key.tool}.`
  return null
}
