import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SPACE_PREFIX_HEADER } from './shared/spaceCookie'
import { isSpaceScopedPath } from './shared/spaceUrl'

/**
 * `redirect()` from a page rendered under a space URL, staying in that space:
 * the proxy hands the page the `/s/…` prefix it was reached under
 * (`SPACE_PREFIX_HEADER`), and an in-app page href is sent under it.
 */
export async function redirectInSpace(href: string): Promise<never> {
  const prefix = (await headers()).get(SPACE_PREFIX_HEADER)
  redirect(prefix && isSpaceScopedPath(href) ? `${prefix}${href}` : href)
}
