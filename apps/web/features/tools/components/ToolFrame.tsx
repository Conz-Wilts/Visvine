'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import Link from '@/features/shared/components/SpaceLink';
import { clsx } from 'clsx';
import { RefreshCwIcon } from '@/features/shared/icons';
import { Button, Skeleton } from '@/components/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import type { BridgeTarget, ToolSubject } from '@/lib/tools/protocol';
import { useTheme } from '@/features/shared/contexts/ThemeContext';
import {
  MIN_FRAME_HEIGHT,
  SANDBOXED_FRAME_ORIGIN,
  createHostBridge,
  type FrameTokenResponse,
  type HostBridge,
  type HostInit,
} from '../lib/hostBridge';
import { collectThemeTokens } from '../lib/theme';
import DegradedBanner from './DegradedBanner';
import ToolErrorCard from './ToolErrorCard';

/**
 * How long the frame has to complete its handshake before we flag it as slow.
 * This no longer hides the frame: a working copy that fails to compile is
 * still a real HTML document (`renderFrameErrorDocument`) with the author's
 * diagnostics in it, and the host cannot read the frame's cross-origin DOM to
 * tell that apart from a Tool that is genuinely stuck — so the timeout can
 * only ever add a note next to whatever the frame is showing, never replace it.
 */
const READY_TIMEOUT_MS = 15_000;

/** Breathing room under the frame so it never sits flush on the viewport edge. */
const PANE_BOTTOM_GUTTER = 16;

type Status = 'minting' | 'loading' | 'ready';

/**
 * The Visvine-side host for one Tool. Nothing in this file runs inside the
 * iframe, and nothing inside the iframe can reach past it.
 *
 * The isolation is spelled out in the `sandbox` attribute below and is the whole
 * reason a stranger's code is allowed on the page at all:
 *
 *   • `allow-scripts` and nothing else. No `allow-same-origin`, so the frame has
 *     an opaque origin and can read neither the app's DOM nor its cookie — even
 *     though the document may be served from the app's own host while
 *     `TOOLS_ORIGIN` is unset. No `allow-top-navigation`, so it cannot move the
 *     page out from under the viewer; no `allow-popups`, no `allow-forms`.
 *   • `referrerPolicy="no-referrer"` — the Tool never learns which note the
 *     viewer was on.
 *   • `allow=""` — no camera, microphone, geolocation, or any other
 *     permissions-policy feature, including the ones browsers grant by default.
 *
 * "A Tool renders in the main content area and nowhere else" is enforced here by
 * construction: this component renders one `<iframe>` in its own flow position
 * and never portals, so there is no code path by which a Tool reaches the navbar
 * or the rail. Keep it that way — a portal would make the sandbox the only thing
 * standing between a Tool and the app chrome.
 *
 * Everything the Tool is allowed to *do* lives in `createHostBridge`; everything
 * it is allowed to *see* comes from the mint (server-derived) plus the theme.
 */
