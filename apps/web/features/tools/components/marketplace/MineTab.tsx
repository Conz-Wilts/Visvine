'use client';

/**
 * Mine — the working copies authored in this space: what builds, what doesn't,
 * and the way to ship one.
 *
 * There is no builder here, and that is the design. A Tool is written by an
 * external coding agent over Visvine's MCP server (`get_tool_sdk` → `create_tool`
 * → `write_tool`), which is why the first card on this tab explains that flow
 * instead of offering a text area. What this screen owns is the part the agent
 * cannot do: reading the build, opening the Tool's note, previewing it, and
 * shipping it.
 *
 * Shipping is TWO steps here, and keeping them apart is the point. Publish
 * snapshots a version into THIS space — an admin's publish is approved as it
 * lands, a member's waits in Approvals — and that is where most Tools stop. Only
 * "Submit to marketplace" offers one to other spaces, and only a Visvine
 * super-admin can grant it. A Tool written in a private space is nobody else's
 * until somebody in that space decides otherwise.
 *
 * The roster is narrowed by the caller's own grants server-side, so "mine" means
 * the Tools in this space you can see. A Tool whose config does not parse is
 * listed with its error rather than hidden: a broken Tool the author cannot see
 * is a Tool they cannot fix.
 */

import { useState } from 'react';
import { useCopied } from '@/features/shared/hooks/useCopied';
import Link from 'next/link';
import { CheckIcon, CopyIcon, ExternalLinkIcon, EyeIcon, HammerIcon, Trash2Icon } from '@/features/shared/icons';
import { Chip, ConfirmDialog, EmptyState, Modal, Skeleton, Textarea } from '@/components/ui';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import { toolDiagnosticLine } from '@/features/tools/components/BuildDiagnostics';
import ToolIconPicker from '@/features/tools/components/marketplace/ToolIconPicker';
import {
  deleteAuthoredTool,
  listOnMarketplace,
  publishTool,
  unlistFromMarketplace,
} from '@/features/tools/lib/client';
import type { AuthoredToolSummary } from '@/lib/tools/api';
import type { ToolVersionStatus } from '@/lib/tools/registry';

/** The MCP call that hands a coding agent the SDK, its types and the guide. */
const SDK_HINT = 'get_tool_sdk';

/** How many compile errors a row shows before it stops listing them. */
const SHOWN_DIAGNOSTICS = 3;

