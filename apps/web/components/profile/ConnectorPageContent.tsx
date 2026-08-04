'use client';

/**
 * The "Connector" view for a connector node — the first tab on
 * /directory/connector:<name>, beside Context and Raw.
 *
 * The note is still the source of truth: every field here is read from — and
 * written back to — the frontmatter the Raw tab edits, as a merge that leaves
 * the body and any key this page doesn't know about alone. So Raw stays the
 * full-power escape hatch (it can change `alias`, which reshapes everything
 * else) while the ordinary edits happen in fields that can't produce a note the
 * executors would refuse: the server re-parses the merged frontmatter and
 * rejects the save if it wouldn't load.
 *
 * What this page adds beyond the note is the half of a connector's state the
 * note cannot hold — whether the secrets it references are actually stored, and
 * whether a call through it succeeds. Secrets live in CommunitySecret and are
 * write-only by design (PUT to set/replace, DELETE to remove, never read back);
 * they are the usual reason a connector that parses still fails.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BookText,
  CheckCircle2,
  Database,
  Globe,
  KeyRound,
  ListChecks,
  Pencil,
  Play,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { CONNECTOR_LIMITS, type ConnectorConfig } from '@/lib/connectors/config';
import { Skeleton } from '@/components/ui';

interface SecretStatus {
  name: string;
  set: boolean;
  updatedAt: string | null;
}

interface ConnectorDetail {
  name: string;
  path: string;
  alias: string | null;
  description: string | null;
  allow: string[];
  invalid: string | null;
  secrets: SecretStatus[];
  docs: string;
  config: ConnectorConfig | null;
}

interface HttpTestResult {
  kind: 'http';
  result: { status: number; content_type: string | null; body: string; truncated: boolean };
}

interface PostgresTestResult {
  kind: 'postgres';
  result: { columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean };
}

// ── Chrome ───────────────────────────────────────────────────────────────────

const CARD = 'rounded-2xl border border-border-subtle bg-surface-1 shadow-soft';
const FIELD =
  'w-full min-w-0 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green';
const GHOST_BUTTON =
  'rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const SAVE_BUTTON =
  'rounded-lg bg-brand-green px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';

/**
 * PATCH one slice of the connector's frontmatter, then reload. Every editor on
 * the page shares this: the server owns validation (it re-parses the merged
 * note), so an editor's job is to send the fields and show back whatever it
 * refused — never to guess at the rules a second time.
 */
function useConnectorSave(communityId: string, name: string, reload: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        await fetchJsonBody(
          `/api/communities/${communityId}/connectors/${encodeURIComponent(name)}`,
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
    [communityId, name, reload],
  );

  return { save, saving, error, setError };
}

/** The Save/Cancel pair every card's edit mode ends with. */
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

function EditButton({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={`${GHOST_BUTTON} inline-flex shrink-0 items-center gap-1.5`}>
      <Pencil className="h-3 w-3" />
      {label}
    </button>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-red-600">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

/** A labelled field in an edit form — same label column as {@link Detail}. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-text-muted sm:w-32">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

function Card({
  title,
  icon,
  subtitle,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-text-muted">{icon}</span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Label/value row for the connection card — values are code, labels are not. */
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-text-muted sm:w-32">
        {label}
      </span>
      <span className="min-w-0 break-all font-mono text-[13px] text-text-primary">{children}</span>
    </div>
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
 * Frontmatter text with its `{{secret:NAME}}` references picked out, so a header
 * value reads as "Bearer «STRIPE_KEY»" rather than as an opaque template.
 */
function SecretTemplate({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*secret:[A-Za-z0-9_]+\s*\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}$/);
        if (!match) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex items-center gap-1 rounded bg-brand-light-bg px-1.5 py-0.5 text-[12px] font-semibold text-brand-dark-green"
          >
            <KeyRound className="h-3 w-3" />
            {match[1]}
          </span>
        );
      })}
    </>
  );
}

// ── Editors ──────────────────────────────────────────────────────────────────

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

/** Headers as ordered pairs — an object can't hold a half-typed blank key. */
type HeaderPair = { key: string; value: string };