export default function ToolFrame({
  target,
  subject = null,
  title,
  mode,
  className,
}: {
  target: BridgeTarget;
  /** What the Tool is being shown about, when it owns a type page. */
  subject?: ToolSubject | null;
  /** The Tool's own name — the iframe's accessible title and the error card's. */
  title: string;
  mode: 'page' | 'tab' | 'preview';
  className?: string;
}) {
  const router = useSpaceRouter();
  const { theme } = useTheme();

  // Bumped by Reload; re-mints the token and remounts the frame from scratch.
  const [attempt, setAttempt] = useState(0);
  const [mint, setMint] = useState<FrameTokenResponse | null>(null);
  const [status, setStatus] = useState<Status>('minting');
  const [error, setError] = useState<string | null>(null);
  // Set once the iframe fires `load` with no handshake yet — the signal that
  // whatever document the frame is showing (the real app, or the compile-error
  // document) has rendered and the skeleton is now just hiding it.
  const [frameLoaded, setFrameLoaded] = useState(false);
  // Set 15s after a `load` that never turned into a handshake. Additive: it
  // never unmounts the frame, only adds a note next to it.
  const [timedOut, setTimedOut] = useState(false);
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  const [paneHeight, setPaneHeight] = useState(MIN_FRAME_HEIGHT);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<HostBridge | null>(null);
  // The bridge clamps every resize against the pane as it is *now*, so it reads
  // through a ref rather than closing over the height it was built with.
  const paneHeightRef = useRef(paneHeight);
  paneHeightRef.current = paneHeight;
  // Same for the subject: `init` is called when the frame says ready, which may
  // be long after the bridge was created and the prop may have moved on.
  const subjectRef = useRef(subject);
  subjectRef.current = subject;

  const targetKey = useMemo(() => JSON.stringify(target), [target]);

  // ── the token ──

  useEffect(() => {
    let cancelled = false;
    setMint(null);
    setStatus('minting');
    setError(null);
    setFrameLoaded(false);
    setTimedOut(false);
    setContentHeight(null);
    fetchJsonBody<FrameTokenResponse>('/api/tools/frame-token', 'POST', { target })
      .then((response) => {
        if (cancelled) return;
        setMint(response);
        setStatus('loading');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Visvine could not open this Tool.');
      });
    return () => {
      cancelled = true;
    };
    // `target` is an object literal at most call sites; key off its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, attempt]);

  // ── how much room there is ──

  useEffect(() => {
    const measure = () => {
      const slot = slotRef.current;
      if (!slot) return;
      // The slot's own height never feeds this: its top is fixed by whatever
      // sits above it (the degraded banner, the page's tab bar), so measuring
      // downward from there cannot chase its own tail.
      const gutter = mode === 'page' ? 0 : PANE_BOTTOM_GUTTER;
      const available = window.innerHeight - slot.getBoundingClientRect().top - gutter;
      setPaneHeight(Math.max(MIN_FRAME_HEIGHT, Math.floor(available)));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [mode]);

  // ── the bridge ──

  useEffect(() => {
    if (!iframeEl || !mint) return;
    const bridge = createHostBridge({
      iframe: iframeEl,
      hostWindow: window,
      // Not the tools origin: a frame sandboxed without `allow-same-origin` has
      // an opaque origin and reports "null" whatever it was loaded from.
      frameOrigin: SANDBOXED_FRAME_ORIGIN,
      target,
      init: (): HostInit => ({
        // The theme is read when the frame says ready, not now: ThemeContext
        // writes its variables in an effect, and a child's effect runs before
        // its provider's.
        theme: collectThemeTokens(document),
        subject: subjectRef.current,
        // Server-derived, all three — the page never decides who the viewer is
        // or whether they administer the space.
        install: mint.install,
        degraded: mint.degraded,
        viewer: mint.viewer,
      }),
      maxHeight: () => paneHeightRef.current,
      onReady: () => setStatus('ready'),
      onResize: setContentHeight,
      onError: (frameError) => setError(frameError.message),
      navigate: (path) => router.push(path),
    });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeEl, mint, targetKey, router]);

  // ── the handshake deadline ──

  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  const handleFrameLoad = useCallback(() => setFrameLoaded(true), []);

  // ── live updates ──

  useEffect(() => {
    if (status !== 'ready') return;
    bridgeRef.current?.setTheme(collectThemeTokens(document));
  }, [theme.id, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    bridgeRef.current?.setSubject(subject);
  }, [subject, status]);

  // The changes stream: note paths inside the Tool's perimeter that changed,
  // relayed to the frame as `visvine:changed`. Same-origin with the cookie,
  // like the bridge; the server re-resolves the target on every (re)connect
  // and filters each event by perimeter and viewer grants. Best-effort — the
  // kit's useLiveQuery also polls, so a missed event costs at most 30s.
  useEffect(() => {
    if (status !== 'ready' || typeof EventSource !== 'function') return;
    const source = new EventSource(`/api/tools/changes?target=${encodeURIComponent(targetKey)}`);
    const onChanged = (event: MessageEvent) => {
      let paths: unknown;
      try {
        paths = (JSON.parse(String(event.data)) as { paths?: unknown }).paths;
      } catch {
        return;
      }
      if (Array.isArray(paths) && paths.every((path) => typeof path === 'string')) {
        bridgeRef.current?.notifyChanged(paths as string[]);
      }
    };
    source.addEventListener('changed', onChanged);
    return () => {
      source.removeEventListener('changed', onChanged);
      source.close();
    };
  }, [status, targetKey, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // A page-mode Tool owns the pane — edge to edge, no frame, no gutter — and
  // scrolls inside itself. A tab or a preview grows to whatever the frame reported, floored so
  // a Tool measuring itself mid-mount cannot collapse, and capped at the pane so
  // it can never grow past the content area.
  const frameHeight =
    mode === 'page'
      ? paneHeight
      : Math.min(paneHeight, Math.max(MIN_FRAME_HEIGHT, contentHeight ?? MIN_FRAME_HEIGHT));

  // Where a viewer goes to look into a Tool that failed: the author's own Tool
  // page for a working copy, the console's install row for an installed one.
  const install = mint?.install;
  const reportHref = !install
    ? '/admin?section=tools'
    : 'preview' in install
      ? `/directory/tool:${install.name}`
      : `/admin?section=tools&tool=${encodeURIComponent(install.key)}`;

  return (
    <div ref={containerRef} className={clsx('flex w-full flex-col', mode === 'page' ? 'gap-0' : 'gap-3', className)}>
      {mint?.degraded && (
        <DegradedBanner degraded={mint.degraded} isAdmin={mint.viewer.isAdmin}
                        className={mode === 'page' ? 'mx-6 my-3' : undefined} />
      )}

      <div ref={slotRef} className="relative w-full" style={{ height: error ? undefined : frameHeight }}>
        {error ? (
          <ToolErrorCard title={title} message={error} reportHref={reportHref} onReload={reload} />
        ) : (
          <>
            {mint && (
              <iframe
                key={attempt}
                ref={setIframeEl}
                src={mint.frameUrl}
                title={title}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                allow=""
                onLoad={handleFrameLoad}
                // A page-mode Tool IS the page, so the iframe paints nothing of
                // its own: the frame document's body is transparent and the
                // app's backdrop shows through, exactly as it does behind a
                // native page. A
                // tab or preview is a panel, and panels sit on the surface like
                // every other card in the app.
                className={clsx('block h-full w-full', mode === 'page' ? 'bg-transparent' : 'bg-surface rounded-xl border border-line-subtle')}
              />
            )}
            {status !== 'ready' && !frameLoaded && <ToolFrameSkeleton framed={mode !== 'page'} />}
            {status !== 'ready' && timedOut && (
              <ToolFrameSlowNotice reportHref={reportHref} onReload={reload} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shown over the frame until the handshake lands. It sits on top rather than
 * instead of the iframe, because the iframe has to be in the document to load at
 * all — swapping them would mean the Tool never starts.
 */
function ToolFrameSkeleton({ framed }: { framed: boolean }) {
  return (
    <div
      aria-hidden
      // Unframed (page mode) it paints no background, so the skeleton floats
      // on the app's backdrop the way a loading native page does — an opaque
      // slab here would read as a card the finished page never had.
      className={clsx('absolute inset-0 flex flex-col gap-3', framed ? 'bg-surface rounded-xl border border-line-subtle p-5' : 'p-6')}
    >
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3.5 w-72" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}

/**
 * Shown 15s after `load` with no handshake. Deliberately a thin strip, not a
 * full card: the frame is left mounted and visible underneath it (its
 * document may already be the author's own compile-error page), so this only
 * ever adds a note — it never has enough information to say the Tool is dead.
 */
function ToolFrameSlowNotice({ reportHref, onReload }: { reportHref: string; onReload: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b border-line-subtle bg-surface/95 px-4 py-2 text-xs text-fg-muted backdrop-blur">
      <span>This Tool is taking longer than usual to start.</span>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onReload} className="inline-flex items-center gap-1.5">
          <RefreshCwIcon className="h-3 w-3" />
          Reload
        </Button>
        <Link href={reportHref} className="font-medium text-fg-secondary hover:text-fg">
          View this Tool
        </Link>
      </div>
    </div>
  );
}
