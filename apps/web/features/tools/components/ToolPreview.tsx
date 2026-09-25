'use client';

/**
 * `/tools/preview/<name>` — an author's working copy, running for real.
 *
 * This is the other half of the authoring loop: `write_tool` gives an agent
 * compile diagnostics, and this page gives the person it is working for the
 * only feedback that actually settles anything — the Tool on screen. It is the
 * target of the `visvine-desktop://open/tools/preview/<name>` deep link that
 * `create_tool` and `preview_tool` hand back (resolved generically by
 * apps/desktop/src/urls.ts#deepLinkToPath — there is nothing desktop-side to
 * change) and of the equivalent web URL beside it.
 *
 * It renders the WORKING COPY, not a published version: the frame target is
 * `{ kind: 'preview' }`, which the frame-token route gates on the viewer's own
 * ability to read the Tool's index note rather than on an install. So a
 * preview is exactly as private as the notes behind it — and, being code no
 * admin has approved, it runs with only the reach its authors and the viewer
 * share, starting by itself only for one of its authors.
 *
 * The chrome is deliberately a strip and not a page: the name, whether it
 * builds, and the two things you do while iterating — reload it, and go read
 * the source.
 *
 * A Tool that does not compile is answered HERE rather than by mounting a frame
 * over it. The runtime route does render a diagnostics document for a failed
 * build, but the host (ToolFrame) covers any frame that hasn't completed its
 * handshake with a skeleton and, fifteen seconds later, replaces it with a
 * generic "did not finish loading" card — so an error document is never read.
 * That is worth fixing in the host, for the sake of an INSTALLED Tool whose
 * viewer has no other surface; on an author's own preview the build row is
 * right here and the errors are the honest answer, so there is no reason to
 * mint a token for a bundle that does not exist.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { Button } from '@visvine/ui';
import { timeAgo } from '@/lib/date';
import PerimeterSummary from './PerimeterSummary';
import Link from '@/features/shared/components/SpaceLink';
import { CheckIcon, CopyIcon, FileCode2Icon, RotateCwIcon, TriangleAlertIcon } from '@/features/shared/icons';
import { useCopied } from '@/features/shared/hooks/useCopied';
import { Skeleton } from '@visvine/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { FetchJsonError } from '@/lib/fetchJson';
import { entityContextHref } from '@/lib/notes/entities';
import { TOOL_SOURCE_FILES } from '@/lib/tools/config';
import type { AuthoredToolDetail } from '@/lib/tools/service';
import { fetchAuthoredTool } from '../lib/client';
import BuildDiagnostics from './BuildDiagnostics';
import ToolFrame from './ToolFrame';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';

const STRIP_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-subtle';

/**
 * Where this Tool stands with the people who decide about it, in one phrase.
 *
 * On the preview above all, because the preview is the link an author hands
 * around: whoever opens it should be able to see at a glance that they are
 * looking at something private to this space, and not assume the tool is out in
 * the world because it renders.
 */
function reachLabel(tool: AuthoredToolDetail): string {
  const publication = tool.publication;
  if (!publication) return 'unpublished · this space only';
  if (publication.marketplaceStatus === 'approved') return `v${publication.version} · on the marketplace`;
  if (publication.marketplaceStatus === 'pending') return `v${publication.version} · listing in review`;
  if (publication.status === 'pending') return `v${publication.version} · waiting on an admin`;
  if (publication.status === 'approved') return `v${publication.version} · live in this space only`;
  return `v${publication.version} · ${publication.status}`;
}

function buildStatus(tool: AuthoredToolDetail): { label: string; tone: keyof typeof TONE_CLASSES } {
  if (tool.invalid) return { label: 'Config error', tone: 'bad' };
  if (!tool.build) return { label: 'Never built', tone: 'warn' };
  if (!tool.build.ok) return { label: 'Not building', tone: 'bad' };
  return { label: 'Builds', tone: 'ok' };
}

