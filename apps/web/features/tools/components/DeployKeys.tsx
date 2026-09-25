'use client';

/**
 * A Tool's deploy keys, on its own Tool tab, for whoever may edit it: the
 * keys a CI job or a terminal pushes this one Tool with (lib/tools/deployKeys.ts).
 * A new key is shown once, here, and never again.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, ConfirmDialog, Input } from '@visvine/ui';
import { CheckIcon, CopyIcon } from '@/features/shared/icons';
import { useCopied } from '@/features/shared/hooks/useCopied';
import { timeAgo } from '@/lib/date';
import type { DeployKeySummary } from '@/lib/tools/deployKeys';
import { fetchDeployKeys, mintDeployKey, revokeDeployKey } from '@/features/tools/lib/client';

const HEADER_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50';

export default function DeployKeys({ spaceId, name }: { spaceId: string; name: string }) {
  const [keys, setKeys] = useState<DeployKeySummary[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null);
  const [revoking, setRevoking] = useState<DeployKeySummary | null>(null);
  const [copied, copy] = useCopied();

  const load = useCallback(async () => {
    try {
      setKeys((await fetchDeployKeys(spaceId, name)).keys);
    } catch {
      setKeys([]);
    }
  }, [spaceId, name]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await mintDeployKey(spaceId, name, label);
      setFresh({ key: made.key, label: made.summary.label });
      setNaming(false);
      setLabel('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a key.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: DeployKeySummary) => {
    setRevoking(null);
    try {
      await revokeDeployKey(spaceId, name, key.id);
      setFresh(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke it.');
    }
  };

  return (
    <section className="border-t border-line-subtle py-5">
      <header className="flex items-center justify-between gap-3 pb-3">
        <h2 className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-fg">Deploy keys</span>
          {keys && keys.length > 0 && <span className="shrink-0 font-mono text-[11px] text-fg-muted">{keys.length}</span>}
        </h2>
        {!naming && (
          <button type="button" onClick={() => setNaming(true)} className={HEADER_BUTTON}>
            New key
          </button>
        )}
      </header>

      {naming && (
        <form
          className="mb-3 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Input
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Label"
            maxLength={40}
            className="max-w-xs py-2 text-sm"
          />
          <Button variant="brand" type="submit" disabled={busy}>
            Create
          </Button>
          <Button variant="neutral" type="button" onClick={() => setNaming(false)} disabled={busy}>
            Cancel
          </Button>
        </form>
      )}

      {fresh && (
        <div className="mb-3 rounded-lg bg-surface-subtle px-3 py-2.5">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg" data-testid="deploy-key">
              {fresh.key}
            </code>
            <button
              type="button"
              onClick={() => void copy(fresh.key)}
              className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-secondary hover:text-fg"
              aria-label="Copy key"
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1 text-[12px] text-warning-strong">Copy it now — it is not shown again.</p>
        </div>
      )}

      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}

      {keys && keys.length > 0 && (
        <ul className="flex flex-col divide-y divide-line-subtle">
          {keys.map((key) => (
            <li key={key.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 truncate text-[13px] text-fg">{key.label}</span>
              <span className="shrink-0 font-mono text-[12px] text-fg-muted">{key.prefix}…</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">
                {key.createdBy.name} · {key.lastUsedAt ? `used ${timeAgo(key.lastUsedAt)}` : 'never used'}
              </span>
              <Button variant="danger-text" size="sm" onClick={() => setRevoking(key)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {revoking && (
        <ConfirmDialog
          open
          title={`Revoke “${revoking.label}”?`}
          confirmLabel="Revoke"
          destructive
          onConfirm={() => void revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  );
}
