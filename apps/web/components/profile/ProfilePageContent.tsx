'use client';

import React, { useState } from 'react';
import {
  MapPin, ExternalLink, Linkedin, Twitter, Phone, Mail,
  Globe2, Wrench,
  Pencil, CheckCircle2, Users, Building2, Calendar,
} from 'lucide-react';
import Image from 'next/image';
import { useProfile } from '@/hooks/useProfile';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useSession } from '@/lib/auth-client';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import ProfileCompletionBanner from './ProfileCompletionBanner';
import EditBasicInfoModal from './edit/EditBasicInfoModal';
import EditAboutModal from './edit/EditAboutModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';
import MyInsightsSection from './MyInsightsSection';
import { getPalette, hexToPalette } from '@/lib/profileTheme';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getNodeTypeConfig } from '@/lib/types';
import {
  Card, CardHeader, EmptyPrompt, EmptyState,
  StatChip, SkillsPillCloud,
  ConnectionAvatar, BioText, initials, memberSinceYear,
} from './ProfilePrimitives';

type ModalState =
  | { kind: 'basicInfo' }
  | { kind: 'about' }
  | { kind: 'skills' }
  | { kind: 'contact' }
  | null;

export default function ProfilePageContent({ nodeId }: { nodeId: string }) {
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const { profile, loading, error, updateBasicInfo } = useProfile(nodeId);

  const { data: nodeData } = useNodeProfile(nodeId);

  const [modal, setModal] = useState<ModalState>(null);
  const close = () => setModal(null);

  const isOwner = !!(session?.user?.nodeId && session.user.nodeId === nodeId);

  const systemPalette = React.useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    const typeColor = getNodeTypeConfig(nodeType, currentCommunity?.nodeTypes).color;
    return hexToPalette(typeColor);
  }, [nodeData?.node?.type, currentCommunity?.nodeTypes]);

  const savedThemeId = profile?.metadata?.themeColor as string | undefined;

  const effectiveId = savedThemeId ?? null;
  const theme = effectiveId ? getPalette(effectiveId) : systemPalette;

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
  const hasContact = !!(profile.email || profile.phone || profile.website || profile.linkedinUrl || profile.twitterUrl);

  return (
    <>
      {isOwner && <ProfileCompletionBanner profile={profile} />}

      <div className="px-6 sm:px-8 pt-6">
        <div className="flex items-stretch gap-6">
          <div className="relative flex-shrink-0">
            <div
              className="w-[225px] h-[225px] rounded-xl overflow-hidden transition-all hover:scale-105"
              style={{ boxShadow: `0 0 0 3px ${theme.base}55, 0 8px 24px ${theme.base}33` }}
            >
              {profile.imageUrl ? (
                <Image
                  src={profile.imageUrl}
                  alt={profile.name}
                  width={225}
                  height={225}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-3xl font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}
                >
                  {initials(profile.name)}
                </div>
              )}
            </div>

            {profile.openToWork && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-surface-1 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-white" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: '225px' }}>
            <div className="flex-1" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {nodeData?.node?.type && (
                    <span
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
                      style={{ background: `${theme.base}20`, color: theme.dark, borderColor: `${theme.base}40` }}
                    >
                      {nodeData.node.type}
                    </span>
                  )}
                  {nodeData?.node?.alias && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-2 text-text-muted border border-border-subtle">
                      {nodeData.node.alias}
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-text-primary leading-tight font-ginto">
                    {profile.name}
                  </h1>
                  {profile.pronouns && (
                    <span className="text-sm text-text-muted">({profile.pronouns})</span>
                  )}
                </div>
              </div>
              {isOwner && (
                <button
                  onClick={() => setModal({ kind: 'basicInfo' })}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border rounded-xl hover:bg-surface-2 transition-colors text-text-secondary border-border-default"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
            </div>

            {profile.openToWork && (
              <div className="mt-1">
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full border"
                  style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}60` }}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: theme.base }} />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: theme.base }} />
                  </span>
                  Open to work
                </span>
              </div>
            )}

            {profile.subtitle ? (
              <p className="mt-1 text-base text-text-secondary leading-snug">{profile.subtitle}</p>
            ) : isOwner ? (
              <button onClick={() => setModal({ kind: 'basicInfo' })} className="mt-1 text-sm hover:underline" style={{ color: theme.dark }}>
                + Add headline
              </button>
            ) : (
              <p className="mt-1 text-base text-text-muted italic">No role listed</p>
            )}

            <div className="flex flex-wrap items-center gap-4 mt-2">
              {profile.location && (
                <span className="flex items-center gap-1 text-sm text-text-muted">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                  {profile.location}
                </span>
              )}
              {profile.website && (
                <a href={profile.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm hover:underline" style={{ color: theme.dark }}>
                  <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                  {(() => { try { return new URL(profile.website).hostname.replace('www.', ''); } catch { return profile.website ?? ''; } })()}
                </a>
              )}
            </div>

            {!isOwner && (
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-full transition-all hover:opacity-90 active:scale-95" style={{ background: theme.base }}>
                  <Users className="w-4 h-4" /> Connect
                </button>
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-full border-2 transition-all hover:bg-surface-2 active:scale-95" style={{ color: theme.dark, borderColor: theme.base }}>
                  <Mail className="w-4 h-4" /> Message
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-auto pt-3">
              <StatChip icon={<Users className="w-3.5 h-3.5" />} value={connectionCount} label="connections" theme={theme} />
              <StatChip icon={<Building2 className="w-3.5 h-3.5" />} value={communityCount} label="communities" theme={theme} />
              {profile.createdAt && (
                <StatChip icon={<Calendar className="w-3.5 h-3.5" />} value={`${memberSinceYear(profile.createdAt)}`} label="member since" theme={theme} />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-8 pb-12 pt-6 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        <div className="space-y-6 min-w-0">

          <Card>
            <CardHeader
              icon={<Globe2 className="w-4 h-4" />}
              title="About"
              isOwner={isOwner}
              onEdit={() => setModal({ kind: 'about' })}
            />
            <div className="px-6 pb-6">
              {profile.bio ? (
                <BioText bio={profile.bio} />
              ) : isOwner ? (
                <EmptyPrompt
                  label="Add a bio to introduce yourself"
                  onAdd={() => setModal({ kind: 'about' })}
                />
              ) : (
                <EmptyState label="No bio yet." />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Wrench className="w-4 h-4" />}
              title="Skills"
              isOwner={isOwner}
              onEdit={() => setModal({ kind: 'skills' })}
            />
            {profile.tags.length > 0 ? (
              <SkillsPillCloud tags={profile.tags} theme={theme} />
            ) : isOwner ? (
              <div className="px-6 pb-6">
                <EmptyPrompt
                  label="Add skills & expertise"
                  onAdd={() => setModal({ kind: 'skills' })}
                />
              </div>
            ) : (
              <div className="px-6 pb-6">
                <EmptyState label="No skills listed." />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">

          {connections.length > 0 && (
            <Card>
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-text-muted" />
                  <h2 className="text-sm font-semibold text-text-primary">
                    Connections
                    <span className="ml-1.5 text-xs font-normal text-text-muted">({connectionCount})</span>
                  </h2>
                </div>
              </div>
              <div className="px-5 pb-5 overflow-x-auto">
                <div className="flex gap-3">
                  {connections.slice(0, 10).map((conn) => (
                    <ConnectionAvatar key={conn.id} conn={conn} />
                  ))}
                  {connectionCount > 10 && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-xs font-semibold border-2"
                        style={{
                          background: theme.light,
                          color: theme.dark,
                          borderColor: `${theme.base}40`,
                        }}
                      >
                        +{connectionCount - 10}
                      </div>
                      <span className="text-[10px] text-text-muted">more</span>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              icon={<Mail className="w-4 h-4" />}
              title="Contact"
              isOwner={isOwner}
              onEdit={() => setModal({ kind: 'contact' })}
            />
            <div className="px-6 pb-6">
                {hasContact ? (
                  <div className="space-y-2.5">
                    {profile.email && (
                      <a
                        href={`mailto:${profile.email}`}
                        className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Mail className="w-4 h-4 text-text-muted flex-shrink-0" /> {profile.email}
                      </a>
                    )}
                    {profile.phone && (
                      <a
                        href={`tel:${profile.phone}`}
                        className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Phone className="w-4 h-4 text-text-muted flex-shrink-0" /> {profile.phone}
                      </a>
                    )}
                    {profile.website && (
                      <a
                        href={profile.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 text-sm hover:underline transition-colors"
                        style={{ color: theme.dark }}
                      >
                        <ExternalLink className="w-4 h-4 flex-shrink-0" />
                        {(() => { try { return new URL(profile.website).hostname.replace('www.', ''); } catch { return profile.website ?? ''; } })()}
                      </a>
                    )}
                    {profile.linkedinUrl && (
                      <a
                        href={profile.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Linkedin className="w-4 h-4 text-text-muted flex-shrink-0" /> LinkedIn
                      </a>
                    )}
                    {profile.twitterUrl && (
                      <a
                        href={profile.twitterUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Twitter className="w-4 h-4 text-text-muted flex-shrink-0" /> X / Twitter
                      </a>
                    )}
                  </div>
                ) : isOwner ? (
                  <EmptyPrompt
                    label="Add contact info"
                    onAdd={() => setModal({ kind: 'contact' })}
                  />
                ) : (
                  <EmptyState label="No contact info listed." />
                )}
              </div>
            </Card>
          </div>
      </div>

      {!isOwner && (
        <MyInsightsSection nodeId={nodeId} communityId={currentCommunity?.id} />
      )}

      {modal?.kind === 'basicInfo' && (
        <EditBasicInfoModal open onClose={close} profile={profile} onSave={updateBasicInfo} />
      )}
      {modal?.kind === 'about' && (
        <EditAboutModal open onClose={close} bio={profile.bio} onSave={updateBasicInfo} />
      )}
      {modal?.kind === 'skills' && (
        <EditSkillsModal open onClose={close} tags={profile.tags} onSave={updateBasicInfo} />
      )}
      {modal?.kind === 'contact' && (
        <EditContactModal open onClose={close} profile={profile} onSave={updateBasicInfo} />
      )}
    </>
  );
}
