'use client';

import { useEffect } from 'react';
import PageError from '@/components/ui/PageError';

/**
 * The app-wide error boundary. Anything that throws during a render lands here,
 * and it says one line and offers the retry Next hands us (`reset` re-renders
 * the segment without a full reload). The cause goes to the console, not to the
 * page: a stack trace on screen tells a member nothing they can act on.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <PageError message="Something went wrong." onRetry={reset} />;
}
