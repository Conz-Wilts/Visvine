'use client';

/**
 * The page for a Space node that is a RECORD — a space, company or
 * organisation kept in someone else's graph for CRM purposes, with no
 * Space row of its own behind it.
 *
 * Every Space node reads as a space page; only the data source differs.
 * A node standing for a space that actually runs here (its own root node, or
 * a record carrying `metadata.spaceRef`) is sent to /communities/<id> by
 * SpaceRoute and renders from the overview API. Everything else lands here
 * and renders from the node — same visual language as that page (cover, hero
 * avatar, Space badge, stat strip, About, At-a-glance rail) so the two are
 * recognisably the same kind of page rather than a space page and an
 * "Overview" that happens to describe an organisation.
 *
 * The differences from /communities/<id> are all absences, not substitutions:
 * there is no membership here, so no join/leave, no member rail, no events or
 * resources strip. What a record does have — the people linked to it in this
 * graph, its tags, its type fields — takes those slots.
 *
 * OrgPageContent still serves the retired org id spellings (`group:`, `org:`,
 * `company:`, and the prefix-less legacy directory rows).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarIcon, CheckIcon, ChevronRightIcon, EarthIcon, MapPinIcon, Share2Icon, SparklesIcon, UsersIcon } from '@/features/shared/icons';
import { useNodeProfile } from '@/features/shared/hooks/useNodeProfile';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hexToPalette } from '@/lib/profileTheme';
import { findAlias, getNodeGlyph, nodeTypeLabel } from '@/lib/types';
import { fieldsForType, readFields } from '@/lib/create/typeFields';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { getInitials } from '@/lib/avatarUtils';
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

/** Rail rows the hero or the stat strip already shows — don't repeat them. */
const HERO_FIELDS = new Set(['subtitle', 'image_url', 'url', 'location', 'founded', 'memberCount']);

interface SpacePageContentProps {
  nodeId: string;
  onConnectionsClick?: () => void;
}

