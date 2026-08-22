'use client';

/**
 * The "Connector" view for a connector node — the first tab on
 * /directory/connector:<name>, beside Context and Raw.
 *
 * The note is still the source of truth: every field here is read from — and
 * written back to — the frontmatter the Raw tab edits, as a merge that leaves
 * the body and any key this page doesn't know about alone. The server re-parses
 * the merged frontmatter and rejects a save the runtime would refuse.
 *
 * One flat page (AGENTS.md#connectors), not a grid of cards: a status header,
 * the perimeter (hosts and allow rules — what the sandbox enforces), the
 * environment, the console — the exact path an agent's run_connector takes, so
 * a green run here is a green run for the agent by construction — and the call
 * log. Sections are separated by a rule, not by boxes: everything here is one
 * connector, and four containers implied four subjects.
 *
 * Secrets have no card of their own. Every secret this page can show is a
 * `{{secret:NAME}}` reference inside an env value (the server derives the list
 * that way), so a separate card listed the same names a second time and left
 * the reader to pair them up. The reference IS the control: click the chip to
 * store, replace or clear the value behind it.
 *
 * The note body isn't rendered here. It's prose, it's long, and the Context and
 * Raw tabs one click away already show it better than a scrolling box would.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCopied } from '@/features/shared/hooks/useCopied';
import Link from 'next/link';
import { CheckIcon, CopyIcon, KeyRoundIcon, PencilIcon, PlayIcon, PlusIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from '@/features/shared/icons';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { timeAgo } from '@/lib/date';
import { SANDBOX_LIMITS, type AllowRule, type ConnectorPerimeter } from '@/lib/connectors/config';
import { PROVIDERS } from '@/lib/agents/registry';
import { connectorConnectUrl } from '@/lib/connectors/connectUrl';
import { Skeleton } from '@/components/ui';

interface SecretStatus {
  name: string;
  set: boolean;
  updatedAt: string | null;
}

/** A `kind: model` connector's provider facts (server: modelConnectorInfo). Never the key. */
interface ModelInfo {
  provider: string;
  providerLabel: string;
  baseURL: string;
  /** True when the URL is the note's own `base_url:` (provider: custom) rather than pinned. */
  customEndpoint: boolean;
  keySecret: string;
  models: { id: string; label: string }[];
}

interface ConnectorDetail {
  name: string;
  path: string;
  /** `model` = an LLM provider the space's agents run on — no perimeter, never runnable. */
  kind: 'http' | 'model';
  model: ModelInfo | null;
  alias: string | null;
  hosts: string[];
  allow: string[];
  invalid: string | null;
  warnings: string[];
  secrets: SecretStatus[];
  perimeter: ConnectorPerimeter | null;
}

/** One past run, as the audit trail recorded it (server: listConnectorCalls). */
interface ConnectorCall {
  at: number;
  by: string;
  code: string;
  outcome: string;
}

interface RunResult {
  ok: boolean;
  value: unknown;
  logs: string;
  error: { name: string; message: string; stack: string | null } | null;
  truncated: boolean;
  timed_out: boolean;
  denials: string[];
  duration_ms: number;
}

// ── Chrome ───────────────────────────────────────────────────────────────────

const FIELD =
  'w-full min-w-0 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green';
const GHOST_BUTTON =
  'rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const SAVE_BUTTON =
  'rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * PATCH one slice of the connector's frontmatter, then reload. The server owns
 * validation (it re-parses the merged note), so an editor's job is to send the
 * fields and show back whatever it refused.
 */
function useConnectorSave(spaceId: string, name: string, reload: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        await fetchJsonBody(
          `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}`,
          'PATCH',
          patch,
        );
        await reload();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [spaceId, name, reload],
  );

  return { save, saving, error, setError };
}

function EditActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="submit" disabled={saving} className={SAVE_BUTTON}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} disabled={saving} className={GHOST_BUTTON}>
        Cancel
      </button>
    </div>
  );
}

/** Icon-only: the pencil is unambiguous, and the word repeated on every card is noise. */
function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      <PencilIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-red-600">
      <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

/**
 * Title, an optional one-word meta, and at most one action, over a rule. No
 * box: the page is one connector, and each section is a part of it rather than
 * a thing of its own.
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

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  POST: 'bg-blue-50 text-blue-700 ring-blue-200',
  PUT: 'bg-amber-50 text-amber-700 ring-amber-200',
  PATCH: 'bg-amber-50 text-amber-700 ring-amber-200',
  DELETE: 'bg-red-50 text-red-700 ring-red-200',
};

function MethodBadge({ method }: { method: string }) {
  const color = METHOD_COLORS[method.toUpperCase()] ?? 'bg-surface-3 text-text-secondary ring-border-subtle';
  return (
    <span className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset ${color}`}>
      {method.toUpperCase()}
    </span>
  );
}

/**
 * Env template text with its `{{secret:NAME}}` references picked out, so a
 * value reads as "Bearer «STRIPE_KEY»" rather than as an opaque template.
 *
 * The chip doubles as the secret's control: amber when nothing is stored behind
 * it, and clicking opens the write-only form for that name.
 */
