'use client';

/**
 * The Workbench — where a Tool is built, at `/tools/preview/<name>` (and at
 * `/tools/build` before it has a name). The preview page grown up: the files,
 * the builder, the checks and the kit on the left, the working copy running
 * on the right, and Publish on the band.
 *
 * Every save is `writeToolFile`, the same write `write_tool` makes, so an
 * editor here and an agent over MCP never disagree about what a file holds.
 * The builder beside it writes through the same actions as the person, and
 * each file it lands reloads the preview. Someone who can read a Tool but not
 * edit it gets the preview alone (ToolPreview).
 */

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Skeleton } from '@visvine/ui';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useSpace, useSpaceHref } from '@/features/shared/contexts/SpaceContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import BandTabList from '@/features/shared/components/pane/BandTabList';
import { RotateCwIcon } from '@/features/shared/icons';
import { insertSnippet, type CatalogEntry } from '@/lib/tools/catalog';
import type { AuthoredToolView } from '@/lib/tools/api';
import { fetchAuthoredTool, runToolChecks, saveToolFile } from '../../lib/client';
import BuilderPanel from '../builder/BuilderPanel';
import CheckReport from '../CheckReport';
import PublishDialog from '../PublishDialog';
import ToolFrame from '../ToolFrame';
import ToolPreview, { NotBuilding, RunGate } from '../ToolPreview';
import ComponentsPanel from './ComponentsPanel';
import SourceEditor from './SourceEditor';

/** A file of the working copy: the three fixed ones, or a module under src/. */
type SourceFile = string;

/** The files in the order they are read: the interface, its modules, the data layer, the index. */
function filesOf(modules: Record<string, string> | undefined): SourceFile[] {
  return ['ui.tsx', ...Object.keys(modules ?? {}).sort(), 'data.js', 'index.md'];
}

const HANDOFF_KEY = 'pane-top';

