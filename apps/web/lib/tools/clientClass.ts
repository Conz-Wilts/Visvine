/**
 * Tools run on the web and in the desktop shell, and never in the phone apps.
 *
 * The phone apps are the only clients that send their session as a Bearer
 * token — web and desktop hold the `auth_session` cookie, the headless preview
 * is a cookie, MCP has a token type of its own — so the TRANSPORT separates
 * them, for every token ever issued. A session minted by a phone's sign-in door
 * also carries `cl: 'mobile'` (lib/session.ts), which records the route that
 * issued it, not the device; the transport carries the weight.
 *
 * Applied where a Tool runs: every bridge target (frame token, bridge call,
 * changes stream, status check), the proxy's refusal of a Bearer header on
 * `/api/tools/*`, and the actions that render a Tool for their caller. A
 * phone's *browser* is the web app and is not claimed here — nothing it sends
 * tells it from a narrow desktop window in a way a client cannot forge.
 *
 * Pure (tests/tools-client-class.test.ts).
 */
import type { SessionInfo, SessionPayload } from '@/lib/session'
import type { BridgeError } from './protocol'

/** Which kind of client a caller is, as far as running a Tool goes. */
export type ToolClient = 'app' | 'mobile'

export function toolClientOf(info: Pick<SessionInfo, 'transport'> & { session: Pick<SessionPayload, 'cl'> }): ToolClient {
  if (info.transport === 'bearer') return 'mobile'
  return info.session.cl === 'mobile' ? 'mobile' : 'app'
}

const PHONE_REFUSAL = 'Tools run on the web and in the desktop app.'

/** Why a client may not run a Tool, or null when it may. */
export function toolRunDenial(client: ToolClient | null | undefined): BridgeError | null {
  return client === 'mobile' ? { code: 'forbidden', message: PHONE_REFUSAL } : null
}

/** The sentence an action answers a phone caller with. */
export const TOOL_PHONE_REFUSAL = PHONE_REFUSAL

interface SpaceWithTools {
  installedTools?: unknown[]
  featureConfig?: {
    order?: string[]
    more?: string[]
    adminOnly?: string[]
    enabled?: Record<string, boolean>
  } | null
}

const isToolKey = (key: string) => key.startsWith('tool:')

/**
 * A space as the phone apps receive it: no installed Tools and no `tool:*`
 * rail keys, so nothing on a phone offers a Tool it could not run.
 */
export function spaceForPhone<S extends SpaceWithTools>(space: S): S {
  const config = space.featureConfig
  const next: S = { ...space, installedTools: [] }
  if (!config) return next
  return {
    ...next,
    featureConfig: {
      ...config,
      ...(config.order ? { order: config.order.filter((k) => !isToolKey(k)) } : {}),
      ...(config.more ? { more: config.more.filter((k) => !isToolKey(k)) } : {}),
      ...(config.adminOnly ? { adminOnly: config.adminOnly.filter((k) => !isToolKey(k)) } : {}),
      ...(config.enabled
        ? { enabled: Object.fromEntries(Object.entries(config.enabled).filter(([k]) => !isToolKey(k))) }
        : {}),
    },
  }
}
