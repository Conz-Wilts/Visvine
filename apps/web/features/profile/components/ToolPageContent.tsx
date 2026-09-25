'use client';

/**
 * The "Tool" view for a tool node — the first tab on /directory/tool:<name>,
 * beside Context and Raw.
 *
 * The notes ARE the Tool: `tools/<name>/index.md` is the config and the docs,
 * `ui.md` and `data.md` beside it are its source, and all three are one click
 * away on the Context tab (the notes strip in the entity folder). So this tab
 * deliberately shows none of them. What it shows is everything the notes cannot
 * say for themselves:
 *
 *   • whether the working copy COMPILES, and where it broke (`file:line:col`);
 *   • what the declared perimeter costs — its reach, and which of the things it
 *     names this space actually has;
 *   • its versions: what was published, what the space's admins decided, and
 *     whether one was withdrawn.
 *
 * Every member gets this tab, like an agent's and unlike a connector's: members
 * author Tools, and the authoring route is grant-gated rather than admin-gated.
 * Anyone who can edit the Tool publishes it into this space — an admin's lands
 * approved, a member's waits on Console → Approvals — and an admin installs an
 * approved version from here.
 *
 * Mirrors ConnectorPageContent's shape: a status header, then flat sections
 * separated by a rule rather than a grid of cards, because everything here is
 * one Tool and six boxes would imply six subjects.
 */

import { useSpaceHref } from '@/features/shared/contexts/SpaceContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCopied } from '@/features/shared/hooks/useCopied';
import Link from '@/features/shared/components/SpaceLink';
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, TriangleAlertIcon, UploadIcon } from '@/features/shared/icons';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { ConfirmDialog, Skeleton } from '@visvine/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import ShareWithRooms, { type ShareValue } from '@/features/shared/components/ShareWithRooms';
import { setAuthoredToolShare } from '@/features/tools/lib/client';
import { FetchJsonError } from '@/lib/fetchJson';
import { timeAgo } from '@/lib/date';
import { entityContextHref } from '@/lib/notes/entities';
import { TOOL_SOURCE_FILES } from '@/lib/tools/config';
// Type-only, both: lib/tools/builds.ts pulls in esbuild, so a value import
// would drag the compiler into the browser bundle. `requirements.ts` is pure,
// and is imported for real.
import type { BuildSummary } from '@/lib/tools/builds';
import type { AuthoredToolView } from '@/lib/tools/api';
import type { ToolVersionSummary } from '@/lib/tools/registry';
import { describeRequirements } from '@/lib/tools/requirements';
import BuildDiagnostics from '@/features/tools/components/BuildDiagnostics';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import InstallSheet from '@/features/tools/components/InstallSheet';
import { TONE_CHIP, TONE_CLASSES, type Tone } from '@/features/shared/lib/statusTone';
import { fetchAuthoredTool, listingAction, revokeToolVersion, runToolChecks, workingCopyExportUrl } from '@/features/tools/lib/client';
import ListingDialog from '@/features/tools/components/ListingDialog';
import TransferDialog from '@/features/tools/components/TransferDialog';
import CheckReport, { checkWord } from '@/features/tools/components/CheckReport';
import PublishDialog from '@/features/tools/components/PublishDialog';
import type { CheckReport as CheckReportData } from '@/lib/tools/checks/findings';

// ── Chrome ───────────────────────────────────────────────────────────────────

/**
 * Title, an optional one-word meta, and at most one action, over a rule — the
 * same section shape ConnectorPageContent uses, for the same reason.
 */
