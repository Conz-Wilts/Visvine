'use client';

/**
 * The redesigned "Profile" view for a non-person directory node (org, group,
 * startup, investor, event-less entity …). Mirrors ProfilePageContent's layout —
 * a floating avatar card beside a floating identity card, then a two-column body
 * of section cards + a sticky rail — but is driven by NodeProfileData rather than
 * the person `useProfile` hook. Person nodes keep their own ProfilePageContent.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { MapPin, Globe2, Calendar, Share2, Check, ChevronRight } from 'lucide-react';
import { useNodeProfile } from '@/hooks/useNodeProfile';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { hexToPalette } from '@/lib/profileTheme';
import { findAlias, getNodeGlyph, type NBNode } from '@/lib/types';
import { getTypeColor } from '@/components/dashboard/typeStyles';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import TypeSilhouette from '@/components/ui/TypeSilhouette';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import NodeTypeDetailsSection from './NodeTypeDetailsSection';
import { StatItem, SectionCard, RailCard } from './profileCards';
import CTARow from './CTARow';

const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

/** Status tags render as ambient badges elsewhere; keep them out of the skills chips. */
const STATUS_TAGS = ['Building in Public', 'Open to Work', 'Hiring', 'Available', 'Busy'];

interface NodeProfileContentProps {
  nodeId: string;
  onConnectionsClick?: () => void;
  onCommunitiesClick?: () => void;
}

