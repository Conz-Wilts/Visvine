'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Skeleton } from '@visvine/ui';
import { BanIcon, ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, HandIcon } from '@/features/shared/icons';
import { fetchJson } from '@/lib/fetchJson';
import { TOOL_PERMISSIONS, type ToolPermission } from '@/lib/connectors/toolPolicy';

/**
 * What an MCP connector's server can do, and which of it this connector may
 * actually use.
 *
 * The tools are read LIVE from the server every time this opens
 * (GET …/connectors/<name>/tools). A server adds and withdraws tools between
 * visits, and a permissions screen showing a stale list is one somebody makes
 * a decision on that no longer applies — so the cost of a round trip is worth
 * paying, and the empty state says the server answered rather than pretending
 * a cached list is current.
 *
 * The three verdicts are the gate's, not this component's
 * (lib/connectors/toolPolicy.ts). What matters for reading this file is that
 * `ask` means "only when someone is here" — a run a person started — and NOT a
 * prompt: Visvine has no way to interrupt a 3am scheduled run and ask, so the
 * setting promises presence, which the runtime can actually keep. The labels
 * say so in those words rather than borrowing "ask every time" from a chat
 * client that can.
 *
 * Every change is one PATCH naming the tools and the verdict — a group's
 * dropdown is the same call with more names — and the row is repainted
 * optimistically, because the write is a frontmatter merge that either lands
 * or errors, never half-lands.
 */

interface ConnectorTool {
  name: string;
  title: string | null;
  description: string | null;
  group: 'read' | 'writes';
  permission: ToolPermission;
  /** What the tool's own description suggests, when it differs from what is set. */
  suggested?: ToolPermission;
}

interface Listing {
  url: string;
  tools: ConnectorTool[];
  default: ToolPermission;
}

/** The three verdicts, as the screen says them. */
const VERDICTS: Record<ToolPermission, { label: string; short: string; hint: string; Icon: typeof BanIcon }> = {
  allow: {
    label: 'Always allow',
    short: 'Allow',
    hint: 'Any run may use it, including one that fires while nobody is here.',
    Icon: CircleCheckIcon,
  },
  ask: {
    label: 'Only when I’m here',
    short: 'When here',
    hint: 'Runs you start yourself. A scheduled or event-fired run is refused.',
    Icon: HandIcon,
  },
  deny: {
    label: 'Never',
    short: 'Never',
    hint: 'Refused for everything, and never offered to a model.',
    Icon: BanIcon,
  },
};

const GROUPS: ReadonlyArray<{ id: ConnectorTool['group']; label: string; blurb: string }> = [
  {
    id: 'writes',
    label: 'Tools that change things',
    blurb: 'They write to your account at the service — or the server does not say they don’t.',
  },
  { id: 'read', label: 'Read-only tools', blurb: 'The server says these only read.' },
];

/** The one verdict every tool in a list is on, or null when they disagree. */
function sharedVerdict(tools: readonly ConnectorTool[]): ToolPermission | null {
  if (tools.length === 0) return null;
  const first = tools[0].permission;
  return tools.every((t) => t.permission === first) ? first : null;
}

