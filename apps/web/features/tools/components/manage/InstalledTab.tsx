'use client';

/**
 * Installed — the Tools this space runs, and every decision an admin has left to
 * make about them: on or off, a waiting upgrade, which types they own, and
 * whether to keep them at all.
 *
 * Members see the same list read-only. A Tool in the sidebar is not a secret
 * from the people it renders for, and being able to see that one is switched off
 * (or running degraded) is how they know the empty pane is not their fault. What
 * they do not see is a pending upgrade — the server strips it, because offering
 * "a new version is available" to somebody who cannot apply it is noise with a
 * perimeter diff attached.
 *
 * Every mutation asks the shell to re-read the list rather than patching a row
 * in place: an upgrade re-resolves type claims, a re-check rewrites every row,
 * and an install's rail row lives in the space record — one honest re-read beats
 * three optimistic ones drifting apart.
 */

import { useEffect, useState } from 'react';
import Link from '@/features/shared/components/SpaceLink';
import { BlocksIcon, CircleArrowUpIcon, ExternalLinkIcon, TriangleAlertIcon } from '@/features/shared/icons';
import { Chip, ConfirmDialog, EmptyState, Skeleton, Button, Select, Toggle } from '@visvine/ui';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import BindingFields from '@/features/tools/components/BindingFields';
import { fetchBindable, fetchVersion, patchInstall, uninstallTool } from '@/features/tools/lib/client';
import type { BindableSpace, BindingValues } from '@visvine/tool-protocol/bindings';
import { describeRequirements } from '@/lib/tools/requirements';
import type { InstallSummary, VersionDetail } from '@/lib/tools/api';
import type { TypeClaimMode } from '@/lib/tools/installs';
import { color } from '@visvine/tokens';

