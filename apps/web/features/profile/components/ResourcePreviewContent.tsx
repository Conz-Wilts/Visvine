'use client';

/**
 * The "Preview" view for a link resource's node: a slim identity header (type
 * pill, name, description, tags, link), then the link drawn by the resources
 * viewer's own stage — a live embed for an allowlisted provider, its card
 * otherwise. Nothing else is ever framed.
 */

import React, { useMemo } from 'react';
import { hostname } from './profileCards';
import { EarthIcon, ExternalLinkIcon, Link2OffIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { hexToPalette } from '@/lib/profileTheme';
import { findAlias, nodeTypeLabel, type NBNode } from '@/lib/types';
import { getTypeColor } from '@/features/directory/components/typeStyles';
import { Chip } from '@visvine/ui';
import InlineResource from '@/features/resources/viewer/InlineResource';
import { fileIdOf } from '@/lib/resources/shared/fileNode';

// A resource created via the modal carries an internal `/slug` url — only an
// absolute http(s) url is a previewable external link.
function externalUrlOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

export default function ResourcePreviewContent({ node }: { node: NBNode }) {
  const { currentSpace } = useSpace();
  const externalUrl = externalUrlOf(node.url);
  const resourceId = fileIdOf(node.metadata);

  // Same theme derivation as OrgPageContent: alias colour wins over type colour.
  const theme = useMemo(() => {
    const aliasConfig = findAlias(currentSpace?.aliases, node.alias, node.type);
    const color = aliasConfig?.color ?? getTypeColor(node.type, currentSpace?.nodeTypes);
    return hexToPalette(color);
  }, [currentSpace?.aliases, currentSpace?.nodeTypes, node.alias, node.type]);

  const bio = node.metadata?.bio as string | undefined;
  const description = bio ?? node.subtitle ?? null;
  const tags = node.tags ?? [];

  return (
    <div className="profile-content-fade flex flex-col gap-5">
      {/* ══ HEADER — resource identity + link actions ══ */}
      <section className="bg-surface border border-line-subtle rounded-2xl px-5 sm:px-8 py-5 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <Chip tone="solid" color={theme.base}>
              {nodeTypeLabel(node.type, node.alias, currentSpace?.aliases, currentSpace?.nodeTypes)}
            </Chip>

            <h1 className="mt-1.5 text-[26px] sm:text-3xl font-bold text-fg leading-tight tracking-tight font-open-sauce">{node.name}</h1>

            {description && <p className="mt-1.5 text-[15px] text-fg-secondary max-w-[72ch] whitespace-pre-line">{description}</p>}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-fg-muted">
              {externalUrl && (
                <a href={externalUrl} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1.5 font-semibold hover:underline" style={{ color: theme.dark }}>
                  <EarthIcon className="w-3.5 h-3.5" />{hostname(externalUrl)}
                </a>
              )}
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {tags.map((tag, i) => (
                  <Chip key={tag} tone="solid" size="lg" color={theme.base}
                        className="chip-pop transition-transform duration-150 hover:-translate-y-0.5"
                        style={{ animationDelay: `${Math.min(i, 20) * 35}ms` }}>
                    {tag}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {externalUrl && (
            <a href={externalUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 flex-none"
               style={{ background: theme.dark }}>
              <ExternalLinkIcon className="w-4 h-4" /> Open site
            </a>
          )}
        </div>
      </section>

      {/* ══ PREVIEW — the viewer's stage ══ */}
      {resourceId ? (
        <InlineResource resourceId={resourceId} className="h-[70vh] overflow-hidden rounded-2xl border border-line-subtle" />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-16 rounded-2xl border border-line-subtle bg-surface text-center">
          <Link2OffIcon className="w-6 h-6 text-fg-muted" />
        </div>
      )}
    </div>
  );
}
