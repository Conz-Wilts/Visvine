'use client';

// Settings → MCP. How someone points Claude at their own Visvine
// context — and, separately, at the Tool creator.
//
// Two servers, two addresses (lib/mcp/config.ts): the everyday one reads,
// searches and writes context and can discover and install Tools; the creator
// one carries only the authoring loop that writes a Tool's code. They are
// separate OAuth resources, so connecting one never grants the other.
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
  /** The context server. */
  url: string;
  /** The Tool creator server. */
  creatorUrl: string;
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
 * Read-only address + Copy, mirroring the invite-link row in the console so the
 * two "copy this and hand it over" affordances look the same.
 */
function McpServerUrlRow({ url, label = 'MCP server address' }: { url: string | null; label?: string }) {
  const [copied, copy] = useCopied();

  const copyUrl = () => { if (url) void copy(url); };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url ?? 'Loading…'}
        aria-label={label}
        className="min-w-0 flex-1 truncate rounded-xl border border-transparent bg-surface-2 px-3.5 py-2.5 font-mono text-xs text-text-secondary"
      />
      <Button variant="brand" onClick={copyUrl} disabled={!url}>
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
        description="Give Claude access to your Visvine context — the entities, notes and connections in every space you're a member of. Visvine runs the server itself; there is nothing to install."
      >
        <McpServerUrlRow url={info?.url ?? null} />
      </SettingsSection>

      <SettingsSection
        title="Connect the Tool creator"
        description="A separate server for building Tools with a coding agent (Claude Code, Cursor): scaffold, write, compile, preview and publish. It carries only the authoring loop — connect it when you're building a Tool, and use the address above for everything else."
      >
        <McpServerUrlRow url={info?.creatorUrl ?? null} label="Tool creator MCP server address" />
      </SettingsSection>
    </div>
  );
}
