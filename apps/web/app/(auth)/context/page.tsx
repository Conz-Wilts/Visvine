import { redirect } from 'next/navigation';

/**
 * Context is a tab of the Directory, not a page of its own — it browses the same
 * community from the same shell. This route stays as a redirect so existing
 * links, the tool registry and anything that deep-links "the context" land on
 * the tab instead of 404ing.
 */
export default function ContextRedirect() {
  redirect('/directory?view=context');
}
