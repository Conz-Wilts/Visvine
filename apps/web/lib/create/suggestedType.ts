import type { CreateableType } from '@/lib/contexts/CreateModalContext';

export interface CreateSuggestion {
  /**
   * Everything the current surface can make, most likely first. A page whose
   * own tools create more than one thing (Channels makes channels *and*
   * spaces) lists them all, so the panel isn't narrower than the page.
   */
  types: CreateableType[];
  /** Short human reason shown next to the suggested option ("You're on Events"). */
  reason: string;
}

/**
 * Route prefix → the thing(s) you most likely came to create there. Ordered
 * longest-prefix-first, so `/directory/note/...` resolves to a context note
 * rather than falling through to the bare `/directory` → person entry.
 */
const ROUTE_SUGGESTIONS: Array<{ prefix: string; suggestion: CreateSuggestion }> = [
  { prefix: '/directory/note', suggestion: { types: ['context', 'file'], reason: "You're in Context" } },
  { prefix: '/directory/source', suggestion: { types: ['context', 'file'], reason: "You're in Context" } },
  { prefix: '/directory', suggestion: { types: ['person'], reason: "You're in the Directory" } },
  { prefix: '/events', suggestion: { types: ['event'], reason: "You're on Events" } },
  { prefix: '/resources', suggestion: { types: ['resource'], reason: "You're on Resources" } },
  { prefix: '/channels', suggestion: { types: ['channel', 'space'], reason: "You're on Channels" } },
  { prefix: '/context', suggestion: { types: ['context', 'file'], reason: "You're in Context" } },
];

/**
 * The create types to pin at the top of the "Create new" panel for the page the
 * user is on, or null where no type is an obvious fit (/home, /settings, …) —
 * in which case the panel just lists everything unranked.
 */
export function suggestedCreateType(pathname: string | null | undefined): CreateSuggestion | null {
  if (!pathname) return null;
  const match = ROUTE_SUGGESTIONS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match.suggestion : null;
}
