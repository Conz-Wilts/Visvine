'use client';

import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { notesApi } from '@/features/notes/lib/notesApi';
import { readBriefSettings, updateBriefSettings, type BriefSettings } from '@/lib/agents/briefEdit';
import type { AgentSummary } from '@/lib/agents/service';
import { useAgentOptions } from '../lib/useAgentOptions';
import AgentSettingsFields from './AgentSettingsFields';

/**
 * The brief's settings, editable in place. The note is the record: saving
 * reads it back, rewrites only the frontmatter keys the form owns
 * (lib/agents/briefEdit.ts) and writes it through the ordinary notes API —
 * the same gate as the Raw tab, so a member saving a live agent's settings
 * turns it off exactly as editing the note would. The form says so before
 * they press Save.
 */
export default function AgentSettingsPanel({
  spaceId,
  agent,
  isAdmin,
  onSaved,
}: {
  spaceId: string;
  agent: AgentSummary & { brief: string };
  isAdmin: boolean;
  onSaved: () => void;
}) {
  const { options } = useAgentOptions(spaceId);
  const [value, setValue] = useState<BriefSettings>(() => readBriefSettings(agent.brief));
  const [saved, setSaved] = useState<BriefSettings>(() => readBriefSettings(agent.brief));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A save elsewhere (the Raw tab, an MCP write) shows up on reload; the form
  // follows the note unless the person is mid-edit.
  useEffect(() => {
    const next = readBriefSettings(agent.brief);
    setSaved(next);
    setValue((cur) => (JSON.stringify(cur) === JSON.stringify(saved) ? next : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.brief]);

  const dirty = JSON.stringify(value) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { content } = await notesApi.read(spaceId, agent.path);
      await notesApi.write(spaceId, agent.path, updateBriefSettings(content, value));
      setSaved(value);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AgentSettingsFields value={value} onChange={setValue} options={options} isAdmin={isAdmin} />
      {error && <Alert inline>{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button variant="brand" size="sm" onClick={save} disabled={!dirty || busy || !value.model.trim()} loading={busy} loadingText="Saving…">
          Save settings
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setValue(saved)} disabled={busy}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}
