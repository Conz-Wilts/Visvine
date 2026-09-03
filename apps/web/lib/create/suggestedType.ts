import type { CreateableType } from '@/features/shared/contexts/CreateModalContext';

export interface CreateSuggestion {
  /**
   * Everything the current surface can make, most likely first. A page whose
   * own tools create more than one thing (Channels makes channels *and*
   * sections) lists them all, so the panel isn't narrower than the page.
   */
  types: CreateableType[];
}

/**
 * Route prefix → the thing(s) you most likely came to create there. Ordered
 * longest-prefix-first, so `/directory/note/...` resolves to a context note
 * rather than falling through to the bare `/directory` → person entry.
 */
const ROUTE_SUGGESTIONS: Array<{ prefix: string; suggestion: CreateSuggestion }> = [
  { prefix: '/directory/note/agents', suggestion: { types: ['agent'] } },
  { prefix: '/directory/note', suggestion: { types: ['context', 'file'] } },
  { prefix: '/directory/source', suggestion: { types: ['context', 'file'] } },
  { prefix: '/directory', suggestion: { types: ['person'] } },
  { prefix: '/events', suggestion: { types: ['event'] } },
  { prefix: '/resources', suggestion: { types: ['resource'] } },
  { prefix: '/channels', suggestion: { types: ['channel', 'section'] } },
];

/**
 * The create types the Create panel lists first for the page the user is on,
 * or null where no type is an obvious fit (/home, /settings, …) — in which
 * case the panel lists everything in its own order. Order is the whole
 * suggestion: nothing renders a reason.
 */
export function suggestedCreateType(pathname: string | null | undefined): CreateSuggestion | null {
  if (!pathname) return null;
  const match = ROUTE_SUGGESTIONS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match.suggestion : null;
}
