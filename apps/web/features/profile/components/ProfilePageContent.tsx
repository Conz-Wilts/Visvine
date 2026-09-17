'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { evictRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { CameraIcon, ChevronDownIcon, ChevronUpIcon, EarthIcon, LoaderCircleIcon, MapPinIcon, PencilIcon, ShieldCheckIcon } from '@/features/shared/icons';
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
import Button from '@/components/ui/Button';
import { getInitials } from '@/lib/avatarUtils';
import { SectionCard, cssVars, hostname } from './profileCards';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditContactModal from './edit/EditContactModal';
import SpacesModal, { type ProfileSpace } from './SpacesModal';
import type { FullProfile } from '@/lib/types/profile';
import ExperienceTimeline from './ExperienceTimeline';
import ContactInfoModal from './ContactInfoModal';

type ModalState = 'basicInfo' | 'about' | 'contact' | 'contactInfo' | 'spaces' | null;
/** Your own space: no member list to connect to, so the link isn't offered. */
const PERSONAL_ID_PREFIX = 'me:';

interface ProfilePageContentProps {
  nodeId: string;
  /** Rendered inside FullProfileOverlay (its own scroll container, no fixed navbar above). */
  overlay?: boolean;
  /** Opened as yourself from the account row (see lib/selfView): your space alias is not shown. */
  selfView?: boolean;
}

