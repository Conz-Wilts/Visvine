'use client';

/**
 * Event detail — Luma-style "poster left, action right" layout, shared by two
 * routes:
 *
 * - /events/[eventId] (manage=false): the guest-facing view everyone sees —
 *   poster, when/where cards, an RSVP card (the page's primary action), about,
 *   and the guest facepile. An "Edit event" button is always shown (navigation
 *   to the manage view is explicit, not based on who is logged in — the manage
 *   APIs enforce host/admin permissions server-side).
 * - /events/[eventId]/manage (manage=true): the organizer view — host toolbar,
 *   analytics strip, and the Overview / Guests / Form management tabs.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from '@/features/shared/components/SpaceLink';
import { useSearchParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { GuestManager } from '@/features/events/components/GuestManager';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PageTabBar, { type PageTab, type TabConfig } from '@/features/shared/components/pane/PageTabBar';
import { HANDOFF_KEY, useDockEdgeClass } from '@/features/shared/components/pane/PaneTabBar';
import { TabBarSlotProvider } from '@/features/shared/contexts/TabBarSlotContext';
import { copyToClipboard } from '@/lib/utils';
import { useTheme } from '@/features/shared/contexts/ThemeContext';
import { type ThemePalette } from '@/lib/profileTheme';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import {
  formatEventDateRange, formatEventDateShort, formatEventTime, getEventStatus,
  missingRequiredAnswers, startsInLabel, RESPONSE_LABELS,
} from '@/lib/eventUtils';
import { RegistrationField } from '@/features/events/components/RegistrationField';
import type { NBEvent, RSVPResponse } from '@/lib/types';
import { useMapLink } from '../hooks/useMapLink';
import { BlocksIcon, CalendarPlusIcon, CheckIcon, CircleQuestionMarkIcon, ClipboardListIcon, ClockIcon, EarthIcon, FileDownIcon, Link2Icon, LoaderCircleIcon, LockIcon, MapPinIcon, PencilIcon, Trash2Icon, UsersIcon, VideoIcon, XIcon } from '@/features/shared/icons';
import Select from '@/components/ui/Select';
import PageError from '@/components/ui/PageError';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { invalidateEventDetail, loadEventDetail, type EventDetail, type EventStats, type GuestPreview, type ViewerRsvp } from '@/features/events/lib/eventDetail';
import { AboutText } from '@/features/profile/components/profileCards';

// The Context tab pulls in Tiptap + the notes stack; load it only when a note
// tab renders (same rationale as the directory profile's deferred panel).
const EntityContextPanel = dynamic(
  () => import('@/features/notes/components/EntityContextPanel').then((m) => m.EntityContextPanel),
  { ssr: false, loading: () => null },
);

type Tab = 'overview' | 'guests' | 'form';

// The guest-facing view carries the same Event | Context | Raw bar entity
// profiles get. Context/Raw are the event's context note (events/<slug>.md in
// the space context) — the tab IS the editor mode.
const EVENT_TABS: TabConfig[] = [
  { id: 'about', label: 'Event' },
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];
const isNoteTab = (tab: PageTab) => tab === 'context' || tab === 'raw';

export default function EventDetailClient({ eventId, manage = false }: { eventId: string; manage?: boolean }) {
  const router = useSpaceRouter();
  const searchParams = useSearchParams();
  const { currentSpace, joinedSpaces, spaces } = useSpace();
  const { session } = useAuth();
  const { theme: userTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  // The guest view's Event | Context | Raw bar (separate from the manage view's
  // overview/guests/form tabs above).
  const [viewTab, setViewTab] = useState<PageTab>('about');
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [occupied, setOccupied] = useState(0);
  const [viewer, setViewer] = useState<ViewerRsvp | null>(null);
  const [guests, setGuests] = useState<GuestPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Rides over the docked notes tree while it's visible — including the
  // retract window right after arriving from a /directory context note.
  const barEdgeClass = useDockEdgeClass();

  // `?space=<id>` names the space that owns the event when it is not the
  // current one — a public sub-space's event opened from its parent's hub
  // (lib/events/rollup.ts). The detail is read there; the parent's member
  // sees it read-only, and the manage and RSVP surfaces stay in the space
  // that owns it.
  const linkedSpaceId = searchParams.get('space');
  const spaceId = linkedSpaceId ?? currentSpace?.id ?? null;
  const readOnly = !!spaceId && spaceId !== currentSpace?.id && !joinedSpaces.some((s) => s.id === spaceId);
  const ownerSpace = readOnly ? spaces.find((s) => s.id === spaceId) ?? null : null;
  const ownerParent = ownerSpace?.parentId ? spaces.find((s) => s.id === ownerSpace.parentId) ?? null : null;
  const applyDetail = useCallback((data: EventDetail) => {
    setEvent(data.event ?? null);
    setStats(data.stats ?? null);
    setOccupied(data.occupied ?? 0);
    setViewer(data.viewer ?? null);
    setGuests(data.guests ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    loadEventDetail(spaceId, eventId, (data) => {
      if (live) applyDetail(data);
    }).catch((error: unknown) => {
      console.error('Failed to load event:', error);
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [spaceId, eventId, applyDetail]);

  // After a write of our own: drop the cached answer and read it again.
  const loadEvent = useCallback(async () => {
    if (!spaceId) return;
    invalidateEventDetail(eventId);
    try {
      applyDetail(await loadEventDetail(spaceId, eventId, applyDetail));
    } catch (error) {
      console.error('Failed to load event:', error);
    }
  }, [spaceId, eventId, applyDetail]);
  const mapLink = useMapLink(event?.location);

  // Follow the viewer's theme colour from Settings → Appearance (not a
  // per-event color) so event pages match the rest of the app.
  const theme = useMemo<ThemePalette>(() => ({
    id: userTheme.id,
    name: userTheme.name,
    base: userTheme.accent,
    dark: userTheme.accentDark,
    light: userTheme.accentLight,
  }), [userTheme]);

  const publicSlug = event?.slug ?? eventId.replace(/^event:/, '');
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/e/${publicSlug}` : `/e/${publicSlug}`;

  const copyInviteLink = async () => {
    const success = await copyToClipboard(publicUrl);
    setCopyStatus(success ? 'Copied!' : 'Failed');
    setTimeout(() => setCopyStatus(''), 2000);
  };

  if (!currentSpace) {
    return <CenteredNote text="Please select a space to view this event." />;
  }

  // The Context/Raw bar only rides the guest-facing view (the manage view has
  // its own overview/guests/form tabs). Every space has context, so there is
  // nothing else to ask. Known before the event fetch resolves, so the bar can
  // be up from the first frame.
  const showContextTabs = !manage;

  // The shared Event | Context | Raw wrapper. The provider spans the bar and
  // the panel so the Context editor can portal its toolbar into the bar's
  // attached region (see TabBarSlotContext). handoffKey: arriving from the
  // /directory pane shell (an event's context note), this bar claims the
  // outgoing bar's underline so the navigation reads as one bar relabelling.
  const withContextBar = (body: React.ReactNode) => (
    <TabBarSlotProvider>
      <div className="profile-enter w-full pb-10">
        {/* Direct child of the tall page container so `sticky` pins. */}
        <PageTabBar
          tabs={EVENT_TABS} activeTab={viewTab} onTabChange={setViewTab}
          ariaLabel="Event sections"
          attachedOpen={viewTab === 'context'}
          edgeClass={barEdgeClass} handoffKey={HANDOFF_KEY}
        />
        {body}
      </div>
    </TabBarSlotProvider>
  );

  // Keep the bar mounted through the fetch: navigating in from an event's
  // context note would otherwise blink it out for the length of the load.
  if (loading) return showContextTabs ? withContextBar(<EventSkeleton />) : <EventSkeleton />;
  if (!event) {
    return <PageError message="Couldn't load this event." onRetry={() => { setLoading(true); void loadEvent(); }} />;
  }

  const liveStatus = getEventStatus(event.startAt, event.endAt);
  const isPast = liveStatus === 'past';
  const isDraft = event.status === 'draft';
  const isFull = !!event.capacity && occupied >= event.capacity && event.waitlistEnabled === false;
  const waitlistOpen = !!event.capacity && occupied >= event.capacity && event.waitlistEnabled !== false;
  const { month, day } = formatEventDateShort(event.startAt);
  const eventType = (event.metadata?.eventType as string) ?? 'in-person';
  // Same convention as the events feed: no physical location ⇒ virtual.
  const isVirtual = eventType === 'virtual' || !event.location?.label;
  const isHybrid = eventType === 'hybrid';
  const goingCount = (stats?.going ?? 0) + (stats?.checkedIn ?? 0);
  const virtualLink = event.metadata?.virtualLink as string | undefined;
  const viewerGoing = viewer && ['going', 'checked_in'].includes(viewer.status) && viewer.response !== 'declined';

  const eventBody = (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10">
      {/* breadcrumb */}
      {manage ? (
        <Link href={`/events/${encodeURIComponent(eventId)}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-primary transition mb-4">
          ‹ Back to event
        </Link>
      ) : (
        <Link href="/events" className="inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-primary transition mb-4">
          ‹ Events
        </Link>
      )}

      {/* manager tabs */}
      {manage && (
        <nav className="flex gap-1 border-b border-border-subtle mb-6 overflow-x-auto" aria-label="Event management">
          {(['overview', 'guests', 'form'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
                    aria-current={activeTab === tab ? 'true' : undefined}
                    className="relative px-3.5 py-3 text-sm font-semibold capitalize whitespace-nowrap transition"
                    style={{ color: activeTab === tab ? theme.dark : undefined }}>
              <span className={activeTab === tab ? '' : 'text-text-muted'}>
                {tab}{tab === 'guests' && stats ? ` · ${stats.total}` : ''}
              </span>
              {activeTab === tab && <span className="absolute left-3.5 right-3.5 bottom-0 h-[3px] rounded-t" style={{ background: theme.base }} />}
            </button>
          ))}
        </nav>
      )}

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
          {/* ── POSTER COLUMN ── */}
          <div className="lg:sticky lg:top-16 self-start flex flex-col gap-4">
            <div className="aspect-square rounded-lg overflow-hidden relative"
                 style={event.coverImageUrl ? undefined : { background: theme.base }}>
              {event.coverImageUrl ? (
                <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6">
                  <span className="text-6xl font-bold font-title leading-none">{day}</span>
                  <span className="text-xl font-bold tracking-[0.3em] mt-1">{month}</span>
                  <span className="mt-4 text-center text-base font-semibold opacity-90 line-clamp-3">{event.title}</span>
                </div>
              )}
            </div>

            {/* Read through the parent: say whose it is, and offer no controls
                — the manage APIs refuse a non-member anyway, so nothing here
                should look like it might work. */}
            {readOnly && (
              <InfoCard>
                <p className="flex items-start gap-2 text-sm text-text-secondary">
                  <BlocksIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: theme.dark }} />
                  <span>
                    From <span className="font-medium text-text-primary">{ownerSpace?.name ?? 'a sub-space'}</span>
                    {ownerParent ? <>, a sub-space of <span className="font-medium text-text-primary">{ownerParent.name}</span></> : null}
                    {' '}— shown here as it is now. To RSVP or take part, join that space
                    {event.visibility === 'public' ? <> or use the <a href={publicUrl} className="font-semibold hover:underline" style={{ color: theme.dark }}>public page</a></> : null}.
                  </span>
                </p>
              </InfoCard>
            )}

            {/* host actions (manage view) / edit entry point (public view) — a
                plain column of text buttons under the poster */}
            {!readOnly && <div className="flex flex-col gap-0.5 -mx-3">
              <ToolbarBtn icon={<PencilIcon className="w-4 h-4" />} label="Edit event"
                          onClick={() => router.push(`/events/${encodeURIComponent(eventId)}/${manage ? 'edit' : 'manage'}`)} />
              {manage && (
                <>
                  <ToolbarBtn icon={<Link2Icon className="w-4 h-4" />} label={copyStatus || 'Copy invite link'} onClick={copyInviteLink} />
                  <ToolbarBtn icon={<FileDownIcon className="w-4 h-4" />} label="Export guest CSV"
                              onClick={() => window.open(`/api/events/${encodeURIComponent(eventId)}/export.csv?spaceId=${currentSpace.id}`, '_blank')} />
                  <ToolbarBtn icon={<Trash2Icon className="w-4 h-4" />} label="Delete event" danger
                              onClick={() => setShowDeleteModal(true)} />
                </>
              )}
            </div>}

            {/* GUESTS — attendee list lives in the poster column, under the edit box */}
            {event.guestListVisible !== false && goingCount > 0 && (
              <InfoCard>
                <h2 className="flex items-center gap-2 text-[15px] font-bold font-title text-text-primary mb-3">
                  <UsersIcon className="w-[18px] h-[18px]" style={{ color: theme.dark }} />
                  {goingCount} going
                </h2>
                {guests.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {guests.slice(0, 12).map((g, i) => <GuestChip key={`${g.name}-${i}`} guest={g} />)}
                    {guests.length > 12 && (
                      <span className="inline-flex items-center py-1.5 text-[13px] font-semibold text-text-muted">
                        +{guests.length - 12} more
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">{goingCount} {goingCount === 1 ? 'person is' : 'people are'} going.</p>
                )}
              </InfoCard>
            )}
          </div>

          {/* ── CONTENT COLUMN ── */}
          <div className="min-w-0 flex flex-col gap-4">
            {/* badges + title */}
            <div>
              {(isDraft || liveStatus === 'live' || isPast || isFull || waitlistOpen) && (
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  {isDraft && <Pill fg="#b45309">Draft</Pill>}
                  {liveStatus === 'live' && (
                    <Pill fg={theme.dark}>
                      <span className="relative flex h-1.5 w-1.5 mr-1">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                      </span>
                      Happening now
                    </Pill>
                  )}
                  {isPast && <Pill fg="#334155">Past event</Pill>}
                  {isFull && !isPast && <Pill fg="#be123c">Sold out</Pill>}
                  {waitlistOpen && !isPast && <Pill fg="#b45309">Waitlist open</Pill>}
                </div>
              )}

              <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-title">{event.title}</h1>
            </div>

            {/* analytics strip (manage view) */}
            {manage && stats && (
              <div className="flex items-stretch divide-x divide-border-subtle py-2">
                <StatCell value={event.analytics?.views ?? 0} label="Views" />
                <StatCell value={stats.going ?? stats.registered} label="Going" />
                <StatCell value={stats.waitlisted} label="Waitlisted" />
                <StatCell value={stats.checkedIn} label="Checked in" />
              </div>
            )}

            {/* WHEN & WHERE */}
            <InfoCard>
              <div className="flex items-center gap-3.5">
                <div className="flex flex-col items-center w-12 rounded-lg overflow-hidden bg-surface-2 flex-none">
                  <span className="w-full text-center text-[10px] font-bold text-white py-0.5" style={{ background: theme.base }}>{month}</span>
                  <span className="text-lg font-bold font-title text-text-primary leading-tight py-0.5">{day}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-text-primary">
                    {formatEventDateRange(event.startAt, event.endAt, event.timezone)}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {liveStatus === 'upcoming' &&
                      (startsInLabel(event.startAt) ??
                        // No countdown and no date is a schedule waiting to be
                        // set, not an event about to begin.
                        (event.startAt ? 'Starting soon' : 'Set a date to publish it'))}
                    {liveStatus === 'live' && <span className="font-semibold" style={{ color: theme.dark }}>Happening now</span>}
                    {liveStatus === 'past' && 'This event has ended'}
                  </div>
                </div>
                <a href={`/api/events/${encodeURIComponent(eventId)}/ics?spaceId=${currentSpace.id}`} target="_blank" rel="noopener noreferrer"
                   className="flex-none inline-flex items-center gap-1.5 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                  <CalendarPlusIcon className="w-4 h-4" /> <span className="hidden sm:inline">Add to calendar</span>
                </a>
              </div>

              {(event.location?.label || isVirtual || isHybrid) && (
                <>
                  <div className="h-px bg-border-subtle my-4" />
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 grid place-items-center flex-none">
                      {isVirtual ? <VideoIcon className="w-5 h-5" style={{ color: theme.dark }} /> : <MapPinIcon className="w-5 h-5" style={{ color: theme.dark }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      {isVirtual ? (
                        <>
                          <div className="text-sm font-bold text-text-primary">Virtual event</div>
                          {virtualLink ? (
                            viewerGoing ? (
                              <a href={virtualLink} target="_blank" rel="noopener noreferrer"
                                 className="text-xs font-semibold hover:underline break-all" style={{ color: theme.dark }}>
                                {virtualLink}
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                                <LockIcon className="w-3 h-3" /> Link visible after you RSVP
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-text-muted">Link to be shared by the host</span>
                          )}
                        </>
                      ) : (
                        <>
                          {mapLink ? (
                            <a href={mapLink} target="_blank" rel="noopener noreferrer"
                               className="text-sm font-bold text-text-primary hover:underline">
                              {event.location?.label}
                            </a>
                          ) : (
                            <div className="text-sm font-bold text-text-primary">{event.location?.label || 'Location TBA'}</div>
                          )}
                          {event.location?.address && <div className="text-xs text-text-muted mt-0.5">{event.location.address}</div>}
                          {isHybrid && (
                            <span className="inline-flex items-center gap-1 mt-1 text-xs text-text-muted">
                              <VideoIcon className="w-3 h-3" /> Also streamed online
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {!isVirtual && mapLink && (
                      <a href={mapLink}
                         target="_blank" rel="noopener noreferrer"
                         className="flex-none inline-flex items-center gap-1.5 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                        <EarthIcon className="w-4 h-4" /> <span className="hidden sm:inline">Open map</span>
                      </a>
                    )}
                  </div>
                </>
              )}
            </InfoCard>

            {/* RSVP — in the space that owns the event; read through the
                parent there is no card, the notice above says where to go. */}
            {!readOnly && <div id="rsvp-card">
              <RsvpCard
                event={event}
                eventId={eventId}
                spaceId={spaceId ?? currentSpace.id}
                theme={theme}
                viewer={viewer}
                occupied={occupied}
                isPast={isPast}
                isDraft={isDraft}
                isFull={isFull}
                sessionName={session?.user?.name}
                sessionEmail={session?.user?.email}
                onChanged={loadEvent}
              />
            </div>}

            {/* ABOUT */}
            {event.description && (
              <InfoCard>
                <h2 className="text-[15px] font-bold font-title text-text-primary mb-2">About this event</h2>
                <AboutText text={event.description} accent={theme.dark} limit={480} />
              </InfoCard>
            )}

          </div>
        </div>
      )}

      {activeTab === 'guests' && manage && (
        <GuestManager event={event} spaceId={currentSpace.id} />
      )}

      {activeTab === 'form' && manage && (
        <FormTab event={event} publicSlug={publicSlug} publicUrl={publicUrl} theme={theme}
                 copyStatus={copyStatus} onCopy={copyInviteLink} />
      )}

      {/* sticky mobile RSVP bar */}
      {activeTab === 'overview' && !readOnly && !isPast && !isDraft && !viewerGoing && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-surface-1/90 backdrop-blur border-t border-border-subtle">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-text-primary truncate">{event.title}</div>
            <div className="text-xs text-text-muted">{month} {day} · {formatEventTime(event.startAt)}</div>
          </div>
          <button
            onClick={() => document.getElementById('rsvp-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="flex-none inline-flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-bold text-white"
            style={{ background: theme.base }}>
            RSVP
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteModal}
        title="Delete Event"
        body={<>Are you sure you want to delete <span className="font-semibold text-text-primary">{event.title}</span>? This action cannot be undone.</>}
        confirmLabel="Delete Event"
        destructive
        error={deleteError}
        closeOnBackdrop={false}
        closeOnEscape={false}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            await fetchJson(`/api/events/${event.id}?spaceId=${currentSpace.id}`, { method: 'DELETE' });
            invalidateEventDetail(event.id);
            router.push('/events');
          } catch (err) {
            setDeleteError(err instanceof Error ? err.message : 'Failed to delete event');
          }
        }}
        onClose={() => { setShowDeleteModal(false); setDeleteError(null); }}
      />
    </div>
  );

  // Notes off (or manage view): render the event page unchanged.
  if (!showContextTabs) return eventBody;

  // Guest view with notes on: wrap the event in the shared Event | Context | Raw bar.
  return withContextBar(
    isNoteTab(viewTab) ? (
      <EntityContextPanel nodeId={event.id} mode={viewTab === 'raw' ? 'raw' : 'wysiwyg'} />
    ) : (
      eventBody
    ),
  );
}

/* ── RSVP card ────────────────────────────────────────────────────────────── */

function RsvpCard({
  event, eventId, spaceId, theme, viewer, occupied, isPast, isDraft, isFull,
  sessionName, sessionEmail, onChanged,
}: {
  event: NBEvent; eventId: string; spaceId: string; theme: ThemePalette;
  viewer: ViewerRsvp | null; occupied: number; isPast: boolean; isDraft: boolean; isFull: boolean;
  sessionName?: string; sessionEmail?: string; onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [response, setResponse] = useState<RSVPResponse>('going');
  const [plusOnes, setPlusOnes] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = event.allowedResponses?.length ? event.allowedResponses : (['going', 'maybe', 'declined'] as RSVPResponse[]);
  const capacity = event.capacity;
  const spotsLeft = capacity ? Math.max(0, capacity - occupied) : null;
  const pct = capacity ? Math.min((occupied / capacity) * 100, 100) : 0;

  const submit = async () => {
    if (!sessionName) return;
    setError(null);
    // Same predicate the RSVP endpoints enforce server-side.
    const missing = missingRequiredAnswers(event.form.schema, { response, answers });
    if (missing.length > 0) {
      setError(`Please answer: ${missing.join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      await fetchJsonBody(`/api/events/${encodeURIComponent(eventId)}/attendees?spaceId=${spaceId}`, 'POST', {
        name: sessionName,
        email: sessionEmail || undefined,
        response,
        plusOnes: response === 'going' ? plusOnes : 0,
        answers: Object.keys(answers).length ? answers : undefined,
      });
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const card = (children: React.ReactNode) => (
    // The one box on the page: registration is the primary action, so it is
    // drawn in the event's colour — a single hairline, no wash.
    <div className="rounded-xl border px-5 py-4" style={{ borderColor: theme.base }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold font-title text-text-primary">Registration</h2>
        {capacity != null && !isPast && (
          <span className="text-xs font-semibold" style={{ color: spotsLeft !== null && spotsLeft <= capacity * 0.2 ? '#be123c' : theme.dark }}>
            {spotsLeft === 0
              ? 'Event full'
              : spotsLeft !== null && spotsLeft <= capacity * 0.2
                ? `Only ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`
                : `${occupied} of ${capacity} spots filled`}
          </span>
        )}
      </div>
      {capacity != null && !isPast && (
        <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden mb-4">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: theme.base }} />
        </div>
      )}
      {children}
    </div>
  );

  if (isDraft) {
    return card(
      <p className="text-sm text-text-muted">This event is still a draft — publish it from the editor to open registrations.</p>,
    );
  }
  if (isPast) {
    return card(<p className="text-sm text-text-muted">This event has ended.</p>);
  }
  if (!event.form.enabled) {
    return card(<p className="text-sm text-text-muted">RSVPs are closed for this event.</p>);
  }

  // Existing response states
  if (viewer && !editing) {
    if (viewer.status === 'waitlisted') {
      return card(
        <ResponseState icon={<ClockIcon className="h-5 w-5" />} title="You're on the waitlist" sub="We'll let you know if a spot opens up." theme={theme}
                       onChange={() => setEditing(true)} />,
      );
    }
    if (viewer.status === 'pending') {
      return card(
        <ResponseState icon={<ClockIcon className="h-5 w-5" />} title="Registration pending" sub="The host needs to approve your RSVP." theme={theme}
                       onChange={() => setEditing(true)} />,
      );
    }
    if (viewer.status === 'cancelled' || viewer.response === 'declined') {
      return card(
        <ResponseState icon={<XIcon className="h-5 w-5" />} title="You can't make it" sub="Changed your mind?" theme={theme}
                       onChange={() => setEditing(true)} changeLabel="Update response" />,
      );
    }
    if (viewer.response === 'maybe') {
      return card(
        <ResponseState icon={<CircleQuestionMarkIcon className="h-5 w-5" />} title="You said maybe" sub="Lock it in when you know." theme={theme}
                       onChange={() => setEditing(true)} changeLabel="Update response" />,
      );
    }
    return card(
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: theme.light }}>
          <span className="w-8 h-8 rounded-full grid place-items-center text-white flex-none" style={{ background: theme.dark }}>
            <CheckIcon className="w-4 h-4" />
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: theme.dark }}>
              You&apos;re going{viewer.plusOnes > 0 ? ` +${viewer.plusOnes}` : ''}
            </div>
            <div className="text-xs text-text-muted">See you there.</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href={`/api/events/${encodeURIComponent(eventId)}/ics?spaceId=${spaceId}`} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
            <CalendarPlusIcon className="w-4 h-4" /> Add to calendar
          </a>
          <button onClick={() => setEditing(true)} className="text-[13px] font-semibold text-text-muted hover:text-text-primary transition">
            Change response
          </button>
        </div>
      </div>,
    );
  }

  if (isFull) {
    return card(
      <button disabled className="w-full h-11 rounded-xl text-sm font-bold bg-surface-3 text-text-muted cursor-not-allowed">
        Event full
      </button>,
    );
  }

  // Response picker
  return card(
    <div className="flex flex-col gap-3">
      <div className={`grid gap-2 ${allowed.length === 1 ? 'grid-cols-1' : allowed.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {(['going', 'maybe', 'declined'] as RSVPResponse[]).filter((r) => allowed.includes(r)).map((r) => (
          <button key={r} type="button" onClick={() => setResponse(r)}
                  className="px-3 py-2.5 rounded-lg text-sm font-bold border transition-all"
                  style={response === r
                    ? { borderColor: theme.base, background: theme.base, color: '#fff' }
                    : { borderColor: 'var(--color-border-default, #d1d5db)' }}>
            {RESPONSE_LABELS[r]}
          </button>
        ))}
      </div>

      {(event.allowPlusOnes ?? 0) > 0 && response === 'going' && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-secondary font-medium">Bringing guests?</span>
          <Select value={plusOnes} onChange={(e) => setPlusOnes(parseInt(e.target.value, 10))}>
            {Array.from({ length: (event.allowPlusOnes ?? 0) + 1 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? 'Just me' : `+${i}`}</option>
            ))}
          </Select>
        </label>
      )}

      {response === 'going' && event.form.schema.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-1">
          {event.form.schema.map((f) => (
            <RegistrationField
              key={f.id}
              field={f}
              value={answers[f.id]}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [f.id]: v }))}
              classes={{
                field: 'flex flex-col gap-1 text-xs font-semibold text-text-muted',
                input: 'w-full px-3.5 py-2.5 border border-border-default rounded-xl bg-surface-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 transition',
                checkbox: 'flex items-center gap-2.5 text-sm text-text-secondary',
                checkboxInput: 'w-4 h-4 rounded border-border-default',
              }}
              checkboxInputStyle={{ accentColor: theme.base }}
            />
          ))}
        </div>
      )}

      {event.form.requireApproval && (
        <p className="text-xs text-text-muted">RSVPs need host approval before they&apos;re confirmed.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={submitting || !sessionName}
                className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
                style={{ background: theme.base }}>
          {submitting && <LoaderCircleIcon className="w-4 h-4 animate-spin" />}
          {response === 'declined' ? 'Send response' : 'RSVP'}
        </button>
        {viewer && (
          <button onClick={() => setEditing(false)} className="text-[13px] font-semibold text-text-muted hover:text-text-primary transition">
            Cancel
          </button>
        )}
      </div>
    </div>,
  );
}

function ResponseState({ icon, title, sub, theme, onChange, changeLabel = 'Change response' }: {
  icon: React.ReactNode; title: string; sub: string; theme: ThemePalette; onChange: () => void; changeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-none text-text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-text-primary">{title}</div>
        <div className="text-xs text-text-muted">{sub}</div>
      </div>
      <button onClick={onChange} className="flex-none text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
        {changeLabel}
      </button>
    </div>
  );
}

/* ── form tab (host) ──────────────────────────────────────────────────────── */

function FormTab({ event, publicSlug, publicUrl, theme, copyStatus, onCopy }: {
  event: NBEvent; publicSlug: string; publicUrl: string; theme: ThemePalette;
  copyStatus: string; onCopy: () => void;
}) {
  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-title text-text-primary">
          <ClipboardListIcon className="w-[18px] h-[18px]" style={{ color: theme.dark }} /> RSVP form
        </h2>
        <button onClick={onCopy}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-bold text-text-secondary hover:bg-surface-3 hover:text-text-primary transition">
          <Link2Icon className="w-4 h-4" /> {copyStatus || 'Copy form link'}
        </button>
      </div>

      <InfoCard>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">Form status</span>
            <span className="text-[12px] font-semibold"
                  style={{ color: event.form.enabled ? theme.dark : 'var(--color-text-muted, #6b7280)' }}>
              {event.form.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {event.form.requireApproval && (
            <p className="text-sm text-text-muted">Requires approval — RSVPs stay pending until you approve them.</p>
          )}

          {event.form.domainAllowlist && event.form.domainAllowlist.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-text-primary mb-2">Allowed email domains</p>
              <div className="flex flex-wrap gap-2">
                {event.form.domainAllowlist.map((domain) => (
                  <span key={domain} className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                    {domain}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-text-primary mb-1">Public RSVP URL</p>
            <Link href={`/e/${publicSlug}`} className="text-sm hover:underline break-all" style={{ color: theme.dark }}>
              {publicUrl}
            </Link>
          </div>

          {event.form.schema.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-text-primary mb-2">Form fields ({event.form.schema.length})</p>
              <ul className="flex flex-col gap-1.5">
                {event.form.schema.map((field) => (
                  <li key={field.id} className="flex items-center gap-2 text-sm text-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: theme.base }} />
                    {field.label} <span className="text-text-muted">({field.type})</span>
                    {field.required && <span style={{ color: theme.dark }}>*</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </InfoCard>
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

function InfoCard({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">{children}</div>;
}

/** A status word in its colour — Draft, Happening now, Sold out. No capsule. */
function Pill({ fg, children }: { fg: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[12px] font-semibold" style={{ color: fg }}>
      {children}
    </span>
  );
}

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 min-w-0 text-center px-2">
      <b className="block text-base font-bold font-title text-text-primary leading-tight">{value}</b>
      <span className="block text-[11px] text-text-muted">{label}</span>
    </div>
  );
}

function ToolbarBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-semibold transition text-left ${
              danger ? 'text-red-500 hover:bg-red-50' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
            }`}>
      {icon} {label}
    </button>
  );
}

function GuestChip({ guest }: { guest: GuestPreview }) {
  const inner = (
    <>
      {guest.imageUrl
        ? <img src={guest.imageUrl} alt="" className="w-5 h-5 rounded-md object-cover flex-none" />
        : <span className="w-5 h-5 rounded-md overflow-hidden flex-none"><PersonSilhouette /></span>}
      <span className="truncate max-w-[14ch]">{guest.name}</span>
    </>
  );
  const cls = 'inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-[13px] font-semibold bg-surface-2 text-text-secondary border border-border-subtle transition';
  return guest.personId
    ? <Link href={`/directory/${encodeURIComponent(guest.personId)}`} className={`${cls} hover:border-border-default hover:-translate-y-0.5`}>{inner}</Link>
    : <span className={cls}>{inner}</span>;
}

function CenteredNote({ text }: { text: string }) {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
      <p className="text-center text-text-muted">{text}</p>
    </div>
  );
}

function EventSkeleton() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
      <div className="h-4 w-16 rounded bg-surface-3 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        <div className="aspect-square rounded-2xl bg-surface-3" />
        <div className="flex flex-col gap-4">
          <div className="h-8 w-3/4 rounded bg-surface-3" />
          <div className="h-16 rounded-2xl bg-surface-3" />
          <div className="h-16 rounded-2xl bg-surface-3" />
          <div className="h-40 rounded-2xl bg-surface-3" />
        </div>
      </div>
    </div>
  );
}
