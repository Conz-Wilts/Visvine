'use client';

/**
 * A Tool's preview page, at `/tools/preview/<name>` — the link `create_tool`,
 * `write_tool`, `push_tool` and `preview_tool` hand back, so the person an AI
 * built a Tool for can open it and look before anything is published.
 *
 * Tools are made over MCP, from a repo with `visvine-tool`, or from a file;
 * this page only shows what was made: the working copy running exactly as it
 * will on its own page — full bleed, its own sections and band buttons on the
 * band — with its files, its checks and Publish behind one ⋯ menu, so the
 * authoring chrome never takes the band a Tool's own views stand on.
 * Someone who can read the Tool but not edit it gets the preview alone
 * (ToolPreview).
 */

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, IconButton, Menu, Skeleton, type MenuItem } from '@visvine/ui';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import { EllipsisIcon } from '@/features/shared/icons';
import type { AuthoredToolView } from '@/lib/tools/api';
import type { BuildSummary } from '@/lib/tools/builds';
import { fetchAuthoredTool, runToolChecks } from '../lib/client';
import BuildDiagnostics from './BuildDiagnostics';
import CheckReport from './CheckReport';
import PublishDialog from './PublishDialog';
import ToolFrame from './ToolFrame';
import ToolPreview, { NotBuilding, RunGate } from './ToolPreview';
import { ToolActionButtons, ToolSectionTabs, ToolSectionsLayout, useToolSections } from './ToolBand';

/** The files in the order they are read: the interface, its modules, the data layer, the index. */
function filesOf(modules: Record<string, string> | undefined): string[] {
  return ['ui.tsx', ...Object.keys(modules ?? {}).sort(), 'data.js', 'index.md'];
}

/** Only one file's lines of a build — the rest belong to the other tabs. */
function buildFor(build: BuildSummary | null, file: string): BuildSummary | null {
  if (!build) return null;
  return {
    ...build,
    configError: file === 'index.md' ? build.configError : null,
    errors: build.errors.filter((d) => d.file === file),
    warnings: build.warnings.filter((d) => d.file === file),
  };
}

