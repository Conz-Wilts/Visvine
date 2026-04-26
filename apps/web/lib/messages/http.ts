import { NextResponse } from 'next/server';
import { MessagingError } from './service';
import { logger } from '@/lib/logger';

export function handleMessagingError(error: unknown) {
  if (error instanceof MessagingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  logger.error('api.messages.failed', { err: error });
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
