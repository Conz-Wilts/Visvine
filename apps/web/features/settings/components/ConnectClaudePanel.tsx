'use client';

// Settings → General → MCP. How someone points Claude at their own Visvine context.
//
// One server, one address (lib/mcp/config.ts), and one tool behind it: reading,
// searching and writing context, the Drive, events, connectors, agents, and
// building Tools. What a connection may actually do is decided at consent, by
// which scopes it asked for — not by which address it was given, which is why
// there is only one to copy.
//
// This lives in personal settings rather than the space console on purpose:
// the OAuth token an MCP client holds belongs to the *person*, and every tool
// call names its own space_id, which is then re-checked against live
// membership and context grants server-side. So one connection covers every
// space you belong to, and there is nothing here for an admin to configure
// on someone else's behalf.
//
// There is no deep link or one-click install for a remote connector — Claude
// takes a URL typed into its own Connectors dialog. So the whole surface is a
// copyable address and nothing more: the click-path and the scope list belong
// to Claude's own add-connector and consent screens, which say it there anyway.

import { useEffect, useState } from 'react';
import { useCopied } from '@/features/shared/hooks/useCopied';
import { Alert, Button, SettingsSection } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

interface McpConnectInfo {
  url: string;
  issuer: string;
  scopes: { scope: string; description: string }[];
}

/** Load the server-truth MCP endpoint once. `null` while in flight. */
function useMcpConnectInfo() {
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
 * The address as plain, selectable text beside Copy — no field chrome, and
 * wrapping rather than truncating so the whole URL is always readable.
 */
function McpServerUrlRow({ url, label = 'MCP server address' }: { url: string | null; label?: string }) {
  const [copied, copy] = useCopied();

  const copyUrl = () => { if (url) void copy(url); };

  return (
    <div className="flex items-center gap-3">
      <p
        aria-label={label}
        className="min-w-0 flex-1 select-all break-all text-lg text-text-primary"
      >
        {url ?? 'Loading…'}
      </p>
      <Button variant="brand" onClick={copyUrl} disabled={!url}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export default function ConnectClaudePanel() {
  const { info, error } = useMcpConnectInfo();

  return (
    <SettingsSection title="MCP">
      {error && <Alert variant="error" inline>{error}</Alert>}
      <McpServerUrlRow url={info?.url ?? null} />
    </SettingsSection>
  );
}
