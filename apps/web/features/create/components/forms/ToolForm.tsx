'use client';

import { useCallback, useState } from 'react';
import { createTool } from '@/features/tools/lib/client';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { slugify } from '@/lib/eventUtils';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { FormFooter, fieldClass, useAutoFocus, useCreateSubmit, type InlineFormProps } from './shared';

// Mirrors lib/tools/config.ts: a tool's name is its folder and its node id.
const TOOL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function toolSlug(name: string): string {
  return slugify(name).replace(/_/g, '-').slice(0, 63);
}

/**
 * A Tool: the name that becomes tools/<name>/, a title, and the label of the
 * rail row it may have. The scaffold lands on its preview page, which says
 * what to do next.
 */
export default function ToolForm({ spaceId, onDone }: InlineFormProps) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [railLabel, setRailLabel] = useState('');
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  const slug = toolSlug(name);
  const badName = name.trim().length > 0 && (!slug || !TOOL_NAME_RE.test(slug));

  const run = useCallback(async () => {
    const { tool } = await createTool(spaceId, {
      name: slug,
      title: title.trim() || undefined,
      railLabel: railLabel.trim() || undefined,
    });
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    // Relative on purpose: the route IS the desktop deep-link target.
    return `/tools/preview/${encodeURIComponent(tool.name)}`;
  }, [spaceId, slug, title, railLabel]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        ref={nameRef}
        className={`${fieldClass} font-mono`}
        placeholder="deal-pipeline"
        aria-label="Tool name"
        maxLength={63}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={fieldClass}
        placeholder="Title"
        aria-label="Title"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
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
      <FormFooter
        ready={!!slug && !badName}
        saving={saving}
        error={error ?? (badName ? 'Lower-case letters, digits and hyphens' : null)}
      />
    </form>
  );
}
