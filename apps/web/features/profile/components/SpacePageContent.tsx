'use client';

/**
 * The page for a Space node that is a RECORD — a space, company or
 * organisation kept in someone else's graph for CRM purposes, with no
 * Space row of its own behind it.
 *
 * Every Space node reads as a space page; only the data source differs.
 * A node standing for a space that actually runs here (its own root node, or
 * a record carrying `metadata.spaceRef`) is sent to /spaces/<id> by
 * SpaceRoute and renders from the overview API. Everything else lands here
 * and renders from the node — same visual language as that page (avatar beside
 * the identity block, Space badge, stat strip, About, Details rail) so the two are
 * recognisably the same kind of page rather than a space page and an
 * "Overview" that happens to describe an organisation.
 *
 * The differences from /spaces/<id> are all absences, not substitutions:
 * there is no membership here, so no join/leave, no member rail, no events or
 * resources strip. What a record does have — the people linked to it in this
 * graph, its tags, its type fields — takes those slots.
 *
 * OrgPageContent still serves the retired org id spellings (`group:`, `org:`,
 * `company:`, and the prefix-less legacy directory rows).
 */

import React, { useMemo } from 'react';
import Image from 'next/image'
import { isOptimizableImageUrl } from '@/lib/mediaUrl'
import { useCopied } from '@/features/shared/hooks/useCopied';
import Link from '@/features/shared/components/SpaceLink';
import { CalendarIcon, CheckIcon, ChevronRightIcon, EarthIcon, MapPinIcon, Share2Icon } from '@/features/shared/icons';
import { useNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hexToPalette } from '@/lib/profileTheme';
import { findAlias, getNodeGlyph, nodeTypeLabel } from '@/lib/types';
import { fieldsForType, readFields } from '@/lib/types/typeFields';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { getInitials } from '@/lib/avatarUtils';
import Chip from '@/components/ui/Chip';
import PersonSilhouette from '@/components/ui/PersonSilhouette';
import TypeSilhouette from '@/components/ui/TypeSilhouette';
import PageError from '@/components/ui/PageError';
import ProfileSkeletonLoader from './ProfileSkeletonLoader';
import { StatItem, SectionCard, RailCard, hostname } from './profileCards';

/** Status tags are ambient badges elsewhere; keep them out of the tag chips. */
const STATUS_TAGS = ['Building in Public', 'Open to Work', 'Hiring', 'Available', 'Busy'];

/** Rail rows the hero or the stat strip already shows — don't repeat them. */
const HERO_FIELDS = new Set(['subtitle', 'image_url', 'url', 'location', 'founded', 'memberCount']);

interface SpacePageContentProps {
  nodeId: string;
  onConnectionsClick?: () => void;
}

