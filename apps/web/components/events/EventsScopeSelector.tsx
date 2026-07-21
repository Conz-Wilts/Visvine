'use client';

/**
 * Scope tabs for the Events page (Discover / Community / My events). Uses the
 * shared UnderlineTabs so it matches the Directory's Grid / Graph / Tables
 * switcher — sliding green underline, brand text colors.
 */

import { Compass, Users, CalendarCheck } from 'lucide-react';
import { UnderlineTabs, type UnderlineTab } from '@/components/ui';

export type EventScope = 'discover' | 'community' | 'mine';

const SCOPES: UnderlineTab<EventScope>[] = [
  { id: 'discover', label: 'Discover Events', icon: <Compass className="h-3.5 w-3.5" /> },
  { id: 'community', label: 'Community Events', icon: <Users className="h-3.5 w-3.5" /> },
  { id: 'mine', label: 'My Events', icon: <CalendarCheck className="h-3.5 w-3.5" /> },
];

export default function EventsScopeSelector({ scope, onScopeChange }: {
  scope: EventScope;
  onScopeChange: (scope: EventScope) => void;
}) {
  return (
    <UnderlineTabs
      tabs={SCOPES}
      value={scope}
      onChange={onScopeChange}
      ariaLabel="Event scope"
    />
  );
}
