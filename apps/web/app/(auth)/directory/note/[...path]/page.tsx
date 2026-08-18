'use client';

// Standalone note view: /directory/note/<path segments> renders any non-entity
// context note (folder indexes, sectors, deals…). The static `note` segment wins
// over the sibling /directory/[nodeId] route, so entity profiles are
// unaffected. Entity notes still open as profile Context tabs — links route
// there via resolveEntityOwner, and a hand-typed (or stale) entity/sub-note URL
// landing here is redirected the same way; this page is everything else.
//
// Thin on purpose: the tab bar, docked tree and NoteContextPanel live in the
// persistent pane shell (directory/layout.tsx). This page owns only the note
// path from the URL and the Context⇄Raw mode, and registers those with the
// shell, so note→note re-points the same panel instead of remounting one.
//
// The one body it renders itself is a Tool-owned type page: when an installed
// Tool owns the page for this note's type, THAT is the note's page — the
// profiles/spaces/events analogy, for a type a member invented. See
// lib/tools/typePages.ts for who is allowed to own what.

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { type NoteMode } from '@/features/notes/components/NoteModeToggle';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { useSpaceContextData } from '@/features/notes/hooks/useSpaceContextData';
import { contextKeys, swrFetch } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import TypePageTab from '@/features/tools/components/TypePageTab';
import { useTypePages } from '@/features/tools/hooks/useTypePages';
import { noteTypeOf } from '@/lib/tools/typePages';
import { getNodeTypeConfig } from '@/lib/types';
import type { NoteMeta } from '@/lib/notes/shared/types';
import type { ToolSubject } from '@/lib/tools/protocol';
import {
  entityContextHref,
  entityOwnerPathOf,
  parseEntityHref,
  resolveEntityOwner,
} from '@/lib/notes/entities';
import { INDEX_BASENAME } from '@/lib/notes/shared/indexNote';

// A non-entity note is still a Context note — same "Context / Raw" top nav an
// entity profile's Context tab gets. The tabs ARE the editor mode.
const NOTE_TABS: PaneTabItem[] = [
  { id: 'context', label: 'Context' },
  { id: 'raw', label: 'Raw' },
];

// The context-root index is where the Directory's Context tab lands, so it keeps
// the Directory's own Grid tab in the bar — Context still reads as a sibling
// view of the grid rather than a place you left it for. Any other note drops
// Grid and shows the plain note bar above.
const ROOT_INDEX_TABS: PaneTabItem[] = [{ id: 'grid', label: 'Grid' }, ...NOTE_TABS];

/** The Tool's page, when one owns this type — the first tab, like Profile. */
const TOOL_TAB_ID = 'tool';

type NoteTab = 'tool' | 'context' | 'raw';

/**
 * This note's entry in the context index — its frontmatter (so we know the type
 * a Tool may have claimed) and its title (so the Tool knows what it is showing).
 *
 * Read off the note LIST rather than the note itself: the docked tree and the
 * note panel already load `contextKeys.list` for every note view, so this costs
 * no request at all, warm or cold. `enabled` keeps it that way in the ordinary
 * case — a space with no Tool owning a type page has nothing to look up.
 */
function useNoteIndexEntry(
  notePath: string,
  enabled: boolean,
): { meta: NoteMeta | null; resolved: boolean } {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [notes, setNotes] = useState<{ spaceId: string; list: NoteMeta[] } | null>(null);

  useEffect(() => {
    if (!enabled || !spaceId) return;
    let cancelled = false;
    const deliver = (list: NoteMeta[]) => {
      if (!cancelled) setNotes({ spaceId, list });
    };
    void swrFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId), (l) => deliver(l.notes)).catch(
      // A context we cannot list is a note we cannot type: fall through to the
      // ordinary note surface rather than holding an empty pane forever.
      () => deliver([]),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, spaceId]);

  // A list from the space we just left answers about the wrong context.
  const list = notes && notes.spaceId === spaceId ? notes.list : null;
  return {
    meta: list?.find((note) => note.path === notePath) ?? null,
    resolved: list !== null,
  };
}

