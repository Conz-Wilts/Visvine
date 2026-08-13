import { redirect } from 'next/navigation';

/**
 * Context is the context's root index note, not a page of its own. This route
 * stays as a redirect so existing links, the tool registry and anything that
 * deep-links "the context" land on the space's home note instead of 404ing.
 */
export default function ContextRedirect() {
  redirect('/directory/note/index.md');
}
