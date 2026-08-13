'use client';

/**
 * The page for a non-person directory node under one of the retired
 * organisation id spellings (`group:`, `org:`, `organization:`, `company:`) or
 * a legacy prefix-less directory row — plus any space-invented type that
 * routes here.
 *
 * This is deliberately NOT a profile. It used to be `NodeProfileContent`, a
 * near-copy of the person profile: a silhouette avatar card, a "Connections"
 * stat, "Skills & interests" chips, a Connect CTA and a "Member since" line —
 * all of which describe a person and read as nonsense on a company. Only people
 * have profiles; an organisation has a page. So the hero shows a logo, the stat
 * strip counts people and years, the connection grid became a People section,
 * and the type-specific fields (founded, HQ, members, website) are promoted from
 * a buried "Details" row to the rail.
 *
 * Person nodes keep ProfilePageContent, and events have their own dedicated
 * page. `space:` nodes no longer land here at all — every one of them gets
 * a space page, either /communities/<id> for a space that actually runs
 * here or SpacePageContent for a record. This page survives for the ids
 * that predate that type.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { MapPin, Globe2, Share2, Check, ChevronRight, Users } from 'lucide-react';
import { useNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hexToPalette } from '@/lib/profileTheme';
import { findAlias, getNodeGlyph, nodeTypeLabel } from '@/lib/types';
import { fieldsForType, readFields } from '@/lib/create/typeFields';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import Chip from '@/components/ui/Chip';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import TypeSilhouette from '@/components/ui/TypeSilhouette';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import { StatItem, SectionCard, RailCard } from './profileCards';

const hostname = (url?: string | null) => {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
};

/** Status tags are ambient badges elsewhere; keep them out of the tag chips. */
const STATUS_TAGS = ['Building in Public', 'Open to Work', 'Hiring', 'Available', 'Busy'];

/** Rail rows the hero already shows — don't repeat them under "At a glance". */
const HERO_FIELDS = new Set(['subtitle', 'image_url', 'url', 'location']);

interface OrgPageContentProps {
  nodeId: string;
  onConnectionsClick?: () => void;
}

