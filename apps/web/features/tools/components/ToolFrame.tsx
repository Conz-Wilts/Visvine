'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import Link from '@/features/shared/components/SpaceLink';
import { clsx } from 'clsx';
import { RefreshCwIcon } from '@/features/shared/icons';
import { Button, ConfirmDialog, Skeleton, ToastHost, useToasts } from '@visvine/ui';
import { FetchJsonError, fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import { desktopToolFrames } from '@/features/desktop/lib/desktop';
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
import { hostServiceCall } from '../lib/hostServices';
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

/**
 * How often an open frame asks whether it may keep running. A withdrawn
 * version stops at its next bridge call; this bounds a Tool that makes none.
 */
const STATUS_CHECK_MS = 60_000;

/** What the frame said when it left its sandbox, drawn in its place. */
const NAVIGATED = 'This tool tried to leave its frame and was stopped.';

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
  section = null,
  onSection,
  actionRef,
}: {
  target: BridgeTarget;
  /** What the Tool is being shown about, when it owns a type page. */
  subject?: ToolSubject | null;
  /** The Tool's own name — the iframe's accessible title and the error card's. */
  title: string;
  mode: 'page' | 'tab' | 'preview';
  className?: string;
  /** The active one of the Tool's own sections, when its page draws them. */
  section?: string | null;
  /** The Tool asked to switch its section; the page decides. */
  onSection?: (section: string) => void;
  /** Filled with a way to tell the Tool a band button was pressed. */
  actionRef?: React.RefObject<((id: string) => void) | null>;
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
  // Why the frame was taken down: withdrawn or suspended (the server said
  // `revoked`), or the frame navigated itself. Set, the frame is gone for good
  // until Reload.
  const [stopped, setStopped] = useState<string | null>(null);
  const loadsRef = useRef(0);
  const visible = usePageVisible();
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
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const onSectionRef = useRef(onSection);
  onSectionRef.current = onSection;

  // ── the host's own services (ui.*) ──
  // Drawn here, in the app's chrome, so the viewer sees the app asking — one
  // question at a time.
  const { toasts, push, dismiss } = useToasts();
  const [question, setQuestion] = useState<{
    title: string;
    body?: string;
    confirmLabel?: string;
    destructive?: boolean;
    answer: (yes: boolean) => void;
  } | null>(null);
  const questionOpenRef = useRef(false);
  const ask = useCallback((q: { title: string; body?: string; confirmLabel?: string; destructive?: boolean }) => {
    if (questionOpenRef.current) return null;
    questionOpenRef.current = true;
    return new Promise<boolean>((resolve) => {
      setQuestion({
        ...q,
        answer: (yes) => {
          questionOpenRef.current = false;
          setQuestion(null);
          resolve(yes);
        },
      });
    });
  }, []);

  const targetKey = useMemo(() => JSON.stringify(target), [target]);

  // The first-use notice: a Tool from outside the space about to act as the
  // viewer. One question however many calls asked it; Continue is recorded on
  // the server, then every waiting call is sent again.
  const [consent, setConsent] = useState<{ sentence: string; answer: (yes: boolean) => void } | null>(null);
  const consentRef = useRef<Promise<boolean> | null>(null);
  const askConsent = useCallback(
    (sentence: string) => {
      if (consentRef.current) return consentRef.current;
      const pending = new Promise<boolean>((resolve) => {
        let answered = false;
        setConsent({
          sentence,
          answer: (yes) => {
            if (answered) return;
            answered = true;
            setConsent(null);
            const done = yes
              ? fetchJsonBody('/api/tools/consent', 'POST', { target }).then(() => true, () => false)
              : Promise.resolve(false);
            void done.then((given) => {
              consentRef.current = null;
              resolve(given);
            });
          },
        });
      });
      consentRef.current = pending;
      return pending;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey],
  );

  // ── the token ──

  useEffect(() => {
    let cancelled = false;
    setMint(null);
    setStatus('minting');
    setError(null);
    setStopped(null);
    loadsRef.current = 0;
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
        if (cause instanceof FetchJsonError && cause.code === 'revoked') {
          setStopped(cause.message);
          return;
        }
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
        section: sectionRef.current,
      }),
      maxHeight: () => paneHeightRef.current,
      onReady: () => setStatus('ready'),
      onResize: setContentHeight,
      onError: (frameError) => setError(frameError.message),
      navigate: (path) => router.push(path),
      onRevoked: setStopped,
      onSection: (next) => onSectionRef.current?.(next),
      onConsent: askConsent,
      onHostCall: (method, params) =>
        hostServiceCall(method, params, {
          mayDownload: mint.ui?.download === true,
          toast: push,
          // Under Visvine's dynamic run nobody is there to answer: every
          // question is a yes, so the Tool shows what it does next.
          confirm: target.kind === 'review' ? () => Promise.resolve(true) : ask,
          save: ({ filename, content, mimeType }) => {
            if (target.kind === 'review') return;
            const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          },
          navigate: (path) => router.push(path),
        }),
    });
    bridgeRef.current = bridge;
    if (actionRef) actionRef.current = (id) => bridge.sendAction(id);
    return () => {
      bridgeRef.current = null;
      if (actionRef) actionRef.current = null;
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

  // The first `load` is the document the host asked for. Any later one is the
  // frame navigating itself — the one way out CSP cannot close — so the host
  // takes the frame down and records it. The request has already left; this is
  // detection, and the incident is what a reviewer acts on.
  const handleFrameLoad = useCallback(() => {
    loadsRef.current += 1;
    if (loadsRef.current === 1) {
      setFrameLoaded(true);
      return;
    }
    setStopped(NAVIGATED);
    void fetchJsonBody('/api/tools/incidents', 'POST', { target, kind: 'navigation' }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // The desktop shell refuses a Tool frame's navigation outright and says so;
  // the frame is taken down and recorded exactly as a browser's second load is.
  useEffect(() => {
    const frames = desktopToolFrames();
    if (!frames || !mint) return;
    return frames.onNavigationRefused((frameUrl) => {
      if (frameUrl !== mint.frameUrl) return;
      setStopped(NAVIGATED);
      void fetchJsonBody('/api/tools/incidents', 'POST', { target, kind: 'navigation' }).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, targetKey]);

  // ── may it keep running ──

  const checkStatus = useCallback(() => {
    void fetchJson<{ ok: boolean; error?: { code: string; message: string } }>(
      `/api/tools/status?target=${encodeURIComponent(targetKey)}`,
    )
      .then((answer) => {
        if (answer.ok || !answer.error) return;
        if (answer.error.code === 'revoked') setStopped(answer.error.message);
        else setError(answer.error.message);
      })
      .catch(() => {});
  }, [targetKey]);

  useEffect(() => {
    if (status !== 'ready' || stopped || !visible) return;
    const timer = setInterval(checkStatus, STATUS_CHECK_MS);
    return () => clearInterval(timer);
  }, [status, stopped, visible, checkStatus]);

  // ── live updates ──

  useEffect(() => {
    if (status !== 'ready') return;
    bridgeRef.current?.setTheme(collectThemeTokens(document));
  }, [theme.id, status]);

  useEffect(() => {
    if (status !== 'ready') return;
    bridgeRef.current?.setSubject(subject);
  }, [subject, status]);

  // A section chosen on the band or the side list reaches the Tool without the
  // frame reloading: same frame, same token, a route message.
  useEffect(() => {
    if (status !== 'ready') return;
    bridgeRef.current?.setSection(section);
  }, [section, status]);

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
    // A verdict moved on this Tool somewhere on this server: ask at once
    // rather than at the next minute.
    source.addEventListener('verdict', checkStatus);
    return () => {
      source.removeEventListener('changed', onChanged);
      source.removeEventListener('verdict', checkStatus);
      source.close();
    };
  }, [status, targetKey, attempt, checkStatus]);

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

      <div ref={slotRef} className="relative w-full" style={{ height: error || stopped ? undefined : frameHeight }}>
        {stopped ? (
          <ToolStopped title={title} reason={stopped} />
        ) : error ? (
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
      <ToastHost toasts={toasts} onDismiss={dismiss} />
      <ConfirmDialog
        open={question !== null}
        title={question?.title ?? ''}
        body={question?.body}
        confirmLabel={question?.confirmLabel ?? 'OK'}
        destructive={question?.destructive}
        onConfirm={() => question?.answer(true)}
        onClose={() => question?.answer(false)}
      />
      <ConfirmDialog
        open={consent !== null}
        title={title}
        body={consent?.sentence}
        confirmLabel="Continue"
        onConfirm={() => consent?.answer(true)}
        onClose={() => consent?.answer(false)}
      />
    </div>
  );
}

/**
 * A Tool that was taken down — withdrawn by its space, held by Visvine, or
 * stopped for leaving its frame. The host's own state, the same for every
 * Tool; the frame is gone and nothing of the Tool's is drawn.
 */
export function ToolStopped({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm text-fg-secondary">{reason}</p>
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
