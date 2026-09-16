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
import { useParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
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
  entityKindOfDir,
  entityOwnerPathOf,
  parseEntityHref,
  resolveEntityOwner,
} from '@/lib/notes/entities';
import { directoryTabs, directoryViewHref, isDirectoryView } from '@/lib/directory/views';

// A non-entity note is still a Context note. Raw is not a tab here — it is the
// bar's trailing Raw toggle (PaneTabBar, `rawToggle`), sitting beside
// Connections, and flipping it swaps the editor's mode in place.
const NOTE_TABS: PaneTabItem[] = [{ id: 'context', label: 'Context' }];

// A context note keeps the Directory's FULL tab set in the bar — Grid, Table
// and Resources stay one click away wherever you are in the tree, and Context
// reads as a sibling view of the grid rather than a place you left it for.
// Only a Tool-owned type page drops them: its own tab is the page, and the
// note is the tab beside it.
const DIRECTORY_TABS: PaneTabItem[] = directoryTabs();

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
  const router = useSpaceRouter();
  const { releaseDockNow } = useContextPanel();
  const { currentSpace } = useSpace();
  const raw = params.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const notePath = segments.map((s) => decodeURIComponent(String(s))).join('/');
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

  // What crossing to the Table opens: the namespace this note sits in, so
  // leaving `people/craig/index.md` — or the `people/` index itself — for the
  // Table lands on the People table. A note outside any entity namespace
  // (`deals/q1.md`) names no type and the Table picks its own.
  const carriedType = useMemo(() => entityKindOfDir(notePath), [notePath]);

  const handleSelect = useCallback(
    (id: string) => {
      if (isDirectoryView(id)) {
        // Same immediate dock release the Directory's own view tabs do: these
        // are terminal states for the docked tree, so the grace would only hold
        // the closing panel over content already animating in.
        releaseDockNow();
        router.push(directoryViewHref(id, carriedType));
        return;
      }
      if (id === 'raw') {
        // The bar's trailing Raw toggle, not a tab: flip the editor mode.
        setTab((prev) => ((prev ?? 'context') === 'raw' ? 'context' : 'raw'));
        return;
      }
      setTab(id === TOOL_TAB_ID ? TOOL_TAB_ID : 'context');
    },
    [releaseDockNow, router, carriedType],
  );

  // The tab is named after the TYPE, not the Tool: this is the page for a deal,
  // the way the first tab on a person is "Profile" rather than the name of
  // whatever renders it.
  const typeLabel = noteType ? getNodeTypeConfig(noteType, currentSpace?.nodeTypes).name : '';
  const tabs = toolPage ? [{ id: TOOL_TAB_ID, label: typeLabel }, ...NOTE_TABS] : DIRECTORY_TABS;

  const onToolTab = !pending && activeTab === TOOL_TAB_ID && toolPage !== null;
  usePaneChrome({
    tabs: redirecting ? null : tabs,
    // Raw is a mode, not a tab, so the Context tab stays the selected one while
    // raw is on — the trailing toggle carries its own underline.
    activeId: redirecting ? null : pending || activeTab === 'raw' ? 'context' : activeTab,
    onSelect: handleSelect,
    // The Raw toggle rides the bar only while the note editor is the surface —
    // a Tool's page has no editor mode to flip.
    rawToggle: !redirecting && !pending && !onToolTab,
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