function ConnectionEditor({
  config,
  save,
  saving,
  error,
  onDone,
}: {
  config: ConnectorConfig;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const http = config.alias === 'http' ? config : null;
  const [baseUrl, setBaseUrl] = useState(http?.baseUrl ?? '');
  const [headers, setHeaders] = useState<HeaderPair[]>(
    http ? Object.entries(http.headers).map(([key, value]) => ({ key, value })) : [],
  );
  const [dsnSecret, setDsnSecret] = useState(
    config.alias === 'postgres' ? (config.dsn.match(/secret:([A-Za-z0-9_]+)/)?.[1] ?? '') : '',
  );
  const [maxRows, setMaxRows] = useState(config.alias === 'postgres' ? String(config.maxRows) : '');
  const [timeoutMs, setTimeoutMs] = useState(String(config.timeoutMs));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: Record<string, unknown> = { timeoutMs: Number(timeoutMs) };
    if (http) {
      patch.baseUrl = baseUrl;
      patch.headers = Object.fromEntries(
        headers.filter((h) => h.key.trim()).map((h) => [h.key, h.value]),
      );
    } else {
      patch.dsnSecret = dsnSecret;
      patch.maxRows = Number(maxRows);
    }
    if (await save(patch)) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {http ? (
        <>
          <FieldRow label="Base URL">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className={FIELD}
            />
          </FieldRow>
          <FieldRow label="Headers">
            <span className="flex flex-col gap-1.5">
              {headers.map((header, i) => (
                <span key={i} className="flex items-center gap-2">
                  <input
                    value={header.key}
                    onChange={(e) =>
                      setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                    }
                    placeholder="Authorization"
                    className={`${FIELD} sm:w-44`}
                  />
                  <input
                    value={header.value}
                    onChange={(e) =>
                      setHeaders((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                    }
                    placeholder="Bearer {{secret:API_KEY}}"
                    className={FIELD}
                  />
                  <button
                    type="button"
                    onClick={() => setHeaders((rows) => rows.filter((_, j) => j !== i))}
                    aria-label="Remove header"
                    className="shrink-0 rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHeaders((rows) => [...rows, { key: '', value: '' }])}
                  className={`${GHOST_BUTTON} inline-flex items-center gap-1.5`}
                >
                  <Plus className="h-3 w-3" /> Add header
                </button>
                <span className="text-xs text-text-muted">
                  Reference a stored secret as{' '}
                  <code className="font-mono">{'{{secret:NAME}}'}</code>, never a raw key.
                </span>
              </span>
            </span>
          </FieldRow>
        </>
      ) : (
        <>
          <FieldRow label="DSN secret">
            <input
              value={dsnSecret}
              onChange={(e) => setDsnSecret(e.target.value.toUpperCase())}
              placeholder="ANALYTICS_DSN"
              className={FIELD}
            />
          </FieldRow>
          <FieldRow label="Row cap">
            <input
              type="number"
              min={CONNECTOR_LIMITS.maxRows.min}
              max={CONNECTOR_LIMITS.maxRows.max}
              value={maxRows}
              onChange={(e) => setMaxRows(e.target.value)}
              className={`${FIELD} sm:w-32`}
            />
          </FieldRow>
        </>
      )}
      <FieldRow label="Timeout (ms)">
        <input
          type="number"
          min={CONNECTOR_LIMITS.timeoutMs.min}
          max={CONNECTOR_LIMITS.timeoutMs.max}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          className={`${FIELD} sm:w-32`}
        />
      </FieldRow>
      <FormError message={error} />
      <EditActions saving={saving} onCancel={onDone} />
    </form>
  );
}

/**
 * The allowlist, as rows rather than a YAML block. A rule's path may end in `*`
 * (prefix match) or contain a `*` segment, so the path stays free text — the
 * grammar is the server's to judge, and it answers with the offending entry.
 */
function AllowlistEditor({
  rules,
  save,
  saving,
  error,
  onDone,
}: {
  rules: string[];
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [rows, setRows] = useState(() =>
    rules.map((rule) => {
      const [method, ...rest] = rule.split(' ');
      return { method, path: rest.join(' ') };
    }),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allow = rows
      .filter((row) => row.path.trim())
      .map((row) => `${row.method} ${row.path.trim()}`);
    if (await save({ allow })) onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={row.method}
              onChange={(e) =>
                setRows((all) => all.map((r, j) => (j === i ? { ...r, method: e.target.value } : r)))
              }
              className="shrink-0 rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={row.path}
              onChange={(e) =>
                setRows((all) => all.map((r, j) => (j === i ? { ...r, path: e.target.value } : r)))
              }
              placeholder="/v1/customers"
              className={FIELD}
            />
            <button
              type="button"
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
              aria-label="Remove rule"
              className="shrink-0 rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((all) => [...all, { method: 'GET', path: '' }])}
          className={`${GHOST_BUTTON} inline-flex w-fit items-center gap-1.5`}
        >
          <Plus className="h-3 w-3" /> Add rule
        </button>
      </div>
      <p className="text-xs text-text-muted">
        A trailing <code className="font-mono">*</code> matches by prefix; a{' '}
        <code className="font-mono">{'/*'}</code> segment matches exactly one segment.
      </p>
      <FormError message={error} />
      <EditActions saving={saving} onCancel={onDone} />
    </form>
  );
}

/** The description, edited where it is read rather than behind a card. */
function DescriptionEditor({
  description,
  save,
  saving,
  error,
  onDone,
}: {
  description: string;
  save: (patch: Record<string, unknown>) => Promise<boolean>;
  saving: boolean;
  error: string | null;
  onDone: () => void;
}) {
  const [value, setValue] = useState(description);
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save({ description: value })) onDone();
      }}
    >
      <input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        placeholder="What this connector is, in one line"
        className={`${FIELD} font-open-sauce text-sm`}
      />
      <FormError message={error} />
      <EditActions saving={saving} onCancel={onDone} />
    </form>
  );
}

// ── Secrets ──────────────────────────────────────────────────────────────────

/** One referenced secret: its stored state, and the write-only form to fix it. */
function SecretRow({
  secret,
  communityId,
  onChanged,
}: {
  secret: SecretStatus;
  communityId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJsonBody(`/api/communities/${communityId}/secrets`, 'PUT', {
        name: secret.name,
        value,
      });
      setValue('');
      setEditing(false);
      onChanged();
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
      await fetchJsonBody(`/api/communities/${communityId}/secrets`, 'DELETE', { name: secret.name });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className={`h-4 w-4 shrink-0 ${secret.set ? 'text-brand-dark-green' : 'text-amber-500'}`} />
          <span className="truncate font-mono text-[13px] font-medium text-text-primary">{secret.name}</span>
          {secret.set ? (
            <span className="shrink-0 rounded-full bg-brand-light-bg px-2 py-0.5 text-[11px] font-semibold text-brand-dark-green">
              Stored
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Not set
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2"
          >
            {secret.set ? 'Replace' : 'Set value'}
          </button>
          {secret.set && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              aria-label={`Remove ${secret.name}`}
              className="rounded-lg border border-border-default p-1.5 text-text-muted transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          className="mt-2.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.length > 0) void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Value for ${secret.name}`}
            className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green"
          />
          <button
            type="submit"
            disabled={busy || value.length === 0}
            className="rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
      {editing && (
        <p className="mt-1.5 text-xs text-text-muted">
          Stored encrypted and never shown again — only the server reads it, while a call runs.
        </p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </li>
  );
}

// ── Test console ─────────────────────────────────────────────────────────────

function HttpTester({
  connector,
  communityId,
}: {
  connector: ConnectorDetail;
  communityId: string;
}) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [body, setBody] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HttpTestResult['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The allowlist is the menu: anything off it is refused before a request
  // leaves, so filling the form from a rule is the only way to get a green run.
  const fill = (rule: string) => {
    const [ruleMethod, rulePath] = rule.split(' ');
    setMethod(ruleMethod);
    setPath(rulePath.replace(/\*$/, ''));
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetchJsonBody<HttpTestResult>(
        `/api/communities/${communityId}/connectors/${encodeURIComponent(connector.name)}/test`,
        'POST',
        { method, path, body: body.trim() || undefined },
      );
      setResult(res.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const bodyless = method === 'GET' || method === 'HEAD';

  return (
    <div className="flex flex-col gap-3">
      {connector.allow.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {connector.allow.map((rule) => (
            <button
              key={rule}
              type="button"
              onClick={() => fill(rule)}
              className="rounded-lg border border-border-subtle bg-surface-2 px-2 py-1 font-mono text-[11.5px] text-text-secondary transition-colors hover:border-brand-green hover:text-text-primary"
            >
              {rule}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded-lg border border-border-default bg-surface-1 px-2 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/v1/customers"
          className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:border-brand-green"
        />
        <button
          type="submit"
          disabled={running || path.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : 'Run'}
        </button>
      </form>

      {!bodyless && (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Request body (optional)"
          className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 font-mono text-[12.5px] text-text-primary outline-none focus:border-brand-green"
        />
      )}

      {error && <TestError message={error} />}
      {result && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-md px-2 py-0.5 font-mono font-semibold ${
                result.status < 400
                  ? 'bg-brand-light-bg text-brand-dark-green'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {result.status}
            </span>
            {result.content_type && <span className="text-text-muted">{result.content_type}</span>}
            {result.truncated && <span className="text-text-muted">· truncated</span>}
          </div>
          <ResultBody text={result.body} />
        </div>
      )}
    </div>
  );
}

function PostgresTester({
  connector,
  communityId,
}: {
  connector: ConnectorDetail;
  communityId: string;
}) {
  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PostgresTestResult['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetchJsonBody<PostgresTestResult>(
        `/api/communities/${communityId}/connectors/${encodeURIComponent(connector.name)}/test`,
        'POST',
        { sql },
      );
      setResult(res.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="select id, name from customers limit 10"
        className="w-full rounded-lg border border-border-default bg-surface-1 px-3 py-2 font-mono text-[12.5px] text-text-primary outline-none focus:border-brand-green"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          One read-only statement, run in a READ ONLY transaction.
        </p>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || sql.trim().length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          {running ? 'Running…' : 'Run query'}
        </button>
      </div>

      {error && <TestError message={error} />}
      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-text-muted">
            {result.row_count} row{result.row_count === 1 ? '' : 's'}
            {result.truncated && ' · capped'}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="min-w-full text-left font-mono text-[12px]">
              <thead className="bg-surface-2 text-text-muted">
                <tr>
                  {result.columns.map((col) => (
                    <th key={col} className="whitespace-nowrap px-3 py-2 font-semibold">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle text-text-primary">
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1.5">
                        {cell === null ? <span className="text-text-muted">null</span> : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TestError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

/** Response bodies are usually JSON; pretty-print when they are, verbatim when not. */
function ResultBody({ text }: { text: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }, [text]);
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-[12px] leading-relaxed text-text-primary">
      {pretty || '(empty body)'}
    </pre>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/** The one-line verdict in the header: what an agent can do through this today. */
function statusOf(connector: ConnectorDetail): { label: string; tone: 'ok' | 'warn' | 'bad'; hint: string } {
  if (connector.invalid) {
    return { label: 'Not usable', tone: 'bad', hint: 'The frontmatter does not parse, so every call is refused.' };
  }
  const unset = connector.secrets.filter((s) => !s.set);
  if (unset.length > 0) {
    return {
      label: 'Missing secrets',
      tone: 'warn',
      hint: `${unset.map((s) => s.name).join(', ')} ${unset.length === 1 ? 'is' : 'are'} referenced but not stored — calls fail until set.`,
    };
  }
  if (connector.config?.alias === 'http' && connector.config.allow.length === 0) {
    return {
      label: 'Documentation only',
      tone: 'warn',
      hint: 'No allow entries, so no call is permitted. Agents can still read the docs.',
    };
  }
  return {
    label: 'Ready',
    tone: 'ok',
    hint:
      connector.config?.alias === 'postgres'
        ? 'Agents can run read-only queries through this connector.'
        : `Agents can make the ${connector.allow.length} allowed request${connector.allow.length === 1 ? '' : 's'}.`,
  };
}

const TONE_CLASSES = {
  ok: 'bg-brand-light-bg text-brand-dark-green',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
} as const;

export default function ConnectorPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('connector:') ? nodeId.slice('connector:'.length) : nodeId;
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const communityId = currentCommunity?.id;

  const [connector, setConnector] = useState<ConnectorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which card is in edit mode. One at a time: two open forms over the same
  // frontmatter would race, and the second save would be written against a
  // reloaded connector the form no longer matches.
  const [editing, setEditing] = useState<'description' | 'connection' | 'allow' | null>(null);

  // Awaited by every save, so a form closes on the reloaded value rather than
  // on the one it optimistically hoped for.
  const reload = useCallback(async () => {
    if (!communityId) return;
    try {
      const data = await fetchJson<{ connector: ConnectorDetail }>(
        `/api/communities/${communityId}/connectors/${encodeURIComponent(name)}`,
      );
      setConnector(data.connector);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [communityId, name]);

  useEffect(() => {
    if (communityLoading) return;
    if (!communityId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
  }, [communityId, communityLoading, reload]);

  const { save, saving, error: saveError, setError: setSaveError } = useConnectorSave(
    communityId ?? '',
    name,
    reload,
  );

  // A card's error belongs to the form that produced it; opening or closing one
  // clears it rather than carrying it to the next.
  const openEditor = (which: typeof editing) => {
    setSaveError(null);
    setEditing(which);
  };

  if (loading || communityLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (error || !connector) {
    return (
      <div className={`${CARD} px-5 py-10 text-center`}>
        <Plug className="mx-auto mb-3 h-8 w-8 text-text-muted" />
        <p className="text-sm text-text-muted">{error ?? 'Connector not found'}</p>
      </div>
    );
  }

  const status = statusOf(connector);
  const config = connector.config;
  const isPostgres = config?.alias === 'postgres';
  const Icon = isPostgres ? Database : Globe;
  const runnable = !connector.invalid && connector.secrets.every((s) => s.set);

  return (
    <div className="profile-content-fade flex flex-col gap-4">
      {/* ══ HEADER ══ */}
      <section className={`${CARD} px-5 py-5 sm:px-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light-bg text-brand-dark-green">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-ginto text-xl font-semibold text-text-primary">
                  {connector.name}
                </h1>
                <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-medium text-text-muted">
                  {connector.alias ?? 'no alias'}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[status.tone]}`}>
                  {status.label}
                </span>
              </div>
              {editing !== 'description' && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  {connector.description ?? status.hint}
                  <button
                    type="button"
                    onClick={() => openEditor('description')}
                    aria-label="Edit description"
                    className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </p>
              )}
            </div>
          </div>
          <Link
            href={`/directory/${encodeURIComponent(nodeId)}?tab=raw`}
            className="shrink-0 rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2"
          >
            Edit frontmatter
          </Link>
        </div>

        {editing === 'description' && (
          <DescriptionEditor
            description={connector.description ?? ''}
            save={save}
            saving={saving}
            error={saveError}
            onDone={() => openEditor(null)}
          />
        )}

        {connector.description && editing !== 'description' && (
          <p className="mt-3 flex items-start gap-2 text-xs text-text-muted">
            {status.tone === 'ok' ? (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-brand-dark-green" />
            ) : (
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            {status.hint}
          </p>
        )}
      </section>

      {/* ══ PARSE ERROR — the note exists but nothing below it is live ══ */}
      {connector.invalid && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700">This connector&apos;s frontmatter is invalid</p>
            <p className="mt-1 break-words text-sm text-red-700">{connector.invalid}</p>
            <Link
              href={`/directory/${encodeURIComponent(nodeId)}?tab=raw`}
              className="mt-2 inline-block text-xs font-semibold text-red-700 underline"
            >
              Fix it in the Raw tab
            </Link>
          </div>
        </div>
      )}

      {/* ══ CONNECTION ══ */}
      {config && (
        <Card
          title="Connection"
          icon={<Icon className="h-4 w-4" />}
          subtitle={isPostgres ? 'Read-only postgres' : 'Outbound HTTP'}
          action={editing === 'connection' ? undefined : <EditButton onClick={() => openEditor('connection')} />}
        >
          {editing === 'connection' ? (
            <ConnectionEditor
              config={config}
              save={save}
              saving={saving}
              error={saveError}
              onDone={() => openEditor(null)}
            />
          ) : (
          <div className="flex flex-col gap-3">
            {config.alias === 'http' ? (
              <>
                <Detail label="Base URL">{config.baseUrl}</Detail>
                {Object.entries(config.headers).length > 0 && (
                  <Detail label="Headers">
                    <span className="flex flex-col gap-1">
                      {Object.entries(config.headers).map(([key, value]) => (
                        <span key={key}>
                          <span className="text-text-muted">{key}: </span>
                          <SecretTemplate text={value} />
                        </span>
                      ))}
                    </span>
                  </Detail>
                )}
                <Detail label="Timeout">{config.timeoutMs} ms</Detail>
              </>
            ) : (
              <>
                <Detail label="DSN">
                  <SecretTemplate text={config.dsn} />
                </Detail>
                <Detail label="Row cap">{config.maxRows}</Detail>
                <Detail label="Timeout">{config.timeoutMs} ms</Detail>
              </>
            )}
          </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ══ ALLOWLIST — http only; postgres is governed by the SQL guard ══ */}
        {config?.alias === 'http' && (
          <Card
            title="Allowlist"
            icon={<ListChecks className="h-4 w-4" />}
            subtitle={`${config.allow.length} rule${config.allow.length === 1 ? '' : 's'}`}
            action={
              editing === 'allow' ? undefined : (
                <EditButton
                  onClick={() => openEditor('allow')}
                  label={config.allow.length === 0 ? 'Add rules' : 'Edit'}
                />
              )
            }
          >
            {editing === 'allow' ? (
              <AllowlistEditor
                rules={connector.allow}
                save={save}
                saving={saving}
                error={saveError}
                onDone={() => openEditor(null)}
              />
            ) : config.allow.length === 0 ? (
              <p className="text-sm text-text-muted">
                No calls are permitted, so this connector is documentation only. Add a rule like{' '}
                <code className="font-mono text-[12px]">GET /customers</code> to let agents call it.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {connector.allow.map((rule) => {
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
          </Card>
        )}

        {config?.alias === 'postgres' && (
          <Card title="Query limits" icon={<ShieldCheck className="h-4 w-4" />} subtitle="Enforced server-side">
            <ul className="flex flex-col gap-1.5 text-sm text-text-muted">
              <li>One statement per call, SELECT-shaped only.</li>
              <li>Runs inside a READ ONLY transaction.</li>
              <li>Capped at {config.maxRows} rows and {config.timeoutMs} ms.</li>
            </ul>
          </Card>
        )}

        {/* ══ SECRETS — the half of the config that isn't in the note ══ */}
        <Card
          title="Secrets"
          icon={<KeyRound className="h-4 w-4" />}
          subtitle={
            connector.secrets.length === 0
              ? 'None referenced'
              : `${connector.secrets.filter((s) => s.set).length} of ${connector.secrets.length} stored`
          }
        >
          {connector.secrets.length === 0 ? (
            <p className="text-sm text-text-muted">
              This connector references no secrets. Reference one from the frontmatter as{' '}
              <code className="font-mono text-[12px]">{'{{secret:NAME}}'}</code> and it will appear here to
              fill in.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {communityId &&
                connector.secrets.map((secret) => (
                  <SecretRow
                    key={secret.name}
                    secret={secret}
                    communityId={communityId}
                    onChanged={reload}
                  />
                ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ══ TEST — same executors an agent's call goes through ══ */}
      {config && communityId && (
        <Card
          title="Test"
          icon={<Play className="h-4 w-4" />}
          subtitle={
            isPostgres
              ? 'Runs for real, under the same limits and secret an agent gets'
              : 'Runs for real, through the same allowlist and secrets an agent gets'
          }
        >
          {!runnable ? (
            <div className="flex items-start gap-2 text-sm text-text-muted">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                {connector.invalid
                  ? 'Fix the frontmatter before testing.'
                  : 'Store the missing secrets above before testing.'}
              </span>
            </div>
          ) : config.alias === 'http' ? (
            <HttpTester connector={connector} communityId={communityId} />
          ) : (
            <PostgresTester connector={connector} communityId={communityId} />
          )}
        </Card>
      )}

      {/* ══ DOCS — the note body, which is what an agent actually reads ══ */}
      <Card
        title="Agent documentation"
        icon={<BookText className="h-4 w-4" />}
        subtitle="The note body, returned with every list_connectors call"
        action={
          <Link
            href={`/directory/${encodeURIComponent(nodeId)}?tab=context`}
            className="shrink-0 rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-2"
          >
            Edit
          </Link>
        }
      >
        {connector.docs ? (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-open-sauce text-[13px] leading-relaxed text-text-secondary">
            {connector.docs}
          </pre>
        ) : (
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Plus className="h-4 w-4" />
            Nothing written yet — agents get the config and no explanation of what this system is.
          </p>
        )}
      </Card>
    </div>
  );
}
