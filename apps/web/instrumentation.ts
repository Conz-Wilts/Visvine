// Server-start hook (Next instrumentation file convention).
//
// Two jobs:
//   • register()        arms the nightly maintenance schedule when this process
//                       is the one responsible for it (see lib/notes/nightly.ts
//                       — on Cloud Run it is Cloud Scheduler's job, not ours).
//   • onRequestError()  is the ONLY place Next surfaces an error it caught
//                       itself: a Server Component that threw during render, a
//                       route handler that rejected, a failed Server Action.
//                       Nothing in app code sees those, so without this hook
//                       they reach the log as Next's own unstructured stderr
//                       and never reach Error Reporting at all.

import type { Instrumentation } from 'next'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNightlySchedule } = await import('@/lib/notes/nightly')
    startNightlySchedule()
  }
}

/** Header names worth attaching; everything else is either noise or a secret. */
const SAFE_HEADERS = ['user-agent', 'referer', 'x-forwarded-for', 'x-request-id'] as const

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // Edge and Node both reach here, and the logger is dependency-free, so no
  // runtime split is needed.
  const { logger, traceFieldFrom } = await import('@/lib/logger')

  const header = (name: string): string | null => {
    const value = request.headers?.[name]
    if (Array.isArray(value)) return value[0] ?? null
    return typeof value === 'string' ? value : null
  }

  const meta: Record<string, unknown> = {
    err,
    // `path` carries the query string; strip it — it is the highest-risk place
    // for a token or an email to end up pinned to an error group forever.
    path: request.path?.split('?')[0] ?? request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    // React replaces the thrown error during RSC rendering; the digest is what
    // ties this record to the opaque id the browser was shown.
    digest:
      typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined,
  }

  for (const name of SAFE_HEADERS) {
    const value = header(name)
    if (value) meta[name.replace(/-/g, '_')] = value
  }

  const trace = traceFieldFrom(header('x-cloud-trace-context'))
  if (trace) meta.trace = trace

  logger.error(`next.request.${context.routeType}_failed`, meta)
}
