// Pure mapper for the retired /context route: Context now lives inside the
// Directory (?view=context) and on entity profiles (?tab=context). Every old
// deep link keeps working — all incoming params ride along (?new=note is the
// Create-modal hand-off the workspace still honours), with `view` forced to
// context.

export function contextRedirectUrl(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams()
  params.set('view', 'context')
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'view' || value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v)
    } else {
      params.set(key, value)
    }
  }
  return `/directory?${params.toString()}`
}
