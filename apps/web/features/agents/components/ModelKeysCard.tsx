'use client';

import { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Trash2 } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

export interface ProviderInfo {
  id: string;
  label: string;
  keySecret: string;
  models: { id: string; label: string }[];
}

/**
 * The space's model keys — one per provider, stored as MODEL_KEY_<PROVIDER>
 * connector secrets (encrypted, admin-only, write-only: set or delete, never
 * read back). Your agents spend YOUR key; Visvine never bills for tokens.
 */
export default function ModelKeysCard({
  spaceId,
  providers,
  stored,
  onChanged,
}: {
  spaceId: string;
  providers: ProviderInfo[];
  stored: { name: string; updatedAt: string }[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storedByName = new Map(stored.map((s) => [s.name, s.updatedAt]));

  const save = async (name: string) => {
    if (!value.trim()) return;
    setBusy(name);
    setError(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/secrets`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value: value.trim() }),
      });
      setEditing(null);
      setValue('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/secrets`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-1 p-4 shadow-soft">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-text-muted" />
        <h2 className="text-sm font-semibold text-text-primary">Model keys</h2>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-text-muted">
        Agents run on this space&apos;s own provider keys — one per provider, stored encrypted and never shown again.
        Where your notes are sent is decided here, by an admin. The same keys back any{' '}
        <Link href="/connectors" className="underline">model connector</Link> (a <span className="font-mono">kind: model</span>{' '}
        note under <span className="font-mono">connectors/</span>) — one store, two doors.
      </p>
      <ul className="mt-3 divide-y divide-border-subtle">
        {providers
          .filter((p) => p.id !== 'custom' || storedByName.has(p.keySecret))
          .map((p) => {
            const set = storedByName.get(p.keySecret);
            const isEditing = editing === p.keySecret;
            return (
              <li key={p.id} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary">{p.label}</p>
                    <p className="font-mono text-[11px] text-text-muted">
                      {p.keySecret}
                      {set ? ` · set ${new Date(set).toLocaleDateString()}` : ' · not set'}
                    </p>
                  </div>
                  {!isEditing && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(p.keySecret); setValue(''); }}>
                      {set ? 'Replace' : 'Add key'}
                    </Button>
                  )}
                  {set && !isEditing && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600"
                      onClick={() => remove(p.keySecret)}
                      disabled={busy === p.keySecret}
                      aria-label={`Delete ${p.keySecret}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {isEditing && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={`Paste your ${p.label} API key`}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void save(p.keySecret); }}
                    />
                    <Button variant="brand" size="sm" onClick={() => save(p.keySecret)} loading={busy === p.keySecret}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
      </ul>
      {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
    </section>
  );
}