function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line-subtle py-5">
      <header className="flex items-center justify-between gap-3 pb-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-fg">{title}</span>
          {meta && <span className="shrink-0 font-mono text-[11px] text-fg-muted">{meta}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

const HEADER_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50';

// ── Build ────────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** The compile-on-write result: the one thing that decides whether it runs. */
function BuildReport({ build }: { build: BuildSummary | null }) {
  if (!build) {
    return (
      <p className="text-sm text-fg-muted">
        This tool has never compiled — nothing has been written to{' '}
        <code className="font-mono text-[12px]">{TOOL_SOURCE_FILES.ui.authorName}</code> yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <BuildDiagnostics build={build} />

      {build.ok && build.errors.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-fg">
          <CheckIcon className="h-4 w-4 shrink-0 text-accent-strong" />
          Compiles — {fmtBytes(build.sizeBytes)} of bundle, built{' '}
          {timeAgo(new Date(build.updatedAt).getTime(), { style: 'short' })}.
        </p>
      )}

      <p className="text-[12px] text-fg-muted">
        Every save recompiles. An authoring agent reads these same lines back from{' '}
        <code className="font-mono">write_tool</code>.
      </p>
    </div>
  );
}

// ── Publishing ───────────────────────────────────────────────────────────────

const VERSION_TONES: Record<ToolVersionSummary['status'], Tone> = {
  approved: 'ok',
  pending: 'warn',
  rejected: 'bad',
  withdrawn: 'warn',
};

/** Where a version's global listing stands, as its chip — nothing when it was never offered. */
const LISTING_CHIP: Partial<Record<ToolVersionSummary['listingState'], { word: string; tone: Tone }>> = {
  awaiting_cosign: { word: 'co-sign', tone: 'warn' },
  in_review: { word: 'with Visvine', tone: 'warn' },
  listed: { word: 'listed', tone: 'ok' },
  rejected: { word: 'not listed', tone: 'bad' },
};

const TRAIL_BUTTON = 'shrink-0 text-fg-muted transition-colors hover:text-fg';

/**
 * The publication trail: every version ever snapshotted off this working copy,
 * newest first. A rejection keeps its reviewer note — that note is the whole
 * value of the review gate to the author.
 */
function VersionTrail({
  versions,
  checks,
  onWithdraw,
  listing,
}: {
  versions: ToolVersionSummary[];
  /** The checks each version was published with. */
  checks: Record<string, CheckReportData>;
  /** An admin of this space may pull an approved version back. */
  onWithdraw?: (version: ToolVersionSummary) => void;
  /** Going global: who may list, co-sign or take a request back, and what pressing does. */
  listing: {
    viewerId: string | null;
    isAdmin: boolean;
    onList: (version: ToolVersionSummary) => void;
    onCosign: (version: ToolVersionSummary) => void;
    onUnlist: (version: ToolVersionSummary) => void;
  };
}) {
  return (
    <ul className="flex flex-col divide-y divide-line-subtle">
      {versions.map((version) => (
        <li key={version.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-mono font-semibold text-fg">v{version.version}</span>
            <span className={`${TONE_CHIP} ${TONE_CLASSES[version.revokedAt ? 'bad' : VERSION_TONES[version.status]]}`}>
              {version.revokedAt ? 'withdrawn' : version.status}
            </span>
            <span className="text-fg-muted">
              {version.author.name ?? 'someone'} · {timeAgo(new Date(version.submittedAt).getTime(), { style: 'short' })}
              {checkWord(checks[version.id]) ? ` · ${checkWord(checks[version.id])}` : ''}
            </span>
            {LISTING_CHIP[version.listingState] && (
              <span className={`${TONE_CHIP} ${TONE_CLASSES[LISTING_CHIP[version.listingState]!.tone]}`}>
                {LISTING_CHIP[version.listingState]!.word}
              </span>
            )}
            <span className="ml-auto shrink-0 font-mono text-fg-muted">{fmtBytes(version.sizeBytes)}</span>
            {listing.isAdmin &&
              version.status === 'approved' &&
              !version.revokedAt &&
              ['none', 'withdrawn', 'rejected'].includes(version.listingState) && (
                <button type="button" onClick={() => listing.onList(version)} className={TRAIL_BUTTON}>
                  List
                </button>
              )}
            {version.listingState === 'awaiting_cosign' && version.author.userId === listing.viewerId && (
              <button type="button" onClick={() => listing.onCosign(version)} className={TRAIL_BUTTON}>
                Co-sign
              </button>
            )}
            {(version.listingState === 'awaiting_cosign' || version.listingState === 'in_review') &&
              (listing.isAdmin || version.author.userId === listing.viewerId) && (
                <button type="button" onClick={() => listing.onUnlist(version)} className={TRAIL_BUTTON}>
                  Cancel listing
                </button>
              )}
            {onWithdraw && version.status === 'approved' && !version.revokedAt && (
              <button
                type="button"
                onClick={() => onWithdraw(version)}
                className="shrink-0 text-fg-muted transition-colors hover:text-danger"
              >
                Withdraw
              </button>
            )}
          </div>
          {version.reviewNote && (
            <p className="min-w-0 break-words text-[12px] text-fg-secondary">
              Reviewer: {version.reviewNote}
            </p>
          )}
          {version.revokeReason && (
            <p className="min-w-0 break-words text-[12px] text-fg-secondary">{version.revokeReason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Status ───────────────────────────────────────────────────────────────────

/** The one-line verdict in the header: what this Tool can do today. */
function statusOf(view: AuthoredToolView): { label: string; tone: Tone; hint: string } {
  const { tool, requirements } = view;
  if (tool.invalid) {
    return {
      label: 'Not usable',
      tone: 'bad',
      hint: `The config does not parse, so nothing runs: ${tool.invalid}`,
    };
  }
  if (!tool.build) {
    return {
      label: 'Never built',
      tone: 'warn',
      hint: `Write ${TOOL_SOURCE_FILES.ui.authorName} and it compiles on save.`,
    };
  }
  if (!tool.build.ok) {
    return {
      label: 'Not building',
      tone: 'bad',
      hint: 'It will render an error card until it compiles — the diagnostics are below.',
    };
  }
  // A current report that blocks is the one thing standing between it and a publish.
  if (view.checks && !view.checks.stale) {
    const report = view.checks.report;
    if (report.compatibility.status === 'blocked' || report.security.status === 'blocked') {
      return { label: 'Blocked', tone: 'bad', hint: 'The checks block a publish until the findings below are fixed.' };
    }
  }
  const missing = requirements ? describeRequirements(requirements) : [];
  if (missing.length > 0) {
    return {
      label: 'Runs degraded',
      tone: 'warn',
      hint: `${missing.length} thing${missing.length === 1 ? '' : 's'} it declares ${missing.length === 1 ? 'is' : 'are'} missing here — it renders behind a banner and those reads come back empty.`,
    };
  }
  return { label: 'Ready', tone: 'ok', hint: 'It compiles, and this space satisfies everything it declares.' };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ToolPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('tool:') ? nodeId.slice('tool:'.length) : nodeId;
  const { currentSpace, loading: spaceLoading, isAdmin, spaces, refreshSpace } = useSpace();
  const spaceId = currentSpace?.id;
  // A house with rooms may install this Tool into them (lib/tools/share.ts).
  const hasSubspaces = !!spaceId && spaces.some((s) => s.parentId === spaceId);
  const [sharing, setSharing] = useState(false);
  const saveShare = useCallback(async (next: ShareValue) => {
    if (!spaceId) return false;
    setSharing(true);
    try {
      await setAuthoredToolShare(spaceId, name, next);
      await reloadRef.current?.();
      return true;
    } catch {
      return false;
    } finally {
      setSharing(false);
    }
  }, [spaceId, name]);
  const reloadRef = useRef<(() => Promise<void>) | null>(null);

  const [view, setView] = useState<AuthoredToolView | null>(null);
  const [loading, setLoading] = useState(true);
  // Kept as the status alongside the message: 403 and 404 are different pages,
  // not two wordings of the same one.
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [installing, setInstalling] = useState<ToolVersionSummary | null>(null);
  const [withdrawing, setWithdrawing] = useState<ToolVersionSummary | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [listing, setListing] = useState<{ version: ToolVersionSummary; mode: 'list' | 'cosign' } | null>(null);
  const [transferring, setTransferring] = useState<string | null>(null);
  const { user } = useAuth();
  const [copied, copy] = useCopied(2000);
  const spaceHref = useSpaceHref();

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await fetchAuthoredTool(spaceId, name);
      setView(next);
      setError(null);
    } catch (e) {
      const status = e instanceof FetchJsonError ? e.status : 0;
      setError({ status, message: e instanceof Error ? e.message : 'Could not load this tool' });
    } finally {
      setLoading(false);
    }
  }, [spaceId, name]);
  reloadRef.current = reload;

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
  }, [spaceId, spaceLoading, reload]);

  /**
   * The line an author hands their coding agent. Naming the space id and the
   * tool by name is the whole trick: every MCP handler takes both, and an agent
   * that has to guess them wastes a round trip finding out it guessed wrong.
   */
  const copyMcpHint = async () => {
    if (!spaceId) return;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const hint = [
      `Work on the Visvine tool "${name}" in space "${spaceId}", using Visvine's MCP server.`,
      `Call get_tool_sdk once first, then read_tool { space_id: "${spaceId}", name: "${name}" }.`,
      `Edit with write_tool (files: index.md, ${TOOL_SOURCE_FILES.ui.authorName}, ${TOOL_SOURCE_FILES.data.authorName}) — the fresh build comes back on every write.`,
      `Run check_tool before publishing. Preview: ${origin}${spaceHref(`/tools/preview/${name}`)}`,
    ].join('\n');
    if (!(await copy(hint))) {
      setNotice('Could not reach the clipboard — copy the preview URL from the address bar instead.');
    }
  };

  if (spaceLoading || loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  // Forbidden and not-found are different answers and get different pages. A
  // 404 here means the notes aren't readable by this viewer OR aren't there at
  // all — deliberately the same sentence, because distinguishing them would
  // tell a stranger which tools exist.
  if (error || !view) {
    const status = error?.status ?? 0;
    return (
      <div className="py-16 text-center">
        <h2 className="text-lg font-semibold text-fg">
          {status === 403 ? 'Tools are off for you here' : 'No tool here'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-secondary">
          {status === 403
            ? 'An admin has switched the Tools surface off for this space, or restricted it to admins.'
            : status === 404
              ? `Nothing readable at tools/${name}/index.md. It may have been deleted, or never shared with you.`
              : (error?.message ?? 'Could not load this tool.')}
        </p>
      </div>
    );
  }

  const { tool, requirements, versions } = view;
  const status = statusOf(view);
  const missing = requirements ? describeRequirements(requirements) : [];
  const pending = versions.find((version) => version.status === 'pending') ?? null;
  const config = tool.config;
  const publishable = view.canEdit && !!tool.build?.ok && !tool.invalid;
  // The newest version this space approved and still stands behind: what an
  // admin installs when the Tool is not yet running here.
  const installable = versions.find((version) => version.status === 'approved' && !version.revokedAt) ?? null;
  // The newest version Visvine lists — what a transfer moves.
  const listedVersion = versions.find((version) => version.listingState === 'listed') ?? null;

  return (
    <div className="profile-content-fade flex flex-col">
      {/* ══ HEADER — what it is, whether it works, and what you can do with it ══ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate font-title text-xl font-semibold text-fg">{tool.title}</h1>
          <span className="font-mono text-[12px] text-fg-muted">{tool.name}</span>
          <span className={`${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/tools/preview/${encodeURIComponent(tool.name)}`} className={HEADER_BUTTON}>
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {view.canEdit ? 'Edit' : 'Preview'}
          </Link>
          {spaceId && (
            <a href={workingCopyExportUrl(spaceId, tool.name)} download className={HEADER_BUTTON}>
              <DownloadIcon className="h-3.5 w-3.5" />
              Export
            </a>
          )}
          <button type="button" onClick={copyMcpHint} className={HEADER_BUTTON}>
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-accent-strong" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy MCP hint'}
          </button>
          {view.canEdit && (
            <button
              type="button"
              onClick={() => setPublishing(true)}
              disabled={!publishable}
              title={publishable ? undefined : 'It has to compile before it can be published.'}
              className={HEADER_BUTTON}
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Publish
            </button>
          )}
          {isAdmin && !view.installId && installable && (
            <button type="button" onClick={() => setInstalling(installable)} className={HEADER_BUTTON}>
              Install
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="mb-5 rounded-2xl bg-surface-subtle px-4 py-2.5 text-[13px] text-fg">{notice}</p>
      )}

      {status.tone !== 'ok' && (
        <p className="flex items-start gap-2 pb-5 text-xs text-fg-muted">
          <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-warning-bright" />
          <span className="min-w-0 break-words">{status.hint}</span>
        </p>
      )}

      {/* ══ BUILD — does it compile, and if not, where ══ */}
      <Section
        title="Build"
        meta={tool.build ? (tool.build.ok ? 'ok' : `${tool.build.errors.length} error${tool.build.errors.length === 1 ? '' : 's'}`) : undefined}
      >
        <BuildReport build={tool.build} />
      </Section>

      {/* ══ CHECKS — the stages a publish runs, run now or as last run ══ */}
      {tool.build && (
        <Section
          title="Checks"
          meta={view.checks ? (view.checks.stale ? 'out of date' : timeAgo(new Date(view.checks.ranAt).getTime(), { style: 'short' })) : undefined}
          action={
            <button
              type="button"
              disabled={checking || !spaceId}
              onClick={async () => {
                if (!spaceId) return;
                setChecking(true);
                try {
                  const res = await runToolChecks(spaceId, tool.name);
                  setView((current) => (current ? { ...current, checks: res.checks } : current));
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : 'Could not run the checks');
                } finally {
                  setChecking(false);
                }
              }}
              className={HEADER_BUTTON}
            >
              {checking ? 'Checking…' : 'Check'}
            </button>
          }
        >
          {view.checks && <CheckReport report={view.checks.report} />}
        </Section>
      )}

      {/* ══ SHARE — install this Tool into the sub-spaces ══ */}
      {isAdmin && hasSubspaces && !tool.invalid && spaceId && (
        <div className="mb-5">
          <ShareWithRooms
            spaceId={spaceId}
            value={tool.share ?? 'none'}
            saving={sharing}
            onSave={saveShare}
            what="tool"
          />
          <p className="mt-1 text-xs text-fg-muted">
            A room it reaches runs the version this space runs, over the room&apos;s own notes; the room can turn it off but not remove it.
          </p>
        </div>
      )}

      {/* ══ CONFIG — the frontmatter, read back ══ */}
      <Section title="Configuration" meta={`v${tool.version}`}>
        {config ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">Title</dt>
              <dd className="text-fg">{config.title}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Version</dt>
              <dd className="font-mono text-fg">
                {config.version === 0 ? 'unpublished' : config.version}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-fg-muted">Description</dt>
              <dd className="text-fg">
                {config.description || <span className="text-fg-muted">none</span>}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Rail row</dt>
              <dd className="text-fg">
                {config.surfaces.rail ? (
                  <>
                    {config.surfaces.rail.label}{' '}
                    <span className="font-mono text-[12px] text-fg-muted">{config.surfaces.rail.icon}</span>
                  </>
                ) : (
                  <span className="text-fg-muted">none — no page of its own</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">Type surfaces</dt>
              <dd className="text-fg">
                {config.surfaces.types.length === 0 ? (
                  <span className="text-fg-muted">none</span>
                ) : (
                  config.surfaces.types.map((claim) => `${claim.type} (${claim.mode})`).join(', ')
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-fg-muted">
            The frontmatter does not parse, so there is no configuration to read. Fix it on the{' '}
            <Link className="underline" href={`/directory/${encodeURIComponent(nodeId)}?tab=raw`}>
              Raw
            </Link>{' '}
            tab.
          </p>
        )}
      </Section>

      {/* ══ PERIMETER — the reach an installing space would be granting ══ */}
      {config && (
        <Section title="Perimeter" meta="what it may touch">
          <PerimeterSummary perimeter={config.perimeter} />
          <p className="mt-3 text-[12px] text-fg-muted">
            The bridge refuses anything not named here, and never widens the viewer&apos;s own grants — a tool
            can only ever show someone what they could already read.
          </p>
        </Section>
      )}

      {/* ══ REQUIREMENTS — the same check an installing space runs ══ */}
      {config && (
        <Section title="In this space" meta={missing.length > 0 ? `${missing.length} missing` : 'satisfied'}>
          {requirements === null ? (
            <p className="text-sm text-fg-muted">Nothing declared to check.</p>
          ) : missing.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-fg">
              <CheckIcon className="h-4 w-4 shrink-0 text-accent-strong" />
              Everything this tool names exists here.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {missing.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[13px] text-warning-strong">
                    <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-warning-bright" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-fg-muted">
                Missing dependencies never block an install: the tool runs degraded behind a banner and
                unsatisfied reads come back empty.
              </p>
            </>
          )}
        </Section>
      )}

      {/* ══ FILES — the notes, opened where they are actually edited ══ */}
      <Section title="Files" meta={tool.path}>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {(
            [
              ['index.md', null, 'config and docs'],
              [TOOL_SOURCE_FILES.ui.authorName, TOOL_SOURCE_FILES.ui.path, 'the interface — React, mounted in the frame'],
              [TOOL_SOURCE_FILES.data.authorName, TOOL_SOURCE_FILES.data.path, 'server-side handlers (optional)'],
            ] as const
          ).map(([file, sub, blurb]) => (
            <li key={file} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              {/* The Context tab's note strip is where these are edited — the
                  sub-notes open under the entity's own folder, so a source file
                  is never a second surface with its own editor. */}
              <Link
                href={entityContextHref(nodeId, sub)}
                className="font-mono text-[13px] font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-accent"
              >
                {file}
              </Link>
              <span className="text-[12px] text-fg-muted">{blurb}</span>
              {tool.sources[file] === null && (
                <span className="ml-auto shrink-0 rounded-md bg-warning-bright px-2 py-0.5 text-[11px] font-semibold text-white">
                  not written
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* ══ VERSIONS — what was published, and what this space decided ══ */}
      {versions.length > 0 && (
        <Section
          title="Versions"
          meta={pending ? `v${pending.version} waiting` : `${versions.length} version${versions.length === 1 ? '' : 's'}`}
          action={
            isAdmin && listedVersion?.listingId ? (
              <button type="button" onClick={() => setTransferring(listedVersion.listingId)} className={HEADER_BUTTON}>
                Transfer
              </button>
            ) : undefined
          }
        >
          <VersionTrail
            versions={versions}
            checks={view.versionChecks}
            onWithdraw={isAdmin ? setWithdrawing : undefined}
            listing={{
              viewerId: user?.id ?? null,
              isAdmin,
              onList: (version) => setListing({ version, mode: 'list' }),
              onCosign: (version) => setListing({ version, mode: 'cosign' }),
              onUnlist: async (version) => {
                if (!spaceId) return;
                try {
                  await listingAction(spaceId, version.id, { action: 'unlist' });
                  setNotice(`v${version.version} is no longer offered for listing`);
                  void reload();
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : 'Could not withdraw it');
                }
              },
            }}
          />
        </Section>
      )}

      {listing && spaceId && (
        <ListingDialog
          spaceId={spaceId}
          version={listing.version}
          mode={listing.mode}
          selfSigned={listing.version.author.userId === user?.id}
          onClose={() => setListing(null)}
          onDone={(message) => {
            setListing(null);
            setNotice(message);
            void reload();
          }}
        />
      )}

      {transferring && spaceId && (
        <TransferDialog spaceId={spaceId} listingId={transferring} onClose={() => setTransferring(null)} onDone={(message) => {
          setTransferring(null);
          setNotice(message);
        }} />
      )}

      {installing && spaceId && (
        <InstallSheet
          spaceId={spaceId}
          version={installing}
          onClose={() => setInstalling(null)}
          onInstalled={(message) => {
            setInstalling(null);
            setNotice(message);
            void refreshSpace();
            void reload();
          }}
        />
      )}

      <ConfirmDialog
        open={!!withdrawing}
        title={withdrawing ? `Withdraw v${withdrawing.version}?` : ''}
        body="It stops wherever it runs — this space, its rooms, and any space that installed it."
        confirmLabel="Withdraw"
        destructive
        error={withdrawError}
        onConfirm={async () => {
          if (!withdrawing || !spaceId) return;
          setWithdrawError(null);
          try {
            await revokeToolVersion(spaceId, withdrawing.id);
            setWithdrawing(null);
            void reload();
          } catch (e) {
            setWithdrawError(e instanceof Error ? e.message : 'Could not withdraw');
          }
        }}
        onClose={() => {
          setWithdrawing(null);
          setWithdrawError(null);
        }}
      />

      {publishing && spaceId && (
        <PublishDialog
          view={view}
          spaceId={spaceId}
          onClose={() => setPublishing(false)}
          onDone={(message) => {
            setPublishing(false);
            setNotice(message);
            void reload();
          }}
        />
      )}
    </div>
  );
}
