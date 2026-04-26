// Minimal structured logger. JSON in production, pretty in dev.
// No external dep; thin wrapper over console so existing log-drain infra
// (Vercel, Cloud Logging) continues to capture stdout/stderr.
//
// Usage:
//   import { logger } from '@/lib/logger';
//   logger.error('auth.callback.token_exchange_failed', { userId });
//   logger.info('message.sent', { conversationId });
//
// First arg is a dotted event name (stable, greppable).
// Second arg is a context object. Errors are automatically serialized.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const isProd = process.env.NODE_ENV === 'production';

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

function emit(level: LogLevel, event: string, context?: LogContext): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
  };

  if (context) {
    for (const [key, value] of Object.entries(context)) {
      record[key] = value instanceof Error ? serializeError(value) : value;
    }
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
