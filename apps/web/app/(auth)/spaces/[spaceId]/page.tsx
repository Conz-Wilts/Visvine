'use client';

/**
 * Space detail page — one page, two modes. Non-members get the pitch (about,
 * stats, organizers, join CTA); members get the hub (events, resources, member
 * rail, network). Same shape as the person profile: square avatar beside the
 * identity block, stat strip on the hero's bottom edge, then sections stacked
 * on hairlines in a main + rail grid. Nothing here draws a box.
 */

import React, { useState, useEffect, useMemo, useCallback, use } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import PageError from '@/components/ui/PageError';
import Link from '@/features/shared/components/SpaceLink';
import { CalendarIcon, CalendarPlusIcon, CheckIcon, ChevronRightIcon, LoaderCircleIcon, LogOutIcon, MapPinIcon, NetworkIcon, PlusIcon, Share2Icon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { viewerDoorFor } from '@/features/spaces/lib/viewerDoor';
import { isGlobalSpace } from '@/lib/spaces/shared/global';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig, type NodeTypeConfig } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import { Chip } from '@/components/ui';
import { AboutText, SectionCard, StatItem } from '@/features/profile/components/profileCards';
import { formatEventDateShort, formatEventTime } from '@/lib/eventUtils';
import { FileTypeIcon, FILE_LABEL } from '@/features/resources/components/resourceUi';
import { formatBytes } from '@/lib/utils';
import { useCopied } from '@/features/shared/hooks/useCopied';

/* ── API payload types ────────────────────────────────────────────────────── */

interface OverviewMember {
  userId: string;
  name: string;
  image?: string | null;
  subtitle?: string | null;
  personId?: string | null;
  role: string;
  joinedAt: string;
}

interface OverviewEvent {
  id: string;
  /** A public sub-space's event, read through this space (lib/events/rollup.ts). */
  viaSpace?: { id: string; name: string } | null;
  title: string;
  startAt: string;
  endAt?: string;
  locationLabel?: string | null;
  eventType: string;
  coverImageUrl?: string | null;
  themeColor?: string | null;
  going: number;
}

interface OverviewResource {
  id: string;
  name: string;
  fileType: string;
  fileSize?: number;
  createdAt: string;
}

