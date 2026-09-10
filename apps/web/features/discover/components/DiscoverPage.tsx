'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { SearchInput, ViewToggle, type ViewToggleOption } from '@/components/ui';
import type { EventFormat, EventWhen } from '@/lib/discover/filters';
import { useDiscoverEvents } from '../hooks/useDiscoverEvents';
import { useJoinFlow } from '../hooks/useJoinFlow';
import EcosystemsView from './EcosystemsView';
import EventsBoard from './EventsBoard';
import JoinRoleDialog from './JoinRoleDialog';
import SpacesView from './SpacesView';

export type DiscoverView = 'spaces' | 'events' | 'ecosystems';

const VIEWS: ViewToggleOption<DiscoverView>[] = [
  { id: 'spaces', label: 'Spaces' },
  { id: 'events', label: 'Events' },
  { id: 'ecosystems', label: 'Ecosystems' },
];

function isDiscoverView(v: string | null): v is DiscoverView {
  return v === 'spaces' || v === 'events' || v === 'ecosystems';
}

const PLACEHOLDER: Record<DiscoverView, string> = {
  spaces: 'Search spaces by name, sector or place…',
  events: 'Search events…',
  ecosystems: 'Search ecosystems…',
};

/**
 * Discover: what is open to you beyond the spaces you are in. Three views on
 * the URL (`?view=`), the way the Directory keeps its tabs — Spaces, a grid
 * narrowed by where and by sector; Events, every public upcoming event on one
 * board; Ecosystems, the spaces that hold other spaces. One search field
 * serves whichever view is open; the filters belong to the view.
 */
export default function DiscoverPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: DiscoverView = isDiscoverView(params.get('view')) ? (params.get('view') as DiscoverView) : 'spaces';

  const setView = useCallback(
    (next: DiscoverView) => {
      const q = new URLSearchParams(params.toString());
      if (next === 'spaces') q.delete('view'); else q.set('view', next);
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const { spaces } = useSpace();
  const { join, confirm, cancel, pending, joining, isJoined } = useJoinFlow();
  const { events, loading, error } = useDiscoverEvents();

  const [search, setSearch] = useState('');
  const [spaceCountries, setSpaceCountries] = useState<Set<string>>(() => new Set());
  const [sectors, setSectors] = useState<Set<string>>(() => new Set());
  const [when, setWhen] = useState<EventWhen>('all');
  const [format, setFormat] = useState<EventFormat>('all');
  const [eventCountries, setEventCountries] = useState<Set<string>>(() => new Set());

  return (
    <div className="w-full">
      <div className="w-full px-4 pb-10 sm:px-6 lg:px-8">
        {/* The page's own nav line: the three views, and the one search. It
            pins under the shell band like the Directory's bar. */}
        <div className="sticky top-0 z-10 -mx-4 bg-glass px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle">
            <ViewToggle options={VIEWS} value={view} onChange={setView} size="lg" />
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={PLACEHOLDER[view]}
              size="sm"
              className="w-full max-w-[320px] sm:w-[260px]"
            />
          </div>
        </div>

        <div className="pt-4">
          {view === 'spaces' && (
            <SpacesView
              spaces={spaces}
              search={search}
              countries={spaceCountries}
              onCountries={setSpaceCountries}
              sectors={sectors}
              onSectors={setSectors}
              isJoined={isJoined}
              onJoin={join}
            />
          )}
          {view === 'events' && (
            <EventsBoard
              events={events}
              loading={loading}
              error={error}
              search={search}
              when={when}
              onWhen={setWhen}
              format={format}
              onFormat={setFormat}
              countries={eventCountries}
              onCountries={setEventCountries}
            />
          )}
          {view === 'ecosystems' && (
            <EcosystemsView spaces={spaces} search={search} isJoined={isJoined} onJoin={join} />
          )}
        </div>
      </div>

      {pending && (
        <JoinRoleDialog
          key={pending.id}
          space={pending}
          joining={joining}
          onConfirm={(alias) => void confirm(pending.id, alias)}
          onCancel={cancel}
        />
      )}
    </div>
  );
}
