'use client';

import { useCallback, useState } from 'react';
import { createTool } from '@/features/tools/lib/client';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { slugify } from '@/lib/eventUtils';
import { fieldClass, SetupSection, useDraftCommit, type DraftKindProps } from './shared';

// Mirrors lib/tools/config.ts: a tool's name is its folder and its node id.
const TOOL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function toolSlug(name: string): string {
  return slugify(name).replace(/_/g, '-').slice(0, 63);
}

/**
 * A Tool: the title above is what it is called, and this surface owns the two
 * names that are not that — the folder it is scaffolded into (tools/<name>/,
 * which is also its node id) and the label of the rail row it may have. The
 * scaffold lands on its preview page, which says what to do next; the Tool's
 * own docs are written there rather than here, so the draft hides its editor.
 */
export default function ToolSetup({ shared, onReadyChange, registerCommit }: DraftKindProps) {
  const { spaceId, title } = shared;
  // Seeded off the title until it is typed into, so naming the Tool names the
  // folder without anyone having to think about slugs.
  const [name, setName] = useState('');
  const [railLabel, setRailLabel] = useState('');

  const slug = toolSlug(name || title);
  const badName = (name || title).trim().length > 0 && (!slug || !TOOL_NAME_RE.test(slug));

  const commit = useCallback(async () => {
    if (badName) throw new Error('Lower-case letters, digits and hyphens');
    const { tool } = await createTool(spaceId, {
      name: slug,
      title: title.trim() || undefined,
      railLabel: railLabel.trim() || undefined,
    });
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    // Relative on purpose: the route IS the desktop deep-link target.
    return `/tools/preview/${encodeURIComponent(tool.name)}`;
  }, [spaceId, slug, title, railLabel, badName]);

  useDraftCommit({ onReadyChange, registerCommit }, !!slug && !badName, commit);

  return (
    <SetupSection label="Where it lives">
      <input
        className={`${fieldClass} font-mono`}
        placeholder={toolSlug(title) || 'deal-pipeline'}
        aria-label="Tool name"
        maxLength={63}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={fieldClass}
        placeholder="Sidebar label"
        aria-label="Sidebar label"
        maxLength={40}
        value={railLabel}
        onChange={(e) => setRailLabel(e.target.value)}
      />
      {slug && !badName && (
        <p className="text-xs text-text-muted">
          <span className="font-mono text-text-secondary">tools/{slug}/</span>
        </p>
      )}
      {badName && <p className="text-xs text-red-600">Lower-case letters, digits and hyphens</p>}
    </SetupSection>
  );
}
