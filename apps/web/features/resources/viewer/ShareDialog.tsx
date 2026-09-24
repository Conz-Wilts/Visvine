'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, SearchInput, Textarea } from '@visvine/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import type { ChannelDirectoryEntry } from '@/lib/messages/types';
import type { ResourceView } from '@/lib/resources/shared/view';
import { ChannelIcon, channelFallback } from '@/features/messages/components/ChannelIcon';

/**
 * Share a resource into a channel: a message there that carries it — the
 * file, or the link as its card — so the channel's members can open it.
 * Only channels you are in, of the resource's space.
 */
export default function ShareDialog({
  resource,
  open,
  onClose,
  onShared,
}: {
  resource: ResourceView;
  open: boolean;
  onClose: () => void;
  onShared: (channelName: string) => void;
}) {
  const [channels, setChannels] = useState<ChannelDirectoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ChannelDirectoryEntry | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setNote('');
    setProblem(null);
    fetchJson<{ channels: ChannelDirectoryEntry[] }>(`/api/messages/channels?spaceId=${encodeURIComponent(resource.spaceId)}`)
      .then(({ channels: all }) => setChannels(all.filter((c) => c.isMember)))
      .catch(() => setChannels([]));
  }, [open, resource.spaceId]);

  const shown = (channels ?? []).filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));

  const send = async () => {
    if (!picked) return;
    setSending(true);
    setProblem(null);
    try {
      const text = resource.source === 'link' ? [note.trim(), resource.url].filter(Boolean).join('\n') : note.trim();
      await fetchJsonBody(`/api/messages/conversations/${encodeURIComponent(picked.id)}/messages`, 'POST', {
        text,
        ...(resource.source === 'upload' ? { fileIds: [resource.id] } : {}),
      });
      onShared(picked.name);
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not share it');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share ${resource.name}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-6 py-4">
          {problem && <p className="mr-auto text-sm text-danger">{problem}</p>}
          <Button variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" onClick={send} disabled={!picked} loading={sending}>
            Share
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-6 py-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Channel" />
        <div className="max-h-56 overflow-y-auto">
          {shown.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => setPicked(channel)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                picked?.id === channel.id ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-surface-subtle'
              }`}
            >
              <ChannelIcon icon={channel.icon} fallback={channelFallback(channel)} className="h-4 w-4 text-fg-muted" />
              <span className="truncate">{channel.name}</span>
            </button>
          ))}
        </div>
        {picked && <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a message" rows={2} />}
      </div>
    </Modal>
  );
}
