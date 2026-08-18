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
 *   • where it stands in the marketplace, and what publishing it would mean.
 *
 * Every member gets this tab, like an agent's and unlike a connector's: members
 * author Tools, and the authoring route is grant-gated rather than admin-gated.
 * The one action that isn't a member's — Publish — is hidden rather than
 * offered-and-refused, and the server refuses it regardless.
 *
 * Mirrors ConnectorPageContent's shape: a status header, then flat sections
 * separated by a rule rather than a grid of cards, because everything here is
 * one Tool and six boxes would imply six subjects.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckIcon, CopyIcon, ExternalLinkIcon, TriangleAlertIcon, UploadIcon } from '@/features/shared/icons';
import { Button, Modal, Skeleton, Textarea } from '@/components/ui';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
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
import { fetchAuthoredTool, publishTool } from '@/features/tools/lib/client';

// ── Chrome ───────────────────────────────────────────────────────────────────

const TONE_CLASSES = {
  ok: 'bg-brand-light-bg text-brand-dark-green',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
} as const;

type Tone = keyof typeof TONE_CLASSES;

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
    <section className="border-t border-border-subtle py-5">
      <header className="flex items-center justify-between gap-3 pb-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
          {meta && <span className="shrink-0 font-mono text-[11px] text-text-muted">{meta}</span>}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

const HEADER_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

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
      <p className="text-sm text-text-muted">
        This tool has never compiled — nothing has been written to{' '}
        <code className="font-mono text-[12px]">{TOOL_SOURCE_FILES.ui.authorName}</code> yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <BuildDiagnostics build={build} />

      {build.ok && build.errors.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-text-primary">
          <CheckIcon className="h-4 w-4 shrink-0 text-brand-dark-green" />
          Compiles — {fmtBytes(build.sizeBytes)} of bundle, built{' '}
          {timeAgo(new Date(build.updatedAt).getTime(), { style: 'short' })}.
        </p>
      )}

      <p className="text-[12px] text-text-muted">
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

/**
 * The publication trail: every version ever snapshotted off this working copy,
 * newest first. A rejection keeps its reviewer note — that note is the whole
 * value of the review gate to the author.
 */
