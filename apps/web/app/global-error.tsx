'use client';

import { useEffect } from 'react';
import './globals.css';
import { PageError } from '@visvine/ui';

/**
 * The last boundary: an error thrown by the root layout itself, where
 * `app/error.tsx` never gets to render. It replaces the whole document, so it
 * owns its own <html>/<body> and re-imports the stylesheet — and then says the
 * same one line as everything else.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <html lang="en">
      <body className="text-fg-secondary antialiased">
        <PageError message="Something went wrong." onRetry={reset} />
      </body>
    </html>
  );
}
