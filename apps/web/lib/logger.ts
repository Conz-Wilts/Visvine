// Structured logger. JSON in production, pretty in dev. No external dep — the
// production shape is what Google Cloud Logging ingests directly from stdout,
// so the deploy needs no agent, no sidecar and no SDK.
//
// Usage:
//   import { logger } from '@/lib/logger';
//   logger.error('auth.callback.token_exchange_failed', { userId });
//   logger.info('message.sent', { conversationId });
//
// First arg is a dotted event name (stable, greppable).
// Second arg is a context object. Errors are automatically serialized.
//
// WHY THE PRODUCTION RECORD LOOKS THE WAY IT DOES
//
// Cloud Logging reads three magic keys off a JSON line: `severity` (so ERROR
// lines are actually errors and not INFO text that happens to say "error"),
// `logging.googleapis.com/trace` (so a line joins the request it belongs to),
// and `@type`. That last one is the load-bearing one: a record tagged as a
// ReportedErrorEvent is picked up by Cloud Error Reporting, which groups it by
// stack signature, counts occurrences, and — this is the point — is a first
// class alerting source. Without the tag an error is a line in a log file that
// someone has to go looking for.
//
// Error Reporting reads the stack out of `message`, not out of a nested field,
// so an error record's `message` is the stack trace and the human-readable
// event name rides alongside in `event`. That is not redundancy; drop either
// and one of the two consumers breaks.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const isProd = process.env.NODE_ENV === 'production';

const SEVERITY: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

const ERROR_EVENT_TYPE =
  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent';

/**
 * Identifies the running revision to Error Reporting so a spike can be pinned
 * to a deploy. K_SERVICE / K_REVISION are set by Cloud Run itself; the fallback
 * keeps local production-mode runs from reporting as an empty service.
 */
const serviceContext = {
  service: process.env.K_SERVICE || 'visvine-web',
  version: process.env.K_REVISION || process.env.GIT_SHA || 'dev',
};

/**
 * GCP project, needed to build the fully-qualified trace name. Read per call
 * rather than at import: this module is pulled in by nearly everything, so
 * caching it would freeze whatever the environment happened to be at whichever
 * import came first.
 */
const projectId = () => process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';

/**
 * Turn an `X-Cloud-Trace-Context: <trace>/<span>;o=1` header into the resource
 * name Cloud Logging expects. Returns null when there is no header or no
 * project to qualify it with, in which case the field is simply omitted.
 */
export function traceFieldFrom(header: string | null | undefined): string | null {
  const project = projectId();
  if (!header || !project) return null;
  const traceId = header.split('/')[0]?.trim();
  if (!traceId || !/^[0-9a-f]{16,32}$/i.test(traceId)) return null;
  return `projects/${project}/traces/${traceId}`;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err.cause !== undefined && { cause: String(err.cause) }),
    };
  }
  return { value: String(err) };
}

/**
 * The text Error Reporting groups on. It insists on a real stack trace —
 * a bare message is accepted but lands every distinct failure in one useless
 * group — so synthesize a stack-shaped line when the thrown value had none.
 */
function stackFor(event: string, context: LogContext | undefined): string {
  for (const value of Object.values(context ?? {})) {
    const stack =
      value instanceof Error
        ? value.stack
        : value !== null && typeof value === 'object' && 'stack' in (value as object)
          ? (value as { stack?: unknown }).stack
          : undefined;
    if (typeof stack === 'string' && stack) return `${event}: ${stack}`;
  }
  // Grouping needs SOMETHING frame-shaped, and the event name is the most
  // stable discriminator available when a non-Error was thrown.
  return `${event}\n    at <no stack captured> (${serviceContext.service}:0:0)`;
}

function emit(level: LogLevel, event: string, context?: LogContext): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    severity: SEVERITY[level],
    // Kept alongside `severity` because every existing log query and the dev
    // formatter below read `level`; `severity` is purely for Cloud Logging.
    level,
    event,
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (key === 'trace') continue;
      record[key] = value instanceof Error ? serializeError(value) : value;
    }
    const trace = typeof context.trace === 'string' ? context.trace : null;
    if (trace) record['logging.googleapis.com/trace'] = trace;
  }

  // Only ERROR is promoted to Error Reporting. Warnings are deliberately left
  // out: they are the app working as designed (a rate limit hit, a bucket
  // blip), and routing them here would bury real failures in the same feed.
  if (level === 'error') {
    record['@type'] = ERROR_EVENT_TYPE;
    record.serviceContext = serviceContext;
    record.message = stackFor(event, context);
  } else {
    record.message = event;
  }

  const stream = level === 'error' || level === 'warn' ? console.error : console.log;

  if (isProd) {
    stream(JSON.stringify(record));
  } else {
    const prefix = `[${level.toUpperCase()}] ${event}`;
    stream(prefix, context ?? '');
  }
}

export const logger = {
  debug: (event: string, context?: LogContext) => emit('debug', event, context),
  info: (event: string, context?: LogContext) => emit('info', event, context),
  warn: (event: string, context?: LogContext) => emit('warn', event, context),
  error: (event: string, context?: LogContext) => emit('error', event, context),
};