export default function MineTab({
  spaceId,
  tools,
  isAdmin,
  loading,
  onChanged,
  onToast,
}: {
  spaceId: string | null;
  tools: AuthoredToolSummary[];
  isAdmin: boolean;
  loading: boolean;
  onChanged: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [publishing, setPublishing] = useState<AuthoredToolSummary | null>(null);
  const [listing, setListing] = useState<AuthoredToolSummary | null>(null);
  const [removing, setRemoving] = useState<AuthoredToolSummary | null>(null);

  return (
    <div className="space-y-4">
      <NewToolCard onToast={onToast} />

      {!spaceId ? (
        <EmptyState
          icon={<HammerIcon className="h-6 w-6" />}
          // `EmptyState` shows the description and keeps the title only as its
          // fallback, so each line has to stand on its own.
          title="No space selected"
          description="No space selected — tools are authored inside one. Pick a space from the switcher to see yours."
        />
      ) : loading ? (
        <RowsSkeleton />
      ) : tools.length === 0 ? (
        <EmptyState
          icon={<HammerIcon className="h-6 w-6" />}
          title="You haven’t written a tool here yet"
          description="You haven’t written a tool in this space yet. Point a coding agent at it over MCP and ask for one — the card above has the first call."
        />
      ) : (
        tools.map((tool) => (
          <AuthoredRow
            key={tool.name}
            spaceId={spaceId}
            tool={tool}
            isAdmin={isAdmin}
            onPublish={() => setPublishing(tool)}
            onList={() => setListing(tool)}
            onUnlist={async () => {
              if (!spaceId || !tool.publication) return;
              try {
                await unlistFromMarketplace(spaceId, tool.publication.versionId);
                onToast('success', `${tool.title || tool.name} withdrawn from the review queue.`);
                onChanged();
              } catch (err) {
                onToast('error', err instanceof Error ? err.message : 'The withdrawal did not go through.');
              }
            }}
            onRemove={() => setRemoving(tool)}
            onChanged={onChanged}
            onToast={onToast}
          />
        ))
      )}

      {publishing && spaceId && (
        <PublishDialog
          spaceId={spaceId}
          tool={publishing}
          isAdmin={isAdmin}
          onClose={() => setPublishing(null)}
          onPublished={(version, status) => {
            setPublishing(null);
            onToast(
              'success',
              status === 'approved'
                ? `${publishing.title} v${version} is live in this space.`
                : `${publishing.title} v${version} sent to your admins for approval.`,
            );
            onChanged();
          }}
          onToast={onToast}
        />
      )}

      {listing && spaceId && listing.publication && (
        <ListingDialog
          spaceId={spaceId}
          tool={listing}
          versionId={listing.publication.versionId}
          version={listing.publication.version}
          onClose={() => setListing(null)}
          onListed={(status) => {
            setListing(null);
            onToast(
              'success',
              status === 'approved'
                ? `${listing.title} is on the marketplace.`
                : `${listing.title} submitted to Visvine for review.`,
            );
            onChanged();
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title={`Delete ${removing?.title || removing?.name || ''}?`}
        body={
          <>
            Its source notes under <code className="font-mono text-[13px]">tools/{removing?.name}</code> are
            trashed and it disappears from this list and the graph. Versions already published to the
            marketplace are immutable snapshots and stay.
          </>
        }
        confirmLabel="Delete tool"
        destructive
        onConfirm={async () => {
          if (!removing || !spaceId) return;
          const target = removing;
          setRemoving(null);
          try {
            await deleteAuthoredTool(spaceId, target.name);
            onToast('success', `${target.title || target.name} deleted.`);
            onChanged();
          } catch (err) {
            onToast('error', err instanceof Error ? err.message : 'The delete did not go through.');
          }
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

const VERDICT_COLOR: Record<ToolVersionStatus, string> = {
  pending: '#d97706',
  approved: '#16a34a',
  rejected: '#dc2626',
  withdrawn: '#6b7280',
};

/**
 * Beside the build chip: where a Tool's newest version stands — in ITS OWN
 * SPACE first, and then, only if somebody asked, with Visvine.
 *
 * Two chips rather than one because they are two verdicts, and collapsing them
 * is exactly the confusion this surface exists to end: "approved" here means
 * this space runs it, and says nothing about whether anyone else can see it.
 */
function PublicationChip({ publication }: { publication: AuthoredToolSummary['publication'] }) {
  if (!publication) return null;
  const label: Record<ToolVersionStatus, string> = {
    pending: 'Waiting on an admin',
    approved: 'Live in this space',
    rejected: 'Rejected here',
    withdrawn: 'Superseded',
  };
  const listing: Record<ToolVersionStatus, string> = {
    pending: 'Marketplace: in review',
    approved: 'On the marketplace',
    rejected: 'Marketplace: rejected',
    withdrawn: 'Marketplace: withdrawn',
  };
  return (
    <>
      <Chip tone="solid" size="sm" color={VERDICT_COLOR[publication.status]}>
        v{publication.version} · {label[publication.status]}
      </Chip>
      {publication.marketplaceStatus ? (
        <Chip tone="solid" size="sm" color={VERDICT_COLOR[publication.marketplaceStatus]}>
          {listing[publication.marketplaceStatus]}
        </Chip>
      ) : (
        <Chip tone="muted" size="sm">
          Private to this space
        </Chip>
      )}
    </>
  );
}

function AuthoredRow({
  spaceId,
  tool,
  isAdmin,
  onPublish,
  onList,
  onUnlist,
  onRemove,
  onChanged,
  onToast,
}: {
  spaceId: string | null;
  tool: AuthoredToolSummary;
  isAdmin: boolean;
  onPublish: () => void;
  onList: () => void;
  onUnlist: () => void;
  onRemove: () => void;
  onChanged: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const build = tool.build;
  const errors = build?.errors ?? [];
  // Publishing is a member act now: an admin's lands approved, a member's lands
  // in Approvals. What still stops either is a tool that does not compile.
  const publishable = build !== null && build.ok && tool.invalid === null;
  const publication = tool.publication;
  // Only a version this space has already approved may be offered to anyone
  // else, and only an admin may offer it.
  const listable =
    isAdmin && publication?.status === 'approved' && publication.marketplaceStatus === null;
  const unlistable = isAdmin && publication?.marketplaceStatus === 'pending';

  return (
    <section className="border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text-primary">{tool.title || tool.name}</h3>
            {build === null ? (
              <Chip tone="muted" size="sm">
                Not built
              </Chip>
            ) : build.ok ? (
              <Chip tone="solid" size="sm" color="#16a34a">
                Builds
              </Chip>
            ) : (
              <Chip tone="solid" size="sm" color="#dc2626">
                {errors.length} {errors.length === 1 ? 'error' : 'errors'}
              </Chip>
            )}
            <PublicationChip publication={tool.publication} />
          </div>
          <p className="truncate font-mono text-[11px] text-text-muted">
            {tool.name} · {tool.version > 0 ? `published v${tool.version}` : 'never published'}
          </p>
          {tool.description && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{tool.description}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {spaceId && (
            <ToolIconPicker spaceId={spaceId} tool={tool} onChanged={onChanged} onToast={onToast} />
          )}
          <Link
            href={`/directory/${encodeURIComponent(`tool:${tool.name}`)}`}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
            Open
          </Link>
          <Link
            href={`/tools/preview/${encodeURIComponent(tool.name)}`}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3 hover:text-text-primary"
          >
            <EyeIcon className="h-3.5 w-3.5" aria-hidden />
            Preview
          </Link>
          <CopyPreviewLink name={tool.name} onToast={onToast} />
          {/* Always offered: the server holds the delete to the note store's
              removal bar (admin, the author, or edit access), and its refusal
              sentence lands in the toast. */}
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3 hover:text-red-600"
          >
            <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
            Delete
          </button>
          {listable && (
            <Button variant="ghost" size="sm" onClick={onList}>
              Submit to marketplace…
            </Button>
          )}
          {unlistable && (
            <Button variant="ghost" size="sm" onClick={onUnlist}>
              Withdraw listing
            </Button>
          )}
          <Button variant="brand" size="sm" onClick={onPublish} disabled={!publishable}>
            {isAdmin ? 'Publish' : 'Publish for approval'}
          </Button>
        </div>
      </header>

      {publication?.reviewNote && (
        <p className="mt-3 border-l-2 border-border-default pl-3 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">From your admin</span> — {publication.reviewNote}
        </p>
      )}
      {publication?.marketplaceReviewNote && (
        <p className="mt-2 border-l-2 border-border-default pl-3 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">From the Visvine reviewer</span> —{' '}
          {publication.marketplaceReviewNote}
        </p>
      )}

      {tool.invalid && (
        <Alert variant="error" className="mt-3">
          <span className="font-medium">index.md doesn&rsquo;t parse:</span> {tool.invalid}
        </Alert>
      )}

      {errors.length > 0 && (
        <div className="mt-3 border-l-2 border-red-500 pl-3">
          <p className="text-sm font-medium text-red-700">This tool does not compile</p>
          <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-red-700">
            {errors.slice(0, SHOWN_DIAGNOSTICS).map((error, i) => (
              <li key={`${error.file}:${error.line}:${i}`}>{toolDiagnosticLine(error)}</li>
            ))}
          </ul>
          {errors.length > SHOWN_DIAGNOSTICS && (
            <p className="mt-1 text-xs text-red-600">
              …and {errors.length - SHOWN_DIAGNOSTICS} more. Your coding agent sees all of them on the next
              write.
            </p>
          )}
        </div>
      )}

      {!isAdmin && build?.ok && (
        <p className="mt-3 text-xs text-text-muted">
          Publishing snapshots this version for your space&rsquo;s admins to approve. It stays in this space
          either way — nothing here puts a tool on the marketplace.
        </p>
      )}
    </section>
  );
}

/**
 * Publishing snapshots an immutable version INTO THIS SPACE, so the confirm
 * says exactly that and restates the reach — the perimeter is the thing being
 * decided on, and neither an author nor whoever approves it should learn what
 * was declared from the rejection.
 */
function PublishDialog({
  spaceId,
  tool,
  isAdmin,
  onClose,
  onPublished,
  onToast,
}: {
  spaceId: string;
  tool: AuthoredToolSummary;
  isAdmin: boolean;
  onClose: () => void;
  onPublished: (version: number, status: ToolVersionStatus) => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const perimeter = tool.build?.config?.perimeter ?? null;

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const body = await publishTool(spaceId, tool.name, note.trim() || undefined, releaseNotes.trim() || undefined);
      if (body.warning) onToast('warning', body.warning);
      onPublished(body.version.version, body.version.status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The publish did not go through.';
      setFailure(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      size="md"
      title={`Publish ${tool.title || tool.name}?`}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={confirm} loading={busy} loadingText="Publishing…">
            {isAdmin ? 'Publish to this space' : 'Send for approval'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {failure && <Alert variant="error">{failure}</Alert>}

        <p className="text-sm text-text-secondary">
          This snapshots the tool as v{tool.version + 1} for <strong>this space only</strong>.{' '}
          {isAdmin
            ? 'You are an admin, so it is approved as it lands and can be installed here straight away.'
            : 'Your space’s admins get it in Approvals; nothing installs until one of them says yes.'}{' '}
          The snapshot is immutable — later edits here don&rsquo;t change what anyone installed. Putting it
          on the marketplace is a separate step, afterwards.
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Reach this version declares
          </h3>
          {perimeter ? (
            <PerimeterSummary perimeter={perimeter} />
          ) : (
            <p className="text-sm text-text-muted">This tool hasn&rsquo;t built, so it declares nothing yet.</p>
          )}
        </section>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-primary">Release notes</span>
          <Textarea
            value={releaseNotes}
            onChange={(event) => setReleaseNotes(event.target.value)}
            rows={3}
            maxLength={2048}
            placeholder="Optional — what this version changes, for the people who install it."
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-primary">
            {isAdmin ? 'Note on this version' : 'Note for your admin'}
          </span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Optional — what changed, or why this reach is needed."
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * The second, deliberate step: offering an approved version to every other
 * space.
 *
 * Separate from Publish on purpose, and worded to make the consequence
 * unmissable — this is the only control in the app that takes a Tool out of the
 * space that wrote it. A Visvine super-admin reads the perimeter and a code
 * diff before anything lists; the answer comes back through the bell.
 */
function ListingDialog({
  spaceId,
  tool,
  versionId,
  version,
  onClose,
  onListed,
}: {
  spaceId: string;
  tool: AuthoredToolSummary;
  versionId: string;
  version: number;
  onClose: () => void;
  onListed: (status: ToolVersionStatus) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const perimeter = tool.build?.config?.perimeter ?? null;

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const body = await listOnMarketplace(spaceId, versionId, note.trim() || undefined);
      onListed(body.version.marketplaceStatus ?? 'pending');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The submission did not go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      size="md"
      title={`Submit ${tool.title || tool.name} v${version} to the marketplace?`}
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={confirm} loading={busy} loadingText="Submitting…">
            Submit for review
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {failure && <Alert variant="error">{failure}</Alert>}

        <Alert variant="warning">
          This offers the tool to <strong>every other space on Visvine</strong>. Its source, its declared
          reach and your name go to a Visvine reviewer, and once approved any space can install it. If this
          tool is only for the people here, it already works — leave it unlisted.
        </Alert>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Reach the reviewer will see
          </h3>
          {perimeter ? (
            <PerimeterSummary perimeter={perimeter} />
          ) : (
            <p className="text-sm text-text-muted">This tool hasn&rsquo;t built, so it declares nothing yet.</p>
          )}
        </section>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-primary">Note for the reviewer</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Optional — what it is for, and why it needs this reach."
          />
        </label>
      </div>
    </Modal>
  );
}

/**
 * The preview URL, on the clipboard.
 *
 * The link beside it opens the preview here; this is the one you paste into a
 * chat with the agent that is building the tool, or send to someone whose
 * opinion you want. Same page either way — a working copy renders live, so the
 * link stays right as the tool changes under it.
 */
function CopyPreviewLink({
  name,
  onToast,
}: {
  name: string;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [copied, copy] = useCopied(2000);
  const href = `/tools/preview/${encodeURIComponent(name)}`;

  return (
    <button
      type="button"
      onClick={async () => {
        // Absolute, because the point of copying it is to paste it somewhere
        // that is not this app.
        const url = typeof window === 'undefined' ? href : new URL(href, window.location.origin).toString();
        if (!(await copy(url))) onToast('error', `Could not copy — the link is ${href}.`);
      }}
      className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-3 hover:text-text-primary"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : <CopyIcon className="h-3.5 w-3.5" aria-hidden />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

/** The authoring path, stated once at the top of the tab. */
function NewToolCard({ onToast }: { onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void }) {
  const [copied, copy] = useCopied(2000);

  const copyHint = async () => {
    if (!(await copy(SDK_HINT))) onToast('error', 'Could not copy — the call is get_tool_sdk.');
  };

  return (
    <section className="border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start gap-3">
        <HammerIcon className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">New tool</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Tools are written by a coding agent, not in this app. Connect Claude Code or Cursor to this
            space&rsquo;s MCP server and start with{' '}
            <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[13px] text-text-primary">
              {SDK_HINT}
            </code>{' '}
            — it hands over the SDK, its types and the guide. Then{' '}
            <code className="font-mono text-[13px]">create_tool</code>, and{' '}
            <code className="font-mono text-[13px]">write_tool</code> one file at a time; compile errors come
            straight back to it.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={copyHint} className="shrink-0">
          <span className="flex items-center gap-1.5">
            {copied ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : <CopyIcon className="h-3.5 w-3.5" aria-hidden />}
            {copied ? 'Copied' : `Copy ${SDK_HINT}`}
          </span>
        </Button>
      </div>
    </section>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div key={i} className="py-2">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="mt-2 h-3 w-1/4 rounded" />
          <Skeleton className="mt-3 h-3 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}
