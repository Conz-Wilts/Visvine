'use client';

/**
 * `/t/<slug>` — one installed Tool, filling the main content area.
 *
 * The install is resolved from the space DTO the shell already hydrated with
 * (`useSpace().currentSpace.installedTools`), so there is no fetch here and no
 * second loading state: if the space is loaded, the answer is already known.
 *
 * The pane holds the frame and nothing else. The Tool's name goes into the
 * navbar's centre slot through the shared header context — the same seam
 * /channels uses — rather than a heading inside the pane, because the pane is
 * the Tool's and the chrome is Visvine's. That line is the whole point of the
 * surface: a Tool renders in the main content area and never touches the navbar
 * or the rail (see ToolFrame's sandbox notes for how that is enforced rather
 * than merely intended).
 */

import { useEffect } from 'react';
import Link from '@/features/shared/components/SpaceLink';
import { useHeader } from '@/features/shared/contexts/HeaderContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { canAccessFeature, toolRailKey } from '@/features/shared/lib/features';
import { Skeleton } from '@/components/ui';
import type { SpaceFeatureConfig } from '@/lib/types';
import ToolFrame from './ToolFrame';

export default function ToolPage({ slug }: { slug: string }) {
  const { currentSpace, loading, isAdmin } = useSpace();
  const { setHeaderContent } = useHeader();

  const config = (currentSpace?.featureConfig as SpaceFeatureConfig | undefined) ?? null;
  // Enabled installs only reach the client (lib/tools/installs.ts), so a slug
  // that doesn't resolve here is uninstalled, switched off, or never existed —
  // all one answer to the person looking at the URL.
  const install = (currentSpace?.installedTools ?? []).find((tool) => tool.slug === slug) ?? null;
  // An admin who locked this row on Console → Tools locked the page with it,
  // and a Tool is a node of the DIRECTORY, so a space that holds its directory
  // to admins takes every installed Tool's page down with it — the same rule
  // the bridge enforces for the frame itself
  // (lib/tools/target.ts#forbiddenForTools), so a member can't land on a page
  // whose frame refuses to run. The rail hides the row for a member either way,
  // so the URL must refuse them too.
  const allowed =
    install !== null &&
    canAccessFeature(config, 'directory', isAdmin) &&
    canAccessFeature(config, toolRailKey(install.slug), isAdmin);

  const title = allowed && install ? install.title : null;
  useEffect(() => {
    setHeaderContent(
      title ? (
        <span className="block truncate text-center text-sm font-medium text-fg">{title}</span>
      ) : null,
    );
    return () => setHeaderContent(null);
  }, [title, setHeaderContent]);

  if (loading) return <ToolPageSkeleton />;
  if (!allowed || !install) return <ToolNotFound slug={slug} />;

  return (
    <ToolFrame
      target={{ kind: 'install', installId: install.id }}
      title={install.title}
      mode="page"
      className="h-full"
    />
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
 * The 404 state. Deliberately says nothing about whether a Tool by that slug
 * exists elsewhere — a stale bookmark and a probe get the same page — and points
 * at the marketplace, which is where an answer actually lives.
 */
function ToolNotFound({ slug }: { slug: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md px-6 py-8 text-center">
        <h1 className="text-lg font-semibold text-fg">No tool here</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          This space has no tool at <span className="font-mono text-fg">/t/{slug}</span>. It may have
          been uninstalled or switched off.
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