function NoteViewerRoute() {
  const params = useParams();
  const router = useRouter();
  const { releaseDockNow } = useContextPanel();
  const { currentSpace } = useSpace();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
  const isRootIndex = notePath === INDEX_BASENAME;
  const [tab, setTab] = useState<NoteTab | null>(null);

  // An entity note (either form) or a sub-note in an entity folder belongs
  // under the entity's chrome: send it to the profile Context tab. Until the
  // directory has loaded we can't tell whose it is, so an entity-shaped path
  // holds the tree-only chrome rather than flashing the plain note bar first.
  const { entityByPath } = useDirectoryEntities();
  const { loading: entitiesLoading } = useSpaceContextData();
  const owner = resolveEntityOwner(notePath, entityByPath);
  const ownerId = owner?.id ?? null;
  const ownerSub = owner?.subPath ?? null;
  const entityShaped = parseEntityHref(notePath) !== null || entityOwnerPathOf(notePath) !== null;
  const redirecting = ownerId !== null || (entityShaped && entitiesLoading);
  useEffect(() => {
    if (ownerId) router.replace(entityContextHref(ownerId, ownerSub));
  }, [ownerId, ownerSub, router]);

  // Which types this space's Tools draw. Empty in every space that has
  // installed none, which is the case this page is optimised for: no lookup, no
  // extra state, and the chrome below is exactly what it always was.
  const typePages = useTypePages();
  const hasPageClaims = useMemo(
    () => Object.values(typePages).some((claim) => claim.mode === 'page'),
    [typePages],
  );
  const { meta, resolved } = useNoteIndexEntry(notePath, hasPageClaims && !redirecting);
  const noteType = noteTypeOf(meta?.frontmatter);
  const claim = noteType ? (typePages[noteType] ?? null) : null;
  const toolPage = claim?.mode === 'page' ? claim : null;
  // A Tool might own this note's page — we just don't know yet. Hold the tree
  // (the entity routes' own loading chrome) rather than mounting the editor for
  // a note that is about to become a Tool's page.
  const pending = hasPageClaims && !redirecting && !resolved;

  // Switching notes drops back to the default tab — the Tool's page when one
  // owns the type, else Context (wysiwyg), which is what the profile Context tab
  // does across entities.
  useEffect(() => {
    setTab(null);
  }, [notePath]);

  const activeTab: NoteTab = tab ?? (toolPage ? TOOL_TAB_ID : 'context');
  const mode: NoteMode = activeTab === 'raw' ? 'raw' : 'wysiwyg';
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid') {
        // Same immediate dock release the Directory's own Grid tab does: Grid
        // is a terminal state for the docked tree, so the grace would only hold
        // the closing panel over cards already animating in.
        releaseDockNow();
        router.push('/directory');
        return;
      }
      setTab(id === TOOL_TAB_ID ? TOOL_TAB_ID : id === 'raw' ? 'raw' : 'context');
    },
    [releaseDockNow, router],
  );

  // The tab is named after the TYPE, not the Tool: this is the page for a deal,
  // the way the first tab on a person is "Profile" rather than the name of
  // whatever renders it.
  const typeLabel = noteType ? getNodeTypeConfig(noteType, currentSpace?.nodeTypes).name : '';
  const tabs = toolPage
    ? [{ id: TOOL_TAB_ID, label: typeLabel }, ...NOTE_TABS]
    : isRootIndex
      ? ROOT_INDEX_TABS
      : NOTE_TABS;

  const onToolTab = !pending && activeTab === TOOL_TAB_ID && toolPage !== null;
  usePaneChrome({
    tabs: redirecting ? null : tabs,
    activeId: redirecting ? null : pending ? 'context' : activeTab,
    onSelect: handleSelect,
    // Only the wysiwyg editor portals a toolbar into the bar's attached region —
    // Raw is a plain textarea with nothing to put there, and a Tool's page is
    // the Tool's.
    attachedOpen: !redirecting && !pending && activeTab === 'context',
    ariaLabel: 'Note sections',
    // The Tool's page keeps the docked tree (it is still a note you are looking
    // at) but draws no note panel under it — the frame below IS the body.
    surface:
      redirecting || pending || onToolTab
        ? { kind: 'tree-only', notePath }
        : { kind: 'note', path: notePath, mode },
  });

  const subject = useMemo<ToolSubject>(
    () => ({ kind: 'note', path: notePath, type: noteType, title: meta?.title ?? null }),
    [notePath, noteType, meta?.title],
  );

  // Everything but the Tool's page is shell-rendered (PaneSurfaceHost).
  if (!onToolTab || !toolPage) return null;
  return <TypePageTab owner={toolPage.owner} subject={subject} mode="page" />;
}

export default function NoteViewerPage() {
  return (
    <Suspense fallback={null}>
      <NoteViewerRoute />
    </Suspense>
  );
}
