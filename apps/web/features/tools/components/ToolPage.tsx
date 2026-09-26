'use client';

/**
 * `/t/<slug>` — one installed Tool, on its own page in the rail.
 *
 * The rail is the switcher: each installed Tool is its own row beside
 * Directory and Channels, and this page is where it lives. The install is
 * resolved from the space DTO the shell already hydrated with
 * (`useSpace().currentSpace.installedTools`), so there is no fetch and no
 * second loading state.
 *
 * The host draws the chrome, the Tool draws its content. What is always the
 * app's: the band — the Tool's own sections as tabs (`surfaces.nav`,
 * `style: tabs`, the default) or a side list beside the frame (`style: side`),
 * its band buttons (`surfaces.actions`), and the ⋯ menu (About · Report, plus
 * Manage for admins and Edit where it was made) — and every state. A section
 * lives in `?section=` and changes through the native history API, which Next
 * syncs into `useSearchParams` without asking the server for anything — so a
 * tab press never renders the route, remounts the page, re-mints the frame
 * token or reloads the frame: the frame is told with a route message. One
 * section or none draws nothing.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from '@/features/shared/components/SpaceLink';
import { useHeader } from '@/features/shared/contexts/HeaderContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useShellBand } from '@/features/desktop/lib/chrome';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { canAccessFeature, toolRailKey } from '@/features/shared/lib/features';
import { EllipsisIcon } from '@/features/shared/icons';
import { IconButton, Menu, Skeleton, useToasts, ToastHost, type MenuItem } from '@visvine/ui';
import type { SpaceFeatureConfig } from '@/lib/types';
import type { InstalledToolDto } from '@/lib/tools/installs';
import ToolFrame, { ToolStopped } from './ToolFrame';
import ToolAbout from './ToolAbout';
import ToolReport from './ToolReport';
import { ToolActionButtons, ToolSectionTabs, ToolSectionsLayout, useToolSections } from './ToolBand';

export default function ToolPage({ slug }: { slug: string }) {
  const { currentSpace, loading, isAdmin } = useSpace();

  const config = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null;
  // Enabled installs only reach the client (lib/tools/installs.ts), so a slug
  // that doesn't resolve here is uninstalled, switched off, or never existed —
  // all one answer to the person looking at the URL.
  const install = (currentSpace?.installedTools ?? []).find((tool) => tool.slug === slug) ?? null;
  // A row an admin locked is the Tool locked — its page, its type tabs, and
  // every call its frame makes (the bridge refuses the same viewers). A Tool is
  // a node of the Directory, so a space that holds its directory to admins
  // takes every installed Tool's page with it.
  const allowed =
    install !== null &&
    canAccessFeature(config, 'directory', isAdmin) &&
    canAccessFeature(config, toolRailKey(install.slug), isAdmin);

  if (loading) return <ToolPageSkeleton />;
  if (!allowed || !install || !currentSpace) return <ToolNotFound slug={slug} />;
  if (install.stopped) return <ToolStopped title={install.title} reason={install.stopped} />;
  return <InstalledTool install={install} spaceId={currentSpace.id} isAdmin={isAdmin} />;
}

function InstalledTool({ install, spaceId, isAdmin }: { install: InstalledToolDto; spaceId: string; isAdmin: boolean }) {
  const { setHeaderContent } = useHeader();
  const { shellTabsHost, shellTrailHost } = useContextPanel();
  const router = useSpaceRouter();
  const { toasts, push, dismiss } = useToasts();
  const actionRef = useRef<((id: string) => void) | null>(null);
  const [about, setAbout] = useState(false);
  const [report, setReport] = useState(false);

  const nav = useToolSections(install.nav, isAdmin);
  const onBand = nav.onBand;
  useShellBand(true);

  // The band's centre names the Tool when no tabs stand there to say where
  // you are; with tabs, the rail row and the tabs already do.
  const title = onBand ? null : install.title;
  useEffect(() => {
    setHeaderContent(title ? <span className="block truncate text-center text-sm font-medium text-fg">{title}</span> : null);
    return () => setHeaderContent(null);
  }, [title, setHeaderContent]);

  const target = { kind: 'install' as const, installId: install.id };
  const madeHere = install.key.startsWith(`${spaceId}/`);
  const menu: MenuItem[] = [
    { id: 'about', label: 'About', onSelect: () => setAbout(true) },
    ...(madeHere
      ? [{ id: 'edit', label: 'Edit', onSelect: () => router.push(`/tools/preview/${encodeURIComponent(install.name)}`) }]
      : []),
    ...(isAdmin ? [{ id: 'manage', label: 'Manage', onSelect: () => router.push('/admin?section=tools') }] : []),
    { id: 'report', label: 'Report', onSelect: () => setReport(true) },
  ];

  const tabs = onBand ? <ToolSectionTabs nav={nav} title={install.title} /> : null;

  // A Tool from outside the space says where it came from; the space's own does not.
  const provenance = install.provenance
    ? [install.provenance.publisher ? `From ${install.provenance.publisher}` : null, install.provenance.reviewed ? 'reviewed by Visvine' : null]
        .filter(Boolean)
        .join(' · ')
    : '';
  const trail = (
    <div className="flex items-center gap-1 pr-2">
      {provenance && <span className="hidden truncate px-2 text-xs text-fg-muted lg:inline">{provenance}</span>}
      <ToolActionButtons actions={install.actions} onAction={(id) => actionRef.current?.(id)} />
      <Menu
        label={`${install.title} menu`}
        items={menu}
        trigger={({ open, toggle }) => (
          <IconButton size="sm" label={`${install.title} menu`} icon={<EllipsisIcon />} active={open} onClick={toggle} />
        )}
      />
    </div>
  );

  const frame = (
    <ToolFrame
      target={target}
      title={install.title}
      mode="page"
      className="h-full"
      section={nav.active}
      onSection={nav.select}
      actionRef={actionRef}
    />
  );

  return (
    <>
      {tabs && shellTabsHost && createPortal(tabs, shellTabsHost)}
      {shellTrailHost && createPortal(trail, shellTrailHost)}

      <ToolSectionsLayout nav={nav} title={install.title}>
        {frame}
      </ToolSectionsLayout>

      {about && <ToolAbout spaceId={spaceId} installId={install.id} onClose={() => setAbout(false)} />}
      {report && (
        <ToolReport
          target={target}
          title={install.title}
          onClose={() => setReport(false)}
          onDone={() => {
            setReport(false);
            push('success', 'Reported');
          }}
        />
      )}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

function ToolPageSkeleton() {
  return (
    <div className="h-full p-6">
      <Skeleton className="h-full w-full rounded-xl" />
    </div>
  );
}

/**
 * The 404 state. Says nothing about whether a Tool by that slug exists
 * elsewhere — a stale bookmark and a probe get the same page.
 */
function ToolNotFound({ slug }: { slug: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md px-6 py-8 text-center">
        <h1 className="text-lg font-semibold text-fg">No tool here</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          This space has no tool at <span className="font-mono text-fg">/t/{slug}</span>.
        </p>
        <Link
          href="/admin?section=tools"
          className="mt-5 inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Space Console
        </Link>
      </div>
    </div>
  );
}
