'use client';

/**
 * Event detail page — Luma-style "poster left, action right" layout.
 *
 * Members see the guest-facing page: poster, when/where cards, an RSVP card
 * (the page's primary action), about, and the guest facepile. Hosts and
 * community admins additionally get a host toolbar, an analytics strip, and
 * the Guests / Form management tabs.
 */

import { useState, useEffect, useCallback, useMemo, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useSession } from '@/lib/auth-client';
import { GuestManager } from '@/components/events/GuestManager';
import { DeleteEventModal } from '@/components/events/DeleteEventModal';
import { copyToClipboard } from '@/lib/utils';
import { hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getInitials } from '@/lib/avatarUtils';
import {
  formatEventDateRange, formatEventDateShort, formatEventTime, getEventStatus,
} from '@/lib/eventUtils';
import type { NBEvent, RSVPResponse, FormField } from '@/lib/types';
import {
  Link2, Trash2, Pencil, MapPin, Video, Users, FileDown,
  CalendarPlus, Check, Loader2, Lock, Eye, ClipboardList, Clock, Globe2,
} from 'lucide-react';

type Tab = 'overview' | 'guests' | 'form';

interface EventStats {
  total: number;
  going?: number;
  registered: number;
  waitlisted: number;
  pending?: number;
  invited: number;
  checkedIn: number;
  cancelled: number;
  noShow: number;
  maybe?: number;
}

interface ViewerRsvp {
  status: string;
  response: RSVPResponse | null;
  plusOnes: number;
}

interface GuestPreview {
  name: string;
  personId?: string;
  imageUrl?: string | null;
}

interface HostNode {
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
}

const RESPONSE_LABELS: Record<RSVPResponse, string> = {
  going: "I'm going",
  maybe: 'Maybe',
  declined: "Can't go",
};

