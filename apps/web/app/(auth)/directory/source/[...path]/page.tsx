'use client';

// Standalone Context Source view: /directory/source/<path segments> previews a
// non-note source (uploaded csv/markdown/txt) — metadata, ingestion status, and
// extracted text. The slim sibling of /directory/note/<path>: same docked
// context tree, no editor/toolbar (sources aren't editable).

import React, { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { usePaneChrome } from '@/features/shared/contexts/PaneShellContext';

const noop = () => {};

const SourcePreviewPanel = dynamic(
  () => import('@/features/notes/components/SourcePreviewPanel').then((m) => m.SourcePreviewPanel),
  { ssr: false, loading: () => null },
);
const ContextSidebar = dynamic(
  () => import('@/features/notes/components/ContextSidebar').then((m) => m.ContextSidebar),
  { ssr: false, loading: () => null },
);

function SourceViewerRoute() {
  const params = useParams();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const sourcePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  // No tab bar on sources (they aren't editable) — registering explicitly is
  // required under the shell's hold-last-config store, or the previous page's
  // bar and note surface would stay on screen over this one.
  usePaneChrome({ tabs: null, activeId: null, onSelect: noop, attachedOpen: false, surface: null });

  return (
    <div className="profile-enter flex w-full items-start pb-10">
      <ContextSidebar currentPath={sourcePath} />
      <div className="min-w-0 flex-1">
        <SourcePreviewPanel path={sourcePath} />
      </div>
    </div>
  );
}

export default function SourceViewerPage() {
  return (
    <Suspense fallback={null}>
      <SourceViewerRoute />
    </Suspense>
  );
}