export default function ToolPreview({ name }: { name: string }) {
  const { currentSpace, loading: spaceLoading } = useSpace();
  const { user } = useAuth();
  const spaceId = currentSpace?.id;
  // A draft starts by itself only for someone who wrote it. Anyone else is
  // shown who did and what it reaches, and presses Run — it then runs with the
  // reach the viewer and its authors share (lib/tools/draftAuthors.ts).
  const [runRequested, setRunRequested] = useState(false);

  const [tool, setTool] = useState<AuthoredToolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  // Bumped by Reload. It is the frame's `key`, so pressing it remounts the
  // iframe from scratch — a fresh token, a fresh bundle fetch, a fresh mount —
  // rather than asking a Tool that may be wedged to re-render itself.
  const [attempt, setAttempt] = useState(0);
  const [copied, copy] = useCopied(2000);

  /** This page's own address, absolute — the point of copying it is to paste it
   *  somewhere that is not this app. */
  const copyLink = useCallback(
    () => copy(typeof window === 'undefined' ? '' : window.location.href),
    [copy],
  );

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
    if (!spaceId) return;
    // The strip's own build chip is as stale as the last fetch; an author
    // pressing Reload after a save wants both halves fresh.
    fetchAuthoredTool(spaceId, name)
      .then((next) => setTool(next.tool))
      .catch(() => {});
  }, [spaceId, name]);

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    fetchAuthoredTool(spaceId, name, controller.signal)
      .then((next) => {
        setTool(next.tool);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError({
          status: cause instanceof FetchJsonError ? cause.status : 0,
          message: cause instanceof Error ? cause.message : 'Could not load this tool',
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [spaceId, spaceLoading, name]);

  if (spaceLoading || loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pt-4">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !tool || !spaceId) {
    return <PreviewUnavailable name={name} status={error?.status ?? 0} message={error?.message} />;
  }

  const status = buildStatus(tool);
  const nodeId = `tool:${tool.name}`;
  // A failed build stores no bundle (lib/tools/builds.ts), so there is nothing
  // for a frame to mount even if one were opened.
  const runnable = !tool.invalid && !!tool.build?.ok;
  const isAuthor = !!user && tool.draft.authors.some((author) => author.userId === user.id);
  const started = isAuthor || runRequested;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 pt-4 pb-6">
      {/* ══ STRIP — what this is, whether it builds, and the two iteration acts ══ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <h1 className="truncate font-title text-lg font-semibold text-fg">{tool.title}</h1>
          <span className="font-mono text-[12px] text-fg-muted">{tool.name}</span>
          <span className={`${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
          <span className="text-[12px] text-fg-muted">preview · working copy</span>
          <span className="text-[12px] text-fg-muted">{reachLabel(tool)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void copyLink()}
            className={STRIP_BUTTON}
            title="Copy this page's address — the link to send to whoever is building or reviewing this tool"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" onClick={reload} className={STRIP_BUTTON}>
            <RotateCwIcon className="h-3.5 w-3.5" />
            Reload
          </button>
          <Link href={entityContextHref(nodeId, TOOL_SOURCE_FILES.ui.path)} className={STRIP_BUTTON}>
            <FileCode2Icon className="h-3.5 w-3.5" />
            Open source
          </Link>
        </div>
      </div>

      {!runnable ? (
        <NotBuilding tool={tool} />
      ) : started ? (
        <ToolFrame
          key={attempt}
          target={{ kind: 'preview', spaceId, name: tool.name }}
          title={tool.title}
          mode="preview"
        />
      ) : (
        <RunGate tool={tool} onRun={() => setRunRequested(true)} />
      )}
    </div>
  );
}

/**
 * An unreviewed draft someone else wrote: who, when, and what it reaches, then
 * Run. What it can do once running is the reach its authors and the viewer
 * share, so this is not a warning about the viewer's data — it is the moment
 * to decide whether to run code nobody has approved.
 */
function RunGate({ tool, onRun }: { tool: AuthoredToolDetail; onRun: () => void }) {
  const names = tool.draft.authors.map((author) => author.name);
  const edited = tool.draft.lastEdit;
  return (
    <div className="flex flex-col gap-4 border-t border-line-subtle pt-5">
      <p className="text-sm text-fg-muted">
        {[
          names.length ? `Written by ${names.join(', ')}` : null,
          edited ? `edited ${timeAgo(new Date(edited.at).getTime())}` : null,
          'not approved',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {tool.config && <PerimeterSummary perimeter={tool.config.perimeter} />}
      <div>
        <Button onClick={onRun}>Run</Button>
      </div>
    </div>
  );
}

/**
 * What the pane says instead of a Tool: the diagnostics the last compile
 * produced, in the pane the Tool would have filled. Same lines an authoring
 * agent gets back from `write_tool`, so an author holding both is holding one
 * account of the problem rather than two.
 */
function NotBuilding({ tool }: { tool: AuthoredToolDetail }) {
  return (
    <div className="flex flex-col gap-3 border-l-2 border-danger-bright pl-4 py-1">
      <div className="flex items-center gap-2">
        <TriangleAlertIcon className="h-4 w-4 shrink-0 text-danger" />
        <h2 className="text-sm font-semibold text-fg">
          {tool.build ? 'This tool does not compile' : 'This tool has never compiled'}
        </h2>
      </div>
      <BuildDiagnostics build={tool.build} />
      {!tool.build && (
        <p className="text-sm text-fg-muted">
          Nothing has been written to{' '}
          <code className="font-mono text-[12px]">{TOOL_SOURCE_FILES.ui.authorName}</code> yet.
        </p>
      )}
      <p className="text-[12px] text-fg-muted">
        Every save recompiles. Fix the source and press Reload — the preview comes back as soon as it builds.
      </p>
    </div>
  );
}

/**
 * The state for a preview that cannot be shown. A 403 is the Tools surface
 * being off (or admins-only) in this space; everything else says the same thing
 * about the notes, on purpose — a stale deep link and a probe for which tools
 * exist deserve the same answer.
 */
function PreviewUnavailable({
  name,
  status,
  message,
}: {
  name: string;
  status: number;
  message?: string;
}) {
  return (
    <div className="flex items-center justify-center px-6 py-24">
      <div className="max-w-md px-6 py-8 text-center">
        <TriangleAlertIcon className="mx-auto h-5 w-5 text-warning-bright" />
        <h1 className="mt-3 text-lg font-semibold text-fg">
          {status === 403 ? 'Tools are off for you here' : 'Nothing to preview'}
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          {status === 403
            ? 'An admin has switched the Tools surface off for this space, or restricted it to admins.'
            : status === 404
              ? `This space has no readable tool called ${name}. It may have been deleted, or never shared with you.`
              : (message ?? 'Could not load this tool.')}
        </p>
        <Link
          href="/admin?section=tools"
          className="mt-5 inline-flex items-center rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Tools in this space
        </Link>
      </div>
    </div>
  );
}