export default function SpacePageContent({ nodeId, onConnectionsClick }: SpacePageContentProps) {
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
        <div className="text-5xl">🏘️</div>
        <p className="text-base font-semibold text-text-primary">Space not found</p>
        <p className="text-sm text-text-muted">It may have been removed, or the URL is incorrect.</p>
      </div>
    );
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
      {/* ══ COVER + HERO — the space page's shape. The cover keeps a soft
          radius because it is an image band inside the pane's gutter; nothing
          frames it. ══ */}
      <section>
        <div className="relative h-36 sm:h-44 rounded-lg overflow-hidden" style={{ background: `linear-gradient(120deg, ${theme.base}, ${theme.dark})` }}>
          <div className="absolute inset-0 opacity-30"
               style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.25) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }} />
          <div className="absolute top-4 right-4 z-10">
            <button onClick={sharePage}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-black/25 text-white text-xs font-semibold backdrop-blur hover:bg-black/35 transition">
              {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <Share2Icon className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Share'}
            </button>
          </div>
        </div>

        <div className="relative px-5 sm:px-8 pb-5">
          <div className="absolute -top-14 left-5 sm:left-8">
            {/* Contained, not cropped: a logo with whitespace must not be zoomed
                to fill, so the object-fit differs from the member-space page
                whose image is a cover photo. */}
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl overflow-hidden bg-surface-1"
                 style={{ boxShadow: '0 0 0 5px var(--surface-1, #fff), 0 10px 30px rgba(0,0,0,.18)' }}>
              {node.image_url ? (
                <img src={node.image_url} alt={node.name} className="w-full h-full object-contain p-3" />
              ) : glyph && glyph !== 'person' ? (
                <TypeSilhouette glyph={glyph} color={theme.base} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-3xl font-bold font-open-sauce"
                     style={{ background: `linear-gradient(135deg, ${theme.base}, ${theme.dark})` }}>
                  {getInitials(node.name)}
                </div>
              )}
            </div>
          </div>

          <div className="pt-[4.5rem] sm:pt-20 flex flex-col">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <Chip tone="solid" size="md" color={theme.base}>{typeLabel}</Chip>
              {node.location && (
                <Chip tone="muted" size="md">
                  <MapPinIcon className="w-3 h-3" /> {node.location}
                </Chip>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold text-text-primary leading-tight font-open-sauce">{node.name}</h1>
            {node.subtitle && <p className="mt-1.5 text-[15px] sm:text-base text-text-secondary max-w-[60ch]">{node.subtitle}</p>}

            {node.url && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-text-muted">
                <a href={node.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                  <EarthIcon className="w-3.5 h-3.5" />{hostname(node.url)}
                </a>
              </div>
            )}

            {/* stat strip — what this graph knows, plus what the record claims */}
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2 mt-5 pt-4 border-t border-border-subtle">
              <StatItem value={people.length} label={people.length === 1 ? 'Person' : 'People'}
                        onClick={people.length > 0 ? onConnectionsClick : undefined} accent={theme.dark} />
              {statedMembers && (
                <span className="inline-flex items-baseline gap-1.5">
                  <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{statedMembers}</b>
                  <span className="text-[13px] text-text-muted">Members</span>
                </span>
              )}
              {founded && (
                <span className="inline-flex items-baseline gap-1.5">
                  <b className="text-[15px] font-bold font-open-sauce text-text-primary tabular-nums">{founded}</b>
                  <span className="text-[13px] text-text-muted">Founded</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

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
          <RailCard title="At a glance">
            <div className="flex flex-col gap-3">
              {node.location && <KV icon={<MapPinIcon className="w-4 h-4" />} label="HQ" value={node.location} />}
              {node.url && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="text-text-muted mt-0.5 flex-none"><EarthIcon className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <div className="text-xs text-text-muted">Website</div>
                    <a href={node.url} target="_blank" rel="noopener noreferrer"
                       className="font-semibold hover:underline truncate block" style={{ color: theme.dark }}>{hostname(node.url)}</a>
                  </div>
                </div>
              )}
              {statedMembers && <KV icon={<UsersIcon className="w-4 h-4" />} label="Members" value={statedMembers} />}
              {founded && <KV icon={<CalendarIcon className="w-4 h-4" />} label="Founded" value={founded} />}
              {railFields.map((field) => (
                <KV key={field.key}
                    icon={<SparklesIcon className="w-4 h-4" />}
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
                  +{connectionCount - people.length - 8} more <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </RailCard>
          )}

          {/* The network teaser the member space page carries, minus the
              link: a record has no workspace of its own to explore. */}
          <RailCard title="In this network">
            <NetworkPreview base={theme.base} dark={theme.dark} light={theme.light} />
            <p className="mt-3 text-[13px] text-text-muted">
              {connectionCount === 0
                ? 'Nothing links to this yet.'
                : `${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'} in ${currentSpace?.name ?? 'this space'}.`}
            </p>
          </RailCard>
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

/** Decorative node-cluster illustration in theme colors — mirrors the one on
 *  /communities/<id> so the two pages read as the same family. */
function NetworkPreview({ base, dark, light }: { base: string; dark: string; light: string }) {
  const nodes = [
    { x: 30, y: 38, r: 9 }, { x: 75, y: 22, r: 6 }, { x: 128, y: 40, r: 8 },
    { x: 58, y: 70, r: 7 }, { x: 105, y: 78, r: 5 }, { x: 160, y: 66, r: 7 },
    { x: 190, y: 30, r: 5 }, { x: 215, y: 72, r: 6 },
  ];
  const links: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 4], [2, 6], [4, 5], [5, 7], [6, 7]];
  return (
    <div className="rounded-xl overflow-hidden border border-border-subtle" style={{ background: light }}>
      <svg viewBox="0 0 240 100" className="w-full h-auto block" aria-hidden="true">
        {links.map(([a, b], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
                stroke={base} strokeOpacity="0.45" strokeWidth="1.5" />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={i % 3 === 0 ? dark : base} fillOpacity={i % 3 === 0 ? 0.9 : 0.75} />
        ))}
      </svg>
    </div>
  );
}