export default function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = use(params);
  const eventId = decodeURIComponent(rawEventId);
  const router = useRouter();
  const { currentCommunity, isAdmin } = useCommunity();
  const { data: session } = useSession();

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [event, setEvent] = useState<NBEvent | null>(null);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [occupied, setOccupied] = useState(0);
  const [viewer, setViewer] = useState<ViewerRsvp | null>(null);
  const [guests, setGuests] = useState<GuestPreview[]>([]);
  const [hostNodes, setHostNodes] = useState<HostNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const loadEvent = useCallback(async () => {
    if (!currentCommunity) return;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventId)}?communityId=${currentCommunity.id}`);
      const data = await response.json();
      setEvent(data.event ?? null);
      setStats(data.stats ?? null);
      setOccupied(data.occupied ?? 0);
      setViewer(data.viewer ?? null);
      setGuests(data.guests ?? []);
      setHostNodes(data.hostNodes ?? []);
    } catch (error) {
      console.error('Failed to load event:', error);
    } finally {
      setLoading(false);
    }
  }, [currentCommunity, eventId]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  const theme = useMemo(() => hexToPalette(event?.theme?.color || '#78d870'), [event?.theme?.color]);
  const isHost = !!(session?.user?.nodeId && event?.hosts?.includes(session.user.nodeId));
  const isManager = isAdmin || isHost;

  const publicSlug = event?.slug ?? eventId.replace(/^event:/, '');
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/e/${publicSlug}` : `/e/${publicSlug}`;

  const copyInviteLink = async () => {
    const success = await copyToClipboard(publicUrl);
    setCopyStatus(success ? 'Copied!' : 'Failed');
    setTimeout(() => setCopyStatus(''), 2000);
  };

  if (!currentCommunity) {
    return <CenteredNote text="Please select a community to view this event." />;
  }
  if (loading) return <EventSkeleton />;
  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">📅</div>
        <p className="text-base font-semibold text-text-primary">Event not found</p>
        <p className="text-sm text-text-muted">It may have been deleted, or the URL is incorrect.</p>
        <Link href="/events" className="mt-2 text-sm font-bold hover:underline text-brand-dark-green">Back to events</Link>
      </div>
    );
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10">
      {/* breadcrumb */}
      <Link href="/events" className="inline-flex items-center gap-1 text-sm font-semibold text-text-muted hover:text-text-primary transition mb-4">
        ‹ Events
      </Link>

      {/* manager tabs */}
      {isManager && (
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
            <div className="aspect-square rounded-2xl overflow-hidden shadow-float relative"
                 style={event.coverImageUrl ? undefined : { background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
              {event.coverImageUrl ? (
                <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6">
                  <div className="absolute inset-0 opacity-30"
                       style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
                  <span className="relative text-6xl font-bold font-ginto leading-none">{day}</span>
                  <span className="relative text-xl font-bold tracking-[0.3em] mt-1">{month}</span>
                  <span className="relative mt-4 text-center text-base font-semibold opacity-90 line-clamp-3">{event.title}</span>
                </div>
              )}
            </div>

            {/* host toolbar */}
            {isManager && (
              <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft p-3 flex flex-col gap-1">
                <ToolbarBtn icon={<Pencil className="w-4 h-4" />} label="Edit event"
                            onClick={() => router.push(`/events/${encodeURIComponent(eventId)}/edit`)} />
                <ToolbarBtn icon={<Link2 className="w-4 h-4" />} label={copyStatus || 'Copy invite link'} onClick={copyInviteLink} />
                <ToolbarBtn icon={<FileDown className="w-4 h-4" />} label="Export guest CSV"
                            onClick={() => window.open(`/api/events/${encodeURIComponent(eventId)}/export.csv?communityId=${currentCommunity.id}`, '_blank')} />
                <div className="h-px bg-border-subtle my-1" />
                <ToolbarBtn icon={<Trash2 className="w-4 h-4" />} label="Delete event" danger
                            onClick={() => setShowDeleteModal(true)} />
              </div>
            )}
          </div>

          {/* ── CONTENT COLUMN ── */}
          <div className="min-w-0 flex flex-col gap-4">
            {/* badges + title */}
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                {isDraft && <Pill bg="#fffbeb" fg="#b45309" border="#f59e0b40">Draft</Pill>}
                {liveStatus === 'live' && (
                  <Pill bg={theme.light} fg={theme.dark} border={`${theme.base}80`}>
                    <span className="relative flex h-1.5 w-1.5 mr-1">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                    </span>
                    Happening now
                  </Pill>
                )}
                {isPast && <Pill bg="#f8fafc" fg="#334155" border="#64748b40">Past event</Pill>}
                {isFull && !isPast && <Pill bg="#fff1f2" fg="#be123c" border="#f43f5e40">Sold out</Pill>}
                {waitlistOpen && !isPast && <Pill bg="#fffbeb" fg="#b45309" border="#f59e0b40">Waitlist open</Pill>}
                <Pill bg={theme.light} fg={theme.dark} border={`${theme.base}40`}>
                  {event.visibility === 'public' ? 'Public' : event.visibility === 'private' ? 'Private' : 'Community'}
                </Pill>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-ginto">{event.title}</h1>

              {/* hosted by */}
              {(hostNodes.length > 0 || currentCommunity) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-sm text-text-muted">
                  {hostNodes.length > 0 && (
                    <span className="inline-flex items-center gap-2">
                      <span className="flex -space-x-2">
                        {hostNodes.slice(0, 3).map((h) => (
                          <HostAvatar key={h.id} host={h} theme={theme} />
                        ))}
                      </span>
                      <span>
                        Hosted by{' '}
                        {hostNodes.slice(0, 2).map((h, i) => (
                          <span key={h.id}>
                            {i > 0 && ' & '}
                            <Link href={`/directory/${encodeURIComponent(h.id)}`} className="font-semibold hover:underline" style={{ color: theme.dark }}>
                              {h.name}
                            </Link>
                          </span>
                        ))}
                        {hostNodes.length > 2 && ` +${hostNodes.length - 2}`}
                      </span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    in{' '}
                    <Link href={`/communities/${encodeURIComponent(currentCommunity.id)}`}
                          className="font-semibold hover:underline" style={{ color: theme.dark }}>
                      {currentCommunity.name}
                    </Link>
                  </span>
                </div>
              )}
            </div>

            {/* analytics strip (managers) */}
            {isManager && stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <StatChip icon={<Eye className="w-4 h-4" />} value={event.analytics?.views ?? 0} label="Views" theme={theme} />
                <StatChip icon={<Users className="w-4 h-4" />} value={stats.going ?? stats.registered} label="Going" theme={theme} />
                <StatChip icon={<Clock className="w-4 h-4" />} value={stats.waitlisted} label="Waitlisted" theme={theme} />
                <StatChip icon={<Check className="w-4 h-4" />} value={stats.checkedIn} label="Checked in" theme={theme} />
              </div>
            )}

            {/* WHEN */}
            <InfoCard>
              <div className="flex items-center gap-3.5">
                <div className="flex flex-col items-center w-12 rounded-xl overflow-hidden border border-border-subtle flex-none">
                  <span className="w-full text-center text-[10px] font-bold text-white py-0.5" style={{ background: theme.base }}>{month}</span>
                  <span className="text-lg font-bold font-ginto text-text-primary leading-tight py-0.5">{day}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-text-primary">
                    {formatEventDateRange(event.startAt, event.endAt, event.timezone)}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {liveStatus === 'upcoming' && <UpcomingIn startAt={event.startAt} />}
                    {liveStatus === 'live' && <span className="font-semibold" style={{ color: theme.dark }}>Happening now</span>}
                    {liveStatus === 'past' && 'This event has ended'}
                  </div>
                </div>
                <a href={`/api/events/${encodeURIComponent(eventId)}/ics?communityId=${currentCommunity.id}`} target="_blank" rel="noopener noreferrer"
                   className="flex-none inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
                  <CalendarPlus className="w-4 h-4" /> <span className="hidden sm:inline">Add to calendar</span>
                </a>
              </div>
            </InfoCard>

            {/* WHERE */}
            {(event.location?.label || isVirtual || isHybrid) && (
              <InfoCard>
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-xl grid place-items-center flex-none border border-border-subtle" style={{ background: theme.light }}>
                    {isVirtual ? <Video className="w-5 h-5" style={{ color: theme.dark }} /> : <MapPin className="w-5 h-5" style={{ color: theme.dark }} />}
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
                              <Lock className="w-3 h-3" /> Link visible after you RSVP
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-text-muted">Link to be shared by the host</span>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-bold text-text-primary">{event.location?.label || 'Location TBA'}</div>
                        {event.location?.address && <div className="text-xs text-text-muted mt-0.5">{event.location.address}</div>}
                        {isHybrid && (
                          <span className="inline-flex items-center gap-1 mt-1 text-xs text-text-muted">
                            <Video className="w-3 h-3" /> Also streamed online
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {!isVirtual && event.location?.label && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location.address || event.location.label)}`}
                       target="_blank" rel="noopener noreferrer"
                       className="flex-none inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
                      <Globe2 className="w-4 h-4" /> <span className="hidden sm:inline">Open map</span>
                    </a>
                  )}
                </div>
              </InfoCard>
            )}

            {/* RSVP */}
            <div id="rsvp-card">
              <RsvpCard
                event={event}
                eventId={eventId}
                communityId={currentCommunity.id}
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
            </div>

            {/* ABOUT */}
            {event.description && (
              <InfoCard>
                <h2 className="text-[15px] font-bold font-ginto text-text-primary mb-2">About this event</h2>
                <AboutText text={event.description} theme={theme} />
              </InfoCard>
            )}

            {/* GUESTS */}
            {event.guestListVisible !== false && goingCount > 0 && (
              <InfoCard>
                <h2 className="flex items-center gap-2 text-[15px] font-bold font-ginto text-text-primary mb-3">
                  <Users className="w-[18px] h-[18px]" style={{ color: theme.dark }} />
                  {goingCount} going
                </h2>
                {guests.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {guests.slice(0, 12).map((g, i) => <GuestChip key={`${g.name}-${i}`} guest={g} />)}
                    {guests.length > 12 && (
                      <span className="inline-flex items-center px-3 py-1.5 rounded-full text-[13px] font-semibold bg-surface-2 text-text-muted border border-border-default">
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
        </div>
      )}

      {activeTab === 'guests' && isManager && (
        <GuestManager event={event} communityId={currentCommunity.id} />
      )}

      {activeTab === 'form' && isManager && (
        <FormTab event={event} publicSlug={publicSlug} publicUrl={publicUrl} theme={theme} />
      )}

      {/* sticky mobile RSVP bar */}
      {activeTab === 'overview' && !isPast && !isDraft && !viewerGoing && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-surface-1/90 backdrop-blur border-t border-border-subtle">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-text-primary truncate">{event.title}</div>
            <div className="text-xs text-text-muted">{formatEventDateShort(event.startAt).month} {day} · {formatEventTime(event.startAt)}</div>
          </div>
          <button
            onClick={() => document.getElementById('rsvp-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="flex-none inline-flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-bold text-white"
            style={{ background: theme.base }}>
            RSVP
          </button>
        </div>
      )}

      {showDeleteModal && (
        <DeleteEventModal
          eventTitle={event.title}
          eventId={event.id}
          communityId={currentCommunity.id}
          onClose={() => setShowDeleteModal(false)}
          onSuccess={() => router.push('/events')}
        />
      )}
    </div>
  );
}

/* ── RSVP card ────────────────────────────────────────────────────────────── */

function RsvpCard({
  event, eventId, communityId, theme, viewer, occupied, isPast, isDraft, isFull,
  sessionName, sessionEmail, onChanged,
}: {
  event: NBEvent; eventId: string; communityId: string; theme: ThemePalette;
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
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/attendees?communityId=${communityId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          email: sessionEmail || undefined,
          response,
          plusOnes: response === 'going' ? plusOnes : 0,
          answers: Object.keys(answers).length ? answers : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not submit your RSVP');
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="rounded-2xl border-2 shadow-soft px-5 py-4"
         style={{ borderColor: `${theme.base}40`, background: `linear-gradient(180deg, ${theme.light}, var(--surface-1, #fff) 70%)` }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-bold font-ginto text-text-primary">Registration</h2>
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
        <ResponseState icon="⏳" title="You're on the waitlist" sub="We'll let you know if a spot opens up." theme={theme}
                       onChange={() => setEditing(true)} />,
      );
    }
    if (viewer.status === 'pending') {
      return card(
        <ResponseState icon="🕐" title="Registration pending" sub="The host needs to approve your RSVP." theme={theme}
                       onChange={() => setEditing(true)} />,
      );
    }
    if (viewer.status === 'cancelled' || viewer.response === 'declined') {
      return card(
        <ResponseState icon="👋" title="You can't make it" sub="Changed your mind?" theme={theme}
                       onChange={() => setEditing(true)} changeLabel="Update response" />,
      );
    }
    if (viewer.response === 'maybe') {
      return card(
        <ResponseState icon="🤔" title="You said maybe" sub="Lock it in when you know." theme={theme}
                       onChange={() => setEditing(true)} changeLabel="Update response" />,
      );
    }
    return card(
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{ background: theme.light }}>
          <span className="w-8 h-8 rounded-full grid place-items-center text-white flex-none" style={{ background: theme.dark }}>
            <Check className="w-4 h-4" />
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: theme.dark }}>
              You&apos;re going{viewer.plusOnes > 0 ? ` +${viewer.plusOnes}` : ''}
            </div>
            <div className="text-xs text-text-muted">See you there 🎉</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href={`/api/events/${encodeURIComponent(eventId)}/ics?communityId=${communityId}`} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl text-[13px] font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
            <CalendarPlus className="w-4 h-4" /> Add to calendar
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
                  className="px-3 py-2.5 rounded-xl text-sm font-bold border-2 transition-all"
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
          <select value={plusOnes} onChange={(e) => setPlusOnes(parseInt(e.target.value, 10))}
                  className="px-3 py-2 border border-border-default rounded-lg bg-surface-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-green/40">
            {Array.from({ length: (event.allowPlusOnes ?? 0) + 1 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? 'Just me' : `+${i}`}</option>
            ))}
          </select>
        </label>
      )}

      {response === 'going' && event.form.schema.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-1">
          {event.form.schema.map((f) => (
            <FormFieldInput key={f.id} field={f} value={answers[f.id]} theme={theme}
                            onChange={(v) => setAnswers((prev) => ({ ...prev, [f.id]: v }))} />
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
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
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
  icon: string; title: string; sub: string; theme: ThemePalette; onChange: () => void; changeLabel?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl flex-none">{icon}</span>
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

function FormFieldInput({ field, value, onChange, theme }: {
  field: FormField; value: string | boolean | undefined; onChange: (v: string | boolean) => void; theme: ThemePalette;
}) {
  const base = 'w-full px-3.5 py-2.5 border border-border-default rounded-xl bg-surface-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 transition';
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2.5 text-sm text-text-secondary">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)}
               className="w-4 h-4 rounded border-border-default" style={{ accentColor: theme.base }} />
        {field.label}{field.required && ' *'}
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
        {field.label}{field.required && ' *'}
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={base}>
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
        {field.label}{field.required && ' *'}
        <textarea rows={3} value={(value as string) ?? ''} placeholder={field.placeholder}
                  onChange={(e) => onChange(e.target.value)} className={`${base} resize-none`} />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
      {field.label}{field.required && ' *'}
      <input type={field.type === 'email' ? 'email' : field.type === 'url' || field.type === 'linkedin' ? 'url' : 'text'}
             value={(value as string) ?? ''} placeholder={field.placeholder}
             onChange={(e) => onChange(e.target.value)} className={base} />
    </label>
  );
}

/* ── form tab (host) ──────────────────────────────────────────────────────── */

function FormTab({ event, publicSlug, publicUrl, theme }: {
  event: NBEvent; publicSlug: string; publicUrl: string; theme: ThemePalette;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const copy = async () => {
    const success = await copyToClipboard(publicUrl);
    setCopyStatus(success ? 'Copied!' : 'Failed');
    setTimeout(() => setCopyStatus(''), 2000);
  };
  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-ginto text-text-primary">
          <ClipboardList className="w-[18px] h-[18px]" style={{ color: theme.dark }} /> RSVP form
        </h2>
        <button onClick={copy}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl text-[13px] font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
          <Link2 className="w-4 h-4" /> {copyStatus || 'Copy form link'}
        </button>
      </div>

      <InfoCard>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">Form status</span>
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                  style={event.form.enabled
                    ? { background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }
                    : { background: 'var(--color-surface-3, #f3f4f6)', color: 'var(--color-text-muted, #6b7280)' }}>
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
  return <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 py-4">{children}</div>;
}

function Pill({ bg, fg, border, children }: { bg: string; fg: string; border: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
          style={{ background: bg, color: fg, borderColor: border }}>
      {children}
    </span>
  );
}

function StatChip({ icon, value, label, theme }: { icon: React.ReactNode; value: number; label: string; theme: ThemePalette }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-border-subtle bg-surface-1 shadow-soft">
      <span className="flex-none" style={{ color: theme.dark }}>{icon}</span>
      <span className="min-w-0">
        <b className="block text-base font-bold font-ginto text-text-primary leading-tight">{value}</b>
        <span className="block text-[11px] text-text-muted">{label}</span>
      </span>
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

function HostAvatar({ host, theme }: { host: HostNode; theme: ThemePalette }) {
  return host.imageUrl ? (
    <img src={host.imageUrl} alt={host.name} title={host.name}
         className="w-7 h-7 rounded-full object-cover border-2 border-surface-1" />
  ) : (
    <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-surface-1"
          title={host.name} style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
      {getInitials(host.name)}
    </span>
  );
}

function GuestChip({ guest }: { guest: GuestPreview }) {
  const inner = (
    <>
      {guest.imageUrl
        ? <img src={guest.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover flex-none" />
        : <span className="w-5 h-5 rounded-full bg-surface-3 text-text-muted flex items-center justify-center text-[9px] font-bold flex-none">{getInitials(guest.name)}</span>}
      <span className="truncate max-w-[14ch]">{guest.name}</span>
    </>
  );
  const cls = 'inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-[13px] font-semibold bg-surface-2 text-text-secondary border border-border-subtle transition';
  return guest.personId
    ? <Link href={`/directory/${encodeURIComponent(guest.personId)}`} className={`${cls} hover:border-border-default hover:-translate-y-0.5`}>{inner}</Link>
    : <span className={cls}>{inner}</span>;
}

function AboutText({ text, theme }: { text: string; theme: ThemePalette }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 480;
  const shown = long && !open ? text.slice(0, 480).trimEnd() + '…' : text;
  return (
    <div>
      <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line">{shown}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 text-[13px] font-bold" style={{ color: theme.dark }}>
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

function UpcomingIn({ startAt }: { startAt: string }) {
  const ms = new Date(startAt).getTime() - Date.now();
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return <>Starts in {days} {days === 1 ? 'day' : 'days'}</>;
  if (hours > 0) return <>Starts in {hours} {hours === 1 ? 'hour' : 'hours'}</>;
  return <>Starting soon</>;
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
