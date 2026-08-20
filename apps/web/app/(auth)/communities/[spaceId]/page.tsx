'use client';

/**
 * Space detail page — one page, two modes. Non-members get a "pitch"
 * (about, stats, organizers, join CTA); members get the hub (events strip,
 * activity feed, resources, member rail). Follows the profile page design
 * system: theme-gradient cover, overlapping avatar, scroll-spy sub-nav,
 * main + 320px rail grid.
 */

import React, { useState, useEffect, useMemo, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarIcon, CalendarPlusIcon, ChevronRightIcon, EarthIcon, FolderOpenIcon, LoaderCircleIcon, LogOutIcon, MapPinIcon, NetworkIcon, PlusIcon, Share2Icon, SparklesIcon, UserPlusIcon, UsersIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig, type NodeTypeConfig } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import { Chip, chipClass, chipStyle } from '@/components/ui';
import { SectionCard, RailCard } from '@/features/profile/components/profileCards';
import { formatEventDateShort, formatEventTime } from '@/lib/eventUtils';
import { FileTypeIcon, FILE_LABEL } from '@/features/resources/components/resourceUi';
import { formatBytes } from '@/lib/utils';

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
    country?: string | null;
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

const SECTIONS = ['overview', 'events', 'resources'] as const;
type Section = (typeof SECTIONS)[number];

