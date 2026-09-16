'use client';

/**
 * The "Model" view for a model node — the first tab on /directory/model:<name>,
 * beside Context and Raw.
 *
 * The note says which provider and which model id; this tab is what the note
 * cannot say. Whether the key behind it is stored. And who ran on it: the
 * recent runs, each with the agent, the person it ran for and the tokens it
 * used, folded per person above the list. Admins only; a member reads the
 * note on the Context tab.
 *
 * There is no bill here. What a space's provider keys were billed is the
 * provider's own account to show, and a second copy of it inside Visvine is a
 * number to reconcile rather than one to trust. Tokens are still metered —
 * the budget cap needs them — and tokens are what this tab reports.
 *
 * The note is still the source of truth: the provider, model id and base URL
 * are read from — and written back to — the frontmatter the Raw tab edits, as
 * a merge that leaves the body and any unknown key alone.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from '@/features/shared/components/SpaceLink';
import { KeyRoundIcon, PencilIcon, TriangleAlertIcon } from '@/features/shared/icons';
import { Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import ConnectorLogo from '@/features/connectors/components/ConnectorLogo';
import { fmtTokens } from '@/features/agents/lib/rowState';
import { FIELD, GHOST_BUTTON, SAVE_BUTTON, Section, SecretEditor } from './pageChrome';
import { agentPageHref } from '@/lib/agents/config';
import { PROVIDERS } from '@/lib/agents/registry';
import { modelCatalogEntryFor } from '@/lib/models/catalog';
import type { ModelDetail, ModelRunRow, ModelUserLine } from '@/lib/models/service';
import { timeAgo } from '@/lib/date';

interface DetailResponse {
  model: ModelDetail;
  history: { runs: ModelRunRow[]; users: ModelUserLine[] };
}

function statusOf(m: ModelDetail): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; hint: string } {
  if (!m.enabled) return { label: 'Off', tone: 'muted', hint: 'Turned off — the note and its key are untouched, but no agent runs on it.' };
  if (m.invalid || !m.info) return { label: 'Not usable', tone: 'bad', hint: 'The frontmatter does not parse, so nothing runs on it.' };
  if (!m.info.modelId) return { label: 'No model', tone: 'warn', hint: 'The note names no model id — set `model:`.' };
  if (!m.key?.set) return { label: 'No key', tone: 'warn', hint: `Agents on ${m.info.providerLabel} fail until ${m.key?.name ?? 'its key'} is stored below.` };
  return { label: 'Ready', tone: 'ok', hint: `Agents run on ${m.info.modelRef}; a brief may pin any ${m.info.provider}/… model on this key.` };
}

export default function ModelPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('model:') ? nodeId.slice('model:'.length) : nodeId;
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The provider form's own state, seeded when editing opens.
  const [provider, setProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await fetchJson<DetailResponse>(`/api/spaces/${spaceId}/models/${encodeURIComponent(name)}`);
      setData(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [spaceId, name]);

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) { setLoading(false); return; }
    setLoading(true);
    void reload();
  }, [spaceId, spaceLoading, reload]);

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!spaceId) return false;
    setSaving(true);
    setSaveError(null);
    try {
      await fetchJsonBody(`/api/spaces/${spaceId}/models/${encodeURIComponent(name)}`, 'PATCH', patch);
      await reload();
      return true;
    } catch (e) {
      setSaveError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
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
  if (error || !data || !spaceId) {
    return <p className="py-10 text-center text-sm text-text-muted">{error ?? 'Model not found'}</p>;
  }

  const { model, history } = data;
  const status = statusOf(model);
  const info = model.info;
  const entry = modelCatalogEntryFor(model.recipe, info?.provider);
  const registryModels = PROVIDERS.find((p) => p.id === provider)?.models ?? [];

  const openEditor = () => {
    setProvider(info?.provider ?? 'custom');
    setModelId(info?.modelId ?? '');
    setBaseUrl(info?.customEndpoint ? info.baseURL : '');
    setSaveError(null);
    setEditing(true);
  };

  return (
    <div className="profile-content-fade flex flex-col">
      {/* ══ HEADER — the name, what it runs, whether it works ══ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ConnectorLogo entry={entry} size="lg" />
          <h1 className="truncate font-title text-xl font-semibold text-text-primary">{model.title ?? model.name}</h1>
          {info && <span className="font-mono text-[12px] text-text-muted">{info.modelRef ?? info.provider}</span>}
          <span className={`${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>{status.label}</span>
        </div>
        <Toggle
          checked={model.enabled}
          onChange={(on) => void save({ enabled: on })}
          disabled={saving}
          aria-label={model.enabled ? 'Turn off' : 'Turn on'}
        />
      </div>

      {status.tone !== 'ok' && (
        <p className="flex items-start gap-2 pb-5 text-xs text-text-muted">
          <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
          {status.hint}
        </p>
      )}

      {model.invalid && (
        <div className="mb-5 flex items-start gap-2.5 border-l-2 border-red-500 py-1 pl-3">
          <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="break-words text-sm text-red-700">{model.invalid}</p>
            <Link href={`/directory/${encodeURIComponent(nodeId)}?tab=raw`} className="mt-1 inline-block text-xs font-semibold text-red-700 underline">
              Fix it in the Raw tab
            </Link>
          </div>
        </div>
      )}

      {model.legacy && (
        <p className="mb-5 text-xs text-text-muted">
          This note is still at <code className="font-mono">{model.path}</code>, the shape before models had a folder of their own.
          It works as it is; <code className="font-mono">db:models:migrate</code> moves it to <code className="font-mono">models/{model.name}.md</code>.
        </p>
      )}

      {/* ══ MODEL — the provider, the id it runs, and where requests go ══ */}
      {info && (
        <Section
          title="Model"
          meta={new URL(info.baseURL).host}
          action={
            editing ? undefined : (
              <button type="button" onClick={openEditor} aria-label="Change model" title="Change model"
                className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary">
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
            )
          }
        >
          {editing ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const patch: Record<string, unknown> = { provider, model: modelId };
                if (provider === 'custom') patch.baseUrl = baseUrl;
                if (await save(patch)) setEditing(false);
              }}
            >
              <select value={provider} onChange={(e) => { setProvider(e.target.value); setModelId(''); }} className={FIELD}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {registryModels.length > 0 && (
                <select value={registryModels.some((m) => m.id === modelId) ? modelId : ''} onChange={(e) => setModelId(e.target.value)} className={FIELD}>
                  <option value="">Something else…</option>
                  {registryModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
              {(registryModels.length === 0 || !registryModels.some((m) => m.id === modelId)) && (
                <input value={modelId} onChange={(e) => setModelId(e.target.value.trim())} placeholder="model id" className={FIELD} required />
              )}
              {provider === 'custom' && (
                <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://llm.example.com/v1/" className={FIELD} required />
              )}
              <p className="text-xs text-text-muted">
                Changing the provider changes which key this note stands for.{' '}
                {provider === 'custom'
                  ? 'The base URL is an OpenAI-compatible https endpoint — where this space’s agents send their context, so only an admin can change it.'
                  : 'The endpoint is the provider’s own, pinned by Visvine.'}
              </p>
              {saveError && (
                <p className="flex items-start gap-1.5 text-xs text-red-600">
                  <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{saveError}</span>
                </p>
              )}
              <div className="flex items-center gap-2">
                <button type="submit" disabled={saving} className={SAVE_BUTTON}>{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(false)} disabled={saving} className={GHOST_BUTTON}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-primary">
                {info.providerLabel}
                <span className="ml-2 font-mono text-[12px] text-text-muted">{info.baseURL}</span>
              </p>
              <p className="text-sm text-text-primary">
                Runs <code className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px]">{info.modelRef ?? 'no model named'}</code>
              </p>
              {info.models.length > 1 && (
                <p className="text-xs text-text-muted">
                  A brief may pin any of{' '}
                  {info.models.map((m, i) => (
                    <span key={m.id}>{i > 0 && ', '}<code className="font-mono">{info.provider}/{m.id}</code></span>
                  ))}{' '}
                  on this key.
                </p>
              )}
              {saveError && !editing && <p className="text-xs text-red-600">{saveError}</p>}
            </div>
          )}
        </Section>
      )}

      {/* ══ KEY — one per provider, write-only ══ */}
      {model.key && (
        <Section title="Key" meta={model.key.set ? 'set' : 'not set'}>
          <button
            type="button"
            onClick={() => setKeyOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[12px] transition-colors ${
              model.key.set ? 'border-border-default text-text-primary hover:bg-surface-2' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
            title={model.key.set ? `Set ${model.key.updatedAt ? timeAgo(new Date(model.key.updatedAt).getTime()) : ''} — click to replace or clear` : 'Not stored — click to add'}
          >
            <KeyRoundIcon className="h-3 w-3" />
            {model.key.name}
            {!model.key.set && <span className="text-[10px] font-semibold uppercase">missing</span>}
          </button>
          {keyOpen && <SecretEditor secret={model.key} spaceId={spaceId} onChanged={() => void reload()} onClose={() => setKeyOpen(false)} />}
          <p className="mt-2 text-xs text-text-muted">
            One key per provider, shared by every agent in this space. Encrypted on save, never shown again, and never
            reachable from a run — a model is not a connector.
          </p>
        </Section>
      )}

      {/* ══ WHO — the recent runs folded per person ══ */}
      {info && history.users.length > 0 && (
        <Section title="Who has run on it" meta={`last ${history.runs.length} runs`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                <th className="py-1 pr-3 font-normal" />
                <th className="py-1 pr-3 text-right font-normal">Runs</th>
                <th className="py-1 pr-3 text-right font-normal">Tokens</th>
                <th className="py-1 text-right font-normal">Last</th>
              </tr>
            </thead>
            <tbody>
              {history.users.map((u) => (
                <tr key={u.user.id} className="border-b border-border-subtle last:border-b-0">
                  <td className="py-1.5 pr-3 text-text-primary">{u.user.name}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{u.runs}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{fmtTokens(u.promptTokens + u.completionTokens)}</td>
                  <td className="py-1.5 text-right text-text-muted">{timeAgo(new Date(u.lastAt).getTime())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-text-muted">
            A run counts for the person it ran for — the subscriber a scheduled fire served, or whoever pressed Run.
          </p>
        </Section>
      )}

      {/* ══ HISTORY — every recent run, newest first ══ */}
      {info && (
        <Section title="History" meta={history.runs.length === 0 ? undefined : `${history.runs.length} recent`}>
          {history.runs.length === 0 ? (
            <p className="text-sm text-text-muted">No runs on {info.providerLabel} in the last 90 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                    <th className="py-1 pr-3 font-normal">When</th>
                    <th className="py-1 pr-3 font-normal">Agent</th>
                    <th className="py-1 pr-3 font-normal">For</th>
                    <th className="py-1 pr-3 font-normal">Model</th>
                    <th className="py-1 pr-3 text-right font-normal">Tokens</th>
                    <th className="py-1 font-normal">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {history.runs.map((r) => {
                    const who = r.ranFor ?? r.startedBy;
                    return (
                      <tr key={r.id} className="border-b border-border-subtle last:border-b-0">
                        <td className="whitespace-nowrap py-1.5 pr-3 text-text-muted" title={new Date(r.startedAt).toLocaleString()}>{timeAgo(new Date(r.startedAt).getTime())}</td>
                        <td className="py-1.5 pr-3 font-mono text-[12px] text-text-primary">
                          <Link href={agentPageHref(r.agent, r.id)} className="hover:underline">{r.agent}</Link>
                        </td>
                        <td className="py-1.5 pr-3 text-text-primary">{who ? who.name : <span className="text-text-muted">—</span>}</td>
                        <td className="py-1.5 pr-3 font-mono text-[12px] text-text-muted">{r.model.slice(r.model.indexOf('/') + 1)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{fmtTokens(r.promptTokens + r.completionTokens)}</td>
                        <td className="py-1.5 text-text-muted">{r.status === 'running' ? 'running' : r.terminalReason ?? r.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title="Note">
        <p className="font-mono text-xs text-text-secondary">{model.path}</p>
        <p className="mt-1.5 text-xs text-text-muted">The note is the model. Read and edit it on the Context and Raw tabs.</p>
      </Section>
    </div>
  );
}