export default function SpacePageContent({ nodeId, onConnectionsClick }: SpacePageContentProps) {
  const { currentSpace } = useSpace();
  const { data, loading, error, reload } = useNodeProfile(nodeId);
  const [copied, copy] = useCopied();

  const node = data?.node ?? null;

  // Alias colour wins over the base type colour, same derivation as the chips.
  const theme = useMemo(() => {
    const aliasConfig = findAlias(currentSpace?.aliases, node?.alias, node?.type ?? '');
    const color = aliasConfig?.color ?? getTypeColor(node?.type ?? 'Space', currentSpace?.nodeTypes);
    return hexToPalette(color);
  }, [currentSpace?.aliases, currentSpace?.nodeTypes, node?.alias, node?.type]);

  const sharePage = () => { void copy(window.location.href); };

  if (loading && !data) return <ProfileSkeletonLoader mode="fullpage" />;
  if (error || !node) {
    return <PageError message="Couldn't load this space." onRetry={reload} />;
  }

  const { connectionCount, connections } = data!;
  const about = (node.metadata?.bio as string | undefined) ?? undefined;
  const tags = (node.tags ?? []).filter(
    (tag) => !STATUS_TAGS.some((s) => tag.toLowerCase().includes(s.toLowerCase())),
  );

  const fieldValues = readFields(node);
  const railFields = fieldsForType(node.type).filter(
    (f) => !HERO_FIELDS.has(f.key) && fieldValues[f.key],
  );
  const founded = fieldValues.founded;
  // The record's own claim about how big it is — distinct from the people we
  // happen to have linked to it in this graph, so both get a stat.
  const statedMembers = fieldValues.memberCount;

  const people = connections.filter((c) => getNodeGlyph(c.type) === 'person');
  const related = connections.filter((c) => getNodeGlyph(c.type) !== 'person');
  const glyph = getNodeGlyph(node.type);
  const typeLabel = nodeTypeLabel(node.type, node.alias, currentSpace?.aliases, currentSpace?.nodeTypes);

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ IDENTITY HERO — avatar beside the identity block, same shape as
          the profile page and /spaces/<id> ══ */}
      <div className="flex flex-col sm:flex-row gap-5 items-stretch">
        {/* Contained, not cropped: a logo with whitespace must not be zoomed
            to fill, so the object-fit differs from the member-space page
            whose image is a cover photo. */}
        <div className="relative w-48 h-48 sm:w-60 sm:h-60 aspect-square flex-none rounded-lg overflow-hidden bg-surface-2">
          {node.image_url ? (
            <Image src={node.image_url} alt={node.name} fill sizes="240px" quality={90}
                   unoptimized={!isOptimizableImageUrl(node.image_url)}
                   className="object-contain p-6" />
          ) : glyph && glyph !== 'person' ? (
            <TypeSilhouette glyph={glyph} color={theme.base} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white text-5xl font-bold font-open-sauce"
                 style={{ background: theme.base }}>
              {getInitials(node.name)}
            </div>
          )}
        </div>

        <section className="flex-1 min-w-0 sm:min-h-60 flex flex-col">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 my-auto py-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[26px] sm:text-3xl font-bold text-text-primary leading-tight tracking-tight font-open-sauce">{node.name}</h1>
              <div className="mt-2"><Chip tone="solid" color={theme.base}>{typeLabel}</Chip></div>
              {node.subtitle && <p className="mt-1.5 text-[15px] text-text-secondary max-w-[60ch]">{node.subtitle}</p>}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                {node.location && (
                  <span className="inline-flex items-center gap-1.5"><MapPinIcon className="w-3.5 h-3.5" />{node.location}</span>
                )}
                {node.url && (
                  <a href={node.url} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                    <EarthIcon className="w-3.5 h-3.5" />{hostname(node.url)}
                  </a>
                )}
                {founded && (
                  <span className="inline-flex items-center gap-1.5"><CalendarIcon className="w-3.5 h-3.5" />Founded {founded}</span>
                )}
              </div>
            </div>

            <button onClick={sharePage}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-[13px] font-semibold text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors flex-none">
              {copied ? <CheckIcon className="w-4 h-4" /> : <Share2Icon className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
            </button>
          </div>

          {/* stat strip — what this graph knows, plus what the record claims */}
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 pt-4 border-t border-border-subtle">
            <StatItem value={people.length} label={people.length === 1 ? 'Person' : 'People'}
                      onClick={people.length > 0 ? onConnectionsClick : undefined} accent={theme.dark} />
            <StatItem value={connectionCount} label={connectionCount === 1 ? 'Connection' : 'Connections'}
                      onClick={connectionCount > 0 ? onConnectionsClick : undefined} accent={theme.dark} />
            {statedMembers && (
              <span className="inline-flex items-baseline gap-1.5">
                <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{statedMembers}</b>
                <span className="text-[13px] text-text-muted">Members</span>
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
                  +{people.length - 12} more <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </SectionCard>
          )}

          {tags.length > 0 && (
            <SectionCard id="tags" title="Tags">
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, i) => (
                  <Chip key={tag} tone="solid" size="lg" color={theme.base}
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
          {railFields.length > 0 && (
            <RailCard title="Details">
              <div className="flex flex-col gap-3">
                {railFields.map((field) => (
                  <KV key={field.key} label={field.label} value={fieldValues[field.key]} />
                ))}
              </div>
            </RailCard>
          )}

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
                  +{connectionCount - people.length - 8} more <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </RailCard>
          )}

        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-semibold text-text-primary">{value}</div>
    </div>
  );
}