function useScrollSpy(ids: readonly string[]) {
  const [active, setActive] = useState<string>(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); }),
      { rootMargin: '-20% 0px -70% 0px' },
    );
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [ids]);
  return active;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function SpaceDetailPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId: rawSpaceId } = use(params);
  const spaceId = decodeURIComponent(rawSpaceId);
  const router = useRouter();
  const { joinSpace, leaveSpace, setCurrentSpace, refreshSpace } = useSpace();

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(spaceId)}/overview`);
      if (!res.ok) { setNotFound(true); return; }
      setData(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const isMember = !!data?.viewer.role;
  const isAdminViewer = data?.viewer.role === 'admin';

  const theme = useMemo(
    () => hexToPalette(getNodeTypeConfig('Space', data?.space.nodeTypes ?? undefined).color),
    [data?.space.nodeTypes],
  );

  const visibleSections = useMemo(() => SECTIONS.filter((s) => {
    if (s === 'events' || s === 'resources') return isMember;
    return true;
  }), [isMember]);
  const active = useScrollSpy(visibleSections);
  const jump = (id: Section) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Entering the space lands on whichever tab its admin put first, so this
  // goes through the /home resolver. The switch must happen before the push —
  // /home reads the current space to pick the tab.
  const openSpace = () => { setCurrentSpace(spaceId); router.push('/home'); };
  // Links that specifically mean "show me the network" still go straight to the
  // directory, whatever the space's landing tab is.
  const openDirectory = () => { setCurrentSpace(spaceId); router.push('/directory'); };

  const share = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      await joinSpace(spaceId);
      await Promise.all([fetchOverview(), refreshSpace()]);
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
      await fetchOverview();
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  if (loading) return <SpaceSkeleton />;
  if (notFound || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">🏘️</div>
        <p className="text-base font-semibold text-text-primary">Space not found</p>
        <p className="text-sm text-text-muted">It may have been removed, or the URL is incorrect.</p>
        <Link href="/communities" className="mt-2 text-sm font-bold hover:underline text-brand-dark-green">Back to spaces</Link>
      </div>
    );
  }

  const { space, counts, organizers, members, events, resources, lastPostAt } = data;
  const createdYear = new Date(space.createdAt).getFullYear();
  const tagline = space.description?.split(/(?<=[.!?])\s/)[0] ?? '';
  const isActive = (lastPostAt && Date.now() - new Date(lastPostAt).getTime() < FOURTEEN_DAYS_MS) || counts.upcomingEvents > 0;

  // Admin setup checklist (only shown while the space is still sparse)

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* ── COVER ── */}
      <div className="relative h-44 sm:h-48" style={{ background: `linear-gradient(120deg, ${theme.base}, ${theme.dark})` }}>
        <div className="absolute inset-0 opacity-30"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          <button onClick={share}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
            <Share2Icon className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="relative px-6 sm:px-8 pb-6">
        <div className="absolute -top-16 left-6 sm:left-8">
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-xl overflow-hidden"
               style={{ boxShadow: '0 0 0 5px var(--surface-1, #fff), 0 10px 30px rgba(0,0,0,.18)' }}>
            {space.imageUrl ? (
              <img src={space.imageUrl} alt={space.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white"
                   style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
                <span className="text-4xl font-bold">{getInitials(space.name)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="pt-20 sm:pt-24 flex flex-col">
          {/* badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Chip tone="solid" size="md" color={theme.base}>Space</Chip>
            {space.location && (
              <Chip tone="muted" size="md">
                <MapPinIcon className="w-3 h-3" /> {space.location}
              </Chip>
            )}
            {isActive && (
              <span className={chipClass({ tone: 'solid', size: 'md', color: theme.base, className: 'gap-1.5' })}
                    style={chipStyle(theme.base, 'solid')}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                </span>
                Active
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-title">{space.name}</h1>
          {tagline && <p className="mt-1.5 text-[15px] sm:text-base text-text-secondary max-w-[60ch]">{tagline}</p>}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
            {space.country && (
              <span className="inline-flex items-center gap-1.5"><EarthIcon className="w-3.5 h-3.5" />{space.country}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><CalendarIcon className="w-3.5 h-3.5" />Created {createdYear}</span>
          </div>

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            {isMember ? (
              <>
                <button onClick={openSpace}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99]"
                  style={{ background: theme.base }}>
                  <NetworkIcon className="w-4 h-4" /> Open space
                </button>
                <button onClick={share}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
                  <UserPlusIcon className="w-4 h-4" /> Invite
                </button>
                {confirmLeave ? (
                  <span className="inline-flex items-center gap-2 text-sm">
                    <button onClick={() => setConfirmLeave(false)} className="font-medium text-text-muted hover:text-text-secondary">Cancel</button>
                    <button onClick={handleLeave} disabled={leaving} className="font-bold text-red-500 hover:text-red-600 disabled:opacity-60">
                      {leaving ? 'Leaving…' : 'Confirm leave'}
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmLeave(true)}
                    className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-sm font-semibold text-text-muted hover:text-red-500 hover:bg-surface-2 transition">
                    <LogOutIcon className="w-4 h-4" /> Leave
                  </button>
                )}
              </>
            ) : (
              <button onClick={handleJoin} disabled={joining}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                style={{ background: theme.base }}>
                {joining ? <LoaderCircleIcon className="w-4 h-4 animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                Join space
              </button>
            )}
          </div>

          {/* social-proof stats */}
          <div className="flex flex-wrap gap-6 mt-5 pt-4 border-t border-border-subtle">
            <Stat value={counts.members} label={counts.members === 1 ? 'Member' : 'Members'} />
            {isMember && <Stat value={counts.upcomingEvents} label="Upcoming events" onClick={() => jump('events')} />}
            {isMember && <Stat value={counts.resources} label={counts.resources === 1 ? 'Resource' : 'Resources'} onClick={() => jump('resources')} />}
            <Stat value={counts.nodes} label="In network" onClick={isMember ? openDirectory : undefined} />
          </div>
        </div>
      </div>

      {/* ── STICKY SUB-NAV ── */}
      <nav className="sticky top-0 z-20 flex gap-1 px-4 sm:px-6 border-b border-border-subtle bg-surface-1/85 backdrop-blur overflow-x-auto"
           aria-label="Space sections">
        {visibleSections.map((s) => (
          <button key={s} onClick={() => jump(s)}
                  aria-current={active === s ? 'true' : undefined}
                  className="relative px-3.5 py-3 text-sm font-semibold capitalize whitespace-nowrap transition"
                  style={{ color: active === s ? theme.dark : undefined }}>
            <span className={active === s ? '' : 'text-text-muted'}>{s}</span>
            {active === s && <span className="absolute left-3.5 right-3.5 bottom-0 h-[3px] rounded-t" style={{ background: theme.base }} />}
          </button>
        ))}
      </nav>

      {/* ── BODY ── */}
      <div className="px-6 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* About */}
          <SectionCard id="overview" icon={<SparklesIcon className="w-[18px] h-[18px]" />} title="About" accent={theme.dark}>
            {space.description ? (
              <AboutText text={space.description} theme={theme} />
            ) : isAdminViewer ? (
              <p className="text-sm text-text-muted italic">Add a description so people know what this space is about.</p>
            ) : (
              <p className="text-sm text-text-muted italic">No description yet.</p>
            )}
          </SectionCard>

          {/* Upcoming events */}
          {isMember && (
            <SectionCard id="events" icon={<CalendarIcon className="w-[18px] h-[18px]" />} title="Upcoming events" accent={theme.dark}
                         action={<Link href="/events" className="text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>View all →</Link>}>
              {events.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {events.map((e) => <EventMiniCard key={e.id} event={e} theme={theme} />)}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="text-3xl">📅</span>
                  <p className="text-sm font-semibold text-text-primary">No upcoming events</p>
                  <Link href="/events/new"
                        className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold hover:underline" style={{ color: theme.dark }}>
                    <CalendarPlusIcon className="w-4 h-4" /> Create an event
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {/* Resources */}
          {isMember && (
            <SectionCard id="resources" icon={<FolderOpenIcon className="w-[18px] h-[18px]" />} title="Resources" accent={theme.dark}
                         action={resources.length > 0 ? <Link href="/resources" className="text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>View all →</Link> : undefined}>
              {resources.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {resources.map((r) => (
                    <Link key={r.id} href={`/resources/${encodeURIComponent(r.id)}`}
                          className="-mx-2.5 flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-surface-2">
                      <FileTypeIcon type={r.fileType} className="h-10 w-10 flex-none" />
                      <span className="min-w-0">
                        <b className="block text-[13.5px] font-bold text-text-primary truncate">{r.name}</b>
                        <span className="block text-xs text-text-muted truncate">
                          {FILE_LABEL[r.fileType] ?? r.fileType.toUpperCase()}
                          {r.fileSize ? ` · ${formatBytes(r.fileSize)}` : ''}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <Link href="/resources"
                      className="inline-flex items-center gap-1.5 py-1 text-sm font-semibold hover:underline" style={{ color: theme.dark }}>
                  <PlusIcon className="w-4 h-4" /> Upload the first resource
                </Link>
              )}
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-16 self-start">
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {space.location && <KV icon={<MapPinIcon className="w-4 h-4" />} label="Location" value={space.location} />}
              {space.country && <KV icon={<EarthIcon className="w-4 h-4" />} label="Country" value={space.country} />}
              <KV icon={<UsersIcon className="w-4 h-4" />} label="Members" value={String(counts.members)} />
              <KV icon={<CalendarIcon className="w-4 h-4" />} label="Created"
                  value={new Date(space.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />
              {(space.nodeTypes?.length ?? 0) > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="text-text-muted mt-0.5 flex-none"><NetworkIcon className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted mb-1.5">Network of</div>
                    <div className="flex flex-wrap gap-1.5">
                      {space.nodeTypes!.slice(0, 6).map((nt) => (
                        <Chip key={nt.name} tone="solid" size="md" color={nt.color}>{nt.name}</Chip>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </RailCard>

          {organizers.length > 0 && (
            <RailCard title={organizers.length === 1 ? 'Organizer' : 'Organizers'}>
              <div className="flex flex-col gap-1">
                {organizers.slice(0, 5).map((o) => (
                  <MemberRow key={o.userId} member={o} theme={theme} badge="Organizer" />
                ))}
              </div>
            </RailCard>
          )}

          {isMember && members.length > 0 && (
            <RailCard title={`Members · ${counts.members}`}>
              {counts.members < 5 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-text-muted mb-1">🌱 Founding members</p>
                  {members.map((m) => <MemberRow key={m.userId} member={m} theme={theme} />)}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    {members.slice(0, 8).map((m) => (
                      <MemberAvatar key={m.userId} member={m} theme={theme} />
                    ))}
                  </div>
                  {counts.members > 8 && (
                    <button onClick={openDirectory}
                            className="mt-3 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                      +{counts.members - 8} more <ChevronRightIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </RailCard>
          )}

          {isMember && (
            <RailCard title="Network">
              <button onClick={openDirectory}
                      className="flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                Explore the network <ChevronRightIcon className="w-3.5 h-3.5" />
              </button>
            </RailCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── presentational helpers ───────────────────────────────────────────────── */

function Stat({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  const inner = (
    <>
      <b className="text-lg font-bold font-title text-text-primary">{value}</b>
      <span className="text-xs text-text-muted">{label}</span>
    </>
  );
  return onClick
    ? <button onClick={onClick} className="flex flex-col items-start">{inner}</button>
    : <div className="flex flex-col">{inner}</div>;
}

function KV({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-text-muted mt-0.5 flex-none">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-text-muted">{label}</div>
        <div className="font-semibold text-text-primary">{value}</div>
      </div>
    </div>
  );
}

function AboutText({ text, theme }: { text: string; theme: ThemePalette }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  const shown = long && !open ? text.slice(0, 280).trimEnd() + '…' : text;
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

function EventMiniCard({ event, theme }: { event: OverviewEvent; theme: ThemePalette }) {
  const { month, day } = formatEventDateShort(event.startAt);
  const accent = event.themeColor || theme.base;
  return (
    <Link href={`/events/${encodeURIComponent(event.id)}`}
          className="-mx-2.5 flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-surface-2">
      <div className="relative aspect-[16/9] flex items-center justify-center overflow-hidden"
           style={event.coverImageUrl ? undefined : { background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}>
        {event.coverImageUrl
          ? <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <CalendarIcon className="w-8 h-8 text-white/70" />}
        <span className="absolute top-2 left-2 flex flex-col items-center w-10 rounded-lg overflow-hidden bg-surface-1">
          <span className="w-full text-center text-[9px] font-bold text-white py-0.5" style={{ background: accent }}>{month}</span>
          <span className="text-sm font-bold font-title text-text-primary leading-tight py-0.5">{day}</span>
        </span>
      </div>
      <div className="p-3">
        <b className="block text-[13.5px] font-bold text-text-primary leading-snug line-clamp-2">{event.title}</b>
        <span className="block mt-1 text-xs text-text-muted truncate">
          {formatEventTime(event.startAt)}
          {event.locationLabel ? ` · ${event.locationLabel}` : event.eventType === 'virtual' ? ' · Virtual' : ''}
        </span>
        {event.going > 0 && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold" style={{ color: theme.dark }}>
            <UsersIcon className="w-3 h-3" /> {event.going} going
          </span>
        )}
      </div>
    </Link>
  );
}

function MemberRow({ member, theme, badge }: { member: OverviewMember; theme: ThemePalette; badge?: string }) {
  const inner = (
    <>
      {member.image
        ? <img src={member.image} alt={member.name} className="w-9 h-9 rounded-xl object-cover flex-none" />
        : <span className="w-9 h-9 rounded-xl overflow-hidden flex-none"><PersonSilhouette color={theme.base} /></span>}
      <span className="min-w-0 flex-1">
        <b className="block text-[13.5px] font-bold text-text-primary truncate">{member.name}</b>
        {member.subtitle && <span className="block text-xs text-text-muted truncate">{member.subtitle}</span>}
      </span>
      {badge && (
        <Chip tone="solid" size="xs" color={theme.base} className="flex-none">{badge}</Chip>
      )}
    </>
  );
  const cls = 'flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-xl hover:bg-surface-2 transition';
  return member.personId
    ? <Link href={`/directory/${encodeURIComponent(member.personId)}`} className={cls}>{inner}</Link>
    : <div className={cls}>{inner}</div>;
}

function MemberAvatar({ member, theme }: { member: OverviewMember; theme: ThemePalette }) {
  const inner = member.image
    ? <img src={member.image} alt={member.name} title={member.name} className="w-full aspect-square rounded-2xl object-cover" />
    : (
      <span className="block w-full aspect-square rounded-2xl overflow-hidden" title={member.name}>
        <PersonSilhouette color={theme.base} />
      </span>
    );
  return member.personId
    ? <Link href={`/directory/${encodeURIComponent(member.personId)}`} className="block hover:-translate-y-0.5 transition">{inner}</Link>
    : <div>{inner}</div>;
}

/** Decorative node-cluster illustration in theme colors — the context teaser. */
function SpaceSkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto animate-pulse">
      <div className="h-44 sm:h-48 bg-surface-3" />
      <div className="px-6 sm:px-8 pb-6">
        <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-xl bg-surface-3 -mt-16 border-4 border-surface-1" />
        <div className="mt-4 h-7 w-64 rounded bg-surface-3" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-surface-3" />
        <div className="mt-5 flex gap-3">
          <div className="h-10 w-36 rounded-xl bg-surface-3" />
          <div className="h-10 w-28 rounded-xl bg-surface-3" />
        </div>
      </div>
      <div className="px-6 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="h-40 rounded-lg bg-surface-3" />
          <div className="h-56 rounded-lg bg-surface-3" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-44 rounded-lg bg-surface-3" />
          <div className="h-32 rounded-lg bg-surface-3" />
        </div>
      </div>
    </div>
  );
}
