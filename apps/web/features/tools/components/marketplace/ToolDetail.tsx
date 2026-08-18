'use client';

/**
 * One Tool, opened from a Browse card: its own documentation, the reach it
 * declares, the trail of versions it has been through, and — for an admin — the
 * way in to installing it.
 *
 * A modal rather than a route. The catalogue is a browsing surface and losing
 * your search results to read a description would be the wrong trade; the card
 * behind stays where it was.
 *
 * Everything here is fetched fresh on open rather than carried from the card:
 * the card row is a summary, and the long description, the publication history
 * and the perimeter's diff against the previous version only exist on the
 * detail route.
 */

import { useEffect, useState } from 'react';
import { Chip, LoadingText, Modal, Skeleton } from '@/components/ui';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ToolIcon from '@/features/tools/components/toolIcons';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import { fetchVersion } from '@/features/tools/lib/client';
import type { BrowseItem, InstallSummary, VersionDetail, VersionHistoryEntry } from '@/lib/tools/api';
import type { NodeTypeConfig } from '@/lib/types/context';
import InstallDialog, { type InstallOutcome } from './InstallDialog';
import ToolDocs from './ToolDocs';

/** Publication states, in the words an author and a browser both read. */
const STATUS_LABEL: Record<VersionHistoryEntry['status'], string> = {
  pending: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const STATUS_COLOR: Record<VersionHistoryEntry['status'], string | undefined> = {
  pending: '#d97706',
  approved: '#16a34a',
  rejected: '#dc2626',
  withdrawn: undefined,
};

export default function ToolDetail({
  item,
  spaceId,
  isAdmin,
  installs,
  nodeTypes,
  onClose,
  onInstalled,
  onError,
}: {
  item: BrowseItem;
  spaceId: string | null;
  isAdmin: boolean;
  /** What this space already runs — the type-page conflicts the dialog previews. */
  installs: InstallSummary[];
  nodeTypes: NodeTypeConfig[];
  onClose: () => void;
  onInstalled: (outcome: InstallOutcome) => void;
  onError: (message: string) => void;
}) {
  const [version, setVersion] = useState<VersionDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setVersion(null);
    setFailed(null);
    fetchVersion(item.id, controller.signal)
      .then((body) => setVersion(body.version))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setFailed(err instanceof Error ? err.message : 'Could not open this tool.');
      });
    return () => controller.abort();
  }, [item.id]);

  const installed = item.installedInSpace === true;
  const canInstall = isAdmin && spaceId !== null && !installed;

  return (
    <>
      <Modal
        onClose={onClose}
        size="lg"
        title={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{item.title}</span>
            <span className="shrink-0 font-mono text-xs font-normal text-text-muted">
              {item.name} · v{item.version}
            </span>
          </span>
        }
        footer={
          <div className="flex items-center gap-3 border-t border-border-subtle px-5 py-3">
            <p className="min-w-0 flex-1 truncate text-xs text-text-muted">
              Published by {item.author.name ?? 'an unknown author'} ·{' '}
              {item.installs} {item.installs === 1 ? 'space runs it' : 'spaces run it'}
            </p>
            {installed ? (
              <Chip tone="soft" size="sm" color="#16a34a">
                Installed in this space
              </Chip>
            ) : canInstall ? (
              <Button variant="brand" onClick={() => setInstalling(true)} disabled={!version}>
                Install
              </Button>
            ) : (
              <span className="text-xs text-text-muted">
                {spaceId === null ? 'Select a space to install' : 'Only space admins can install'}
              </span>
            )}
          </div>
        }
      >
        <div className="space-y-5 px-5 py-4">
          {failed && <Alert variant="error">{failed}</Alert>}

          {!version && !failed && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 w-11/12 rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
              <LoadingText text="Loading tool…" />
            </div>
          )}

          {version && (
            <>
              <section>
                <ToolDocs source={version.indexSource} />
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Declared reach
                </h3>
                <p className="mb-2 text-sm text-text-secondary">
                  This is everything the tool may touch. It never widens what you can already see —
                  a reader only ever gets notes their own grants already allow.
                </p>
                <PerimeterSummary perimeter={version.perimeter} />
              </section>

              {version.surfaces.rail || version.surfaces.types.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Where it appears
                  </h3>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {version.surfaces.rail && (
                      <li className="flex items-center gap-1.5">
                        {/* The actual glyph, drawn as the rail would draw it —
                            a custom icon is something an admin should SEE
                            before it lands in their sidebar, not read about. */}
                        <span className="shrink-0 text-text-primary">
                          <ToolIcon name={version.surfaces.rail.icon} svg={version.iconSvg} />
                        </span>
                        <span>
                          A sidebar row labelled{' '}
                          <span className="font-medium text-text-primary">{version.surfaces.rail.label}</span>,
                          with its own full page.
                        </span>
                      </li>
                    )}
                    {version.surfaces.types.map((surface) => (
                      <li key={surface.type}>
                        {surface.mode === 'page' ? 'The page' : 'A tab'} for{' '}
                        <span className="font-mono text-[13px] text-text-primary">{surface.type}</span> notes.
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Version history
                </h3>
                <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
                  {version.history.map((entry) => (
                    <li key={entry.version} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-12 shrink-0 font-mono text-[13px] text-text-primary">v{entry.version}</span>
                      <Chip tone="soft" size="sm" color={STATUS_COLOR[entry.status]}>
                        {STATUS_LABEL[entry.status]}
                      </Chip>
                      <span className="ml-auto text-xs text-text-muted">
                        {entry.reviewedAt ? new Date(entry.reviewedAt).toLocaleDateString() : 'Not reviewed'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </Modal>

      {installing && version && spaceId && (
        <InstallDialog
          version={version}
          spaceId={spaceId}
          installs={installs}
          nodeTypes={nodeTypes}
          onClose={() => setInstalling(false)}
          onInstalled={(outcome) => {
            setInstalling(false);
            onInstalled(outcome);
          }}
          onError={onError}
        />
      )}
    </>
  );
}