function SecretTemplate({
  text,
  statusOfSecret,
  onPick,
}: {
  text: string;
  statusOfSecret: (name: string) => SecretStatus | undefined;
  onPick: (name: string) => void;
}) {
  const parts = text.split(/(\{\{\s*secret:[A-Za-z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}$/);
        if (!match) return <span key={i}>{part}</span>;
        const secretName = match[1];
        const stored = statusOfSecret(secretName)?.set ?? false;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(secretName)}
            title={stored ? `Replace or clear ${secretName}` : `${secretName} is not stored — set it`}
            className={`mx-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold transition-colors ${
              stored
                ? 'bg-brand-light-bg text-brand-dark-green hover:bg-brand-green/20'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            <KeyRoundIcon className="h-3 w-3" />
            {secretName}
            {!stored && <span className="font-normal">· not set</span>}
          </button>
        );
      })}
    </>
  );
}

// ── Editors ──────────────────────────────────────────────────────────────────

/**
 * The perimeter as three plain fields — hosts and allow rules one per line, the
 * grammar is the server's to judge and it answers with the offending entry.
 */
function PerimeterEditor({
  detail,
  save,
  saving,
  error,
  onDone,
}: {
  detail: ConnectorDetail;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [hosts, setHosts] = useState(detail.hosts.join('\n'));
  const [allow, setAllow] = useState(detail.allow.join('\n'));
  const [timeoutMs, setTimeoutMs] = useState(String(detail.perimeter?.timeoutMs ?? SANDBOX_LIMITS.timeoutMs.default));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (await save({ hosts: lines(hosts), allow: lines(allow), timeoutMs: Number(timeoutMs) })) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <textarea
        value={hosts}
        onChange={(e) => setHosts(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={'api.stripe.com\ndb.internal:5432'}
        className={`${FIELD} py-2`}
      />
      <textarea
        value={allow}
        onChange={(e) => setAllow(e.target.value)}
        rows={2}
        spellCheck={false}
        placeholder={'GET /v1/customers*   (optional — leave empty for host-gated only)'}
        className={`${FIELD} py-2`}
      />
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={SANDBOX_LIMITS.timeoutMs.min}
          max={SANDBOX_LIMITS.timeoutMs.max}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          className={`${FIELD} sm:w-32`}
        />
        <span className="text-xs text-text-muted">ms</span>
      </div>
      <FormError message={error} />
      <EditActions saving={saving} onCancel={onDone} />
    </form>
  );
}

/** Env vars as ordered pairs — an object can't hold a half-typed blank key. */
type EnvPair = { key: string; value: string };

function EnvEditor({
  env,
  save,
  saving,
  error,
  onDone,
}: {
  env: Record<string, string>;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<EnvPair[]>(Object.entries(env).map(([key, value]) => ({ key, value })));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key, r.value]));
    if (await save({ env: patch })) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={row.key}
              onChange={(e) => setRows((all) => all.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
              placeholder="STRIPE_KEY"
              className={`${FIELD} sm:w-44`}
            />
            <input
              value={row.value}
              onChange={(e) => setRows((all) => all.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              placeholder="{{secret:STRIPE_KEY}}"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
              aria-label="Remove variable"
              className="shrink-0 rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRows((all) => [...all, { key: '', value: '' }])}
            className={`${GHOST_BUTTON} inline-flex items-center gap-1.5`}
          >
            <PlusIcon className="h-3 w-3" /> Add variable
          </button>
          <span className="text-xs text-text-muted">
            Use <code className="font-mono">{'{{secret:NAME}}'}</code>, never a raw value.
          </span>
        </span>
      </div>
      <FormError message={error} />
      <EditActions saving={saving} onCancel={onDone} />
    </form>
  );
}

// ── Secrets ──────────────────────────────────────────────────────────────────

/**
 * The write-only form for the one secret chip that was clicked. Values are
 * never read back, so this is always a fresh write — there is nothing to
 * pre-fill and no reason to keep more than one open.
 */
function SecretEditor({
  secret,
  spaceId,
  onChanged,
  onClose,
}: {
  secret: SecretStatus;
  spaceId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/communities/${spaceId}/secrets`, 'PUT', {
        name: secret.name,
        value,
      });
      setValue('');
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/communities/${spaceId}/secrets`, 'DELETE', { name: secret.name });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-border-subtle bg-surface-2 px-3 py-2.5">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.length > 0) void save();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Value for ${secret.name}`}
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button type="submit" disabled={busy || value.length === 0} className={SAVE_BUTTON}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onClose} disabled={busy} className={GHOST_BUTTON}>
          Cancel
        </button>
        {secret.set && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            aria-label={`Clear ${secret.name}`}
            title={`Clear ${secret.name}`}
            className="rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
      <p className="mt-1.5 text-xs text-text-muted">Encrypted on save, never shown again.</p>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ── Model connector ──────────────────────────────────────────────────────────

/**
 * The whole page for a `kind: model` connector, in place of perimeter, env and
 * console: which provider this note names (base URL pinned by the registry and
 * shown, or — for `custom` — the note's own `base_url:`, editable), the known model ids an agent's `model:` can pick, and
 * the one secret behind it, MODEL_KEY_<PROVIDER>. Same write-only SecretEditor
 * as an env secret; there is deliberately no way to run anything here.
 */
function ModelSection({
  connector,
  model,
  spaceId,
  editing,
  onEdit,
  onDone,
  save,
  saving,
  saveError,
  reload,
}: {
  connector: ConnectorDetail;
  model: ModelInfo;
  spaceId: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  reload: () => Promise<void>;
}) {
  const [provider, setProvider] = useState(model.provider);
  const [baseUrl, setBaseUrl] = useState(model.customEndpoint ? model.baseURL : '');
  const [keyOpen, setKeyOpen] = useState(false);
  const key = connector.secrets.find((s) => s.name === model.keySecret) ?? {
    name: model.keySecret,
    set: false,
    updatedAt: null,
  };

  return (
    <>
      <Section
        title="Provider"
        meta={new URL(model.baseURL).host}
        action={editing ? undefined : <EditButton onClick={onEdit} label="Change provider" />}
      >
        {editing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save(provider === 'custom' ? { provider, baseUrl } : { provider })) onDone();
            }}
          >
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={FIELD}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {provider === 'custom' && (
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://llm.example.com/v1/"
                className={`${FIELD} font-mono`}
                required
              />
            )}
            <p className="text-xs text-text-muted">
              Changing the provider changes which key this connector stands for.{' '}
              {provider === 'custom'
                ? 'The base URL is an OpenAI-compatible https endpoint — where this space\u2019s agents send their context, so it is yours to set and only an admin can change it.'
                : 'The endpoint is the provider\u2019s own, pinned by Visvine.'}
            </p>
            <FormError message={saveError} />
            <EditActions saving={saving} onCancel={onDone} />
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">
              {model.providerLabel}
              <span className="ml-2 font-mono text-[12px] text-text-muted">
                {model.baseURL}
              </span>
            </p>
            {model.models.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {model.models.map((m) => (
                  <li
                    key={m.id}
                    title={m.label}
                    className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-text-primary"
                  >
                    {model.provider}/{m.id}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">
                Any model id: <code className="font-mono text-[12px]">{model.provider}/&lt;model-id&gt;</code>
              </p>
            )}
            <p className="text-xs text-text-muted">
              An agent uses this by naming one of these in its brief&apos;s <code className="font-mono">model:</code>.
              Not runnable — <code className="font-mono">run_connector</code> refuses model connectors, so no note or
              agent can read or spend the key directly.
            </p>
          </div>
        )}
      </Section>

      <Section title="Key" meta={key.set ? 'set' : 'not set'}>
        <button
          type="button"
          onClick={() => setKeyOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[12px] transition-colors ${
            key.set
              ? 'border-border-default text-text-primary hover:bg-surface-2'
              : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          }`}
          title={key.set ? `Set ${key.updatedAt ? timeAgo(new Date(key.updatedAt).getTime()) : ''} — click to replace or clear` : 'Not stored — click to add'}
        >
          <KeyRoundIcon className="h-3 w-3" />
          {key.name}
          {!key.set && <span className="text-[10px] font-semibold uppercase">missing</span>}
        </button>
        {keyOpen && (
          <SecretEditor key={key.name} secret={key} spaceId={spaceId} onChanged={reload} onClose={() => setKeyOpen(false)} />
        )}
        <p className="mt-2 text-xs text-text-muted">
          One key per provider, shared by every agent in this space. Encrypted on save, never shown again — the same
          store as every other connector secret.
        </p>
      </Section>
    </>
  );
}

// ── Connections ──────────────────────────────────────────────────────────────

/** One row of GET …/connectors/[name]/connections. */
interface ConnectionRow {
  mode: 'user' | 'space';
  /** What the far side calls the account — the point of the list. */
  actsAs: string | null;
  isMine: boolean;
  isShared: boolean;
  scopes: string[];
  expiresAt: string | null;
  broken: { at: string; reason: string | null } | null;
  connectedAt: string;
  connectedBy: string | null;
  /** DELETE target; the server only tells admins. */
  userId: string | null;
}

/**
 * The accounts this connector is connected to, and the door to add or revoke
 * one. Rendered only for a connector with an `auth:` block. Every row names the
 * account it acts as, because a `mode: space` connection lends whoever set it up
 * to everyone who can run the note — and the only honest way to do that is to
 * say so.
 */
function ConnectionsSection({
  spaceId,
  name,
  auth,
  isAdmin,
}: {
  spaceId: string;
  name: string;
  auth: { provider: string; mode: 'user' | 'space' };
  isAdmin: boolean;
}) {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which row's Disconnect is awaiting confirmation, by row key.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<{ connections: ConnectionRow[] }>(
        `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}/connections`,
      );
      setRows(data.connections);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [spaceId, name]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The `?user=` the DELETE route wants: '' for the shared row, 'me' for the caller's own. */
  const targetOf = (row: ConnectionRow): string | null =>
    row.isShared ? '' : row.isMine ? 'me' : row.userId;

  const disconnect = async (row: ConnectionRow, key: string) => {
    const target = targetOf(row);
    if (target === null) return;
    setBusy(key);
    setError(null);
    try {
      const qs = target === 'me' ? '' : `?user=${encodeURIComponent(target)}`;
      await fetchJson(
        `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}/connections${qs}`,
        { method: 'DELETE' },
      );
      setConfirming(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shared = auth.mode === 'space';
  const canConnect = shared ? isAdmin : true;
  const explainer = shared
    ? 'Everyone who can run this connector acts as the connected account. An admin connects once and the whole space shares it.'
    : 'Each person connects their own account. Runs use the caller\u2019s connection, never anyone else\u2019s.';
  const connectHref = connectorConnectUrl(spaceId, name);
  const alreadyConnected = shared
    ? (rows ?? []).some((r) => r.isShared)
    : (rows ?? []).some((r) => r.isMine);

  return (
    <Section
      title="Connections"
      meta={`${auth.provider} · ${auth.mode}`}
      action={
        canConnect ? (
          <a href={connectHref} className={GHOST_BUTTON}>
            {alreadyConnected ? 'Reconnect' : 'Connect'}
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">{explainer}</p>
        {rows === null ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-muted">No account connected.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {rows.map((row, i) => {
              const target = targetOf(row);
              const canRevoke = row.isMine || (isAdmin && target !== null);
              const key = target ?? `row-${i}`;
              const who = row.isShared ? 'Space' : row.isMine ? 'You' : (row.connectedBy ?? 'Member');
              return (
                <li key={key} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium text-text-primary">{who}</span>
                      <span className="text-text-muted">
                        acts as{' '}
                        <span className="font-mono text-[12px] text-text-secondary">
                          {row.actsAs ?? 'unknown account'}
                        </span>
                      </span>
                      {row.isShared && row.connectedBy && (
                        <span className="text-text-muted">· connected by {row.connectedBy}</span>
                      )}
                      <span className="text-text-muted">
                        · {timeAgo(new Date(row.connectedAt).getTime(), { style: 'short' })}
                      </span>
                      {row.broken && (
                        <span
                          className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                          title={row.broken.reason ?? undefined}
                        >
                          broken
                        </span>
                      )}
                    </div>
                    {canRevoke && confirming !== key && (
                      <button type="button" onClick={() => setConfirming(key)} className={GHOST_BUTTON}>
                        Disconnect
                      </button>
                    )}
                    {canRevoke && confirming === key && (
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-text-muted">
                          {row.isShared
                            ? 'Every member and agent loses this account.'
                            : 'Disconnect this account?'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          disabled={busy === key}
                          className={GHOST_BUTTON}
                        >
                          Keep
                        </button>
                        <button
                          type="button"
                          onClick={() => void disconnect(row, key)}
                          disabled={busy === key}
                          className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {busy === key ? 'Disconnecting…' : 'Disconnect'}
                        </button>
                      </span>
                    )}
                  </div>
                  {row.broken && (
                    <p className="flex items-start gap-1.5 text-xs text-red-600">
                      <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {row.broken.reason ?? 'The connection stopped working.'} Reconnect to repair it.
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <FormError message={error} />
      </div>
    </Section>
  );
}

// ── Webhook ──────────────────────────────────────────────────────────────────

/** GET …/connectors/[name]/webhook — the address and what guards it. */
interface WebhookInfo {
  url: string;
  signature: string;
  header: string | null;
  idHeader: string | null;
  eventField: string | null;
  maxBytes: number;
  secretName: string | null;
  hasSignatureSecret: boolean;
  /** Active agents whose live note says `on.webhook: <this connector>`. */
  recipients: string[];
}

/** One row of GET …/webhook/events. */
interface WebhookEventRow {
  id: string;
  agentName: string;
  summary: string;
  createdAt: string;
  consumedBy: string | null;
}

const SIGNATURE_LABELS: Record<string, string> = {
  none: 'URL token only — no signature',
  token: 'shared token in a header',
  'hmac-sha256': 'HMAC-SHA256 of the body',
  'hmac-sha1': 'HMAC-SHA1 of the body',
  github: 'GitHub (sha256= HMAC)',
  stripe: 'Stripe (t=/v1=, 5-min tolerance)',
  slack: 'Slack (v0= HMAC, 5-min tolerance)',
  hubspot: 'HubSpot v3 (base64 HMAC, 5-min tolerance)',
  linear: 'Linear (HMAC of the body)',
};

/**
 * The inbound address of a connector with a `webhook:` block, for admins.
 * The URL is a credential — anyone holding it can post into this space's
 * agents — so it is shown here and nowhere else, and Rotate is one click
 * (with a confirm) away. Below it, the last deliveries: the honest answer to
 * "is the provider actually reaching us, and who heard it".
 */
function WebhookSection({ spaceId, name }: { spaceId: string; name: string }) {
  const [info, setInfo] = useState<WebhookInfo | null>(null);
  const [events, setEvents] = useState<WebhookEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopied();
  const [confirming, setConfirming] = useState(false);
  const [rotating, setRotating] = useState(false);

  const base = `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}/webhook`;

  const load = useCallback(async () => {
    try {
      const [detail, list] = await Promise.all([
        fetchJson<WebhookInfo>(base),
        fetchJson<{ events: WebhookEventRow[] }>(`${base}/events`),
      ]);
      setInfo(detail);
      setEvents(list.events.slice(0, 10));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setEvents([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyUrl = async () => {
    if (info && !(await copy(info.url))) setError('Could not copy — select the URL and copy it by hand.');
  };

  const rotate = async () => {
    setRotating(true);
    setError(null);
    try {
      const next = await fetchJson<WebhookInfo & { rotated: boolean }>(base, { method: 'DELETE' });
      setInfo(next);
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRotating(false);
    }
  };

  const signatureLabel = info ? (SIGNATURE_LABELS[info.signature] ?? info.signature) : '';
  const secretMissing = Boolean(info && info.secretName && !info.hasSignatureSecret);

  return (
    <Section
      title="Webhook"
      meta={info ? info.signature : undefined}
      action={
        info && !confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className={GHOST_BUTTON}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCwIcon className="h-3.5 w-3.5" />
              Rotate
            </span>
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          Point the provider at this address. Every delivery it accepts becomes an event for each
          active agent whose live note says <span className="font-mono">on.webhook: {name}</span>.
          The URL is a credential — anyone holding it can post here.
        </p>

        {info === null && !error ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : info ? (
          <>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={info.url}
                onFocus={(e) => e.currentTarget.select()}
                className={`${FIELD} select-all`}
                aria-label="Webhook URL"
              />
              <button type="button" onClick={() => void copyUrl()} className={GHOST_BUTTON} title="Copy URL">
                <span className="inline-flex items-center gap-1.5">
                  {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </button>
            </div>

            {confirming && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text-muted">
                  Rotating mints a new URL; the provider must be re-pointed and the old one stops at once.
                </span>
                <button type="button" onClick={() => setConfirming(false)} disabled={rotating} className={GHOST_BUTTON}>
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => void rotate()}
                  disabled={rotating}
                  className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {rotating ? 'Rotating…' : 'Rotate URL'}
                </button>
              </div>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-text-muted">Verified by</dt>
              <dd className="text-text-primary">
                {signatureLabel}
                {info.header && <span className="ml-1 font-mono text-[11px] text-text-muted">{info.header}</span>}
              </dd>
              {info.secretName && (
                <>
                  <dt className="text-text-muted">Secret</dt>
                  <dd className={secretMissing ? 'text-red-600' : 'text-text-primary'}>
                    <span className="font-mono text-[12px]">{info.secretName}</span>
                    {secretMissing ? ' — not set; every delivery will be refused' : ' — set'}
                  </dd>
                </>
              )}
              {info.idHeader && (
                <>
                  <dt className="text-text-muted">Dedupe on</dt>
                  <dd className="font-mono text-[12px] text-text-primary">{info.idHeader}</dd>
                </>
              )}
              <dt className="text-text-muted">Listening</dt>
              <dd className="text-text-primary">
                {info.recipients.length === 0
                  ? 'No active agent names this connector in on.webhook — deliveries are accepted and dropped.'
                  : info.recipients.map((r) => (
                      <span key={r} className="mr-2 font-mono text-[12px]">{r}</span>
                    ))}
              </dd>
            </dl>

            <div>
              <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Recent deliveries</p>
              {events === null ? (
                <Skeleton className="h-6 w-full rounded" />
              ) : events.length === 0 ? (
                <p className="text-sm text-text-muted">Nothing received yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border-subtle">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs">
                      <span className="min-w-0 truncate font-mono text-[12px] text-text-primary">{ev.summary}</span>
                      <span className="shrink-0 text-text-muted">
                        → {ev.agentName} · {ev.consumedBy ? 'run' : 'pending'} ·{' '}
                        {timeAgo(new Date(ev.createdAt).getTime(), { style: 'short' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
        <FormError message={error} />
      </div>
    </Section>
  );
}

// ── Console ──────────────────────────────────────────────────────────────────

/**
 * One command, one run — through the same route an agent's run_connector
 * takes. History accumulates newest-first so a probe/fix loop reads naturally.
 */
function ConnectorConsole({
  connector,
  spaceId,
}: {
  connector: ConnectorDetail;
  spaceId: string;
}) {
  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Array<{ code: string; result: RunResult | null; error: string | null }>>([]);

  const run = async () => {
    const source = code.trim();
    if (!source) return;
    setRunning(true);
    try {
      const res = await fetchJsonBody<{ result: RunResult }>(
        `/api/communities/${spaceId}/connectors/${encodeURIComponent(connector.name)}/test`,
        'POST',
        { code: source },
      );
      setRuns((all) => [{ code: source, result: res.result, error: null }, ...all].slice(0, 10));
      setCode('');
    } catch (e) {
      setRuns((all) => [{ code: source, result: null, error: (e as Error).message }, ...all].slice(0, 10));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            // Enter is a newline here — code is multi-line far more often than
            // it is one expression — so submitting needs the modifier.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          rows={4}
          placeholder={'const res = await fetch(`${env.API_BASE}/v1/things`, {\n  headers: { Authorization: `Bearer ${env.API_KEY}` },\n})\nreturn JSON.parse(res.body)'}
          className={`${FIELD} resize-y font-mono text-[12px] leading-relaxed`}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-text-muted">
            JavaScript · return the answer · ⌘↵ to run
          </span>
          <button
            type="submit"
            disabled={running || code.trim().length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </form>

      {runs.map((entry, i) => (
        <div key={runs.length - i} className="flex flex-col gap-1.5">
          <pre className="overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-text-muted">
            {entry.code}
          </pre>
          {entry.error ? (
            <div className="flex items-start gap-2 border-l-2 border-red-500 pl-3 py-1 text-xs text-red-700">
              <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{entry.error}</span>
            </div>
          ) : entry.result ? (
            <RunOutput result={entry.result} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RunOutput({ result }: { result: RunResult }) {
  const returned = result.value === undefined ? null : JSON.stringify(result.value, null, 2);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-md px-2 py-0.5 font-mono font-semibold ${
            result.ok ? 'bg-brand-light-bg text-brand-dark-green' : 'bg-red-50 text-red-700'
          }`}
        >
          {result.timed_out ? 'timeout' : result.ok ? 'ok' : 'error'}
        </span>
        <span className="text-text-muted">{result.duration_ms} ms</span>
        {result.truncated && <span className="text-text-muted">· truncated</span>}
      </div>
      {result.denials.length > 0 && (
        <ul className="flex flex-col gap-1 border-l-2 border-amber-500 pl-3 py-1 text-xs text-amber-800">
          {result.denials.map((denial, i) => (
            <li key={i} className="break-words">{denial}</li>
          ))}
        </ul>
      )}
      {result.error && (
        <div className="flex items-start gap-2 border-l-2 border-red-500 pl-3 py-1 text-xs text-red-700">
          <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words font-mono">{result.error.message}</span>
        </div>
      )}
      {returned !== null && (
        <pre className="max-h-80 overflow-auto rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary">
          {returned}
        </pre>
      )}
      {result.logs && (
        <pre className="max-h-40 overflow-auto rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-text-muted">
          {result.logs}
        </pre>
      )}
    </div>
  );
}

