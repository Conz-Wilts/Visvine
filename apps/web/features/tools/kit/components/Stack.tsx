import type { ReactNode } from 'react';
import { Row, Stack as UIStack } from '@visvine/ui';

export interface StackProps {
  direction?: 'row' | 'column';
  gap?: 'sm' | 'md' | 'lg';
  wrap?: boolean;
  className?: string;
  children: ReactNode;
}

const GAP = { sm: 1.5, md: 3, lg: 5 } as const;

/** A flex row or column a fixed step apart — the app's own Stack and Row (@visvine/ui). */
export function Stack({ direction = 'column', gap = 'md', wrap = false, className, children }: StackProps) {
  return direction === 'row' ? (
    <Row gap={GAP[gap]} wrap={wrap} className={className}>
      {children}
    </Row>
  ) : (
    <UIStack gap={GAP[gap]} className={className}>
      {children}
    </UIStack>
  );
}
