// Pure constants for the brain's display settings — importable from both the
// server side (lib/notes/brainSettings.ts) and client components, so the
// default name and length cap live in exactly one place.

export const DEFAULT_CONTEXT_NAME = 'Community context'
export const CONTEXT_NAME_MAX_LENGTH = 60

/**
 * What to call the context on screen: a renamed one wins, and the generic
 * default defers to the space's own name — "Everything in Blackbird Ventures"
 * says more than "Everything in Community context". Shared so the sidebar root,
 * the access picker and the request queue never disagree.
 */
export function contextDisplayName(
  stored: string | null | undefined,
  communityName: string | null | undefined,
): string {
  if (stored && stored !== DEFAULT_CONTEXT_NAME) return stored
  return communityName?.trim() || DEFAULT_CONTEXT_NAME
}
