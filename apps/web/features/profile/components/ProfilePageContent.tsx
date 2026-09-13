'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { evictRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { CameraIcon, ChevronDownIcon, ChevronUpIcon, EarthIcon, LoaderCircleIcon, MapPinIcon } from '@/features/shared/icons';
import Image from 'next/image';
import { useProfile } from '@/features/profile/hooks/useProfile';
import { useMemberConnection } from '@/features/profile/hooks/useMemberConnection';
import { useNodeProfile, patchCachedNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { getPalette, hexToPalette, type ThemePalette } from '@/lib/profileTheme';
import { getNodeTypeConfig, findAlias } from '@/lib/types';
import Chip, { chipClass } from '@/components/ui/Chip';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import PageError from '@/components/ui/PageError';
import { matchCountryInLocation } from '@/lib/countries';
import CountryFlag from './CountryFlag';
import { uploadImage, validateImageFile } from '@/lib/imageUpload';
import { StatItem, SectionCard, EditIconButton, cssVars, hostname } from './profileCards';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';
import SpacesModal, { type ProfileSpace } from './SpacesModal';
import ContactInfoModal from './ContactInfoModal';

type ModalState = 'basicInfo' | 'about' | 'skills' | 'contact' | 'contactInfo' | 'communities' | null;
/** Your own space: no member list to connect to, so the link isn't offered. */
const PERSONAL_ID_PREFIX = 'me:';

interface ProfilePageContentProps {
  nodeId: string;
  /** Rendered inside FullProfileOverlay (its own scroll container, no fixed navbar above). */
  overlay?: boolean;
}

export default function ProfilePageContent({ nodeId, overlay = false }: ProfilePageContentProps) {
  const { session } = useAuth();
  const { currentSpace } = useSpace();
  const { profile, loading, error, updateBasicInfo, reload } = useProfile(nodeId);
  const { data: nodeData } = useNodeProfile(nodeId);
  const [modal, setModal] = useState<ModalState>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [profileSpaces, setProfileSpaces] = useState<ProfileSpace[]>([]);

  // Spaces shown on the profile: managed (admin) ones always, member ones
  // only when the owner has toggled them visible. Owner receives the full list
  // (for the toggles); everyone else gets the pre-filtered visible set.
  useEffect(() => {
    let cancelled = false;
    setProfileSpaces([]);
    const url = `/api/profile/${encodeURIComponent(nodeId)}/communities`;
    swrFetch(url, () => fetchJson<{ spaces?: ProfileSpace[] }>(url), (data) => {
      if (!cancelled) setProfileSpaces(data.spaces ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId]);

  const toggleSpaceVisibility = useCallback(async (spaceId: string, showOnProfile: boolean) => {
    try {
      const url = `/api/profile/${encodeURIComponent(nodeId)}/communities`;
      evictRequestCache(url);
      await fetchJsonBody(url, 'PATCH', { spaceId, showOnProfile });
    } catch { return; }
    setProfileSpaces((prev) => prev.map((c) =>
      c.id === spaceId ? { ...c, showOnProfile, visible: c.role === 'admin' || showOnProfile } : c
    ));
  }, [nodeId]);

  // The member link. A person node with no member behind it still shows its
  // profile — nothing is offered to connect one; the page simply stands in.
  // Changing the link moves two caches on its way out: the cached node carries
  // `connected_user_id` (what the route and a later mount read), and the profile
  // itself flips between the member's real record and a node-synthesized
  // stand-in.
  const isPersonalSpace = currentSpace?.id?.startsWith(PERSONAL_ID_PREFIX) ?? false;
  const onConnectionChange = useCallback((userId: string | null) => {
    patchCachedNodeProfile(nodeId, { connected_user_id: userId });
    void reload();
  }, [nodeId, reload]);
  const memberConnection = useMemberConnection({ nodeId, onChange: onConnectionChange });

  // Ownership follows the member connection (profile.userId resolves through
  // Node.identityId → Identity.userId), not node-id equality — a member's node
  // in a space they created has a name-derived id that never matches their
  // session nodeId. The nodeId check stays as a fallback for profiles cached
  // before `userId` was returned here.
  const isOwner = !!(
    (session?.user?.id && profile?.userId && profile.userId === session.user.id) ||
    (session?.user?.nodeId && session.user.nodeId === nodeId)
  );

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

  // Aliases ("Founder", "Investor", …) carry a per-space colour; when this
  // node has one, the whole page theme uses it instead of the base type colour.
  const aliasName = nodeData?.node?.alias;
  const aliasColor = aliasName
    ? findAlias(currentSpace?.aliases, aliasName, nodeData?.node?.type ?? 'People')?.color
    : undefined;

  const systemPalette = useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    return hexToPalette(aliasColor ?? getNodeTypeConfig(nodeType, currentSpace?.nodeTypes).color);
  }, [aliasColor, nodeData?.node?.type, currentSpace?.nodeTypes]);
  const savedThemeId = profile?.metadata?.themeColor as string | undefined;
  const theme = savedThemeId ? getPalette(savedThemeId) : systemPalette;

  if (loading) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !profile) {
    return <PageError message="Couldn't load this profile." onRetry={() => void reload()} />;
  }

  // Prefer the profile-visible space list; fall back to the shared-count
  // for context-only people with no linked user.
  const visibleSpaceCount = profileSpaces.filter((c) => c.visible).length;
  const spaceCount = profileSpaces.length > 0 ? visibleSpaceCount : (nodeData?.spaceCount ?? 1);
  const spacesClickable = profileSpaces.length > 0;
  const joined = profile.createdAt ? joinedFacts(new Date(profile.createdAt)) : null;
  const hasCountry = !!matchCountryInLocation(profile.location);
  const hasContact = !!(profile.email || profile.phone || profile.website || profile.linkedinUrl || profile.twitterUrl);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const sectionScrollMargin = overlay ? 'scroll-mt-4' : 'scroll-mt-20';

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ IDENTITY HERO — avatar beside the identity block, both on the page ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* avatar card */}
        <div className="relative w-48 h-48 sm:w-60 sm:h-60 aspect-square flex-none rounded-lg overflow-hidden bg-surface-2">
          {profile.imageUrl ? (
            <Image src={profile.imageUrl} alt={profile.name} width={240} height={240} className="w-full h-full object-cover" />
          ) : (
            <PersonSilhouette color={theme.base} />
          )}
          {isOwner && (
            <button onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}
                    aria-label="Change profile photo"
                    className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus-visible:opacity-100'}`}>
              {avatarUploading ? <LoaderCircleIcon className="w-6 h-6 animate-spin" /> : <CameraIcon className="w-6 h-6" />}
            </button>
          )}
        </div>
        {isOwner && <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={changeAvatar} />}

        {/* identity card */}
        <section className="flex-1 min-w-0 sm:min-h-60 flex flex-col">
          {/* my-auto centers the identity block against the tall avatar card,
              pushing the stat strip to the bottom edge */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto py-4">
          {/* identity — every fact appears exactly once on this page */}
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{profile.name}</h1>
            {aliasName && <div className="mt-2"><Chip tone="solid" color={aliasColor}>{aliasName}</Chip></div>}

            {profile.subtitle && (
              <p className="mt-1.5 text-[15px] text-text-secondary max-w-[60ch]">{profile.subtitle}</p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  {hasCountry
                    ? <CountryFlag location={profile.location} />
                    : <MapPinIcon className="w-3.5 h-3.5" />}
                  {profile.location}
                </span>
              )}
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                  <EarthIcon className="w-3.5 h-3.5" />{hostname(profile.website)}
                </a>
              )}
            </div>

            {/* Contact info — the details live behind this link, not on the page */}
            {(hasContact || isOwner) && (
              <button type="button" onClick={() => setModal('contactInfo')}
                      className="mt-2 text-sm font-semibold hover:underline" style={{ color: theme.dark }}>
                Contact info
              </button>
            )}
          </div>

          {isOwner && (
            <EditIconButton onClick={() => setModal('basicInfo')} label="Edit intro" className="-mt-1 -mr-2" />
          )}
          </div>

          {/* stat strip — pinned to the hero's bottom edge */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <StatItem value={spaceCount} label={spaceCount === 1 ? 'Space' : 'Spaces'}
                      onClick={spacesClickable ? () => setModal('communities') : undefined} accent={theme.dark} />
            {profile.tags.length > 0 && (
              <StatItem value={profile.tags.length} label={profile.tags.length === 1 ? 'Skill' : 'Skills'}
                        onClick={() => jump('skills')} accent={theme.dark} />
            )}

            {/* The member behind this profile. Only the people who can undo the
                link see it — for everyone else the connection is just what the
                page is. */}
            {!isOwner && memberConnection.connection && memberConnection.canManage && !isPersonalSpace && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[13px] text-text-muted">Member</span>
                <Chip size="lg">{memberConnection.connection.name}</Chip>
                <button type="button" onClick={() => void memberConnection.disconnect()}
                        disabled={memberConnection.busy}
                        className={chipClass({ tone: 'dashed', size: 'lg' })}
                        style={cssVars({ '--accent': theme.dark })}>
                  Disconnect
                </button>
                {memberConnection.error && <span className="text-xs text-red-600">{memberConnection.error}</span>}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ══ BODY — full-width sections stacked on hairlines ══ */}
      <div className="min-w-0 flex flex-col gap-5">
        {/* About */}
        <SectionCard id="about" title="About"
                     scrollMargin={sectionScrollMargin} isOwner={isOwner} onEdit={() => setModal('about')}>
          {profile.bio
            ? <BioText bio={profile.bio} theme={theme} />
            : <p className="text-sm text-text-muted">No bio yet.</p>}
        </SectionCard>

        {/* Skills & experience — the time on Visvine opens it as a timeline line */}
        <SectionCard id="skills" title="Skills & experience" scrollMargin={sectionScrollMargin} isOwner={isOwner}
                     onAdd={() => setModal('skills')} onEdit={() => setModal('skills')}>
          {joined && (
            <div className="relative pl-6 pb-5">
              <span aria-hidden className="absolute left-[3px] top-[7px] w-2 h-2 rounded-full bg-text-muted/60" />
              <span aria-hidden className="absolute left-[6px] top-6 bottom-2 w-0.5 rounded-full bg-border-subtle" />
              <div className="text-[15px] font-bold font-open-sauce text-text-primary">Joined Visvine</div>
              <div className="text-sm text-text-muted">{joined.since} – Present · {joined.duration}</div>
            </div>
          )}
          {profile.tags.length > 0 ? (
            <div className={`flex flex-wrap gap-2 ${joined ? 'pl-6' : ''}`}>
              {profile.tags.map((tag, i) => (
                <Chip key={tag} tone="solid" size="lg" color={theme.base}
                      className="chip-pop transition-transform duration-150 hover:-translate-y-0.5"
                      style={{ animationDelay: `${Math.min(i, 20) * 35}ms` }}>
                  {tag}
                </Chip>
              ))}
            </div>
          ) : <p className={`text-sm text-text-muted ${joined ? 'pl-6' : ''}`}>No skills listed.</p>}
        </SectionCard>
      </div>

      {/* Modals */}
      {modal === 'basicInfo' && <EditBasicInfoModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'about' && <EditAboutModal open onClose={() => setModal(null)} bio={profile.bio} onSave={updateBasicInfo} />}
      {modal === 'skills' && <EditSkillsModal open onClose={() => setModal(null)} tags={profile.tags} onSave={updateBasicInfo} />}
      {modal === 'contact' && <EditContactModal open onClose={() => setModal(null)} profile={profile} onSave={updateBasicInfo} />}
      {modal === 'contactInfo' && (
        <ContactInfoModal open onClose={() => setModal(null)} profile={profile}
                          isOwner={isOwner} onEdit={() => setModal('contact')} />
      )}
      {modal === 'communities' && (
        <SpacesModal open onClose={() => setModal(null)} spaces={profileSpaces}
                          isOwner={isOwner} personName={profile.name} theme={theme}
                          onToggle={isOwner ? toggleSpaceVisibility : undefined} />
      )}
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

/** "Oct 2025" and "1 yr 6 mos" for a join date, the way LinkedIn states a tenure. */
function joinedFacts(date: Date): { since: string; duration: string } {
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth()) + 1;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  const parts = [
    yrs > 0 ? `${yrs} yr${yrs === 1 ? '' : 's'}` : '',
    mos > 0 ? `${mos} mo${mos === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return {
    since: date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    duration: parts.join(' '),
  };
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
          {open ? <><ChevronUpIcon className="w-3.5 h-3.5" /> Show less</> : <><ChevronDownIcon className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}
