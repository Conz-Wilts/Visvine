import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/**
 * The grid resource cards sit in: as many columns as fit, each at least a
 * card wide. Images pack denser (smaller, tighter), because choosing one is
 * scanning pictures, not reading names.
 */
export default function ResourceGrid({ variant = 'file', children, className }: { variant?: 'file' | 'image'; children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'grid',
        variant === 'image'
          ? 'grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2'
          : 'grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-x-4 gap-y-5',
        className,
      )}
    >
      {children}
    </div>
  );
}