// ── Call log ─────────────────────────────────────────────────────────────────

/**
 * Every run of this connector, whoever made it — an agent through
 * run_connector, or an admin through the console above. Read straight from the
 * context's audit trail, so it is the compliance record rather than a prettier
 * copy of one.
 *
 * "Why" is the code: the audit line records what was asked for, which is the
 * only intent the runtime ever sees. Nobody declares a reason to the sandbox.
 */
function CallLog({ calls }: { calls: ConnectorCall[] }) {
  if (calls.length === 0) {
    return <p className="text-sm text-text-muted">No runs yet.</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border-subtle">
      {calls.map((call, i) => {
        const failed = !/^exit 0\b/.test(call.outcome);
        return (
          <li key={`${call.at}-${i}`} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className="font-medium text-text-primary">{call.by}</span>
              <span className="text-text-muted">{timeAgo(call.at, { style: 'short' })}</span>
              <span
                className={`ml-auto shrink-0 font-mono ${failed ? 'text-red-600' : 'text-text-muted'}`}
              >
                {call.outcome}
              </span>
            </div>
            {call.code && (
              <p className="truncate font-mono text-[12px] text-text-secondary" title={call.code}>
                {call.code}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** The one-line verdict in the header: what an agent can do through this today. */
function statusOf(connector: ConnectorDetail): { label: string; tone: 'ok' | 'warn' | 'bad'; hint: string } {
  if (connector.invalid) {
    return { label: 'Not usable', tone: 'bad', hint: 'The frontmatter does not parse, so every run is refused.' };
  }
  const unset = connector.secrets.filter((s) => !s.set);
  if (connector.kind === 'model') {
    if (unset.length > 0) {
      return {
        label: 'No key',
        tone: 'warn',
        hint: `Agents on ${connector.model?.providerLabel ?? 'this provider'} fail until its API key is stored below.`,
      };
    }
    return {
      label: 'Ready',
      tone: 'ok',
      hint: `Agents whose brief names a ${connector.model?.provider ?? ''}/… model run on this key.`,
    };
  }
  if (unset.length > 0) {
    return {
      label: 'Missing secrets',
      tone: 'warn',
      hint: `${unset.map((s) => s.name).join(', ')} ${unset.length === 1 ? 'is' : 'are'} referenced but not stored — runs fail until set.`,
    };
  }
  if (connector.warnings.length > 0) {
    return { label: 'Needs migration', tone: 'warn', hint: connector.warnings[0] };
  }
  if (connector.hosts.length === 0) {
    return {
      label: 'No network',
      tone: 'warn',
      hint: 'No hosts declared, so commands run without network. Add hosts to let agents reach a service.',
    };
  }
  return {
    label: 'Ready',
    tone: 'ok',
    hint: `Agents can run commands that reach ${connector.hosts.join(', ')}.`,
  };
}

export default function ConnectorPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('connector:') ? nodeId.slice('connector:'.length) : nodeId;
  const { currentSpace, loading: spaceLoading, isAdmin } = useSpace();
  const spaceId = currentSpace?.id;

  const [connector, setConnector] = useState<ConnectorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which card is in edit mode. One at a time: two open forms over the same
  // frontmatter would race, and the second save would be written against a
  // reloaded connector the form no longer matches.
  const [editing, setEditing] = useState<'perimeter' | 'env' | 'provider' | null>(null);
  // The secret chip that was clicked, if any — its write-only form opens below
  // the env list. Cleared on reload so a stored secret doesn't reopen.
  const [pickedSecret, setPickedSecret] = useState<string | null>(null);
  const [calls, setCalls] = useState<ConnectorCall[]>([]);
  // The last Test result, as one line. Null until the button is pressed.
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const data = await fetchJson<{ connector: ConnectorDetail; calls: ConnectorCall[] }>(
        `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}`,
      );
      setConnector(data.connector);
      setCalls(data.calls);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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

  const { save, saving, error: saveError, setError: setSaveError } = useConnectorSave(
    spaceId ?? '',
    name,
    reload,
  );

  const openEditor = (which: typeof editing) => {
    setSaveError(null);
    setEditing(which);
  };

  /**
   * The status button: run a trivial script down the real execution path.
   * That is a genuine check rather than a re-reading of the config, because
   * secrets are decrypted and interpolated into env BEFORE the code runs —
   * so a missing or undecryptable secret, an unparseable note, or an isolate
   * that won't start all fail here exactly as they would for an agent.
   *
   * What it does NOT claim is that the upstream service is up: reaching it
   * needs the connector's own code, which is what the console is for.
   */
  const runTest = async () => {
    if (!spaceId) return;
    setTesting(true);
    setTest(null);
    try {
      const res = await fetchJsonBody<{ result: RunResult }>(
        `/api/communities/${spaceId}/connectors/${encodeURIComponent(name)}/test`,
        'POST',
        { code: "return 'connector ok'" },
      );
      const ok = res.result.ok && res.result.value === 'connector ok';
      setTest({
        ok,
        message: ok
          ? `Secrets resolve and the isolate ran in ${res.result.duration_ms} ms`
          : res.result.timed_out
            ? 'The isolate timed out before it could start'
            : `The isolate failed: ${res.result.error?.message ?? 'unknown error'}`,
      });
      await reload();
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const allowRules = useMemo(
    () =>
      (connector?.perimeter?.allow ?? []).map(
        (rule: AllowRule) => `${rule.method} ${rule.path}${rule.prefix ? '*' : ''}`,
      ),
    [connector],
  );

  if (loading || spaceLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !connector) {
    return <p className="py-10 text-center text-sm text-text-muted">{error ?? 'Connector not found'}</p>;
  }

  const status = statusOf(connector);
  const missingSecrets = connector.secrets.filter((s) => !s.set);
  const runnable = !connector.invalid && missingSecrets.length === 0;
  const env = connector.perimeter?.env ?? {};
  const pickedSecretStatus = connector.secrets.find((s) => s.name === pickedSecret) ?? null;

  return (
    <div className="profile-content-fade flex flex-col">
      {/* ══ HEADER — the name, what it is, whether it works ══ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="truncate font-title text-xl font-semibold text-text-primary">
            {connector.name}
          </h1>
          {connector.alias && (
            <span className="font-mono text-[12px] text-text-muted">{connector.alias}</span>
          )}
          <span className={`${TONE_CHIP} ${TONE_CLASSES[status.tone]}`}>
            {status.label}
          </span>
        </div>
        {/* A model connector has no isolate to test — the key is proven at
            agent activation (probeModelKey), not here. */}
        {isAdmin && connector.kind !== 'model' && (
          <button
            type="button"
            onClick={runTest}
            disabled={testing || !runnable}
            title={runnable ? undefined : status.hint}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {testing ? 'Testing…' : 'Test'}
          </button>
        )}
      </div>

      {/* The status hint, or the last Test verdict — one line, never both. */}
      {test ? (
        <p
          className={`flex items-start gap-2 pb-5 text-xs ${test.ok ? 'text-brand-dark-green' : 'text-red-600'}`}
        >
          {test.ok ? (
            <CheckIcon className="mt-px h-3.5 w-3.5 shrink-0" />
          ) : (
            <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{test.message}</span>
        </p>
      ) : (
        status.tone !== 'ok' && (
          <p className="flex items-start gap-2 pb-5 text-xs text-text-muted">
            <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
            {status.hint}
          </p>
        )
      )}

      {/* ══ PARSE ERROR — the note exists but nothing below it is live ══ */}
      {connector.invalid && (
        <div className="mb-5 flex items-start gap-2.5 border-l-2 border-red-500 pl-3 py-1">
          <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="break-words text-sm text-red-700">{connector.invalid}</p>
            <Link
              href={`/directory/${encodeURIComponent(nodeId)}?tab=raw`}
              className="mt-1 inline-block text-xs font-semibold text-red-700 underline"
            >
              Fix it in the Raw tab
            </Link>
          </div>
        </div>
      )}

      {/* ══ MODEL — for a `kind: model` connector: the provider, and its key ══ */}
      {connector.kind === 'model' && !connector.invalid && connector.model && spaceId && (
        <ModelSection
          connector={connector}
          model={connector.model}
          spaceId={spaceId}
          editing={editing === 'provider'}
          onEdit={() => openEditor('provider')}
          onDone={() => openEditor(null)}
          save={save}
          saving={saving}
          saveError={saveError}
          reload={reload}
        />
      )}

      {/* ══ PERIMETER — what the sandbox enforces ══ */}
      {connector.perimeter && (
        <Section
          title="Perimeter"
          meta={`${Math.round(connector.perimeter.timeoutMs / 1000)}s timeout`}
          action={
            editing === 'perimeter' || !isAdmin ? undefined : (
              <EditButton onClick={() => openEditor('perimeter')} label="Edit perimeter" />
            )
          }
        >
          {editing === 'perimeter' ? (
            <PerimeterEditor
              detail={connector}
              save={save}
              saving={saving}
              error={saveError}
              onDone={() => openEditor(null)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {connector.hosts.length === 0 ? (
                <p className="text-sm text-text-muted">No hosts — commands run without network.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {connector.hosts.map((host) => (
                    <span key={host} className="font-mono text-[13px] text-text-primary">
                      {host}
                    </span>
                  ))}
                </div>
              )}
              {allowRules.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {allowRules.map((rule) => {
                    const [method, ...rest] = rule.split(' ');
                    return (
                      <li key={rule} className="flex items-center gap-2">
                        <MethodBadge method={method} />
                        <span className="min-w-0 truncate font-mono text-[13px] text-text-primary">
                          {rest.join(' ')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ══ ENV — the variables a command sees, and the secrets behind them ══ */}
      {isAdmin && connector.perimeter && (
        <Section
          title="Environment"
          meta={
            missingSecrets.length > 0
              ? `${missingSecrets.length} secret${missingSecrets.length === 1 ? '' : 's'} missing`
              : undefined
          }
          action={
            editing === 'env' ? undefined : (
              <EditButton onClick={() => openEditor('env')} label="Edit environment variables" />
            )
          }
        >
          {editing === 'env' ? (
            <EnvEditor
              env={env}
              save={save}
              saving={saving}
              error={saveError}
              onDone={() => openEditor(null)}
            />
          ) : Object.keys(env).length === 0 ? (
            <p className="text-sm text-text-muted">No variables.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {Object.entries(env).map(([key, value]) => (
                  <li key={key} className="min-w-0 break-all font-mono text-[13px] text-text-primary">
                    <span className="text-text-muted">{key}=</span>
                    <SecretTemplate
                      text={value}
                      statusOfSecret={(secretName) =>
                        connector.secrets.find((s) => s.name === secretName)
                      }
                      onPick={(secretName) =>
                        setPickedSecret((current) => (current === secretName ? null : secretName))
                      }
                    />
                  </li>
                ))}
              </ul>
              {pickedSecretStatus && spaceId && (
                <SecretEditor
                  key={pickedSecretStatus.name}
                  secret={pickedSecretStatus}
                  spaceId={spaceId}
                  onChanged={reload}
                  onClose={() => setPickedSecret(null)}
                />
              )}
            </>
          )}
        </Section>
      )}

      {/* ══ CONNECTIONS — the OAuth accounts an `auth:` connector acts as ══ */}
      {connector.perimeter?.auth && spaceId && (
        <ConnectionsSection
          spaceId={spaceId}
          name={connector.name}
          auth={connector.perimeter.auth}
          isAdmin={isAdmin}
        />
      )}

      {/* ══ WEBHOOK — the inbound address, for admins ══ */}
      {isAdmin && connector.perimeter?.webhook && spaceId && (
        <WebhookSection spaceId={spaceId} name={connector.name} />
      )}

      {/* ══ TERMINAL — the same path an agent's run_connector takes ══ */}
      {isAdmin && connector.perimeter && spaceId && (
        <Section title="Console" meta="runs for real">
          {!runnable ? (
            <p className="flex items-start gap-2 text-sm text-text-muted">
              <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                {connector.invalid
                  ? 'Fix the frontmatter before running.'
                  : `Set ${missingSecrets.map((s) => s.name).join(', ')} in Environment above before running.`}
              </span>
            </p>
          ) : (
            <ConnectorConsole connector={connector} spaceId={spaceId} />
          )}
        </Section>
      )}

      {/* ══ CALLS — who ran this, and what came back (admins: the audit trail) ══ */}
      {isAdmin && (
        <Section title="Activity" meta={calls.length > 0 ? `last ${calls.length}` : undefined}>
          <CallLog calls={calls} />
        </Section>
      )}
    </div>
  );
}