function ToolSwitch({
  value,
  disabled,
  onChange,
  label,
}: {
  value: ToolPermission;
  disabled: boolean;
  onChange: (next: ToolPermission) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Permission for ${label}`}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-line-subtle p-0.5"
    >
      {TOOL_PERMISSIONS.map((verdict) => {
        const { Icon, label: name, hint } = VERDICTS[verdict];
        const on = value === verdict;
        return (
          <button
            key={verdict}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name}
            title={`${name} — ${hint}`}
            disabled={disabled}
            onClick={() => { if (!on) onChange(verdict); }}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-50 ${
              on
                ? 'bg-surface-muted text-fg'
                : 'text-fg-muted hover:bg-surface-subtle hover:text-fg-secondary'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

export default function ConnectorToolPermissions({
  spaceId,
  name,
}: {
  spaceId: string;
  /** The connector's note name — `connectors/<name>.md`. */
  name: string;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const base = `/api/spaces/${encodeURIComponent(spaceId)}/connectors/${encodeURIComponent(name)}/tools`;

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setError(null);
    void fetchJson<Listing>(base)
      .then((data) => { if (!cancelled) setListing(data); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [base]);

  const set = useCallback(
    async (names: readonly string[], permission: ToolPermission) => {
      if (names.length === 0) return;
      const before = listing;
      setSaving(true);
      setSaveError(null);
      // Painted first: the write is a frontmatter merge that lands whole or
      // errors, so there is no half-state to show and every failure restores.
      setListing((prev) =>
        prev
          ? { ...prev, tools: prev.tools.map((t) => (names.includes(t.name) ? { ...t, permission } : t)) }
          : prev,
      );
      try {
        await fetchJson(base, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tools: names, permission }),
        });
      } catch (e) {
        setListing(before);
        setSaveError(e instanceof Error ? e.message : 'Could not change the permission');
      } finally {
        setSaving(false);
      }
    },
    [base, listing],
  );

  const grouped = useMemo(() => {
    const map = new Map<ConnectorTool['group'], ConnectorTool[]>();
    for (const tool of listing?.tools ?? []) {
      const rows = map.get(tool.group);
      if (rows) rows.push(tool);
      else map.set(tool.group, [tool]);
    }
    return map;
  }, [listing]);

  const heading = (
    <div>
      <h3 className="text-sm font-semibold text-fg">Tool permissions</h3>
      <p className="mt-0.5 text-xs text-fg-muted">
        Choose when this connector’s tools may be used. “Only when I’m here” means a run you
        started — a scheduled one is refused.
      </p>
    </div>
  );

  if (error) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <Alert>{error}</Alert>
      </section>
    );
  }

  if (!listing) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
        </div>
      </section>
    );
  }

  if (listing.tools.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        {heading}
        <p className="text-sm text-fg-muted">This server advertises no tools.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {heading}
      {saveError && <Alert>{saveError}</Alert>}

      {GROUPS.map((group) => {
        const tools = grouped.get(group.id) ?? [];
        if (tools.length === 0) return null;
        const shut = collapsed.has(group.id);
        const shared = sharedVerdict(tools);
        return (
          <div key={group.id} className="flex flex-col">
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                aria-expanded={!shut}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (shut) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-fg"
              >
                {shut ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-fg-muted" /> : <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />}
                <span className="truncate">{group.label}</span>
                <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-xs text-fg-muted">{tools.length}</span>
              </button>
              {/* One dropdown for the whole group — the same PATCH, with every
                  name in it. "Mixed" is a readout, never a value to choose. */}
              <select
                aria-label={`Permission for every ${group.label.toLowerCase()}`}
                value={shared ?? ''}
                disabled={saving}
                onChange={(e) => void set(tools.map((t) => t.name), e.target.value as ToolPermission)}
                className="shrink-0 rounded-lg border border-line-subtle bg-surface-subtle px-2 py-1.5 text-xs text-fg-secondary disabled:opacity-50"
              >
                {shared === null && <option value="">Mixed</option>}
                {TOOL_PERMISSIONS.map((verdict) => (
                  <option key={verdict} value={verdict}>{VERDICTS[verdict].label}</option>
                ))}
              </select>
            </div>

            {!shut && (
              <p className="pb-1 pl-6 text-xs text-fg-muted">{group.blurb}</p>
            )}

            {!shut && (
              <ul className="divide-y divide-line-subtle border-t border-line-subtle">
                {tools.map((tool) => (
                  <li key={tool.name} className="flex min-h-12 items-center gap-3 py-2 pl-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{tool.title ?? tool.name}</p>
                      {(tool.description || (tool.suggested && tool.suggested !== tool.permission)) && (
                        <p className="truncate text-xs text-fg-muted">
                          {[tool.suggested && tool.suggested !== tool.permission ? `Suggested ${tool.suggested}` : null, tool.description]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                    <ToolSwitch
                      value={tool.permission}
                      disabled={saving}
                      label={tool.title ?? tool.name}
                      onChange={(next) => void set([tool.name], next)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
