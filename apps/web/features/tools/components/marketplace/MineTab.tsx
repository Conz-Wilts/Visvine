'use client';

/**
 * Mine — the working copies authored in this space: what builds, what doesn't,
 * and the way to ship one.
 *
 * There is no builder here, and that is the design. A Tool is written by an
 * external coding agent over Visvine's MCP server (`get_tool_sdk` → `create_tool`
 * → `write_tool`), which is why the first card on this tab explains that flow
 * instead of offering a text area. What this screen owns is the part the agent
 * cannot do: reading the build, opening the Tool's note, previewing it, and — for
 * an admin — publishing it into the review queue.
 *
 * The roster is narrowed by the caller's own grants server-side, so "mine" means
 * the Tools in this space you can see. A Tool whose config does not parse is
 * listed with its error rather than hidden: a broken Tool the author cannot see
 * is a Tool they cannot fix.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Hammer, ExternalLink, Eye } from 'lucide-react';
import { Chip, EmptyState, Modal, Skeleton, Textarea } from '@/components/ui';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import { toolDiagnosticLine } from '@/features/tools/components/BuildDiagnostics';
import { publishTool } from '@/features/tools/lib/client';
import type { AuthoredToolSummary } from '@/lib/tools/api';
import type { ToolVersionStatus } from '@/lib/tools/registry';

/** The MCP call that hands a coding agent the SDK, its types and the guide. */
const SDK_HINT = 'get_tool_sdk';

/** How many compile errors a row shows before it stops listing them. */
const SHOWN_DIAGNOSTICS = 3;

/** What a publish this session did, so the row can say so. The roster route
 *  carries the working copy, not the registry, so this is the only place a
 *  submission's state is known without leaving the page. */
interface Submitted {
  version: number;
  status: ToolVersionStatus;
}

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
  const [submitted, setSubmitted] = useState<Record<string, Submitted>>({});

  return (
    <div className="space-y-4">
      <NewToolCard onToast={onToast} />

      {!spaceId ? (
        <EmptyState
          icon={<Hammer className="h-6 w-6" />}
          // `EmptyState` shows the description and keeps the title only as its
          // fallback, so each line has to stand on its own.
          title="No space selected"
          description="No space selected — tools are authored inside one. Pick a space from the switcher to see yours."
        />
      ) : loading ? (
        <RowsSkeleton />
      ) : tools.length === 0 ? (
        <EmptyState
          icon={<Hammer className="h-6 w-6" />}
          title="You haven’t written a tool here yet"
          description="You haven’t written a tool in this space yet. Point a coding agent at it over MCP and ask for one — the card above has the first call."
        />
      ) : (
        tools.map((tool) => (
          <AuthoredRow
            key={tool.name}
            tool={tool}
            isAdmin={isAdmin}
            submitted={submitted[tool.name] ?? null}
            onPublish={() => setPublishing(tool)}
          />
        ))
      )}

      {publishing && spaceId && (
        <PublishDialog
          spaceId={spaceId}
          tool={publishing}
          onClose={() => setPublishing(null)}
          onPublished={(version, status) => {
            setSubmitted((current) => ({ ...current, [publishing.name]: { version, status } }));
            setPublishing(null);
            onToast('success', `${publishing.title} v${version} submitted for review.`);
            onChanged();
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function AuthoredRow({
  tool,
  isAdmin,
  submitted,
  onPublish,
}: {
  tool: AuthoredToolSummary;
  isAdmin: boolean;
  submitted: Submitted | null;
  onPublish: () => void;
}) {
  const build = tool.build;
  const errors = build?.errors ?? [];
  const publishable = isAdmin && build !== null && build.ok && tool.invalid === null;

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-1 p-4 shadow-soft">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-text-primary">{tool.title || tool.name}</h3>
            {build === null ? (
              <Chip tone="muted" size="sm">
                Not built
              </Chip>
            ) : build.ok ? (
              <Chip tone="soft" size="sm" color="#16a34a">
                Builds
              </Chip>
            ) : (
              <Chip tone="soft" size="sm" color="#dc2626">
                {errors.length} {errors.length === 1 ? 'error' : 'errors'}
              </Chip>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-text-muted">
            {tool.name} · {tool.version > 0 ? `published v${tool.version}` : 'never published'}
          </p>
          {tool.description && <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{tool.description}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href={`/directory/${encodeURIComponent(`tool:${tool.name}`)}`}
            className="flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-brand-green hover:text-text-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Open
          </Link>
          <Link
            href={`/tools/preview/${encodeURIComponent(tool.name)}`}
            className="flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-brand-green hover:text-text-primary"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            Preview
          </Link>
          {isAdmin && (
            <Button variant="brand" size="sm" onClick={onPublish} disabled={!publishable}>
              Publish
            </Button>
          )}
        </div>
      </header>

      {submitted && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          v{submitted.version} is <span className="font-medium">{submitted.status}</span> — a Visvine reviewer
          reads the perimeter and the code diff before it reaches the marketplace.
        </p>
      )}

      {tool.invalid && (
        <Alert variant="error" className="mt-3">
          <span className="font-medium">index.md doesn&rsquo;t parse:</span> {tool.invalid}
        </Alert>
      )}

      {errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
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
          Members write tools; a space admin publishes them. Ask one to ship this when it&rsquo;s ready.
        </p>
      )}
    </section>
  );
}

/**
 * Publishing snapshots an immutable version and queues it for a Visvine
 * super-admin, so the confirm restates the reach that reviewer will see — the
 * perimeter is the thing being submitted, and an author should not learn what
 * they declared from the rejection.
 */
function PublishDialog({
  spaceId,
  tool,
  onClose,
  onPublished,
  onToast,
}: {
  spaceId: string;
  tool: AuthoredToolSummary;
  onClose: () => void;
  onPublished: (version: number, status: ToolVersionStatus) => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const perimeter = tool.build?.config?.perimeter ?? null;

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const body = await publishTool(spaceId, tool.name, note.trim() || undefined);
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
            Publish for review
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {failure && <Alert variant="error">{failure}</Alert>}

        <p className="text-sm text-text-secondary">
          This snapshots the tool as v{tool.version + 1} and sends it to a Visvine reviewer. The snapshot is
          immutable — later edits here don&rsquo;t change what anyone installed.
        </p>

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
            placeholder="Optional — what changed, or why this reach is needed."
          />
        </label>
      </div>
    </Modal>
  );
}

/** The authoring path, stated once at the top of the tab. */
function NewToolCard({ onToast }: { onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      ?.writeText(SDK_HINT)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => onToast('error', 'Could not copy — the call is get_tool_sdk.'));
  };

  return (
    <section className="rounded-2xl border border-dashed border-border-default bg-surface-2 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-light-bg text-brand-dark-green">
          <Hammer className="h-5 w-5" aria-hidden />
        </span>
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
        <Button variant="ghost" size="sm" onClick={copy} className="shrink-0">
          <span className="flex items-center gap-1.5">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
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
        <div key={i} className="rounded-2xl border border-border-subtle bg-surface-1 p-4">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="mt-2 h-3 w-1/4 rounded" />
          <Skeleton className="mt-3 h-3 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}