export default function OrgPageContent({ nodeId, onConnectionsClick }: OrgPageContentProps) {
  const { currentSpace } = useSpace();
  const { data, loading, error } = useNodeProfile(nodeId);
  const [copied, setCopied] = useState(false);

  const node = data?.node ?? null;

  // Alias colour wins over the base type colour, same derivation as the chips.
  const theme = useMemo(() => {
    const aliasConfig = findAlias(currentSpace?.aliases, node?.alias, node?.type ?? '');
    const color = aliasConfig?.color ?? getTypeColor(node?.type ?? 'Space', currentSpace?.nodeTypes);
    return hexToPalette(color);
  }, [currentSpace?.aliases, currentSpace?.nodeTypes, node?.alias, node?.type]);

  const sharePage = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  if (loading && !data) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !node) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="text-5xl">😕</div>
        <p className="text-base font-semibold text-text-primary">Page not found</p>
        <p className="text-sm text-text-muted">This entity may have been removed or the URL is incorrect.</p>
      </div>
    );
  }

  const { connectionCount, connections } = data!;
  const about = node.metadata?.bio as string | undefined;
  const tags = (node.tags ?? []).filter(
    (tag) => !STATUS_TAGS.some((s) => tag.toLowerCase().includes(s.toLowerCase())),
  );

  // The type's own fields (Founded, Members, HQ, Website for a Group) — the real
  // facts about an organisation, so they lead in the rail instead of hiding in a
  // "Details" card at the bottom.
  const fieldValues = readFields(node);
  const railFields = fieldsForType(node.type).filter(
    (f) => !HERO_FIELDS.has(f.key) && fieldValues[f.key],
  );
  const founded = fieldValues.founded;

  // People linked to this org. Everything else stays a plain "Related" grid —
  // a company's connections are its people first.
  const people = connections.filter((c) => getNodeGlyph(c.type) === 'person');
  const related = connections.filter((c) => getNodeGlyph(c.type) !== 'person');
  const glyph = getNodeGlyph(node.type);

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ HERO — logo card beside the identity card ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* logo card — an org's mark, never a person silhouette. Contained, not
            cropped: a logo with whitespace must not be zoomed to fill. */}
        <div className="relative w-48 h-48 sm:w-60 sm:h-auto flex-none rounded-2xl overflow-hidden bg-surface-1 border border-border-subtle shadow-soft">
          {node.image_url ? (
            <img src={node.image_url} alt={node.name} className="w-full h-full object-contain p-4" />
          ) : glyph && glyph !== 'person' ? (
            <TypeSilhouette glyph={glyph} color={theme.base} />
          ) : (
            // Only reachable for a space-invented type with no glyph.
            <PersonSilhouette color={theme.base} />
          )}
        </div>

        {/* identity card */}
        <section className="flex-1 min-w-0 bg-surface-1 border border-border-subtle rounded-2xl shadow-soft px-5 sm:px-8 py-5 sm:py-6 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto pb-5">
            <div className="min-w-0 flex-1">
              <Chip tone="soft" color={theme.base}>
                {nodeTypeLabel(node.type, node.alias, currentSpace?.aliases, currentSpace?.nodeTypes)}
              </Chip>

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
              </div>
            </div>

            {/* Share only. "Connect" belongs on a person — you don't send a warm
                intro request to a company. */}
            <div className="flex-none">
              <button onClick={sharePage}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-[13px] font-semibold bg-surface-1 text-text-secondary border border-border-default hover:bg-surface-2 hover:text-text-primary transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
              </button>
            </div>
          </div>

          {/* stat strip — people and provenance, not "connections since" */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <StatItem value={people.length} label={people.length === 1 ? 'Person' : 'People'}
                      onClick={people.length > 0 ? onConnectionsClick : undefined} accent={theme.dark} />
            {founded && (
              <span className="inline-flex items-baseline gap-1.5">
                <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{founded}</b>
                <span className="text-[13px] text-text-muted">Founded</span>
              </span>
            )}
          </div>
        </section>
      </div>

      {/* ══ TWO-COLUMN BODY ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_320px] gap-5 xl:gap-6">
        {/* MAIN */}
        <div className="min-w-0 flex flex-col gap-5">
          <SectionCard id="about" title="About">
            {about
              ? <p className="text-[15px] text-text-secondary leading-relaxed whitespace-pre-line max-w-[72ch]">{about}</p>
              : <p className="text-sm text-text-muted italic">No description yet.</p>}
          </SectionCard>

          {people.length > 0 && (
            <SectionCard id="people" title="People" badge={people.length}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {people.slice(0, 12).map((person) => (
                  <Link key={person.id} href={`/directory/${encodeURIComponent(person.id)}`}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-2 transition-colors">
                    <span className="w-10 h-10 flex-none rounded-xl overflow-hidden">
                      {person.image_url
                        ? <img src={person.image_url} alt={person.name} className="w-full h-full object-cover" />
                        : <PersonSilhouette color={getTypeColor(person.type, currentSpace?.nodeTypes)} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-text-primary truncate">{person.name}</span>
                      {person.subtitle && (
                        <span className="block text-xs text-text-muted truncate">{person.subtitle}</span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
              {people.length > 12 && onConnectionsClick && (
                <button onClick={onConnectionsClick}
                        className="mt-3 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                  +{people.length - 12} more <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </SectionCard>
          )}

          {tags.length > 0 && (
            <SectionCard id="tags" title="Tags">
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <Chip key={tag} tone="soft" size="lg" color={theme.base}
                        className="chip-pop transition-transform duration-150 hover:-translate-y-0.5"
                        style={{ animationDelay: `${Math.min(i, 20) * 35}ms` }}>
                    {tag}
                  </Chip>
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
              {railFields.map((field) => (
                <KV key={field.key}
                    icon={<Users className="w-4 h-4" />}
                    label={field.label}
                    value={fieldValues[field.key]} />
              ))}
            </div>
          </RailCard>

          {related.length > 0 && (
            <RailCard title="Related">
              <div className="grid grid-cols-4 gap-2">
                {related.slice(0, 8).map((conn) => {
                  const connGlyph = getNodeGlyph(conn.type);
                  const color = getTypeColor(conn.type, currentSpace?.nodeTypes);
                  return (
                    <Link key={conn.id} href={`/directory/${encodeURIComponent(conn.id)}`}
                          title={conn.name} className="block hover:-translate-y-0.5 transition">
                      {conn.image_url ? (
                        <img src={conn.image_url} alt={conn.name} className="w-full aspect-square rounded-2xl object-cover" />
                      ) : (
                        <span className="block w-full aspect-square rounded-2xl overflow-hidden">
                          {connGlyph && connGlyph !== 'person'
                            ? <TypeSilhouette glyph={connGlyph} color={color} />
                            : <PersonSilhouette color={color} />}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
              {connectionCount > people.length + 8 && onConnectionsClick && (
                <button onClick={onConnectionsClick}
                        className="mt-3 flex items-center gap-1 text-[13px] font-bold hover:underline" style={{ color: theme.dark }}>
                  +{connectionCount - people.length - 8} more <ChevronRight className="w-3.5 h-3.5" />
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