export default function InstalledTab({
  spaceId,
  installs,
  isAdmin,
  loading,
  onChanged,
  onToast,
}: {
  spaceId: string | null;
  installs: InstallSummary[];
  isAdmin: boolean;
  loading: boolean;
  onChanged: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [removing, setRemoving] = useState<InstallSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [space, setSpace] = useState<BindableSpace | null>(null);
  const binds = isAdmin && installs.some((i) => Object.keys(i.slots).length > 0);

  useEffect(() => {
    if (!spaceId || !binds) return;
    const ctl = new AbortController();
    fetchBindable(spaceId, ctl.signal).then(setSpace).catch(() => {});
    return () => ctl.abort();
  }, [spaceId, binds]);

  if (!spaceId) {
    return (
      <EmptyState
        icon={<BlocksIcon className="h-6 w-6" />}
        // `EmptyState` shows the description and keeps the title only as its
        // fallback, so each line has to stand on its own.
        title="No space selected"
        description="No space selected — installed tools belong to one. Pick a space from the switcher to see what it runs."
      />
    );
  }

  if (loading) return <RowsSkeleton />;

  if (installs.length === 0) {
    return null;
  }

  const act = async (install: InstallSummary, run: () => Promise<unknown>, done: string) => {
    setBusy(install.id);
    try {
      await run();
      onToast('success', done);
      onChanged();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="-my-4 divide-y divide-line-subtle">
        {installs.map((install) => (
          <InstallRow
            key={install.id}
            spaceId={spaceId}
            install={install}
            isAdmin={isAdmin}
            busy={busy === install.id}
            onAct={(run, done) => act(install, run, done)}
            onRemove={() => setRemoving(install)}
            onToast={onToast}
            space={space}
          />
        ))}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={`Uninstall ${removing?.title ?? ''}?`}
        body="Anything it stored goes with it. Notes it wrote stay."
        confirmLabel="Uninstall"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          const target = removing;
          setRemoving(null);
          await act(target, () => uninstallTool(spaceId, target.id), `${target.title} uninstalled.`);
        }}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

function InstallRow({
  spaceId,
  install,
  isAdmin,
  busy,
  onAct,
  onRemove,
  onToast,
  space,
}: {
  spaceId: string;
  install: InstallSummary;
  isAdmin: boolean;
  busy: boolean;
  onAct: (run: () => Promise<unknown>, done: string) => void;
  onRemove: () => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
  space: BindableSpace | null;
}) {
  const missing = describeRequirements(install.requirements);
  const [bindings, setBindings] = useState<BindingValues>(install.bindings);
  const [settings, setSettings] = useState<Record<string, unknown>>(install.settings);
  const saved = JSON.stringify([install.bindings, install.settings]);
  // A save re-reads the list, and the server's canonical values replace the draft.
  useEffect(() => {
    const [b, st] = JSON.parse(saved) as [BindingValues, Record<string, unknown>];
    setBindings(b);
    setSettings(st);
  }, [saved]);
  const dirty =
    JSON.stringify(bindings) !== JSON.stringify(install.bindings) ||
    JSON.stringify(settings) !== JSON.stringify(install.settings);
  const configurable = Object.keys(install.slots).length > 0 || Object.keys(install.settingSpecs).length > 0;

  return (
    <section className="py-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">{install.title}</h3>
            {!install.enabled && (
              <Chip tone="muted" size="sm">
                Off
              </Chip>
            )}
            {install.degraded && (
              <Chip tone="solid" size="sm" color={color.warning.default}>
                Degraded
              </Chip>
            )}
            {install.sharedFrom && (
              <Chip tone="muted" size="sm">
                Shared from {install.sharedFrom.name}
              </Chip>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-fg-muted">
            {install.slug} · v{install.version}
          </p>
          {install.stopped && <p className="mt-1 text-sm text-danger">{install.stopped}</p>}
          {install.description && (
            <p className="mt-1 line-clamp-2 text-sm text-fg-secondary">{install.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {install.rail && install.enabled && (
            <Link
              href={`/t/${install.slug}`}
              className="flex items-center gap-1 text-xs font-medium text-accent-strong hover:opacity-80"
            >
              Open <ExternalLinkIcon className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          <Toggle
            checked={install.enabled}
            disabled={!isAdmin || busy}
            aria-label={`${install.title} enabled`}
            onChange={(next) =>
              onAct(
                () => patchInstall(spaceId, install.id, { enabled: next }),
                `${install.title} ${next ? 'enabled' : 'disabled'}.`,
              )
            }
          />
        </div>
      </header>

      {missing.length > 0 && (
        <div className="mt-3 border-l-2 border-warning-bright pl-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning-strong">
            <TriangleAlertIcon className="h-4 w-4 shrink-0" aria-hidden />
            Running with limits
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-warning-strong">
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-warning">
            Unsatisfied reads come back empty. Add what it needs, then re-check.
          </p>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={busy}
              onClick={() =>
                onAct(
                  () => patchInstall(spaceId, install.id, { recheck: true }),
                  'Requirements re-checked against this space.',
                )
              }
            >
              Re-check
            </Button>
          )}
        </div>
      )}

      {install.pendingVersion && isAdmin && !install.sharedFrom && (
        <UpgradeCard
          spaceId={spaceId}
          install={install}
          pending={install.pendingVersion}
          busy={busy}
          onAct={onAct}
          onToast={onToast}
        />
      )}

      {install.types.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Type pages</p>
          <ul className="space-y-2">
            {install.types.map((surface) => {
              const mode = install.typeClaims[surface.type] ?? null;
              return (
                <li key={surface.type} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-32 shrink-0 truncate font-mono text-[13px] text-fg">
                    {surface.type}
                  </span>
                  {isAdmin ? (
                    <Select
                      className="w-40"
                      value={mode ?? 'tab'}
                      disabled={busy}
                      aria-label={`How ${surface.type} is claimed by ${install.title}`}
                      onChange={(event) =>
                        onAct(
                          () =>
                            patchInstall(spaceId, install.id, {
                              typeClaims: { [surface.type]: event.target.value as TypeClaimMode },
                            }),
                          `${install.title} now ${event.target.value === 'page' ? 'owns' : 'adds a tab to'} the ${surface.type} page.`,
                        )
                      }
                    >
                      <option value="tab">Adds a tab</option>
                      <option value="page">Owns the page</option>
                    </Select>
                  ) : (
                    <span className="text-fg-secondary">
                      {mode === 'page' ? 'Owns the page' : mode === 'tab' ? 'Adds a tab' : 'Not claimed here'}
                    </span>
                  )}
                  {mode === null && (
                    <span className="text-xs text-fg-muted">
                      Declared but unclaimed — another tool holds this page.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {isAdmin && configurable && (
        <div className="mt-3">
          <BindingFields
            headings
            slots={install.slots}
            settingSpecs={install.settingSpecs}
            bindings={bindings}
            settings={settings}
            space={space}
            onBindings={setBindings}
            onSettings={setSettings}
            disabled={busy}
          />
          {dirty && (
            <div className="mt-2 flex justify-end">
              <Button
                variant="brand"
                size="sm"
                disabled={busy}
                onClick={() =>
                  onAct(
                    () =>
                      patchInstall(spaceId, install.id, {
                        bind: {
                          // Only what moved; a slot cleared in the picker is sent empty, which unbinds it.
                          bindings: Object.fromEntries(
                            Object.keys(install.slots)
                              .filter((name) => (bindings[name] ?? '') !== (install.bindings[name] ?? ''))
                              .map((name) => [name, bindings[name] ?? '']),
                          ),
                          settings: Object.fromEntries(
                            Object.keys(install.settingSpecs).map((key) => [key, settings[key] ?? null]),
                          ),
                        },
                      }),
                    `${install.title} bound.`,
                  )
                }
              >
                Save
              </Button>
            </div>
          )}
        </div>
      )}

      {isAdmin && !install.sharedFrom && (
        <div className="mt-3 flex justify-end">
          <Button variant="danger-text" size="sm" onClick={onRemove} disabled={busy}>
            Uninstall
          </Button>
        </div>
      )}
      {isAdmin && install.sharedFrom && (
        <p className="mt-3 text-xs text-fg-muted">
          Installed here by {install.sharedFrom.name}; it follows the version that space runs. Turn it off here, or stop sharing it there.
        </p>
      )}
    </section>
  );
}

/**
 * A new version has been approved and is waiting for an admin. Code never
 * changes under a space silently, so this is a card with a button rather than a
 * background upgrade — and the button sits under the perimeter diff, which is
 * the thing actually being approved.
 *
 * The diff comes with the install; the full incoming perimeter does not (the
 * list would carry a perimeter per row for a card almost nobody has open), so it
 * is fetched when the card is expanded and the diff is layered over it.
 */
function UpgradeCard({
  spaceId,
  install,
  pending,
  busy,
  onAct,
  onToast,
}: {
  spaceId: string;
  install: InstallSummary;
  pending: NonNullable<InstallSummary['pendingVersion']>;
  busy: boolean;
  onAct: (run: () => Promise<unknown>, done: string) => void;
  onToast: (tone: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}) {
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const expand = async () => {
    setOpen(true);
    if (detail || loading) return;
    setLoading(true);
    try {
      const body = await fetchVersion(pending.id);
      setDetail(body.version);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Could not read the new version.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 border-l-2 border-success pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-success-strong">
          <CircleArrowUpIcon className="h-4 w-4 shrink-0" aria-hidden />
          Version {pending.version} is available
        </p>
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : expand())}
          className="text-xs font-medium text-success-strong underline"
        >
          {open ? 'Hide what changes' : 'See what changes'}
        </button>
        <Button
          variant="brand"
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() =>
            onAct(
              () => patchInstall(spaceId, install.id, { applyUpgrade: true }),
              `${install.title} upgraded to v${pending.version}.`,
            )
          }
        >
          Approve upgrade
        </Button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg bg-surface-subtle p-3">
          {loading && <Skeleton className="h-16 w-full rounded" />}
          {detail && <PerimeterSummary perimeter={detail.perimeter} diff={pending.perimeterDiff} />}
          {detail && (
            <p className="mt-2 text-xs text-fg-muted">
              Green is reach the new version asks for that v{install.version} did not; struck-through red is
              reach it gives up.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="py-2">
          <Skeleton className="h-4 w-1/3 rounded" />
          <Skeleton className="mt-2 h-3 w-1/4 rounded" />
          <Skeleton className="mt-3 h-3 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}
