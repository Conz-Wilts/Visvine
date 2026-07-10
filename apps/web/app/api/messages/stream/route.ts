import { NextRequest } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { subscribeToUser } from '@/lib/messages/realtime';
import type { RealtimeEvent } from '@/lib/messages/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getApiMessagingUser();

  if (!user) {
    return unauthorizedResponse();
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: RealtimeEvent) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      controller.enqueue(encoder.encode(': connected\n\n'));

      const unsubscribe = subscribeToUser(user.id, send);

      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        }
      }, 20_000);

      const cleanup = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
