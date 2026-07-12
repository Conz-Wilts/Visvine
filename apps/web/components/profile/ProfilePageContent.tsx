'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  MapPin, Linkedin, Twitter, Phone, Mail, Globe2, Calendar,
  Pencil, Plus, Share2, Sparkles, Wrench,
  Check, ChevronDown, ChevronUp, Briefcase, Camera, Loader2,
} from 'lucide-react';
import Image from 'next/image';
import { useProfile } from '@/hooks/useProfile';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useSession } from '@/lib/auth-client';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getPalette, hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig, findAlias } from '@/lib/types';
import { getInitials } from '@/lib/avatarUtils';
import {
  computeProfileCompletion, getExperience, sortExperience,
  formatYearMonth, formatDuration, type ExperienceEntry,
} from '@/lib/profileTypes';
import { matchCountryInLocation } from '@/lib/countries';
import CountryFlag from './CountryFlag';
import { uploadImage, validateImageFile } from '@/lib/imageUpload';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';
import EditExperienceModal from './edit/EditExperienceModal';
import CommunitiesModal, { type ProfileCommunity } from './CommunitiesModal';

type ModalState = 'basicInfo' | 'about' | 'skills' | 'contact' | 'experience' | 'communities' | null;
/** Which edit modal completes each profile-strength item. */
const COMPLETION_MODAL: Record<string, Exclude<ModalState, null>> = {
  photo: 'basicInfo', headline: 'basicInfo', about: 'about',
  location: 'basicInfo', experience: 'experience', skills: 'skills', contact: 'contact',
};

const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

/** Typed helper for inline CSS custom properties (CSSProperties rejects arbitrary keys). */
const cssVars = (vars: Record<`--${string}`, string>): React.CSSProperties => vars as React.CSSProperties;

interface ProfilePageContentProps {
  nodeId: string;
  /** Rendered inside FullProfileOverlay (its own scroll container, no fixed navbar above). */
  overlay?: boolean;
}

