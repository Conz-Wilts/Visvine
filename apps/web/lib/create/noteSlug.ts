import { slugify } from '@/lib/eventUtils'

/**
 * A connector's or agent's name IS its filename and the handle agents call
 * it by, so it's slugified rather than validated-and-rejected — "My API"
 * becomes `my-api`, which is both a legal note path and a legal name.
 */
export function connectorSlug(name: string): string {
  return slugify(name).slice(0, 64)
}

/** Same rule as connectors: the name IS the filename and the handle. */
export function agentSlug(name: string): string {
  return slugify(name).slice(0, 64)
}