export default function Workbench({ name }: { name: string | null }) {
  const { currentSpace, loading: spaceLoading } = useSpace();
  const { user } = useAuth();
  const spaceId = currentSpace?.id ?? null;
  const spaceHref = useSpaceHref();
  const searchParams = useSearchParams();
  const { shellTabsHost, shellTrailHost } = useContextPanel();
  useShellBand(true);

  const [toolName, setToolName] = useState<string | null>(name);
  const toolNameRef = useRef<string | null>(name);
  const [view, setView] = useState<AuthoredToolView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<SourceFile, string>>>({});
  const [stored, setStored] = useState<Partial<Record<SourceFile, string>>>({});
  // What was stored as of the last read, for deciding which drafts are untouched.
  const storedRef = useRef<Partial<Record<SourceFile, string>>>({});
  const [caret, setCaret] = useState<Partial<Record<SourceFile, number>>>({});
  const [placeCaret, setPlaceCaret] = useState<number | null>(null);
  const [saving, setSaving] = useState<SourceFile | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runRequested, setRunRequested] = useState(false);

  const files = useMemo(() => filesOf(view?.tool.modules), [view]);
  const isFile = (id: string): id is SourceFile => files.includes(id);
  const allViews = [
    { id: 'builder', label: 'Builder' },
    ...files.map((file) => ({ id: file, label: file })),
    { id: 'checks', label: 'Checks' },
    { id: 'components', label: 'Components' },
  ];
  const views = toolName ? allViews : allViews.filter((v) => v.id === 'builder');
  const requested = searchParams.get('view');
  const active = views.find((v) => v.id === requested)?.id ?? 'builder';
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', id);
    window.history.replaceState(null, '', `?${params.toString()}`);
  };

  /** Re-read the working copy; a file the person has not touched follows what is stored. */
  const refresh = useCallback(
    async (tool: string) => {
      if (!spaceId) return;
      try {
        const next = await fetchAuthoredTool(spaceId, tool);
        setView(next);
        setLoadError(null);
        const sources: Partial<Record<SourceFile, string>> = {};
        const every: Record<string, string | null> = { ...next.tool.sources, ...next.tool.modules };
        for (const file of filesOf(next.tool.modules)) sources[file] = every[file] ?? '';
        const prev = storedRef.current;
        storedRef.current = sources;
        setStored(sources);
        setDrafts((current) => {
          const merged = { ...current };
          for (const file of filesOf(next.tool.modules)) {
            const untouched = current[file] === undefined || current[file] === prev[file];
            if (untouched) merged[file] = sources[file];
          }
          return merged;
        });
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Could not load this tool');
      }
    },
    [spaceId],
  );

  useEffect(() => {
    if (spaceLoading || !toolName) return;
    void refresh(toolName);
  }, [spaceLoading, toolName, refresh]);

  /** The builder created or wrote a Tool: follow it, and show what landed. */
  const onWorkbench = useCallback(
    (tool: string) => {
      if (tool !== toolNameRef.current) {
        toolNameRef.current = tool;
        setToolName(tool);
        setDrafts({});
        setStored({});
        storedRef.current = {};
        // The page stays mounted (the builder's answer is still streaming);
        // the address becomes the Tool's own, so a reload lands back here.
        window.history.replaceState(null, '', spaceHref(`/tools/preview/${encodeURIComponent(tool)}?view=builder`));
      }
      void refresh(tool);
      setAttempt((n) => n + 1);
    },
    [refresh, spaceHref],
  );

  const dirtyFiles = useMemo(
    () => files.filter((file) => drafts[file] !== undefined && drafts[file] !== stored[file]),
    [files, drafts, stored],
  );

  const save = async (file: SourceFile) => {
    if (!spaceId || !toolName || saving) return;
    setSaving(file);
    try {
      await saveToolFile(spaceId, toolName, file, drafts[file] ?? '');
      storedRef.current = { ...storedRef.current, [file]: drafts[file] ?? '' };
      setStored(storedRef.current);
      await refresh(toolName);
      setAttempt((n) => n + 1);
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not save', tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const insert = (entry: CatalogEntry) => {
    const source = drafts['ui.tsx'] ?? '';
    const next = insertSnippet(source, caret['ui.tsx'] ?? null, entry);
    setDrafts((current) => ({ ...current, 'ui.tsx': next.source }));
    setCaret((current) => ({ ...current, 'ui.tsx': next.cursor }));
    setPlaceCaret(next.cursor);
    select('ui.tsx');
  };

  const check = async () => {
    if (!spaceId || !toolName) return;
    setChecking(true);
    try {
      const res = await runToolChecks(spaceId, toolName);
      setView((current) => (current ? { ...current, checks: res.checks } : current));
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not run the checks', tone: 'error' });
    } finally {
      setChecking(false);
    }
  };

  if (spaceLoading || (toolName && !view && !loadError)) {
    return (
      <div className="flex h-full gap-4 p-6">
        <Skeleton className="h-full w-[44%] rounded-xl" />
        <Skeleton className="h-full flex-1 rounded-xl" />
      </div>
    );
  }
  if (!spaceId) return null;
  // Someone who may read the Tool but not change it gets the preview alone.
  if (toolName && (loadError || (view && !view.canEdit))) {
    return (
      <div className="h-full overflow-y-auto">
        <ToolPreview name={toolName} />
      </div>
    );
  }

  const tool = view?.tool ?? null;
  const build = tool?.build ?? null;
  const report = view?.checks && !view.checks.stale ? view.checks.report : null;
  const blocked = !!report && (report.compatibility.status === 'blocked' || report.security.status === 'blocked');
  const status = !tool ? null : tool.invalid ? 'Config error' : !build ? 'Never built' : !build.ok ? 'Not building' : blocked ? 'Blocked' : 'Builds';
  const runnable = !!tool && !tool.invalid && !!build?.ok;
  const isAuthor = !!user && !!tool && tool.draft.authors.some((author) => author.userId === user.id);

  const tabs = (
    <BandTabList
      tabs={views.map((v) => ({ id: v.id, label: v.label }))}
      activeId={active}
      onSelect={select}
      ariaLabel="Workbench"
      handoffKey={HANDOFF_KEY}
      inBand={!!shellTabsHost}
    />
  );
  const trail = tool ? (
    <div className="flex items-center gap-3 pr-2">
      {status && <span className="whitespace-nowrap text-xs text-fg-muted">{[tool.title, status].join(' · ')}</span>}
      <Button
        size="sm"
        variant="brand"
        onClick={() => setPublishing(true)}
        disabled={!runnable || dirtyFiles.length > 0}
        title={dirtyFiles.length > 0 ? 'Save first' : undefined}
      >
        Publish
      </Button>
    </div>
  ) : null;

  const left = (() => {
    if (active === 'builder' || !toolName) {
      return <BuilderPanel spaceId={spaceId} tool={toolName} onWorkbench={onWorkbench} className="min-h-0 flex-1" />;
    }
    if (isFile(active)) {
      return (
        <SourceEditor
          file={active}
          value={drafts[active] ?? ''}
          dirty={dirtyFiles.includes(active)}
          saving={saving === active}
          build={build}
          cursor={active === 'ui.tsx' ? placeCaret : null}
          onChange={(value) => setDrafts((current) => ({ ...current, [active]: value }))}
          onCursor={(at) => setCaret((current) => ({ ...current, [active]: at }))}
          onSave={() => void save(active)}
        />
      );
    }
    if (active === 'checks') {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-fg-muted">{view?.checks?.stale ? 'out of date' : view?.checks ? 'current' : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => void check()} loading={checking}>
              Check
            </Button>
          </div>
          {view?.checks && <CheckReport report={view.checks.report} />}
        </div>
      );
    }
    return <ComponentsPanel onInsert={insert} />;
  })();

  const preview = !toolName || !tool ? (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-line text-sm text-fg-muted">
      Preview
    </div>
  ) : !runnable ? (
    <NotBuilding tool={tool} />
  ) : isAuthor || runRequested ? (
    <ToolFrame key={attempt} target={{ kind: 'preview', spaceId, name: tool.name }} title={tool.title} mode="preview" />
  ) : (
    <RunGate tool={tool} onRun={() => setRunRequested(true)} />
  );

  return (
    <>
      {shellTabsHost && createPortal(tabs, shellTabsHost)}
      {shellTrailHost && trail && createPortal(trail, shellTrailHost)}
      <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section className="flex min-h-[480px] flex-col border-b border-line-subtle lg:min-h-0 lg:w-[44%] lg:min-w-[380px] lg:border-b-0 lg:border-r">
          {!shellTabsHost && <div className="border-b border-line-subtle px-4">{tabs}</div>}
          {notice && (
            <p className={`border-b border-line-subtle px-5 py-2 text-[13px] ${notice.tone === 'error' ? 'text-danger-strong' : 'text-fg-secondary'}`}>
              {notice.text}
            </p>
          )}
          {left}
        </section>
        <section className="relative min-h-[480px] min-w-0 flex-1 overflow-auto p-4 lg:min-h-0">
          {toolName && runnable && (
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              aria-label="Reload the preview"
              className="absolute right-6 top-6 z-10 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-surface-subtle hover:text-fg"
            >
              <RotateCwIcon className="h-4 w-4" />
            </button>
          )}
          {preview}
        </section>
      </div>
      {publishing && view && (
        <PublishDialog
          view={view}
          spaceId={spaceId}
          onClose={() => setPublishing(false)}
          onDone={(message) => {
            setPublishing(false);
            setNotice({ text: message, tone: 'info' });
            if (toolName) void refresh(toolName);
          }}
        />
      )}
    </>
  );
}