export default function NodeProfileContent({ nodeId, onConnectionsClick, onCommunitiesClick }: NodeProfileContentProps) {
  const { currentCommunity } = useCommunity();
  const { data, loading, error } = useNodeProfile(nodeId);
  const [copied, setCopied] = useState(false);

  const node = data?.node ?? null;

  // Same theme derivation ProfileHero uses: alias colour wins over the base type colour.
  const theme = useMemo(() => {
    const aliasConfig = findAlias(currentCommunity?.communityAliases, node?.alias, node?.type ?? '');
    const color = aliasConfig?.color ?? getTypeColor(node?.type ?? 'Organization', currentCommunity?.nodeTypes);
    return hexToPalette(color);
  }, [currentCommunity?.communityAliases, currentCommunity?.nodeTypes, node?.alias, node?.type]);

  const shareNode = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  if (loading && !data) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !node) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="text-5xl">😕</div>
        <p className="text-base font-semibold text-text-primary">Profile not found</p>
        <p className="text-sm text-text-muted">This entity may have been removed or the URL is incorrect.</p>
      </div>
    );
  }

  const { connectionCount, communityCount, connections } = data!;
  const bio = node.metadata?.bio as string | undefined;
  const skills = (node.tags ?? []).filter(
    (tag) => !STATUS_TAGS.some((s) => tag.toLowerCase().includes(s.toLowerCase())),
  );
  const memberSince = node.createdAt
    ? new Date(node.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;
  const hasTypeDetails =
    ['Startup', 'Investor', 'Organization', 'Group'].includes(node.type) &&
    Object.keys(node.metadata ?? {}).length > 0;

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ IDENTITY HERO — avatar and identity as separate floating cards ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* avatar card */}
        <div className="relative w-48 h-48 sm:w-60 sm:h-auto flex-none rounded-2xl overflow-hidden bg-surface-1 border border-border-subtle shadow-soft">
          {node.image_url ? (
            <img src={node.image_url} alt={node.name} className="w-full h-full object-cover" />
          ) : (() => {
            const glyph = getNodeGlyph(node.type);
            return glyph && glyph !== 'person'
              ? <TypeSilhouette glyph={glyph} color={theme.base} />
              : <PersonSilhouette color={theme.base} />;
          })()}
        </div>

        {/* identity card */}
        <section className="flex-1 min-w-0 bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 sm:px-8 py-5 sm:py-6 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto pb-5">
            {/* identity */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center h-[22px] px-2 rounded-md text-[11.5px] font-semibold border"
                      style={{ background: `${theme.base}1a`, color: theme.dark, borderColor: `${theme.base}55` }}>
                  {node.alias ?? node.type}
                </span>
              </div>

              <h1 className="mt-1.5 text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{node.name}</h1>

              {node.subtitle && <p className="mt-1.5 text-[15px] text-text-secondary max-w-[60ch]">{node.subtitle}</p>}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                {node.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{node.location}</span>
                )}
                {node.url && (
                  <a href={node.url} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                    <Globe2 className="w-3.5 h-3.5" />{hostname(node.url)}
                  </a>
                )}
                {memberSince && (
                  <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />Since {memberSince}</span>
                )}
              </div>
            </div>

            {/* actions */}
            <div className="flex flex-wrap items-center gap-2 flex-none">
              <button onClick={shareNode}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-[13px] font-semibold bg-surface-1 text-text-secondary border border-border-default hover:bg-surface-2 hover:text-text-primary transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
              </button>
              <CTARow state="idle" nodeName={node.name} />
            </div>
          </div>

          {/* stat strip */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <StatItem value={connectionCount} label={connectionCount === 1 ? 'Connection' : 'Connections'}
                      onClick={connectionCount > 0 ? onConnectionsClick : undefined} accent={theme.dark} />
            <StatItem value={communityCount} label={communityCount === 1 ? 'Community' : 'Communities'}
                      onClick={communityCount > 0 ? onCommunitiesClick : undefined} accent={theme.dark} />
          </div>
        </section>
      </div>

      {/* ══ TWO-COLUMN BODY ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5 xl:gap-6">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          {/* About */}
          <SectionCard id="about" title="About">
            {bio
              ? <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line max-w-[72ch]">{bio}</p>
              : <p className="text-sm text-text-muted italic">No description yet.</p>}
          </SectionCard>

          {/* Type-specific details */}
          {hasTypeDetails && (
            <SectionCard id="details" title="Details">
              <NodeTypeDetailsSection node={node as NBNode} />
            </SectionCard>
          )}

          {/* Skills & interests */}
          {skills.length > 0 && (
            <SectionCard id="skills" title="Skills & interests">
              <div className="flex flex-wrap gap-2">
                {skills.map((tag, i) => (
                  <span key={tag}
                        className="chip-pop px-3 py-1.5 rounded-full text-[13px] font-medium border transition-transform duration-150 hover:-translate-y-0.5"
                        style={{ background: theme.light, color: theme.dark, borderColor: `${theme.base}33`, animationDelay: `${Math.min(i, 20) * 35}ms` }}>
                    {tag}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* RAIL */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-16 self-start">
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {node.location && <KV icon={<MapPin className="w-4 h-4" />} label="Location" value={node.location} />}
              {node.url && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="text-text-muted mt-0.5 flex-none"><Globe2 className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted">Website</div>
                    <a href={node.url} target="_blank" rel="noopener noreferrer"
                       className="font-semibold hover:underline truncate block" style={{ color: theme.dark }}>{hostname(node.url)}</a>
                  </div>
                </div>
              )}
              {memberSince && <KV icon={<Calendar className="w-4 h-4" />} label="Member since" value={memberSince} />}
            </div>
          </RailCard>

          {connections.length > 0 && (
            <RailCard title="Connections">
              <div className="grid grid-cols-4 gap-2">
                {connections.slice(0, 8).map((conn) => (
                  <Link key={conn.id} href={`/directory/${encodeURIComponent(conn.id)}`}
                        title={conn.name} className="block hover:-translate-y-0.5 transition">
                    {conn.image_url ? (
                      <img src={conn.image_url} alt={conn.name} className="w-full aspect-square rounded-2xl object-cover" />
                    ) : (
                      <span className="block w-full aspect-square rounded-2xl overflow-hidden">
                        {(() => {
                          const glyph = getNodeGlyph(conn.type);
                          const color = getTypeColor(conn.type, currentCommunity?.nodeTypes);
                          return glyph && glyph !== 'person'
                            ? <TypeSilhouette glyph={glyph} color={color} />
                            : <PersonSilhouette color={color} />;
                        })()}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
              {connectionCount > 8 && onConnectionsClick && (
                <button onClick={onConnectionsClick}
                        className="mt-3 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                  +{connectionCount - 8} more <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </RailCard>
          )}
        </div>
      </div>
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
