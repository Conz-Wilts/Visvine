'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { FilterDropdown } from '@/features/directory/components/FilterDropdown';
import ContentReveal from '@/components/ui/ContentReveal';
import { Chip, SearchInput } from '@/components/ui';
import { getCountry } from '@/lib/countries';
import { tagPalette } from '@/lib/tagColors';
import { countryOptions, sectorOptions, spaceCountryCode, type EventFormat, type EventWhen } from '@/lib/discover/filters';
import { useDiscoverEvents } from '../hooks/useDiscoverEvents';
import { useJoinFlow } from '../hooks/useJoinFlow';
import EventsBoard from './EventsBoard';
import JoinRoleDialog from './JoinRoleDialog';
import SpacesView from './SpacesView';
import { SPACE_COLOR } from './SpaceTile';

export type DiscoverView = 'spaces' | 'events';

const TABS: PaneTabItem[] = [
  { id: 'spaces', label: 'Spaces' },
  { id: 'events', label: 'Events' },
];

function isDiscoverView(v: string | null): v is DiscoverView {
  return v === 'spaces' || v === 'events';
}

const PLACEHOLDER: Record<DiscoverView, string> = {
  spaces: 'Search open spaces…',
  events: 'Search events…',
};

const WHEN: Array<{ value: EventWhen; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

const FORMAT: Array<{ value: EventFormat; label: string }> = [
  { value: 'in-person', label: 'In person' },
  { value: 'virtual', label: 'Online' },
];

/**
 * Discover: what is open to you beyond the spaces you are in. Two views on
 * the pane's tab bar and the URL (`?view=`), the way the Directory keeps its
 * tabs — Spaces, a grid of tiles narrowed by where and by sector; Events,
 * every public upcoming event as posters on one board. The Directory's own toolbar rides under the tabs:
 * the search, then the filters as words.
 */
export default function DiscoverPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: DiscoverView = isDiscoverView(params.get('view')) ? (params.get('view') as DiscoverView) : 'spaces';

  const setView = useCallback(
    (id: string) => {
      if (!isDiscoverView(id)) return;
      router.replace(id === 'spaces' ? pathname : `${pathname}?view=${id}`, { scroll: false });
    },
    [pathname, router],
  );

  usePaneChrome({
    tabs: TABS,
    activeId: view,
    onSelect: setView,
    attachedOpen: false,
    ariaLabel: 'Discover views',
    surface: null,
  });

  const { spaces, loading: spacesLoading } = useSpace();
  const { join, confirm, cancel, pending, joining, isJoined } = useJoinFlow();
  const { events, loading: eventsLoading, error } = useDiscoverEvents();

  const [search, setSearch] = useState('');
  const [countries, setCountries] = useState<Set<string>>(() => new Set());
  const [sectors, setSectors] = useState<Set<string>>(() => new Set());
  const [when, setWhen] = useState<EventWhen>('all');
  const [format, setFormat] = useState<EventFormat>('all');

  // Where counts what the open view holds: spaces by their country, events by
  // their host's. One filter, so switching views keeps the place.
  const countryOpts = useMemo(
    () => countryOptions(view === 'events' ? events.map((e) => e.country) : spaces.map(spaceCountryCode)),
    [view, events, spaces],
  );
  const sectorOpts = useMemo(() => sectorOptions(spaces), [spaces]);

  const without = (set: Set<string>, value: string) => {
    const next = new Set(set);
    next.delete(value);
    return next;
  };
  const activeCount = countries.size + (view === 'spaces' ? sectors.size : 0) + (view === 'events' ? (when !== 'all' ? 1 : 0) + (format !== 'all' ? 1 : 0) : 0);
  const clearAll = () => { setCountries(new Set()); setSectors(new Set()); setWhen('all'); setFormat('all'); };

  const ready = view === 'events' ? !eventsLoading : !spacesLoading;

  return (
    <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 112px)' }}>
      {/* The Directory's toolbar, welded under the pane tab bar. */}
      <div className="sticky top-0 z-10 -ml-6 bg-glass pt-1 pb-2 pl-12 pr-6">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={PLACEHOLDER[view]}
            size="lg"
            className="w-full max-w-[420px] flex-1 sm:min-w-[280px]"
          />

          <div className="hidden h-6 w-px shrink-0 bg-border-subtle sm:block" />

          {countryOpts.length > 0 && (
            <FilterDropdown label="Where" options={countryOpts} selected={countries} onChange={setCountries} />
          )}

          {view === 'spaces' && sectorOpts.length > 0 && (
            <FilterDropdown
              label="Sector"
              options={sectorOpts}
              selected={sectors}
              onChange={setSectors}
              getColor={(v) => tagPalette(sectorOpts.find((o) => o.value === v)?.label ?? v).base}
            />
          )}

          {view === 'events' && (
            <>
              {/* The default is "All": no selection, so the word stays quiet. */}
              <FilterDropdown label="When" options={WHEN} selected={new Set(when === 'all' ? [] : [when])} onChange={(s) => setWhen(([...s][0] as EventWhen) ?? 'all')} singleSelect />
              <FilterDropdown label="Format" options={FORMAT} selected={new Set(format === 'all' ? [] : [format])} onChange={(s) => setFormat(([...s][0] as EventFormat) ?? 'all')} singleSelect />
            </>
          )}
        </div>

        {activeCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {[...countries].map((c) => (
              <Chip key={c} color={SPACE_COLOR} onRemove={() => setCountries(without(countries, c))} removeLabel={`Remove ${c} filter`}>
                {getCountry(c)?.name ?? c}
              </Chip>
            ))}
            {view === 'spaces' && [...sectors].map((s) => {
              const label = sectorOpts.find((o) => o.value === s)?.label ?? s;
              return (
                <Chip key={s} color={tagPalette(label).base} onRemove={() => setSectors(without(sectors, s))} removeLabel={`Remove ${label} filter`}>
                  {label}
                </Chip>
              );
            })}
            {view === 'events' && when !== 'all' && (
              <Chip color={SPACE_COLOR} onRemove={() => setWhen('all')} removeLabel="Remove when filter">{WHEN.find((w) => w.value === when)?.label}</Chip>
            )}
            {view === 'events' && format !== 'all' && (
              <Chip color={SPACE_COLOR} onRemove={() => setFormat('all')} removeLabel="Remove format filter">{FORMAT.find((f) => f.value === format)?.label}</Chip>
            )}
            {activeCount > 1 && (
              <button type="button" onClick={clearAll} className="text-[12px] font-medium text-text-muted hover:text-text-primary">Clear all</button>
            )}
          </div>
        )}
      </div>

      <ContentReveal ready={ready} id={`panel-${view}`} role="tabpanel">
        <div className="w-full px-6 pt-7 pb-8">
          {view === 'spaces' && (
            <SpacesView
              spaces={spaces}
              search={search}
              countries={countries}
              sectors={sectors}
              onSectors={setSectors}
              isJoined={isJoined}
              onJoin={join}
            />
          )}
          {view === 'events' && (
            <EventsBoard
              events={events}
              loading={eventsLoading}
              error={error}
              search={search}
              when={when}
              format={format}
              countries={countries}
            />
          )}
        </div>
      </ContentReveal>

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
