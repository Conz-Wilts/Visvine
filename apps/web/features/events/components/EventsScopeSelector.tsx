'use client';

/**
 * Scope tabs for the Events page (Discover / Space / My events). Uses the
 * shared UnderlineTabs so it matches the Directory's Grid / Context
 * switcher — sliding green underline, brand text colors.
 */

import { CalendarCheckIcon, CompassIcon, UsersIcon } from '@/features/shared/icons';
import { UnderlineTabs, type UnderlineTab } from '@/components/ui';

export type EventScope = 'discover' | 'space' | 'mine';

const SCOPES: UnderlineTab<EventScope>[] = [
  { id: 'discover', label: 'Discover', icon: <CompassIcon className="h-3.5 w-3.5" /> },
  { id: 'space', label: 'Space', icon: <UsersIcon className="h-3.5 w-3.5" /> },
  { id: 'mine', label: 'Mine', icon: <CalendarCheckIcon className="h-3.5 w-3.5" /> },
];

export default function EventsScopeSelector({ scope, onScopeChange, className }: {
  scope: EventScope;
  onScopeChange: (scope: EventScope) => void;
  className?: string;
}) {
  return (
    <UnderlineTabs
      tabs={SCOPES}
      value={scope}
      onChange={onScopeChange}
      ariaLabel="Event scope"
      idPrefix="events"
      className={className}
    />
  );
}
