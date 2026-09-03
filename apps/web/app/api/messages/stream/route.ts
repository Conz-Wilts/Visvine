import { NextRequest } from 'next/server';
import { getApiMessagingUser, unauthorizedResponse } from '@/lib/messages/auth';
import { subscribeToUser } from '@/lib/messages/realtime';
import type { RealtimeEvent } from '@/lib/messages/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How long one connection is held before the server closes it and lets the
 * browser open the next one.
 *
 * A stream lives on an instance, and an instance the autoscaler cannot retire
 * is one that is still billed. Left to itself this connection ends when the
 * client hangs up — and a client that goes away without its abort reaching us
 * (a sleeping laptop, a proxy that drops the socket quietly) leaves the stream
 * running until the runtime's own request ceiling, half an hour later. Closing
 * on our own clock bounds that: `EventSource` reconnects by itself, so a
 * viewer sees nothing, and every reconnection is a chance to shed an instance.
 */
const MAX_STREAM_MS = 5 * 60_000;

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
        clearTimeout(lifetime);
        unsubscribe();
        controller.close();
      };

      const lifetime = setTimeout(cleanup, MAX_STREAM_MS);

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
