import { redirect } from 'next/navigation'
import { contextRedirectUrl } from '@/lib/notes/contextRedirect'

/**
 * /context is retired — Context merged into the Directory. The notes workspace
 * now renders as the directory's Context view (/directory?view=context) and
 * each entity's context note lives on its profile (/directory/<id>?tab=context).
 * This server redirect keeps every old deep link (incl. ?new=note) working.
 */
export default async function ContextRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(contextRedirectUrl(await searchParams))
}
