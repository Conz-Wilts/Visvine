'use client';

// Settings → Connections. How someone points Claude at their own Visvine
// context.
//
// This lives in personal settings rather than the community console on purpose:
// the OAuth token an MCP client holds belongs to the *person*, and every tool
// call names its own community_id, which is then re-checked against live
// membership and brain grants server-side. So one connection covers every
// community you belong to, and there is nothing here for an admin to configure
// on someone else's behalf.
//
// There is no deep link or one-click install for a remote connector — Claude
// takes a URL typed into its own Connectors dialog. So the whole surface is a
// copyable address and nothing more: the click-path and the scope list belong
// to Claude's own add-connector and consent screens, which say it there anyway.

import { useEffect, useState } from 'react';
import { Alert, Button, SettingsSection } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

export interface McpConnectInfo {
  url: string;
  issuer: string;
  scopes: { scope: string; description: string }[];
}

/** Load the server-truth MCP endpoint once. `null` while in flight. */
export function useMcpConnectInfo() {
  const [info, setInfo] = useState<McpConnectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJson<McpConnectInfo>('/api/mcp/connect-info')
      .then((d) => { if (alive) setInfo(d); })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load the server address');
      });
    return () => { alive = false; };
  }, []);

  return { info, error };
}

/**
 * Read-only address + Copy, mirroring the invite-link row in the console so the
 * two "copy this and hand it over" affordances look the same.
 */
export function McpServerUrlRow({ url }: { url: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url ?? 'Loading…'}
        aria-label="MCP server address"
        className="min-w-0 flex-1 truncate rounded-xl border border-transparent bg-surface-2 px-3.5 py-2.5 font-mono text-xs text-text-secondary"
      />
      <Button variant="pill-secondary" onClick={copy} disabled={!url}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export default function ConnectClaudePanel() {
  const { info, error } = useMcpConnectInfo();

  return (
    <div className="space-y-8">
      {error && <Alert variant="error" inline>{error}</Alert>}

      <SettingsSection
        title="Connect Claude"
        description="Give Claude access to your Visvine context — the entities, notes and connections in every community you're a member of. Visvine runs the server itself; there is nothing to install."
      >
        <McpServerUrlRow url={info?.url ?? null} />
      </SettingsSection>
    </div>
  );
}