export default function PreviewPage({ name }: { name: string }) {
  const { currentSpace, loading: spaceLoading } = useSpace();
  const { user } = useAuth();
  const { isAdmin } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const searchParams = useSearchParams();
  const { shellTabsHost, shellTrailHost } = useContextPanel();
  useShellBand(true);

  const [view, setView] = useState<AuthoredToolView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runRequested, setRunRequested] = useState(false);
  const actionRef = useRef<((id: string) => void) | null>(null);
  const nav = useToolSections(view?.tool.config?.surfaces.nav, isAdmin);

  const files = useMemo(() => filesOf(view?.tool.modules), [view]);
  const views = [{ id: 'preview', label: 'Preview' }, ...files.map((file) => ({ id: file, label: file })), { id: 'checks', label: 'Checks' }];
  const requested = searchParams.get('view');
  const active = views.find((v) => v.id === requested)?.id ?? 'preview';
  const select = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'preview') params.delete('view');
    else params.set('view', id);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  };

  const refresh = useCallback(async () => {
    if (!spaceId) return;
    try {
      setView(await fetchAuthoredTool(spaceId, name));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load this tool');
    }
  }, [spaceId, name]);

  useEffect(() => {
    if (!spaceLoading) void refresh();
  }, [spaceLoading, refresh]);

  const check = async () => {
    if (!spaceId) return;
    setChecking(true);
    try {
      const res = await runToolChecks(spaceId, name);
      setView((current) => (current ? { ...current, checks: res.checks } : current));
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not run the checks', tone: 'error' });
    } finally {
      setChecking(false);
    }
  };

  if (spaceLoading || (!view && !loadError)) {
    return (
      <div className="h-full p-6">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    );
  }
  if (!spaceId) return null;
  if (loadError || !view || !view.canEdit) {
    return (
      <div className="h-full overflow-y-auto">
        <ToolPreview name={name} />
      </div>
    );
  }

  const tool = view.tool;
  const build = tool.build;
  const report = view.checks && !view.checks.stale ? view.checks.report : null;
  const blocked = !!report && (report.compatibility.status === 'blocked' || report.security.status === 'blocked');
  const status = tool.invalid ? 'Config error' : !build ? 'Never built' : !build.ok ? 'Not building' : blocked ? 'Blocked' : 'Builds';
  const runnable = !tool.invalid && !!build?.ok;
  const isAuthor = !!user && tool.draft.authors.some((author) => author.userId === user.id);
  const sources: Record<string, string | null> = { ...tool.sources, ...tool.modules };

  const inTool = active === 'preview';
  const tabs = inTool ? <ToolSectionTabs nav={nav} title={tool.title} /> : null;
  const menu: MenuItem[] = [
    ...(inTool ? [] : [{ id: 'preview', label: 'Back to the tool', onSelect: () => select('preview') }]),
    ...(inTool && runnable ? [{ id: 'reload', label: 'Reload', onSelect: () => setAttempt((n) => n + 1) }] : []),
    ...files.map((file) => ({ id: file, label: file, onSelect: () => select(file) })),
    { id: 'checks', label: blocked ? 'Checks · blocked' : 'Checks', onSelect: () => select('checks') },
    { id: 'publish', label: 'Publish', onSelect: () => setPublishing(true), disabled: !runnable },
  ];
  const trail = (
    <div className="flex items-center gap-1 pr-2">
      {inTool ? (
        <ToolActionButtons actions={runnable ? (tool.config?.surfaces.actions ?? []) : []} onAction={(id) => actionRef.current?.(id)} />
      ) : (
        <span className="whitespace-nowrap px-2 text-xs text-fg-muted">{[active === 'checks' ? 'Checks' : active, status].join(' · ')}</span>
      )}
      <Menu
        label={`${tool.title} source`}
        items={menu}
        trigger={({ open, toggle }) => (
          <IconButton size="sm" label={`${tool.title} source`} icon={<EllipsisIcon />} active={open} onClick={toggle} />
        )}
      />
    </div>
  );

  const body = (() => {
    if (active === 'checks') {
      return (
        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-fg-muted">{view.checks?.stale ? 'out of date' : view.checks ? 'current' : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => void check()} loading={checking}>
              Check
            </Button>
          </div>
          {view.checks && <CheckReport report={view.checks.report} />}
        </div>
      );
    }
    if (active !== 'preview') {
      return (
        <div className="flex flex-col gap-3 px-6 py-5">
          <BuildDiagnostics build={buildFor(build, active)} />
          <pre className="overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed text-fg">{sources[active] ?? ''}</pre>
        </div>
      );
    }
    if (!runnable) return <NotBuilding tool={tool} />;
    if (!isAuthor && !runRequested) return <RunGate tool={tool} onRun={() => setRunRequested(true)} />;
    return (
      <ToolSectionsLayout nav={nav} title={tool.title}>
        <ToolFrame
          key={attempt}
          target={{ kind: 'preview', spaceId, name: tool.name }}
          title={tool.title}
          mode="page"
          className="h-full"
          section={nav.active}
          onSection={nav.select}
          actionRef={actionRef}
        />
      </ToolSectionsLayout>
    );
  })();

  return (
    <>
      {tabs && shellTabsHost && createPortal(tabs, shellTabsHost)}
      {shellTrailHost && createPortal(trail, shellTrailHost)}
      <div className={inTool ? 'flex h-full min-h-0 flex-col' : 'h-full min-h-0 overflow-y-auto'}>
        {!shellTabsHost && (
          <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4">
            {tabs}
            {trail}
          </div>
        )}
        {notice && (
          <p className={`border-b border-line-subtle px-6 py-2 text-[13px] ${notice.tone === 'error' ? 'text-danger-strong' : 'text-fg-secondary'}`}>
            {notice.text}
          </p>
        )}
        {inTool ? <div className="min-h-0 flex-1">{body}</div> : body}
      </div>
      {publishing && (
        <PublishDialog
          view={view}
          spaceId={spaceId}
          onClose={() => setPublishing(false)}
          onDone={(message) => {
            setPublishing(false);
            setNotice({ text: message, tone: 'info' });
            void refresh();
          }}
        />
      )}
    </>
  );
}