export default function ProfilePageContent({ nodeId, overlay = false }: ProfilePageContentProps) {
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const { profile, loading, error, updateBasicInfo } = useProfile(nodeId);
  const { data: nodeData } = useNodeProfile(nodeId);
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [profileCommunities, setProfileCommunities] = useState<ProfileCommunity[]>([]);

  // Communities shown on the profile: managed (admin) ones always, member ones
  // only when the owner has toggled them visible. Owner receives the full list
  // (for the toggles); everyone else gets the pre-filtered visible set.
  useEffect(() => {
    let cancelled = false;
    setProfileCommunities([]);
    fetch(`/api/profile/${encodeURIComponent(nodeId)}/communities`)
      .then((res) => (res.ok ? res.json() : { communities: [] }))
      .then((data) => { if (!cancelled) setProfileCommunities(data.communities ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId]);

  const toggleCommunityVisibility = useCallback(async (communityId: string, showOnProfile: boolean) => {
    const res = await fetch(`/api/profile/${encodeURIComponent(nodeId)}/communities`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ communityId, showOnProfile }),
    });
    if (!res.ok) return;
    setProfileCommunities((prev) => prev.map((c) =>
      c.id === communityId ? { ...c, showOnProfile, visible: c.role === 'admin' || showOnProfile } : c
    ));
  }, [nodeId]);

  const isOwner = !!(session?.user?.nodeId && session.user.nodeId === nodeId);

  const shareProfile = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  const changeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    if (validateImageFile(file)) return; // invalid type/size — modal path shows errors, hero path just no-ops
    setAvatarUploading(true);
    try {
      const url = await uploadImage('person', profile.id, file);
      await updateBasicInfo({ imageUrl: url });
    } catch { /* keep previous avatar */ } finally {
      setAvatarUploading(false);
    }
  };

  // Aliases ("Founder", "Investor", …) carry a per-community colour; when this
  // node has one, the whole page theme uses it instead of the base type colour.
  const aliasName = nodeData?.node?.alias;
  const aliasColor = aliasName
    ? findAlias(currentCommunity?.communityAliases, aliasName, nodeData?.node?.type ?? 'People')?.color
    : undefined;

  const systemPalette = useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    return hexToPalette(aliasColor ?? getNodeTypeConfig(nodeType, currentCommunity?.nodeTypes).color);
  }, [aliasColor, nodeData?.node?.type, currentCommunity?.nodeTypes]);
  const savedThemeId = profile?.metadata?.themeColor as string | undefined;
  const theme = savedThemeId ? getPalette(savedThemeId) : systemPalette;

  const experience = useMemo(
    () => (profile ? sortExperience(getExperience(profile)) : []),
    [profile],
  );

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

  // Prefer the profile-visible community list; fall back to the shared-count
  // for graph-only people with no linked user.
  const visibleCommunityCount = profileCommunities.filter((c) => c.visible).length;
  const communityCount = profileCommunities.length > 0 ? visibleCommunityCount : (nodeData?.communityCount ?? 1);
  const communitiesClickable = profileCommunities.length > 0;
  const joinedLabel = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;
  const hasCountry = !!matchCountryInLocation(profile.location);
  const { score, sections: completionSections } = computeProfileCompletion(profile);
  const missing = Object.entries(completionSections).filter(([, s]) => !s.complete);
  const hasContact = !!(profile.email || profile.phone || profile.linkedinUrl || profile.twitterUrl);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // The rail sticks under the fixed app chrome on the standalone page; in the
  // overlay it owns its own scroll container, so it sticks near the very top.
  const railStick = overlay ? 'lg:top-4' : 'lg:top-16';
  const sectionScrollMargin = overlay ? 'scroll-mt-4' : 'scroll-mt-20';

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ IDENTITY HERO — avatar and identity as separate floating cards ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* avatar card */}
        <div className="relative w-52 h-52 sm:w-[272px] sm:h-[272px] flex-none self-start rounded-2xl overflow-hidden bg-surface-1 border border-border-subtle shadow-soft">
          {profile.imageUrl ? (
            <Image src={profile.imageUrl} alt={profile.name} width={272} height={272} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl sm:text-7xl font-bold text-white"
                 style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
              {getInitials(profile.name)}
            </div>
          )}
          {isOwner && (
            <button onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}
                    aria-label="Change profile photo"
                    className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus-visible:opacity-100'}`}>
              {avatarUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
            </button>
          )}
        </div>
        {isOwner && <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={changeAvatar} />}

        {/* identity card */}
        <section data-tour="profile-hero" className="flex-1 min-w-0 bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 sm:px-8 py-5 sm:py-6 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-5">
          {/* identity — every fact appears exactly once on this page */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-x-2.5 gap-y-1 flex-wrap">
              <h1 className="text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{profile.name}</h1>
              {profile.pronouns && <span className="text-sm text-text-muted">{profile.pronouns}</span>}
              {aliasName && (
                <span
                  className={`inline-flex items-center h-[22px] px-2 rounded-md text-[11.5px] font-semibold border ${aliasColor ? '' : 'bg-surface-2 text-text-muted border-border-subtle'}`}
                  style={aliasColor ? { background: `${aliasColor}1a`, color: aliasColor, borderColor: `${aliasColor}55` } : undefined}
                >
                  {aliasName}
                </span>
              )}
            </div>

            {profile.subtitle ? (
              <p className="mt-1.5 text-[15px] text-text-secondary max-w-[60ch]">{profile.subtitle}</p>
            ) : isOwner ? (
              <button onClick={() => setModal('basicInfo')} className="mt-1.5 text-sm font-medium hover:underline" style={{ color: theme.dark }}>
                + Add a headline
              </button>
            ) : null}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  {hasCountry
                    ? <CountryFlag location={profile.location} />
                    : <MapPin className="w-3.5 h-3.5" />}
                  {profile.location}
                </span>
              )}
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                  <Globe2 className="w-3.5 h-3.5" />{hostname(profile.website)}
                </a>
              )}
              {joinedLabel && (
                <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Joined {joinedLabel}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 flex-none">
            <button onClick={shareProfile}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-[13px] font-semibold bg-surface-1 text-text-secondary border border-border-default hover:bg-surface-2 hover:text-text-primary transition-colors">
              {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
            </button>
            {isOwner ? (
              <button onClick={() => setModal('basicInfo')}
                data-tour="profile-edit"
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold whitespace-nowrap text-white transition hover:opacity-95 active:scale-[0.99]"
                style={{ background: theme.base }}>
                <Pencil className="w-4 h-4 flex-none" /> Edit profile
              </button>
            ) : null}
          </div>
          </div>

          {/* stat strip — pinned to the card's bottom edge */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 mt-auto pt-4 border-t border-border-subtle">
            <StatItem value={communityCount} label={communityCount === 1 ? 'Community' : 'Communities'}
                      onClick={communitiesClickable ? () => setModal('communities') : undefined} accent={theme.dark} />
            {experience.length > 0 && (
              <StatItem value={experience.length} label={experience.length === 1 ? 'Role' : 'Roles'}
                        onClick={() => jump('experience')} accent={theme.dark} />
            )}
            {profile.tags.length > 0 && (
              <StatItem value={profile.tags.length} label={profile.tags.length === 1 ? 'Skill' : 'Skills'}
                        onClick={() => jump('skills')} accent={theme.dark} />
            )}
          </div>
        </section>
      </div>

      {/* ══ TWO-COLUMN BODY — separate floating cards ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5 xl:gap-6">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* About */}
          <SectionCard id="about" icon={<Sparkles className="w-4 h-4" />} title="About" theme={theme}
                       scrollMargin={sectionScrollMargin} isOwner={isOwner} onEdit={() => setModal('about')}>
            {profile.bio
              ? <BioText bio={profile.bio} theme={theme} />
              : isOwner
                ? <AddPrompt theme={theme} label="Add a bio to introduce yourself" onClick={() => setModal('about')} />
                : <p className="text-sm text-text-muted italic">No bio yet.</p>}
          </SectionCard>

          {/* Experience */}
          {(experience.length > 0 || isOwner) && (
            <SectionCard id="experience" icon={<Briefcase className="w-4 h-4" />} title="Experience"
                         badge={experience.length > 0 ? experience.length : undefined} theme={theme}
                         scrollMargin={sectionScrollMargin} isOwner={isOwner}
                         addLabel={experience.length === 0} onEdit={() => setModal('experience')}>
              {experience.length > 0
                ? <ExperienceTimeline entries={experience} theme={theme} />
                : <AddPrompt theme={theme} label="Add your career history" onClick={() => setModal('experience')} />}
            </SectionCard>
          )}

          {/* Skills */}
          <SectionCard id="skills" icon={<Wrench className="w-4 h-4" />} title="Skills & expertise" theme={theme}
                       scrollMargin={sectionScrollMargin} isOwner={isOwner} addLabel onEdit={() => setModal('skills')}>
            {profile.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.tags.map((tag, i) => (
                  <span key={tag}
                        className="chip-pop px-3 py-1.5 rounded-full text-[13px] font-medium border transition-transform duration-150 hover:-translate-y-0.5"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}33`, animationDelay: `${Math.min(i, 20) * 35}ms` }}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add skills & expertise" onClick={() => setModal('skills')} />
              : <p className="text-sm text-text-muted italic">No skills listed.</p>}
          </SectionCard>

        </div>

        {/* RAIL */}
        <div className={`flex flex-col gap-4 lg:sticky ${railStick} self-start`}>
          {/* Owner: profile strength with quick-fix shortcuts */}
          {isOwner && score < 100 && (
            <RailCard title="Profile strength">
              <div className="flex items-center gap-3.5">
                <div className="relative w-14 h-14 flex-none rounded-full grid place-items-center"
                     style={{ background: `conic-gradient(${theme.base} ${score}%, var(--surface-3,#f3f4f6) 0)` }}>
                  <div className="absolute w-10 h-10 rounded-full bg-surface-1" />
                  <b className="relative text-[13px] font-bold font-open-sauce text-text-primary">{score}%</b>
                </div>
                <p className="text-[13px] text-text-secondary leading-snug">Complete profiles rank higher in your community’s directory.</p>
              </div>
              {missing.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-3 pt-3 border-t border-border-subtle">
                  {missing.slice(0, 3).map(([key, s]) => (
                    <button key={key} onClick={() => setModal(COMPLETION_MODAL[key] ?? 'basicInfo')}
                            className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors text-left">
                      <Plus className="w-3.5 h-3.5 text-text-muted flex-none" /> Add {s.label.toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
            </RailCard>
          )}

          {/* Contact — email/phone/socials only; location, website & joined live in the hero */}
          <SectionCard id="contact" icon={<Mail className="w-4 h-4" />} title="Contact" theme={theme}
                       scrollMargin={sectionScrollMargin} isOwner={isOwner} onEdit={() => setModal('contact')}>
            {hasContact ? (
              <>
                <div className="flex flex-col gap-0.5 -mx-2">
                  {profile.email && <ContactRow icon={<Mail className="w-4 h-4" />} href={`mailto:${profile.email}`} text={profile.email} />}
                  {profile.phone && <ContactRow icon={<Phone className="w-4 h-4" />} href={`tel:${profile.phone}`} text={profile.phone} />}
                </div>
                {(profile.linkedinUrl || profile.twitterUrl) && (
                  <div className="flex gap-2 mt-2.5">
                    {profile.linkedinUrl && <SocialBtn href={profile.linkedinUrl} theme={theme} label="LinkedIn"><Linkedin className="w-4 h-4" /></SocialBtn>}
                    {profile.twitterUrl && <SocialBtn href={profile.twitterUrl} theme={theme} label="X / Twitter"><Twitter className="w-4 h-4" /></SocialBtn>}
                  </div>
                )}
              </>
            ) : isOwner
              ? <AddPrompt theme={theme} label="Add contact info" onClick={() => setModal('contact')} />
              : <p className="text-sm text-text-muted italic">No contact info listed.</p>}
          </SectionCard>
        </div>
      </div>

      {/* Modals */}
      {modal === 'basicInfo' && <EditBasicInfoModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'about' && <EditAboutModal open onClose={() => setModal(null)} bio={profile.bio} onSave={updateBasicInfo} />}
      {modal === 'skills' && <EditSkillsModal open onClose={() => setModal(null)} tags={profile.tags} onSave={updateBasicInfo} />}
      {modal === 'contact' && <EditContactModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'experience' && <EditExperienceModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'communities' && (
        <CommunitiesModal open onClose={() => setModal(null)} communities={profileCommunities}
                          isOwner={isOwner} personName={profile.name} theme={theme}
                          onToggle={isOwner ? toggleCommunityVisibility : undefined} />
      )}
    </div>
  );
}

/* ── experience timeline ──────────────────────────────────────────────────── */

function ExperienceTimeline({ entries, theme }: { entries: ExperienceEntry[]; theme: ThemePalette }) {
  return (
    <div className="relative">
      {/* spine — draws downward on entry */}
      <div className="timeline-draw absolute left-[17px] top-2 bottom-2 w-px"
           style={{ background: `linear-gradient(to bottom, ${theme.base}66, ${theme.base}1a)` }} />
      <ol className="flex flex-col gap-5">
        {entries.map((entry, i) => {
          const isCurrent = !!entry.current && !entry.end;
          return (
            <li key={entry.id} className="exp-rise relative flex gap-4" style={{ animationDelay: `${i * 90}ms` }}>
              {/* org dot */}
              <span className={`relative z-[1] w-9 h-9 flex-none rounded-xl grid place-items-center text-[11px] font-bold ring-4 ring-surface-1 ${isCurrent ? 'dot-pulse' : ''}`}
                    style={cssVars({
                      '--pulse-color': `${theme.base}55`,
                    })}>
                <span className="absolute inset-0 rounded-xl" style={{ background: theme.light, border: `1px solid ${theme.base}33` }} />
                <span className="relative" style={{ color: theme.dark }}>{getInitials(entry.org)}</span>
              </span>

              <div className="min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[14.5px] font-bold text-text-primary leading-snug">{entry.title}</h3>
                  {isCurrent && (
                    <span className="inline-flex items-center h-[20px] px-2 rounded-md text-[11px] font-semibold"
                          style={{ background: theme.light, color: theme.dark }}>
                      Current
                    </span>
                  )}
                </div>
                <p className="text-[13.5px] text-text-secondary mt-0.5">{entry.org}</p>
                <p className="text-xs text-text-muted mt-1">
                  {formatYearMonth(entry.start)} – {entry.end ? formatYearMonth(entry.end) : 'Present'}
                  {formatDuration(entry.start, entry.end) && <> · {formatDuration(entry.start, entry.end)}</>}
                  {entry.location && <> · <CountryFlag location={entry.location} className="w-[15px] h-[11px] align-[-1px] mr-0.5" />{entry.location}</>}
                </p>
                {entry.description && (
                  <p className="text-[13px] text-text-secondary leading-relaxed mt-1.5 max-w-[64ch] whitespace-pre-line">{entry.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

function StatItem({ value, label, onClick, accent }: { value: number; label: string; onClick?: () => void; accent?: string }) {
  const inner = (
    <>
      <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{value}</b>
      <span className="text-[13px] text-text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button onClick={onClick}
            className="group inline-flex items-baseline gap-1.5 hover:text-[color:var(--accent-dark)] transition-colors"
            style={cssVars({ '--accent-dark': accent ?? 'inherit' })}>
      {inner}
    </button>
  ) : (
    <div className="inline-flex items-baseline gap-1.5">{inner}</div>
  );
}

function SectionCard({ id, icon, title, badge, theme, isOwner, onEdit, addLabel, scrollMargin, children }: {
  id: string; icon: React.ReactNode; title: string; badge?: number; theme: ThemePalette;
  isOwner: boolean; onEdit?: () => void; addLabel?: boolean; scrollMargin: string; children: React.ReactNode;
}) {
  return (
    <section id={id} className={`bg-surface-1 border border-border-subtle rounded-2xl shadow-soft ${scrollMargin}`}>
      <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold font-open-sauce text-text-primary">
          <span className="w-7 h-7 rounded-lg grid place-items-center flex-none"
                style={{ background: theme.light, color: theme.dark }}>
            {icon}
          </span>
          {title}
          {badge !== undefined && <span className="text-[13px] font-medium text-text-muted">{badge}</span>}
        </h2>
        {isOwner && onEdit && (
          <button onClick={onEdit}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors">
            {addLabel ? <Plus className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}{addLabel ? 'Add' : 'Edit'}
          </button>
        )}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 py-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted mb-3.5">{title}</div>
      {children}
    </div>
  );
}

function ContactRow({ icon, href, text }: { icon: React.ReactNode; href: string; text: string }) {
  return (
    <a href={href} className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-colors">
      <span className="text-text-muted flex-none">{icon}</span><span className="truncate">{text}</span>
    </a>
  );
}

function SocialBtn({ href, theme, label, children }: { href: string; theme: ThemePalette; label: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}
       className="w-9 h-9 rounded-xl grid place-items-center bg-surface-2 border border-border-subtle text-text-secondary hover:text-[color:var(--accent-dark)] hover:border-border-default transition-colors"
       style={cssVars({ '--accent-dark': theme.dark })}>
      {children}
    </a>
  );
}

function AddPrompt({ theme, label, onClick }: { theme: ThemePalette; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="w-full py-4 border-[1.5px] border-dashed border-border-default rounded-xl text-sm text-text-muted hover:text-[color:var(--accent-dark)] hover:border-[color:var(--accent)] flex items-center justify-center gap-1.5 transition-colors"
      style={cssVars({ '--accent': theme.base, '--accent-dark': theme.dark })}>
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
      <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line max-w-[72ch]">{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
          {open ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</> : <><ChevronDown className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}