export default function ProfilePageContent({ nodeId, overlay = false, selfView = false }: ProfilePageContentProps) {
  const { session, refreshSession } = useAuth();
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
    const url = `/api/profile/${encodeURIComponent(nodeId)}/spaces`;
    swrFetch(url, () => fetchJson<{ spaces?: ProfileSpace[] }>(url), (data) => {
      if (!cancelled) setProfileSpaces(data.spaces ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId]);

  const toggleSpaceVisibility = useCallback(async (spaceId: string, showOnProfile: boolean) => {
    try {
      const url = `/api/profile/${encodeURIComponent(nodeId)}/spaces`;
      evictRequestCache(url);
      await fetchJsonBody(url, 'PATCH', { spaceId, showOnProfile });
    } catch { return; }
    setProfileSpaces((prev) => prev.map((c) =>
      c.id === spaceId ? { ...c, showOnProfile, visible: c.isAdmin || showOnProfile } : c
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

  // Your name and your picture are shell chrome too — the account band at the
  // foot of the rail draws them. Saving either moves the band with it; the
  // session is re-read rather than patched, so the band and this page can
  // never disagree about what was actually stored.
  const saveBasicInfo = useCallback(async (patch: Partial<FullProfile>) => {
    await updateBasicInfo(patch);
    if (isOwner && (patch.imageUrl !== undefined || patch.name !== undefined)) await refreshSession();
  }, [updateBasicInfo, isOwner, refreshSession]);

  const changeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !profile) return;
    if (validateImageFile(file)) return; // invalid type/size — modal path shows errors, hero path just no-ops
    setAvatarUploading(true);
    try {
      const url = await uploadImage('person', profile.id, file);
      await saveBasicInfo({ imageUrl: url });
    } catch { /* keep previous avatar */ } finally {
      setAvatarUploading(false);
    }
  };

  // Aliases ("Founder", "Investor", …) carry a per-space colour; when this
  // node has one, the whole page theme uses it instead of the base type colour.
  // An alias is a role inside one space, so your own page opened from the
  // account row shows neither the chip nor its colour.
  const aliasName = isOwner && selfView ? undefined : nodeData?.node?.alias;
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
  const visibleSpaces = profileSpaces.filter((c) => c.visible);
  const spaceCount = profileSpaces.length > 0 ? visibleSpaces.length : (nodeData?.spaceCount ?? 1);
  const spacesClickable = profileSpaces.length > 0;
  const hasCountry = !!matchCountryInLocation(profile.location);
  const hasContact = !!(profile.email || profile.phone || profile.website || profile.linkedinUrl || profile.twitterUrl);

  const sectionScrollMargin = overlay ? 'scroll-mt-4' : 'scroll-mt-20';

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ IDENTITY HERO — the avatar beside who they are, their spaces to the right ══ */}
      <section className="rounded-2xl border border-border-subtle bg-surface-1 px-5 py-5 shadow-strip sm:px-7 sm:py-7 flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-7">
        <div className="relative w-44 h-44 sm:w-56 sm:h-56 flex-none rounded-2xl overflow-hidden bg-surface-2">
          {profile.imageUrl ? (
              <Image src={profile.imageUrl} alt={profile.name} width={224} height={224} quality={90} className="w-full h-full object-cover" />
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

        <div className="min-w-0 flex-1 flex flex-col lg:flex-row lg:items-start gap-6 sm:pt-2">
          {/* identity — every fact appears exactly once on this page */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h1 className="text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{profile.name}</h1>
              {/* A profile served from a member's own record, not synthesized from a directory card. */}
              {profile.userId && (
                <span title="Verified member" aria-label="Verified member" style={{ color: theme.dark }}>
                  <ShieldCheckIcon className="w-5 h-5" />
                </span>
              )}
              {profile.pronouns && <span className="text-sm text-text-muted">{profile.pronouns}</span>}
              {aliasName && (
                <Chip
                  tone="solid"
                  size="lg"
                  color={aliasColor}
                  className="h-8 rounded-lg px-3 text-sm leading-normal"
                >
                  {aliasName}
                </Chip>
              )}
            </div>

            {profile.subtitle && (
              <p className="mt-1.5 text-lg text-text-primary max-w-[60ch]">{profile.subtitle}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              {profile.location && (
                <span className="inline-flex items-center gap-1.5">
                  {hasCountry
                    ? <CountryFlag location={profile.location} />
                    : <MapPinIcon className="w-3.5 h-3.5" />}
                  {profile.location}
                </span>
              )}
              {profile.website && (
                <>
                  {profile.location && <span aria-hidden>·</span>}
                  <a href={profile.website} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                    <EarthIcon className="w-3.5 h-3.5" />{hostname(profile.website)}
                  </a>
                </>
              )}
              {/* Contact info — the details live behind this link, not on the page */}
              {(hasContact || isOwner) && (
                <>
                  {(profile.location || profile.website) && <span aria-hidden>·</span>}
                  <button type="button" onClick={() => setModal('contactInfo')}
                          className="font-semibold hover:underline" style={{ color: theme.dark }}>
                    Contact info
                  </button>
                </>
              )}
            </div>

            {spacesClickable ? (
              <button type="button" onClick={() => setModal('spaces')}
                      className="mt-2 text-sm font-semibold hover:underline" style={{ color: theme.dark }}>
                {spaceCount} {spaceCount === 1 ? 'space' : 'spaces'}
              </button>
            ) : (
              <p className="mt-2 text-sm font-semibold text-text-secondary">{spaceCount} {spaceCount === 1 ? 'space' : 'spaces'}</p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isOwner ? (
                <Button onClick={() => setModal('basicInfo')} className="inline-flex items-center gap-2">
                  <PencilIcon className="w-4 h-4" /> Edit profile
                </Button>
              ) : hasContact && (
                <Button onClick={() => setModal('contactInfo')}>Contact info</Button>
              )}
            </div>

            {/* The member behind this profile. Only the people who can undo the
                link see it — for everyone else the connection is just what the
                page is. */}
            {!isOwner && memberConnection.connection && memberConnection.canManage && !isPersonalSpace && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
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

          {/* their spaces, logo first — the spot LinkedIn gives the current company */}
          {visibleSpaces.length > 0 && (
            <div className="lg:w-72 flex-none flex flex-col gap-3 lg:pt-1">
              {visibleSpaces.slice(0, 3).map((space) => (
                <button key={space.id} type="button" onClick={() => setModal('spaces')}
                        className="group flex items-center gap-3 text-left">
                  {space.imageUrl ? (
                    <img src={space.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-none" />
                  ) : (
                    <span className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold flex-none"
                          style={{ background: theme.light, color: theme.dark }}>
                      {getInitials(space.name)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-primary truncate group-hover:underline">{space.name}</span>
                    <span className="block text-[13px] text-text-muted">
                      {space.isAdmin ? 'Admin' : 'Member'} · {space.memberCount} {space.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ══ BODY — lifted sections with space between each card ══ */}
      <div className="min-w-0 flex flex-col gap-5">
        {/* About */}
        <SectionCard id="about" title="About" size="lg" card
                     scrollMargin={sectionScrollMargin} isOwner={isOwner} onEdit={() => setModal('about')}>
          {profile.bio
            ? <BioText bio={profile.bio} theme={theme} />
            : <p className="text-base text-text-muted">No bio yet.</p>}
        </SectionCard>

        {/* Experience — their time on Visvine */}
        <SectionCard id="experience" title="Experience" size="lg" card scrollMargin={sectionScrollMargin}>
          <ExperienceTimeline accountCreatedAt={profile.createdAt ?? null} />
        </SectionCard>
      </div>

      {/* Modals */}
      {modal === 'basicInfo' && <EditBasicInfoModal open onClose={() => setModal(null)} profile={profile} onSave={saveBasicInfo} />}
      {modal === 'about' && <EditAboutModal open onClose={() => setModal(null)} bio={profile.bio} onSave={saveBasicInfo} />}
      {modal === 'contact' && <EditContactModal open onClose={() => setModal(null)} profile={profile} onSave={saveBasicInfo} />}
      {modal === 'contactInfo' && (
        <ContactInfoModal open onClose={() => setModal(null)} profile={profile}
                          isOwner={isOwner} onEdit={() => setModal('contact')} />
      )}
      {modal === 'spaces' && (
        <SpacesModal open onClose={() => setModal(null)} spaces={profileSpaces}
                          isOwner={isOwner} personName={profile.name} theme={theme}
                          onToggle={isOwner ? toggleSpaceVisibility : undefined} />
      )}
    </div>
  );
}

/* ── small presentational helpers ─────────────────────────────────────────── */

function BioText({ bio, theme }: { bio: string; theme: ThemePalette }) {
  const [open, setOpen] = useState(false);
  const long = bio.length > 280;
  const text = long && !open ? bio.slice(0, 280).trimEnd() + '…' : bio;
  return (
    <div>
      <p className="text-[17px] text-text-secondary leading-relaxed whitespace-pre-line max-w-[72ch]">{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
          {open ? <><ChevronUpIcon className="w-3.5 h-3.5" /> Show less</> : <><ChevronDownIcon className="w-3.5 h-3.5" /> Read more</>}
        </button>
      )}
    </div>
  );
}