interface Overview {
  space: {
    id: string;
    name: string;
    description?: string | null;
    location?: string | null;
    tags: string[];
    imageUrl?: string | null;
    nodeTypes?: NodeTypeConfig[] | null;
    createdAt: string;
    memberCount: number;
  };
  viewer: { role: string | null };
  counts: { members: number; nodes: number; resources: number; upcomingEvents: number; totalEvents: number };
  organizers: OverviewMember[];
  members: OverviewMember[];
  events: OverviewEvent[];
  resources: OverviewResource[];
  lastPostAt: string | null;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function SpaceDetailPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId: rawSpaceId } = use(params);
  const spaceId = decodeURIComponent(rawSpaceId);
  const { joinSpace, leaveSpace, setCurrentSpace, refreshSpace, spaces, joinedSpaces } = useSpace();
  // The door this viewer meets, from the client's copy of the dials; a space
  // not in the list (a secret room reached by link) gets the invite-only word.
  const viewerDoor = useMemo(() => {
    const listed = spaces.find((s) => s.id === spaceId);
    return listed ? viewerDoorFor(listed, new Set(joinedSpaces.map((s) => s.id))) : 'deny';
  }, [spaces, joinedSpaces, spaceId]);
  const [asked, setAsked] = useState(false);
  // The global record is a public space with no members and no door: everyone
  // already reads it, so it offers nothing to press.
  const isGlobal = isGlobalSpace(spaceId);

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, copy] = useCopied();
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Through the request cache: coming back to a space's page paints its
  // overview at once and revalidates behind it. A join or leave reads fresh,
  // because the viewer's own standing is part of the answer.
  const overviewKey = `spaces:overview:${spaceId}`;
  const fetchOverview = useCallback(async (fresh = false) => {
    if (fresh) invalidateRequestCache(overviewKey);
    try {
      await swrFetch(
        overviewKey,
        () => fetchJson<Overview>(`/api/spaces/${encodeURIComponent(spaceId)}/overview`),
        (overview) => {
          setData(overview);
          setLoading(false);
        },
      );
    } catch {
      setNotFound(true);
      setLoading(false);
    }
  }, [overviewKey, spaceId]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const isMember = !!data?.viewer.role;
  const isAdminViewer = data?.viewer.role === 'admin';

  const theme = useMemo(
    () => hexToPalette(getNodeTypeConfig('Space', data?.space.nodeTypes ?? undefined).color),
    [data?.space.nodeTypes],
  );

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Entering the space lands on whichever tab its admin put first, so this
  // goes through the /home resolver. The switch must happen before the push —
  // /home reads the current space to pick the tab.
  const openSpace = () => { setCurrentSpace(spaceId, '/home'); };
  // Links that specifically mean "show me the network" still go straight to the
  // directory, whatever the space's landing tab is.
  const openDirectory = () => { setCurrentSpace(spaceId, '/directory'); };

  const share = () => { void copy(window.location.href); };

  const handleJoin = async () => {
    setJoining(true);
    try {
      const status = await joinSpace(spaceId);
      if (status === 'pending') setAsked(true);
      await Promise.all([fetchOverview(true), refreshSpace()]);
    } catch {
      // join API errors (e.g. invite-only) just leave the button enabled
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await leaveSpace(spaceId);
      await fetchOverview(true);
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  if (loading) return <SpaceSkeleton />;
  if (notFound || !data) {
    return (
      <PageError
        message="Couldn't load this space."
        onRetry={() => { setNotFound(false); setLoading(true); void fetchOverview(true); }}
      />
    );
  }

  const { space, counts, organizers, members, events, resources, lastPostAt } = data;
  const createdLabel = new Date(space.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  const tagline = space.description?.split(/(?<=[.!?])\s/)[0] ?? '';
  const isActive = (lastPostAt && Date.now() - new Date(lastPostAt).getTime() < FOURTEEN_DAYS_MS) || counts.upcomingEvents > 0;

  return (
    <div className="profile-content-fade w-full max-w-5xl mx-auto px-6 sm:px-8 py-6 flex flex-col gap-5">
      {/* ══ IDENTITY HERO — avatar beside the identity block, same shape as the profile page ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        <div className="w-48 h-48 sm:w-60 sm:h-60 aspect-square flex-none rounded-lg overflow-hidden bg-surface-2">
          {space.imageUrl ? (
            <img src={space.imageUrl} alt={space.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white text-5xl font-bold font-open-sauce"
                 style={{ background: theme.base }}>
              {getInitials(space.name)}
            </div>
          )}
        </div>

        <section className="flex-1 min-w-0 sm:min-h-60 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto py-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{space.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Chip tone="solid" color={theme.base}>Space</Chip>
                {isActive && (
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: theme.dark }}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                    </span>
                    Active
                  </span>
                )}
              </div>
              {tagline && <p className="mt-1.5 text-[15px] text-text-secondary max-w-[60ch]">{tagline}</p>}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                {space.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPinIcon className="w-3.5 h-3.5" />{space.location}</span>
                )}
                <span className="inline-flex items-center gap-1.5"><CalendarIcon className="w-3.5 h-3.5" />Created {createdLabel}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 flex-none">
              <button onClick={share}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-[13px] font-semibold text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors">
                {copied ? <CheckIcon className="w-4 h-4" /> : <Share2Icon className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
              </button>
              {isMember ? (
                <>
                  {confirmLeave ? (
                    <span className="inline-flex items-center gap-2 text-[13px]">
                      <button onClick={() => setConfirmLeave(false)} className="font-medium text-text-muted hover:text-text-secondary">Cancel</button>
                      <button onClick={handleLeave} disabled={leaving} className="font-bold text-red-500 hover:text-red-600 disabled:opacity-60">
                        {leaving ? 'Leaving…' : 'Confirm leave'}
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmLeave(true)}
                      className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-[13px] font-semibold text-text-secondary hover:bg-surface-3 hover:text-red-500 transition-colors">
                      <LogOutIcon className="w-4 h-4" /><span className="hidden sm:inline">Leave</span>
                    </button>
                  )}
                  <button onClick={openSpace}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold whitespace-nowrap text-white transition hover:opacity-95 active:scale-[0.99]"
                    style={{ background: theme.base }}>
                    <NetworkIcon className="w-4 h-4 flex-none" /> Open space
                  </button>
                </>
              ) : isGlobal ? (
                <span className="text-[13px] font-medium text-text-muted">The public record — open to everyone</span>
              ) : (
                <button onClick={handleJoin} disabled={joining || asked || viewerDoor === 'deny'}
                  title={viewerDoor === 'deny' ? 'This space is invite only' : undefined}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold whitespace-nowrap text-white transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                  style={{ background: theme.base }}>
                  {joining ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                  {viewerDoor === 'active' ? 'Join space' : viewerDoor === 'pending' ? (asked ? 'Asked to join' : 'Ask to join') : 'Invite only'}
                </button>
              )}
            </div>
          </div>

          {/* stat strip — pinned to the hero's bottom edge */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <StatItem value={counts.members} label={counts.members === 1 ? 'Member' : 'Members'}
                      onClick={isMember ? openDirectory : undefined} accent={theme.dark} />
            {isMember && (
              <StatItem value={counts.upcomingEvents} label={counts.upcomingEvents === 1 ? 'Upcoming event' : 'Upcoming events'}
                        onClick={() => jump('events')} accent={theme.dark} />
            )}
            {isMember && resources.length > 0 && (
              <StatItem value={counts.resources} label={counts.resources === 1 ? 'Resource' : 'Resources'}
                        onClick={() => jump('resources')} accent={theme.dark} />
            )}
            <StatItem value={counts.nodes} label="In network" onClick={isMember ? openDirectory : undefined} accent={theme.dark} />
          </div>
        </section>
      </div>

      {/* ══ TWO-COLUMN BODY — sections stacked on hairlines ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5 xl:gap-6">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          <SectionCard id="about" title="About" scrollMargin="scroll-mt-20">
            {space.description ? (
              <AboutText text={space.description} accent={theme.dark} className="max-w-[72ch]" />
            ) : (
              <p className="text-sm text-text-muted">
                {isAdminViewer ? 'Add a description so people know what this space is about.' : 'No description yet.'}
              </p>
            )}
          </SectionCard>

          {isMember && (
            <SectionCard id="events" title="Upcoming events" scrollMargin="scroll-mt-20"
                         badge={events.length > 0 ? counts.upcomingEvents : undefined}
                         action={<Link href="/directory?type=event" className="text-[13px] font-semibold hover:underline" style={{ color: theme.dark }}>View all</Link>}>
              {events.length > 0 ? (
                <div className="flex flex-col divide-y divide-border-subtle">
                  {events.map((e) => <EventRow key={e.id} event={e} theme={theme} />)}
                </div>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="text-text-muted">No upcoming events.</span>
                  <Link href="/events/new" className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                    <CalendarPlusIcon className="w-4 h-4" /> Create an event
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {isMember && resources.length > 0 && (
            <SectionCard id="resources" title="Resources" scrollMargin="scroll-mt-20" badge={counts.resources}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {resources.map((r) => (
                  <Link key={r.id} href={`/resources/${encodeURIComponent(r.id)}`}
                        className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
                    <FileTypeIcon type={r.fileType} className="h-9 w-9 flex-none" />
                    <span className="min-w-0">
                      <b className="block text-[13.5px] font-semibold text-text-primary truncate">{r.name}</b>
                      <span className="block text-xs text-text-muted truncate">
                        {FILE_LABEL[r.fileType] ?? r.fileType.toUpperCase()}
                        {r.fileSize ? ` · ${formatBytes(r.fileSize)}` : ''}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-16 self-start">
          {organizers.length > 0 && (
            <SectionCard id="organizers" title={organizers.length === 1 ? 'Organizer' : 'Organizers'}>
              <div className="flex flex-col gap-0.5 -mx-2">
                {organizers.slice(0, 5).map((o) => <MemberRow key={o.userId} member={o} theme={theme} />)}
              </div>
            </SectionCard>
          )}

          {isMember && members.length > 0 && (
            <SectionCard id="members" title="Members" badge={counts.members}
                         action={counts.members > 8 ? (
                           <button onClick={openDirectory} className="text-[13px] font-semibold hover:underline" style={{ color: theme.dark }}>
                             See all
                           </button>
                         ) : undefined}>
              {counts.members < 5 ? (
                <div className="flex flex-col gap-0.5 -mx-2">
                  {members.map((m) => <MemberRow key={m.userId} member={m} theme={theme} />)}
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {members.slice(0, 8).map((m) => <MemberAvatar key={m.userId} member={m} theme={theme} />)}
                </div>
              )}
            </SectionCard>
          )}

          {(space.nodeTypes?.length ?? 0) > 0 && (
            <SectionCard id="network" title="Network"
                         action={isMember ? (
                           <button onClick={openDirectory} className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline" style={{ color: theme.dark }}>
                             See all <ChevronRightIcon className="w-3.5 h-3.5" />
                           </button>
                         ) : undefined}>
              <div className="flex flex-wrap gap-1.5">
                {space.nodeTypes!.slice(0, 8).map((nt) => (
                  <Chip key={nt.name} tone="solid" color={nt.color}>{nt.name}</Chip>
                ))}
              </div>
            </SectionCard>
          )}

          {space.tags.length > 0 && (
            <SectionCard id="tags" title="Tags">
              <div className="flex flex-wrap gap-1.5">
                {space.tags.map((tag) => <Chip key={tag} tone="muted">{tag}</Chip>)}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── presentational helpers ───────────────────────────────────────────────── */

/** One event per row: a date block, then title and time. Reads like a list,
 *  not a card grid — the events page is where the posters live. */
function EventRow({ event, theme }: { event: OverviewEvent; theme: ThemePalette }) {
  const { month, day } = formatEventDateShort(event.startAt);
  const accent = event.themeColor || theme.base;
  // A sub-space's event opens in the space that owns it: the link names that
  // space so the detail page reads it there rather than in this one.
  const href = event.viaSpace
    ? `/events/${encodeURIComponent(event.id)}?space=${encodeURIComponent(event.viaSpace.id)}`
    : `/events/${encodeURIComponent(event.id)}`;
  return (
    <Link href={href}
          className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-surface-2">
      <span className="flex flex-col items-center w-11 flex-none leading-none">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: accent }}>{month}</span>
        <span className="mt-0.5 text-xl font-bold font-open-sauce text-text-primary tabular-nums">{day}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <b className="block text-[14px] font-semibold text-text-primary truncate">{event.title}</b>
          {event.viaSpace && <Chip tone="muted">{event.viaSpace.name}</Chip>}
        </span>
        <span className="block mt-0.5 text-[13px] text-text-muted truncate">
          {formatEventTime(event.startAt)}
          {event.locationLabel ? ` · ${event.locationLabel}` : event.eventType === 'virtual' ? ' · Virtual' : ''}
          {event.going > 0 ? ` · ${event.going} going` : ''}
        </span>
      </span>
      <ChevronRightIcon className="w-4 h-4 flex-none text-text-muted" />
    </Link>
  );
}

function MemberRow({ member, theme }: { member: OverviewMember; theme: ThemePalette }) {
  const inner = (
    <>
      {member.image
        ? <img src={member.image} alt={member.name} className="w-9 h-9 rounded-lg object-cover flex-none" />
        : <span className="w-9 h-9 rounded-lg overflow-hidden flex-none"><PersonSilhouette color={theme.base} /></span>}
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-semibold text-text-primary truncate">{member.name}</b>
        {member.subtitle && <span className="block text-xs text-text-muted truncate">{member.subtitle}</span>}
      </span>
    </>
  );
  const cls = 'flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-2 transition-colors';
  return member.personId
    ? <Link href={`/directory/${encodeURIComponent(member.personId)}`} className={cls}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

function MemberAvatar({ member, theme }: { member: OverviewMember; theme: ThemePalette }) {
  const inner = member.image
    ? <img src={member.image} alt={member.name} title={member.name} className="w-full aspect-square rounded-lg object-cover" />
    : (
      <span className="block w-full aspect-square rounded-lg overflow-hidden" title={member.name}>
        <PersonSilhouette color={theme.base} />
      </span>
    );
  return member.personId
    ? <Link href={`/directory/${encodeURIComponent(member.personId)}`} className="block hover:opacity-80 transition-opacity">{inner}</Link>
    : <div>{inner}</div>;
}

function SpaceSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto px-6 sm:px-8 py-6 animate-pulse flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row gap-5">
        <div className="w-48 h-48 sm:w-60 sm:h-60 flex-none rounded-lg bg-surface-3" />
        <div className="flex-1 flex flex-col justify-center gap-3">
          <div className="h-8 w-64 rounded bg-surface-3" />
          <div className="h-4 w-96 max-w-full rounded bg-surface-3" />
          <div className="h-4 w-48 rounded bg-surface-3" />
          <div className="mt-6 h-px bg-surface-3" />
          <div className="h-4 w-72 rounded bg-surface-3" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="h-32 rounded bg-surface-3" />
          <div className="h-48 rounded bg-surface-3" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-36 rounded bg-surface-3" />
          <div className="h-24 rounded bg-surface-3" />
        </div>
      </div>
    </div>
  );
}
