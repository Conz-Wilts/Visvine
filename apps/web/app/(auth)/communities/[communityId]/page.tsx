'use client';

/**
 * Community detail page — one page, two modes. Non-members get a "pitch"
 * (about, stats, organizers, join CTA); members get the hub (events strip,
 * activity feed, resources, member rail). Follows the profile page design
 * system: theme-gradient cover, overlapping avatar, scroll-spy sub-nav,
 * main + 320px rail grid.
 */

import React, { useState, useEffect, useMemo, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MapPin, Calendar, Users, Share2, FolderOpen, Sparkles, Network as NetworkIcon,
  Plus, Check, ChevronRight, LogOut, Globe2, UserPlus,
  CalendarPlus, Loader2,
} from 'lucide-react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig, type NodeTypeConfig } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import { formatEventDateShort, formatEventTime } from '@/lib/eventUtils';
import { FileTypeIcon, FILE_LABEL, formatBytes } from '@/components/resources/resourceUi';

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
  community: {
    id: string;
    name: string;
    description?: string | null;
    location?: string | null;
    country?: string | null;
    tags: string[];
    imageUrl?: string | null;
    emoji?: string | null;
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

export default function CommunityDetailPage({ params }: { params: Promise<{ communityId: string }> }) {
  const { communityId: rawCommunityId } = use(params);
  const communityId = decodeURIComponent(rawCommunityId);
  const router = useRouter();
  const { joinCommunity, leaveCommunity, setCurrentCommunity, refreshCommunity } = useCommunity();

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`/api/communities/${encodeURIComponent(communityId)}/overview`);
      if (!res.ok) { setNotFound(true); return; }
      setData(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const isMember = !!data?.viewer.role;
  const isAdminViewer = data?.viewer.role === 'admin';

  const theme = useMemo(
    () => hexToPalette(getNodeTypeConfig('Community', data?.community.nodeTypes ?? undefined).color),
    [data?.community.nodeTypes],
  );

  const visibleSections = useMemo(() => SECTIONS.filter((s) => {
    if (s === 'events' || s === 'resources') return isMember;
    return true;
  }), [isMember]);
  const active = useScrollSpy(visibleSections);
  const jump = (id: Section) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Entering the community lands on whichever tab its admin put first, so this
  // goes through the /home resolver. The switch must happen before the push —
  // /home reads the current community to pick the tab.
  const openCommunity = () => { setCurrentCommunity(communityId); router.push('/home'); };
  // Links that specifically mean "show me the network" still go straight to the
  // directory, whatever the community's landing tab is.
  const openDirectory = () => { setCurrentCommunity(communityId); router.push('/directory'); };

  const share = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      await joinCommunity(communityId);
      await Promise.all([fetchOverview(), refreshCommunity()]);
    } catch {
      // join API errors (e.g. invite-only) just leave the button enabled
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await leaveCommunity(communityId);
      await fetchOverview();
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  };

  if (loading) return <CommunitySkeleton />;
  if (notFound || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">🏘️</div>
        <p className="text-base font-semibold text-text-primary">Community not found</p>
        <p className="text-sm text-text-muted">It may have been removed, or the URL is incorrect.</p>
        <Link href="/communities" className="mt-2 text-sm font-bold hover:underline text-brand-dark-green">Back to communities</Link>
      </div>
    );
  }

  const { community, counts, organizers, members, events, resources, lastPostAt } = data;
  const createdYear = new Date(community.createdAt).getFullYear();
  const tagline = community.description?.split(/(?<=[.!?])\s/)[0] ?? '';
  const isActive = (lastPostAt && Date.now() - new Date(lastPostAt).getTime() < FOURTEEN_DAYS_MS) || counts.upcomingEvents > 0;

  // Admin setup checklist (only shown while the community is still sparse)
  const checklist = [
    { label: 'Add a community image', done: !!community.imageUrl },
    { label: 'Write a description', done: !!community.description },
    { label: 'Reach 3 members', done: counts.members >= 3 },
    { label: 'Host your first event', done: counts.totalEvents > 0 },
    { label: 'Share a resource', done: counts.resources > 0 },
  ];
  const checklistDone = checklist.filter((c) => c.done).length;
  const showChecklist = isAdminViewer && checklistDone < checklist.length;

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* ── COVER ── */}
      <div className="relative h-44 sm:h-48" style={{ background: `linear-gradient(120deg, ${theme.base}, ${theme.dark})` }}>
        <div className="absolute inset-0 opacity-30"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          <button onClick={share}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
            <Share2 className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="relative px-6 sm:px-8 pb-6">
        <div className="absolute -top-16 left-6 sm:left-8">
          <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl overflow-hidden"
               style={{ boxShadow: '0 0 0 5px var(--surface-1, #fff), 0 10px 30px rgba(0,0,0,.18)' }}>
            {community.imageUrl ? (
              <img src={community.imageUrl} alt={community.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl text-white"
                   style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
                {community.emoji || <span className="text-4xl font-bold">{getInitials(community.name)}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="pt-20 sm:pt-24 flex flex-col">
          {/* badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                  style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
              Community
            </span>
            {community.location && (
              <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11.5px] font-semibold bg-surface-2 text-text-muted border border-border-default">
                <MapPin className="w-3 h-3" /> {community.location}
              </span>
            )}
            {isActive && (
              <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                    style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}80` }}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                </span>
                Active
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-ginto">{community.name}</h1>
          {tagline && <p className="mt-1.5 text-[15px] sm:text-base text-text-secondary max-w-[60ch]">{tagline}</p>}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
            {community.country && (
              <span className="inline-flex items-center gap-1.5"><Globe2 className="w-3.5 h-3.5" />{community.country}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Created {createdYear}</span>
          </div>

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2.5 mt-4">
            {isMember ? (
              <>
                <button onClick={openCommunity}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99]"
                  style={{ background: theme.base }}>
                  <NetworkIcon className="w-4 h-4" /> Open community
                </button>
                <button onClick={share}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 transition">
                  <UserPlus className="w-4 h-4" /> Invite
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
                    <LogOut className="w-4 h-4" /> Leave
                  </button>
                )}
              </>
            ) : (
              <button onClick={handleJoin} disabled={joining}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
                style={{ background: theme.base }}>
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Join community
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
           aria-label="Community sections">
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
          {showChecklist && (
            <SectionCard id="checklist" icon={<Sparkles className="w-[18px] h-[18px]" />} title="Set up your community" theme={theme}>
              <div className="flex items-center gap-4 mb-3">
                <div className="relative w-14 h-14 flex-none rounded-full grid place-items-center"
                     style={{ background: `conic-gradient(${theme.base} ${(checklistDone / checklist.length) * 100}%, var(--surface-3,#f3f4f6) 0)` }}>
                  <div className="absolute w-10 h-10 rounded-full bg-surface-1" />
                  <b className="relative text-[13px] font-bold font-ginto">{checklistDone}/{checklist.length}</b>
                </div>
                <p className="text-[13px] text-text-secondary">A complete page helps new members understand what this community is about.</p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-2.5 text-sm">
                    <span className={`w-5 h-5 rounded-full grid place-items-center flex-none border ${c.done ? 'text-white' : 'border-border-default text-transparent'}`}
                          style={c.done ? { background: theme.base, borderColor: theme.base } : undefined}>
                      <Check className="w-3 h-3" />
                    </span>
                    <span className={c.done ? 'text-text-muted line-through' : 'text-text-secondary'}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* About */}
          <SectionCard id="overview" icon={<Sparkles className="w-[18px] h-[18px]" />} title="About" theme={theme}>
            {community.description ? (
              <AboutText text={community.description} theme={theme} />
            ) : isAdminViewer ? (
              <p className="text-sm text-text-muted italic">Add a description so people know what this community is about.</p>
            ) : (
              <p className="text-sm text-text-muted italic">No description yet.</p>
            )}
            {community.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {community.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1.5 rounded-full text-[13px] font-semibold border transition hover:-translate-y-0.5"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Upcoming events */}
          {isMember && (
            <SectionCard id="events" icon={<Calendar className="w-[18px] h-[18px]" />} title="Upcoming events" theme={theme}
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
                    <CalendarPlus className="w-4 h-4" /> Create an event
                  </Link>
                </div>
              )}
            </SectionCard>
          )}

          {/* Resources */}
          {isMember && (
            <SectionCard id="resources" icon={<FolderOpen className="w-[18px] h-[18px]" />} title="Resources" theme={theme}
                         action={resources.length > 0 ? <Link href="/resources" className="text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>View all →</Link> : undefined}>
              {resources.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {resources.map((r) => (
                    <Link key={r.id} href={`/resources/${encodeURIComponent(r.id)}`}
                          className="flex items-center gap-3 p-2.5 rounded-2xl border border-border-subtle hover:-translate-y-0.5 hover:shadow-soft transition">
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
                      className="w-full py-4 border-[1.5px] border-dashed border-border-default rounded-xl text-sm text-text-muted hover:text-text-secondary flex items-center justify-center gap-1.5 transition">
                  <Plus className="w-4 h-4" /> Upload the first resource
                </Link>
              )}
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-16 self-start">
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {community.location && <KV icon={<MapPin className="w-4 h-4" />} label="Location" value={community.location} />}
              {community.country && <KV icon={<Globe2 className="w-4 h-4" />} label="Country" value={community.country} />}
              <KV icon={<Users className="w-4 h-4" />} label="Members" value={String(counts.members)} />
              <KV icon={<Calendar className="w-4 h-4" />} label="Created"
                  value={new Date(community.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />
              {(community.nodeTypes?.length ?? 0) > 0 && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="text-text-muted mt-0.5 flex-none"><NetworkIcon className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted mb-1.5">Network of</div>
                    <div className="flex flex-wrap gap-1.5">
                      {community.nodeTypes!.slice(0, 6).map((nt) => (
                        <span key={nt.name} className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-semibold border"
                              style={{ background: `${nt.color}14`, color: nt.color, borderColor: `${nt.color}40` }}>
                          {nt.name}
                        </span>
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
                      +{counts.members - 8} more <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </RailCard>
          )}

          {isMember && (
            <RailCard title="Network">
              <NetworkPreview theme={theme} />
              <button onClick={openDirectory}
                      className="mt-3 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                Explore the network <ChevronRight className="w-3.5 h-3.5" />
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
      <b className="text-lg font-bold font-ginto text-text-primary">{value}</b>
      <span className="text-xs text-text-muted">{label}</span>
    </>
  );
  return onClick
    ? <button onClick={onClick} className="flex flex-col items-start">{inner}</button>
    : <div className="flex flex-col">{inner}</div>;
}

function SectionCard({ id, icon, title, theme, action, children }: {
  id: string; icon: React.ReactNode; title: string; theme: ThemePalette;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft scroll-mt-16">
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-ginto text-text-primary">
          <span style={{ color: theme.dark }}>{icon}</span>{title}
        </h2>
        {action}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 py-4">
      <div className="text-[12px] font-bold uppercase tracking-wider text-text-muted mb-3.5">{title}</div>
      {children}
    </div>
  );
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
          className="group rounded-2xl border border-border-subtle overflow-hidden hover:shadow-soft hover:-translate-y-0.5 transition-all duration-150">
      <div className="relative aspect-[16/9] flex items-center justify-center overflow-hidden"
           style={event.coverImageUrl ? undefined : { background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}>
        {event.coverImageUrl
          ? <img src={event.coverImageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <Calendar className="w-8 h-8 text-white/70" />}
        <span className="absolute top-2 left-2 flex flex-col items-center w-10 rounded-lg overflow-hidden bg-surface-1 shadow-sm">
          <span className="w-full text-center text-[9px] font-bold text-white py-0.5" style={{ background: accent }}>{month}</span>
          <span className="text-sm font-bold font-ginto text-text-primary leading-tight py-0.5">{day}</span>
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
            <Users className="w-3 h-3" /> {event.going} going
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
        <span className="flex-none inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-semibold border"
              style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
          {badge}
        </span>
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

/** Decorative node-cluster illustration in theme colors — the graph teaser. */
function NetworkPreview({ theme }: { theme: ThemePalette }) {
  const nodes = [
    { x: 30, y: 38, r: 9 }, { x: 75, y: 22, r: 6 }, { x: 128, y: 40, r: 8 },
    { x: 58, y: 70, r: 7 }, { x: 105, y: 78, r: 5 }, { x: 160, y: 66, r: 7 },
    { x: 190, y: 30, r: 5 }, { x: 215, y: 72, r: 6 },
  ];
  const links: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [2, 6], [4, 5], [5, 7], [6, 7]];
  return (
    <div className="rounded-xl overflow-hidden border border-border-subtle" style={{ background: theme.light }}>
      <svg viewBox="0 0 240 100" className="w-full h-auto block" aria-hidden="true">
        {links.map(([a, b], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
                stroke={theme.base} strokeOpacity="0.45" strokeWidth="1.5" />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={i % 3 === 0 ? theme.dark : theme.base} fillOpacity={i % 3 === 0 ? 0.9 : 0.75} />
        ))}
      </svg>
    </div>
  );
}

function CommunitySkeleton() {
  return (
    <div className="w-full max-w-5xl mx-auto animate-pulse">
      <div className="h-44 sm:h-48 bg-surface-3" />
      <div className="px-6 sm:px-8 pb-6">
        <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl bg-surface-3 -mt-16 border-4 border-surface-1" />
        <div className="mt-4 h-7 w-64 rounded bg-surface-3" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-surface-3" />
        <div className="mt-5 flex gap-3">
          <div className="h-10 w-36 rounded-xl bg-surface-3" />
          <div className="h-10 w-28 rounded-xl bg-surface-3" />
        </div>
      </div>
      <div className="px-6 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="flex flex-col gap-5">
          <div className="h-40 rounded-2xl bg-surface-3" />
          <div className="h-56 rounded-2xl bg-surface-3" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-44 rounded-2xl bg-surface-3" />
          <div className="h-32 rounded-2xl bg-surface-3" />
        </div>
      </div>
    </div>
  );
}
