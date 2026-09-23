import type { CSSProperties, ElementType, ReactNode } from 'react';
import { clsx } from 'clsx';

/** Gaps in the spacing scale's steps: `3` is 12px, like `gap-3`. */
type Gap = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 4 | 5 | 6 | 8 | 10 | 12;

const GAP: Record<Gap, string> = {
  0: 'gap-0',
  0.5: 'gap-0.5',
  1: 'gap-1',
  1.5: 'gap-1.5',
  2: 'gap-2',
  2.5: 'gap-2.5',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
};

const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' };
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' };

interface LayoutProps {
  gap?: Gap;
  align?: keyof typeof ALIGN;
  justify?: keyof typeof JUSTIFY;
  /** Let items wrap onto a new line (rows only). */
  wrap?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function layout(direction: 'flex-col' | 'flex-row', { gap = 0, align, justify, wrap, as: Tag = 'div', className, style, children }: LayoutProps) {
  return (
    <Tag
      className={clsx('flex', direction, GAP[gap], align && ALIGN[align], justify && JUSTIFY[justify], wrap && 'flex-wrap', className)}
      style={style}
    >
      {children}
    </Tag>
  );
}

/** Children one under another, a fixed step apart. */
export function Stack(props: LayoutProps) {
  return layout('flex-col', props);
}

/** Children side by side, a fixed step apart, centred on one line by default. */
export function Row({ align = 'center', ...props }: LayoutProps) {
  return layout('flex-row', { align, ...props });
}
