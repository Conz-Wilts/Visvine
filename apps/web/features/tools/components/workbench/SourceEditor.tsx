'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@visvine/ui';
import type { BuildSummary } from '@/lib/tools/builds';
import BuildDiagnostics from '../BuildDiagnostics';

const INDENT = '  ';

/**
 * One of a Tool's files, as text: a monospace editor that keeps a two-space
 * indent on Tab and saves on ⌘S, over the build's diagnostics for this file.
 * A save is `writeToolFile` — the same write, and the same compile, an
 * authoring agent's `write_tool` makes.
 */
export default function SourceEditor({
  file,
  value,
  dirty,
  saving,
  build,
  cursor,
  onChange,
  onCursor,
  onSave,
}: {
  file: string;
  value: string;
  dirty: boolean;
  saving: boolean;
  build: BuildSummary | null;
  /** Where to put the caret when the editor opens — after an inserted snippet, say. */
  cursor: number | null;
  onChange: (value: string) => void;
  onCursor: (at: number) => void;
  onSave: () => void;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (cursor === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(cursor, cursor);
  }, [cursor, file]);

  // Only this file's lines — the rest belong to the other tabs.
  const ownBuild: BuildSummary | null = build
    ? {
        ...build,
        configError: file === 'index.md' ? build.configError : null,
        errors: build.errors.filter((d) => d.file === file),
        warnings: build.warnings.filter((d) => d.file === file),
      }
    : null;
  const hasDiagnostics = !!ownBuild && (!!ownBuild.configError || ownBuild.errors.length > 0 || ownBuild.warnings.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        ref={area}
        value={value}
        spellCheck={false}
        aria-label={file}
        onChange={(e) => onChange(e.target.value)}
        onSelect={(e) => onCursor(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave();
            return;
          }
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = `${value.slice(0, start)}${INDENT}${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => el.setSelectionRange(start + INDENT.length, start + INDENT.length));
          }
        }}
        className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-[12.5px] leading-[1.6] text-fg outline-none"
      />
      {hasDiagnostics && (
        <div className="max-h-44 overflow-y-auto border-t border-line-subtle px-5 py-3">
          <BuildDiagnostics build={ownBuild} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-5 py-2.5">
        <span className="font-mono text-[11px] text-fg-muted">{saving ? 'saving' : dirty ? 'unsaved' : 'saved'}</span>
        <Button size="sm" variant={dirty ? 'brand' : 'ghost'} onClick={onSave} disabled={!dirty || saving} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
