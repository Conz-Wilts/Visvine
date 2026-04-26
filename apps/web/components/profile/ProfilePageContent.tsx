'use client';

/**
 * ProfilePageContent — full-page profile redesign.
 *
 * Design language:
 *  • Immersive hero: full-width gradient banner whose color is set by the
 *    profile's chosen theme palette, with the avatar "bleeding" out of it.
 *  • Theme color system: 8 curated palettes. Saved to person.metadata.themeColor.
 *    The accent color flows through the banner, timeline dots, pill borders,
 *    and CTA buttons — cohesive, not garish.
 *  • Two-column body (main + sidebar) so the page scans quickly without scrolling
 *    an endless single column.
 *  • Experience rendered as a left-bordered timeline (breaks the plain-list
 *    convention) with subtle date-range pills.
 *  • Skills rendered as a weighted pill cloud: alternating sizes create visual
 *    rhythm without being meaningless.
 *  • Connections shown as a horizontal scrollable avatar strip — immediately
 *    shows social proof without navigating away.
 *  • Stat chips float below the avatar row with a translucent glass treatment.
 */

import React, { useState } from 'react';
import {
  MapPin, ExternalLink, Linkedin, Twitter, Phone, Mail,
  Briefcase, GraduationCap, Award, Globe2, Wrench,
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
import ExperienceEntryModal from './edit/ExperienceEntryModal';
import EducationEntryModal from './edit/EducationEntryModal';
import CertificationEntryModal from './edit/CertificationEntryModal';
import LanguageEntryModal from './edit/LanguageEntryModal';
import EditSkillsModal from './edit/EditSkillsModal';
import EditContactModal from './edit/EditContactModal';
import MyInsightsSection from './MyInsightsSection';
import type {
  WorkExperience, Education, Certification, ProfileLanguage,
} from '@/lib/profileTypes';
import { PROFICIENCY_LABELS } from '@/lib/profileTypes';
import { getPalette, hexToPalette } from '@/lib/profileTheme';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { getNodeTypeConfig } from '@/lib/types';
import {
  Card, CardHeader, EmptyPrompt, EmptyState,
  StatChip, ExperienceItem, SkillsPillCloud,
  ConnectionAvatar, BioText, initials, memberSinceYear,
} from './ProfilePrimitives';

// ─── Modal state type ─────────────────────────────────────────────────────────

type ModalState =
  | { kind: 'basicInfo' }
  | { kind: 'about' }
  | { kind: 'experience'; entry?: WorkExperience }
  | { kind: 'education'; entry?: Education }
  | { kind: 'certification'; entry?: Certification }
  | { kind: 'language'; entry?: ProfileLanguage }
  | { kind: 'skills' }
  | { kind: 'contact' }
  | null;

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProfilePageContent({ nodeId }: { nodeId: string }) {
  const { data: session } = useSession();
  const { currentCommunity } = useCommunity();
  const {
    profile, loading, error,
    updateBasicInfo,
    addExperience, updateExperience, deleteExperience,
    addEducation, updateEducation, deleteEducation,
    addCertification, updateCertification, deleteCertification,
    addLanguage, updateLanguage, deleteLanguage,
  } = useProfile(nodeId);

  const { data: nodeData } = useNodeProfile(nodeId);

  const [modal, setModal] = useState<ModalState>(null);
  const close = () => setModal(null);

  const isOwner = !!(session?.user?.nodeId && session.user.nodeId === nodeId);

  // System palette: derived from the community's node-type color for this person.
  // This is the default every user sees until they pick a custom theme.
  const systemPalette = React.useMemo(() => {
    const nodeType = nodeData?.node?.type ?? 'People';
    const typeColor = getNodeTypeConfig(nodeType, currentCommunity?.nodeTypes).color;
    return hexToPalette(typeColor);
  }, [nodeData?.node?.type, currentCommunity?.nodeTypes]);

  const savedThemeId = profile?.metadata?.themeColor as string | undefined;

  // Resolve active theme: saved preference → system default
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
      {/* Completion circle for owner — fixed bottom-right */}
      {isOwner && <ProfileCompletionBanner profile={profile} />}

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <div className="px-6 sm:px-8 pt-6">
        <div className="flex items-stretch gap-6">
          {/* Square avatar */}
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

            {/* Open to work ring */}
            {profile.openToWork && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-surface-1 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-white" />
              </span>
            )}
          </div>

          {/* Identity — name starts at vertical midpoint, stats at bottom */}
          <div className="flex-1 min-w-0 flex flex-col" style={{ minHeight: '225px' }}>
            {/* Top spacer pushes name to middle */}
            <div className="flex-1" />

            {/* Name + pronouns — sits at midpoint */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                {/* Type badge + alias */}
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

            {/* Open to work badge */}
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

            {/* Subtitle */}
            {profile.subtitle ? (
              <p className="mt-1 text-base text-text-secondary leading-snug">{profile.subtitle}</p>
            ) : isOwner ? (
              <button onClick={() => setModal({ kind: 'basicInfo' })} className="mt-1 text-sm hover:underline" style={{ color: theme.dark }}>
                + Add headline
              </button>
            ) : (
              <p className="mt-1 text-base text-text-muted italic">No role listed</p>
            )}

            {/* Location + website */}
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

            {/* CTAs (non-owner) */}
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

            {/* Stat chips — pinned to bottom of avatar height */}
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

      {/* ── BODY — two-column ─────────────────────────────────────────────── */}
      <div className="px-6 sm:px-8 pb-12 pt-6 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">

          {/* About / Bio */}
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

          {/* Work Experience — timeline layout */}
          <Card>
            <CardHeader
              icon={<Briefcase className="w-4 h-4" />}
              title="Experience"
              isOwner={isOwner}
              onAdd={() => setModal({ kind: 'experience' })}
            />
            <div className="px-6 pb-6">
              {profile.workExperience.length > 0 ? (
                <div>
                  {profile.workExperience.map((exp, i) => (
                    <ExperienceItem
                      key={exp.id}
                      exp={exp}
                      isOwner={isOwner}
                      theme={theme}
                      onEdit={() => setModal({ kind: 'experience', entry: exp })}
                      isLast={i === profile.workExperience.length - 1}
                    />
                  ))}
                </div>
              ) : isOwner ? (
                <EmptyPrompt
                  label="Add your work experience"
                  onAdd={() => setModal({ kind: 'experience' })}
                />
              ) : (
                <EmptyState label="No work experience added." />
              )}
            </div>
          </Card>

          {/* Education */}
          <Card>
            <CardHeader
              icon={<GraduationCap className="w-4 h-4" />}
              title="Education"
              isOwner={isOwner}
              onAdd={() => setModal({ kind: 'education' })}
            />
            <div className="px-6 pb-6 space-y-4">
              {profile.education.length > 0 ? (
                profile.education.map((edu, i) => (
                  <div key={edu.id} className="group">
                    {i > 0 && <div className="border-t border-border-subtle mb-4" />}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex gap-3 flex-1 min-w-0">
                        <div
                          className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                          style={{ background: theme.light }}
                        >
                          <GraduationCap className="w-4 h-4" style={{ color: theme.base }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary">{edu.school}</p>
                          {(edu.degree || edu.fieldOfStudy) && (
                            <p className="text-sm text-text-secondary">
                              {[edu.degree, edu.fieldOfStudy].filter(Boolean).join(', ')}
                            </p>
                          )}
                          {(edu.startYear || edu.endYear) && (
                            <span
                              className="inline-block mt-1 px-2 py-0.5 text-[11px] font-medium rounded-full"
                              style={{ background: theme.light, color: theme.dark }}
                            >
                              {edu.startYear && edu.endYear
                                ? `${edu.startYear} – ${edu.endYear}`
                                : edu.startYear ? `From ${edu.startYear}` : `Until ${edu.endYear}`}
                            </span>
                          )}
                          {edu.description && (
                            <p className="text-sm text-text-muted mt-1.5 leading-relaxed">
                              {edu.description}
                            </p>
                          )}
                        </div>
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => setModal({ kind: 'education', entry: edu })}
                          className="flex-shrink-0 p-1.5 rounded-lg text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : isOwner ? (
                <EmptyPrompt
                  label="Add your education"
                  onAdd={() => setModal({ kind: 'education' })}
                />
              ) : (
                <EmptyState label="No education added." />
              )}
            </div>
          </Card>

          {/* Certifications */}
          <Card>
            <CardHeader
              icon={<Award className="w-4 h-4" />}
              title="Certifications"
              isOwner={isOwner}
              onAdd={() => setModal({ kind: 'certification' })}
            />
            <div className="px-6 pb-6 space-y-4">
              {profile.certifications.length > 0 ? (
                  profile.certifications.map((cert, i) => (
                    <div key={cert.id} className="group">
                      {i > 0 && <div className="border-t border-border-subtle mb-4" />}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-3 flex-1 min-w-0">
                          <div
                            className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                            style={{ background: theme.light }}
                          >
                            <Award className="w-4 h-4" style={{ color: theme.base }} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-text-primary">{cert.name}</p>
                            <p className="text-sm text-text-secondary">{cert.issuingOrg}</p>
                            {cert.issueDate && (
                              <span
                                className="inline-block mt-1 px-2 py-0.5 text-[11px] font-medium rounded-full"
                                style={{ background: theme.light, color: theme.dark }}
                              >
                                Issued {cert.issueDate}{cert.expiryDate ? ` · Expires ${cert.expiryDate}` : ''}
                              </span>
                            )}
                            {cert.credentialUrl && (
                              <a
                                href={cert.credentialUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1.5 flex items-center gap-1 text-xs font-medium hover:underline w-fit"
                                style={{ color: theme.dark }}
                              >
                                <ExternalLink className="w-3 h-3" /> Show credential
                              </a>
                            )}
                          </div>
                        </div>
                        {isOwner && (
                          <button
                            onClick={() => setModal({ kind: 'certification', entry: cert })}
                            className="flex-shrink-0 p-1.5 rounded-lg text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : isOwner ? (
                  <EmptyPrompt
                    label="Add a certification"
                    onAdd={() => setModal({ kind: 'certification' })}
                  />
                ) : (
                  <EmptyState label="No certifications added." />
                )}
              </div>
            </Card>
          </div>

        {/* ── RIGHT COLUMN (sidebar) ───────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Skills pill cloud */}
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

          {/* Connections strip */}
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

          {/* Contact info */}
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

          {/* Languages */}
          <Card>
            <CardHeader
              icon={<Globe2 className="w-4 h-4" />}
              title="Languages"
              isOwner={isOwner}
              onAdd={() => setModal({ kind: 'language' })}
            />
            <div className="px-6 pb-6">
                {profile.languages.length > 0 ? (
                  <div className="space-y-2">
                    {profile.languages.map((lang) => (
                      <div key={lang.id} className="group flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ background: theme.base }}
                          />
                          <span className="text-sm font-medium text-text-primary">{lang.language}</span>
                          <span className="text-xs text-text-muted">
                            {PROFICIENCY_LABELS[lang.proficiency] ?? lang.proficiency}
                          </span>
                        </div>
                        {isOwner && (
                          <button
                            onClick={() => setModal({ kind: 'language', entry: lang })}
                            className="p-1 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-2 transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : isOwner ? (
                  <EmptyPrompt
                    label="Add a language"
                    onAdd={() => setModal({ kind: 'language' })}
                  />
                ) : (
                  <EmptyState label="No languages listed." />
                )}
              </div>
            </Card>
          </div>
      </div>

      {/* ── MY INSIGHTS (private layer) ────────────────────────────────────── */}
      {!isOwner && (
        <MyInsightsSection nodeId={nodeId} communityId={currentCommunity?.id} />
      )}

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}
      {modal?.kind === 'basicInfo' && (
        <EditBasicInfoModal open onClose={close} profile={profile} onSave={updateBasicInfo} />
      )}
      {modal?.kind === 'about' && (
        <EditAboutModal open onClose={close} bio={profile.bio} onSave={updateBasicInfo} />
      )}
      {modal?.kind === 'experience' && (
        <ExperienceEntryModal
          open onClose={close} entry={modal.entry}
          onSave={modal.entry ? (d) => updateExperience(modal.entry!.id, d) : addExperience}
          onDelete={modal.entry ? () => deleteExperience(modal.entry!.id) : undefined}
        />
      )}
      {modal?.kind === 'education' && (
        <EducationEntryModal
          open onClose={close} entry={modal.entry}
          onSave={modal.entry ? (d) => updateEducation(modal.entry!.id, d) : addEducation}
          onDelete={modal.entry ? () => deleteEducation(modal.entry!.id) : undefined}
        />
      )}
      {modal?.kind === 'certification' && (
        <CertificationEntryModal
          open onClose={close} entry={modal.entry}
          onSave={modal.entry ? (d) => updateCertification(modal.entry!.id, d) : addCertification}
          onDelete={modal.entry ? () => deleteCertification(modal.entry!.id) : undefined}
        />
      )}
      {modal?.kind === 'language' && (
        <LanguageEntryModal
          open onClose={close} entry={modal.entry}
          onSave={modal.entry ? (d) => updateLanguage(modal.entry!.id, d) : addLanguage}
          onDelete={modal.entry ? () => deleteLanguage(modal.entry!.id) : undefined}
        />
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