function VersionTrail({ versions }: { versions: ToolVersionSummary[] }) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Never published. Publishing snapshots the working copy as an immutable version and queues it for a
        Visvine super-admin, who reads the declared reach and a code diff before anyone can install it.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {versions.map((version) => (
        <li key={version.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-mono font-semibold text-text-primary">v{version.version}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[VERSION_TONES[version.status]]}`}>
              {version.status}
            </span>
            <span className="text-text-muted">
              {version.author.name ?? 'someone'} · {timeAgo(new Date(version.submittedAt).getTime(), { style: 'short' })}
            </span>
            <span className="ml-auto shrink-0 font-mono text-text-muted">{fmtBytes(version.sizeBytes)}</span>
          </div>
          {version.reviewNote && (
            <p className="min-w-0 break-words text-[12px] text-text-secondary">
              Reviewer: {version.reviewNote}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Publishing is the one act here with consequences outside this space: it
 * snapshots code and a declared reach, hands both to a super-admin, and makes
 * the result installable everywhere. So it is a dialog showing exactly that
 * reach, not a button that fires.
 */
function PublishDialog({
  view,
  spaceId,
  onClose,
  onDone,
}: {
  view: AuthoredToolView;
  spaceId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { tool, versions } = view;
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await publishTool(spaceId, tool.name, note.trim() || undefined);
      onDone(
        res.warning ??
          `Published v${res.version.version} — waiting for a Visvine super-admin to review it.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Publish ${tool.title} v${nextVersion}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} loadingText="Publishing…">
            Publish
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4 text-sm">
        <p className="text-[13px] leading-snug text-text-muted">
          This snapshots the working copy exactly as it is now — code, config and the reach below — and queues
          it for review. Nothing installs until a Visvine super-admin approves it, and spaces already running an
          older version keep it until an admin there applies the upgrade.
        </p>

        {tool.config ? (
          <div className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2.5">
            <p className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Reach every installing space grants
            </p>
            <PerimeterSummary perimeter={tool.config.perimeter} />
          </div>
        ) : (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
            The config does not parse, so there is no declared reach to publish.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Note for the reviewer
          </span>
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed, and why it needs the reach it asks for."
          />
        </label>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      </div>
    </Modal>
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
  const { currentSpace, loading: spaceLoading, isAdmin } = useSpace();
  const spaceId = currentSpace?.id;

  const [view, setView] = useState<AuthoredToolView | null>(null);
  const [loading, setLoading] = useState(true);
  // Kept as the status alongside the message: 403 and 404 are different pages,
  // not two wordings of the same one.
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);

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
      `Run check_tool before publishing. Preview: ${origin}/tools/preview/${name}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(hint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
        <h2 className="text-lg font-semibold text-text-primary">
          {status === 403 ? 'Tools are off for you here' : 'No tool here'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
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
  const publishable = isAdmin && !!tool.build?.ok && !tool.invalid;

  return (
    <div className="profile-content-fade flex flex-col">
      {/* ══ HEADER — what it is, whether it works, and what you can do with it ══ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate font-title text-xl font-semibold text-text-primary">{tool.title}</h1>
          <span className="font-mono text-[12px] text-text-muted">{tool.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/tools/preview/${encodeURIComponent(tool.name)}`} className={HEADER_BUTTON}>
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            Preview
          </Link>
          <button type="button" onClick={copyMcpHint} className={HEADER_BUTTON}>
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-brand-dark-green" /> : <CopyIcon className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy MCP hint'}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setPublishing(true)}
              disabled={!publishable || !!pending}
              title={
                pending
                  ? `v${pending.version} is already waiting for review — withdraw it before publishing again.`
                  : publishable
                    ? undefined
                    : 'It has to compile before it can be published.'
              }
              className={HEADER_BUTTON}
            >
              <UploadIcon className="h-3.5 w-3.5" />
              Publish
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className="mb-5 rounded-2xl bg-surface-2 px-4 py-2.5 text-[13px] text-text-primary">{notice}</p>
      )}

      {status.tone !== 'ok' && (
        <p className="flex items-start gap-2 pb-5 text-xs text-text-muted">
          <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
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

      {/* ══ CONFIG — the frontmatter, read back ══ */}
      <Section title="Configuration" meta={`v${tool.version}`}>
        {config ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">Title</dt>
              <dd className="text-text-primary">{config.title}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Version</dt>
              <dd className="font-mono text-text-primary">
                {config.version === 0 ? 'unpublished' : config.version}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Description</dt>
              <dd className="text-text-primary">
                {config.description || <span className="text-text-muted">none — the marketplace card shows this</span>}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Rail row</dt>
              <dd className="text-text-primary">
                {config.surfaces.rail ? (
                  <>
                    {config.surfaces.rail.label}{' '}
                    <span className="font-mono text-[12px] text-text-muted">{config.surfaces.rail.icon}</span>
                  </>
                ) : (
                  <span className="text-text-muted">none — no page of its own</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Type surfaces</dt>
              <dd className="text-text-primary">
                {config.surfaces.types.length === 0 ? (
                  <span className="text-text-muted">none</span>
                ) : (
                  config.surfaces.types.map((claim) => `${claim.type} (${claim.mode})`).join(', ')
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-text-muted">
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
          <p className="mt-3 text-[12px] text-text-muted">
            The bridge refuses anything not named here, and never widens the viewer&apos;s own grants — a tool
            can only ever show someone what they could already read.
          </p>
        </Section>
      )}

      {/* ══ REQUIREMENTS — the same check an installing space runs ══ */}
      {config && (
        <Section title="In this space" meta={missing.length > 0 ? `${missing.length} missing` : 'satisfied'}>
          {requirements === null ? (
            <p className="text-sm text-text-muted">Nothing declared to check.</p>
          ) : missing.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-text-primary">
              <CheckIcon className="h-4 w-4 shrink-0 text-brand-dark-green" />
              Everything this tool names exists here.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {missing.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[13px] text-amber-800">
                    <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-text-muted">
                Missing dependencies never block an install: the tool runs degraded behind a banner and
                unsatisfied reads come back empty.
              </p>
            </>
          )}
        </Section>
      )}

      {/* ══ FILES — the notes, opened where they are actually edited ══ */}
      <Section title="Files" meta={tool.path}>
        <ul className="flex flex-col divide-y divide-border-subtle">
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
                className="font-mono text-[13px] font-medium text-text-primary underline decoration-border-default underline-offset-2 hover:decoration-brand-green"
              >
                {file}
              </Link>
              <span className="text-[12px] text-text-muted">{blurb}</span>
              {tool.sources[file] === null && (
                <span className="ml-auto shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  not written
                </span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* ══ MARKETPLACE — where this Tool stands outside the space ══ */}
      <Section
        title="Publishing"
        meta={pending ? `v${pending.version} in review` : versions.length > 0 ? `${versions.length} version${versions.length === 1 ? '' : 's'}` : undefined}
      >
        <VersionTrail versions={versions} />
        {!isAdmin && versions.length === 0 && (
          <p className="mt-3 text-[12px] text-text-muted">
            Members author tools; publishing one is a space admin&apos;s call.
          </p>
        )}
      </Section>

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
