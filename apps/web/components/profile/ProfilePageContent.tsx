'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  MapPin, ExternalLink, Linkedin, Twitter, Phone, Mail, Globe2, Calendar,
  Pencil, Plus, Share2, Users, Building2, Sparkles, Wrench, Network as NetworkIcon,
  Eye, Palette, ChevronDown, ChevronUp,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/hooks/useProfile';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useSession } from '@/lib/auth-client';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getPalette, hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import { computeProfileCompletion } from '@/lib/profileTypes';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import MyInsightsSection from './MyInsightsSection';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';

type ModalState = 'basicInfo' | 'about' | 'skills' | 'contact' | null;
const SECTIONS = ['about', 'skills', 'network', 'contact'] as const;
type Section = typeof SECTIONS[number];

const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

/** Typed helper for inline CSS custom properties (CSSProperties rejects arbitrary keys). */
const cssVars = (vars: Record<`--${string}`, string>): React.CSSProperties => vars as React.CSSProperties;

/** Scroll-spy for the sticky sub-nav. */
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

export default function ProfilePageContent({ nodeId }: { nodeId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const { profile, loading, error, updateBasicInfo } = useProfile(nodeId);
  const { data: nodeData } = useNodeProfile(nodeId);
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);

  // Only sections that actually render get a sub-nav tab + scroll-spy target;
  // the Network section is omitted when there are no connections.
  const hasConnections = (nodeData?.connections?.length ?? 0) > 0;
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => s !== 'network' || hasConnections),
    [hasConnections],
  );
  const active = useScrollSpy(visibleSections);

  const isOwner = !!(session?.user?.nodeId && session.user.nodeId === nodeId);

  const shareProfile = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const systemPalette = useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    return hexToPalette(getNodeTypeConfig(nodeType, currentCommunity?.nodeTypes).color);
  }, [nodeData?.node?.type, currentCommunity?.nodeTypes]);
  const savedThemeId = profile?.metadata?.themeColor as string | undefined;
  const theme = savedThemeId ? getPalette(savedThemeId) : systemPalette;

  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <div className="text-5xl">😕</div>
        <p className="text-base font-semibold text-text-primary">Profile not found</p>
        <p className="text-sm text-text-muted">This person may have been removed or the URL is incorrect.</p>
      </div>
    );
  }

  const connectionCount = nodeData?.connectionCount ?? 0;
  const communityCount = nodeData?.communityCount ?? 1;
  const connections = nodeData?.connections ?? [];
  const memberYear = profile.createdAt ? new Date(profile.createdAt).getFullYear() : null;
  const { score } = computeProfileCompletion(profile);
  const hasContact = !!(profile.email || profile.phone || profile.website || profile.linkedinUrl || profile.twitterUrl);

  const jump = (id: Section) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div>
      {/* ── COVER ── */}
      <div
        className="relative h-44 sm:h-48"
        style={{ background: `linear-gradient(120deg, ${theme.base}, ${theme.dark})` }}
      >
        <div className="absolute inset-0 opacity-30"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          {isOwner && (
            <button disabled title="Coming soon"
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur transition disabled:opacity-50 disabled:cursor-not-allowed">
              <Palette className="w-3.5 h-3.5" /> Theme
            </button>
          )}
          <button onClick={shareProfile}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
            <Share2 className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="relative px-6 sm:px-8 pb-6">
        <div className="absolute -top-16 left-6 sm:left-8">
          <div className="relative">
            <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl overflow-hidden"
                 style={{ boxShadow: `0 0 0 5px var(--surface-1, #fff), 0 10px 30px rgba(0,0,0,.18)` }}>
              {profile.imageUrl ? (
                <Image src={profile.imageUrl} alt={profile.name} width={144} height={144} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-white"
                     style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
                  {getInitials(profile.name)}
                </div>
              )}
            </div>
            {profile.openToWork && (
              <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-bold text-white border-[3px]"
                    style={{ background: theme.dark, borderColor: 'var(--surface-1, #fff)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" /> Open
              </span>
            )}
          </div>
        </div>

        <div className="pt-20 sm:pt-24 flex flex-col">
          {/* badges */}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {nodeData?.node?.type && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold border"
                    style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                {nodeData.node.type}
              </span>
            )}
            {nodeData?.node?.alias && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold bg-surface-2 text-text-muted border border-border-default">
                {nodeData.node.alias}
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-ginto">{profile.name}</h1>
                {profile.pronouns && <span className="text-sm text-text-muted font-medium">{profile.pronouns}</span>}
              </div>
              {profile.subtitle ? (
                <p className="mt-1.5 text-[15px] sm:text-base text-text-secondary max-w-[60ch]">{profile.subtitle}</p>
              ) : isOwner ? (
                <button onClick={() => setModal('basicInfo')} className="mt-1.5 text-sm hover:underline" style={{ color: theme.dark }}>+ Add a headline</button>
              ) : null}

              {/* inline meta row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                {profile.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{profile.location}</span>
                )}
                {profile.website && (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold" style={{ color: theme.dark }}>
                    <Globe2 className="w-3.5 h-3.5" />{hostname(profile.website)}
                  </a>
                )}
                {memberYear && (
                  <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Joined {memberYear}</span>
                )}
                {profile.openToWork && (
                  <span className="inline-flex items-center gap-1.5 h-6 px-3 rounded-full text-[12.5px] font-semibold border"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}80` }}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                    </span>
                    Open to work
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* actions */}
          <div className="flex flex-wrap gap-2.5 mt-4">
            {isOwner ? (
              <>
                <button onClick={() => setModal('basicInfo')} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white" style={{ background: theme.base }}>
                  <Pencil className="w-4 h-4" /> Edit profile
                </button>
                <button disabled title="Coming soon" className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold bg-surface-2 text-text-secondary border border-border-default disabled:opacity-50 disabled:cursor-not-allowed">
                  <Eye className="w-4 h-4" /> Preview as visitor
                </button>
              </>
            ) : (
              <>
                <button disabled title="Coming soon" className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: theme.base }}>
                  <Users className="w-4 h-4" /> Connect
                </button>
                <button onClick={() => router.push('/messages')} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold bg-surface-1 border-[1.5px] active:scale-95" style={{ color: theme.dark, borderColor: `${theme.base}88` }}>
                  <Mail className="w-4 h-4" /> Message
                </button>
                <button disabled title="Coming soon" className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-bold bg-surface-2 text-text-secondary border border-border-default disabled:opacity-50 disabled:cursor-not-allowed">
                  <Users className="w-4 h-4" /> Request intro
                </button>
              </>
            )}
          </div>

          {/* social-proof stats */}
          <div className="flex flex-wrap gap-6 mt-5 pt-4 border-t border-border-subtle">
            <button onClick={() => jump('network')} className="flex flex-col items-start">
              <b className="text-lg font-bold font-ginto text-text-primary">{connectionCount}</b>
              <span className="text-xs text-text-muted">Connections</span>
            </button>
            <div className="flex flex-col">
              <b className="text-lg font-bold font-ginto text-text-primary">{communityCount}</b>
              <span className="text-xs text-text-muted">Communities</span>
            </div>
            {memberYear && (
              <div className="flex flex-col">
                <b className="text-lg font-bold font-ginto text-text-primary">{memberYear}</b>
                <span className="text-xs text-text-muted">Member since</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── STICKY SUB-NAV ── */}
      <nav className="sticky top-0 z-20 flex gap-1 px-4 sm:px-6 border-b border-border-subtle bg-surface-1/85 backdrop-blur overflow-x-auto"
           aria-label="Profile sections">
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
          <SectionCard id="about" icon={<Sparkles className="w-[18px] h-[18px]" />} title="About"
                       theme={theme} isOwner={isOwner} onEdit={() => setModal('about')}>
            {profile.bio
              ? <BioText bio={profile.bio} theme={theme} />
              : isOwner
                ? <AddPrompt theme={theme} label="Add a bio to introduce yourself" onClick={() => setModal('about')} />
                : <p className="text-sm text-text-muted italic">No bio yet.</p>}
          </SectionCard>

          {/* Skills */}
          <SectionCard id="skills" icon={<Wrench className="w-[18px] h-[18px]" />} title="Skills & expertise"
                       theme={theme} isOwner={isOwner} addLabel onEdit={() => setModal('skills')}>
            {profile.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.tags.map((tag) => (
                  <span key={tag} className="px-3 py-1.5 rounded-full text-[13px] font-semibold border transition hover:-translate-y-0.5"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}40` }}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add skills & expertise" onClick={() => setModal('skills')} />
              : <p className="text-sm text-text-muted italic">No skills listed.</p>}
          </SectionCard>

          {/* Network */}
          {connections.length > 0 && (
            <SectionCard id="network" icon={<NetworkIcon className="w-[18px] h-[18px]" />}
                         title={`Network · ${connectionCount}`} theme={theme} isOwner={false}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
                {connections.slice(0, 12).map((c) => (
                  <a key={c.id} href={`/directory/${encodeURIComponent(c.id)}`}
                     className="flex items-center gap-2.5 p-2.5 rounded-2xl border border-border-subtle hover:-translate-y-0.5 transition">
                    {c.image_url
                      ? <img src={c.image_url} alt={c.name} className="w-10 h-10 rounded-xl object-cover flex-none" />
                      : <span className="w-10 h-10 rounded-xl bg-surface-3 text-text-muted flex items-center justify-center text-sm font-bold flex-none">{getInitials(c.name)}</span>}
                    <span className="min-w-0">
                      <b className="block text-[13.5px] font-bold text-text-primary truncate">{c.name}</b>
                      {c.subtitle && <span className="block text-xs text-text-muted truncate">{c.subtitle}</span>}
                    </span>
                  </a>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-16 self-start">
          {/* At a glance */}
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {profile.location && <KV icon={<MapPin className="w-4 h-4" />} label="Location" value={profile.location} />}
              {profile.website && <KV icon={<Globe2 className="w-4 h-4" />} label="Website" value={hostname(profile.website)} href={profile.website} theme={theme} />}
              <KV icon={<Building2 className="w-4 h-4" />} label="Communities" value={`${communityCount} shared`} />
              {profile.createdAt && <KV icon={<Calendar className="w-4 h-4" />} label="Member since"
                value={new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} />}
            </div>
          </RailCard>

          {/* Owner: profile strength. Visitor: would render a mutuals card. */}
          {isOwner && score < 100 && (
            <RailCard title="Profile strength">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-14 flex-none rounded-full grid place-items-center"
                     style={{ background: `conic-gradient(${theme.base} ${score}%, var(--surface-3,#f3f4f6) 0)` }}>
                  <div className="absolute w-10 h-10 rounded-full bg-surface-1" />
                  <b className="relative text-[13px] font-bold font-ginto">{score}%</b>
                </div>
                <p className="text-[13px] text-text-secondary">A few more details and you’ll rank higher in your community’s directory.</p>
              </div>
            </RailCard>
          )}

          {/* Contact */}
          <SectionCard id="contact" icon={<Mail className="w-[18px] h-[18px]" />} title="Contact"
                       theme={theme} isOwner={isOwner} onEdit={() => setModal('contact')} rail>
            {hasContact ? (
              <>
                <div className="flex flex-col gap-0.5">
                  {profile.email && <ContactRow icon={<Mail className="w-4 h-4" />} href={`mailto:${profile.email}`} text={profile.email} />}
                  {profile.phone && <ContactRow icon={<Phone className="w-4 h-4" />} href={`tel:${profile.phone}`} text={profile.phone} />}
                </div>
                <div className="flex gap-2 mt-2">
                  {profile.linkedinUrl && <SocialBtn href={profile.linkedinUrl} theme={theme} label="LinkedIn"><Linkedin className="w-[18px] h-[18px]" /></SocialBtn>}
                  {profile.twitterUrl && <SocialBtn href={profile.twitterUrl} theme={theme} label="X / Twitter"><Twitter className="w-[18px] h-[18px]" /></SocialBtn>}
                  {profile.website && <SocialBtn href={profile.website} theme={theme} label="Website"><ExternalLink className="w-[18px] h-[18px]" /></SocialBtn>}
                </div>
              </>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add contact info" onClick={() => setModal('contact')} />
              : <p className="text-sm text-text-muted italic">No contact info listed.</p>}
          </SectionCard>
        </div>
      </div>

      {/* Visitor-only private CRM notes */}
      {!isOwner && <MyInsightsSection nodeId={nodeId} communityId={currentCommunity?.id} />}

      {/* Modals */}
      {modal === 'basicInfo' && <EditBasicInfoModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'about' && <EditAboutModal open onClose={() => setModal(null)} bio={profile.bio} onSave={updateBasicInfo} />}
      {modal === 'skills' && <EditSkillsModal open onClose={() => setModal(null)} tags={profile.tags} onSave={updateBasicInfo} />}
      {modal === 'contact' && <EditContactModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

function SectionCard({ id, icon, title, theme, isOwner, onEdit, addLabel, rail, children }: {
  id: string; icon: React.ReactNode; title: string; theme: ThemePalette;
  isOwner: boolean; onEdit?: () => void; addLabel?: boolean; rail?: boolean; children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft scroll-mt-16">
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-bold font-ginto text-text-primary">
          <span style={{ color: theme.dark }}>{icon}</span>{title}
        </h2>
        {isOwner && onEdit && (
          <button onClick={onEdit} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2">
            {addLabel ? <Plus className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}{addLabel ? 'Add' : 'Edit'}
          </button>
        )}
      </div>
      <div className={`px-5 ${rail ? 'pb-4 pt-1' : 'pb-5'}`}>{children}</div>
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

function KV({ icon, label, value, href, theme }: { icon: React.ReactNode; label: string; value: string; href?: string; theme?: ThemePalette }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="text-text-muted mt-0.5 flex-none">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-text-muted">{label}</div>
        {href
          ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold truncate block" style={{ color: theme?.dark }}>{value}</a>
          : <div className="font-semibold text-text-primary">{value}</div>}
      </div>
    </div>
  );
}

function ContactRow({ icon, href, text }: { icon: React.ReactNode; href: string; text: string }) {
  return (
    <a href={href} className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary transition">
      <span className="text-text-muted flex-none">{icon}</span><span className="truncate">{text}</span>
    </a>
  );
}

function SocialBtn({ href, theme, label, children }: { href: string; theme: ThemePalette; label: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
       className="w-9 h-9 rounded-xl grid place-items-center bg-surface-2 border border-border-default text-text-secondary hover:text-[color:var(--accent-dark)] transition"
       style={cssVars({ '--accent-dark': theme.dark })}>
      {children}
    </a>
  );
}

function AddPrompt({ theme, label, onClick }: { theme: ThemePalette; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full py-4 border-[1.5px] border-dashed border-border-default rounded-xl text-sm text-text-muted hover:text-[color:var(--accent-dark)] flex items-center justify-center gap-1.5 transition"
      style={cssVars({ '--accent-dark': theme.dark })}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = theme.base)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}>
      <Plus className="w-4 h-4" /> {label}
    </button>
  );
}

function BioText({ bio, theme }: { bio: string; theme: ThemePalette }) {
  const [open, setOpen] = useState(false);
  const long = bio.length > 280;
  const text = long && !open ? bio.slice(0, 280).trimEnd() + '…' : bio;
  return (
    <div>
      <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line">{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[13px] font-bold" style={{ color: theme.dark }}>
          {open ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}
