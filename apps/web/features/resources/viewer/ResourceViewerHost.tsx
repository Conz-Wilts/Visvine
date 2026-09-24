'use client';

import { useEffect, useState } from 'react';
import {
  ConfirmDialog,
  ResourceViewer,
  ToastHost,
  ZOOM_IDENTITY,
  stepZoom,
  useToasts,
  type MenuItem,
  type ViewerAction,
  type ZoomState,
} from '@visvine/ui';
import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MessageSquareIcon,
  Share2Icon,
  Trash2Icon,
} from '@/features/shared/icons';
import { useSpaceHref } from '@/features/shared/contexts/SpaceContext';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { fetchJson } from '@/lib/fetchJson';
import { invalidateRequestCachePrefix, swrFetch } from '@/features/shared/lib/requestCache';
import type { ResourceView } from '@/lib/resources/shared/view';
import { desktopFiles } from '@/features/desktop/lib/desktop';
import Stage, { zoomMaxOf } from './Stage';
import ShareDialog from './ShareDialog';
import { resourceMeta } from './meta';

/** The key a resource's view is cached under; a change to it evicts this prefix. */
export const resourceViewKey = (id: string) => `resource-view:${id}`;

/** Download the original under its own name, without leaving the page. */
function download(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ResourceViewerHost({
  resourceId,
  full,
  onModeChange,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  resourceId: string;
  full: boolean;
  onModeChange: (mode: 'panel' | 'full') => void;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  position: string | null;
}) {
  const [resource, setResource] = useState<ResourceView | null>(null);
  const [missing, setMissing] = useState(false);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_IDENTITY);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { toasts, push, dismiss } = useToasts();
  const spaceHref = useSpaceHref();
  const router = useSpaceRouter();

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    setZoom(ZOOM_IDENTITY);
    swrFetch(
      resourceViewKey(resourceId),
      () => fetchJson<{ resource: ResourceView }>(`/api/resources/${encodeURIComponent(resourceId)}/view`),
      (data) => !cancelled && setResource(data.resource),
    ).catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  const current = resource?.id === resourceId ? resource : null;
  if (!current) {
    return (
      <ResourceViewer open mode={full ? 'full' : 'panel'} onModeChange={onModeChange} onClose={onClose} title="" kind="other">
        <div className="flex h-full items-center justify-center">
          <span className="h-8 w-8 animate-pulse rounded-lg bg-surface" />
        </div>
      </ResourceViewer>
    );
  }

  const r = current;
  const native = desktopFiles();
  const zoomMax = zoomMaxOf(r);
  const primary: ViewerAction | null =
    r.source === 'link' && r.url
      ? {
          id: 'open',
          label: `Open in ${r.providerLabel}`,
          icon: <ExternalLinkIcon />,
          onSelect: () => window.open(r.url!, '_blank', 'noopener,noreferrer'),
        }
      : r.downloadUrl
        ? { id: 'download', label: 'Download', icon: <DownloadIcon />, onSelect: () => download(r.downloadUrl!) }
        : null;

  const copyLink = async () => {
    const href = `${window.location.origin}${spaceHref(`/directory?view=resources&resource=${encodeURIComponent(r.id)}`)}`;
    try {
      await navigator.clipboard.writeText(href);
      push('success', 'Link copied');
    } catch {
      push('error', 'Could not copy the link');
    }
  };

  const openNatively = native && r.source === 'upload'
    ? async () => {
        const result = await native.open(r.id);
        if (!result.ok) push('error', result.error ?? 'Could not open it');
      }
    : null;

  const context = r.shares.find((s) => s.messageId && s.channelId);
  const menu: MenuItem[] = [
    ...(context
      ? [{
          id: 'context',
          label: 'View in channel',
          icon: <MessageSquareIcon />,
          onSelect: () => router.push(`/channels/${encodeURIComponent(context.channelId!)}?message=${encodeURIComponent(context.messageId!)}`),
        }]
      : []),
    ...(r.nodeId
      ? [{ id: 'note', label: 'Open note', icon: <FileTextIcon />, onSelect: () => router.push(`/directory/${encodeURIComponent(r.nodeId!)}`) }]
      : []),
    ...(openNatively ? [{ id: 'native', label: 'Open in app', icon: <ExternalLinkIcon />, onSelect: () => void openNatively() }] : []),
    ...(native && r.source === 'upload' && window.visvineDesktop?.platform === 'darwin'
      ? [{ id: 'quicklook', label: 'Quick Look', icon: <ExternalLinkIcon />, onSelect: () => void native.quickLook(r.id) }]
      : []),
    ...(r.source === 'upload' && r.downloadUrl && primary?.id !== 'download'
      ? [{ id: 'download', label: 'Download', icon: <DownloadIcon />, onSelect: () => download(r.downloadUrl!) }]
      : []),
    ...(r.canManage && !r.deleted ? [{ id: 'delete', label: 'Delete', icon: <Trash2Icon />, danger: true, onSelect: () => setDeleting(true) }] : []),
  ];

  return (
    <>
      <ResourceViewer
        open
        mode={full ? 'full' : 'panel'}
        onModeChange={onModeChange}
        onClose={onClose}
        title={r.name}
        kind={r.kind}
        meta={resourceMeta(r)}
        person={r.creator ? { name: r.creator.name, imageUrl: r.creator.image } : null}
        primary={primary}
        actions={[
          { id: 'share', label: 'Share', icon: <Share2Icon />, onSelect: () => setSharing(true) },
          { id: 'copy', label: 'Copy link', icon: <CopyIcon />, onSelect: () => void copyLink() },
        ]}
        menu={menu}
        onPrev={onPrev}
        onNext={onNext}
        position={position}
        zoom={
          zoomMax
            ? {
                label: `${Math.round(zoom.scale * 100)}%`,
                onIn: () => setZoom((z) => stepZoom(z, 1, zoomMax)),
                onOut: () => setZoom((z) => stepZoom(z, -1, zoomMax)),
                onReset: () => setZoom(ZOOM_IDENTITY),
              }
            : null
        }
      >
        <Stage
          resource={r}
          full={full}
          zoom={zoom}
          onZoom={setZoom}
          onDownload={() => r.downloadUrl && download(r.downloadUrl)}
          onOpenInApp={openNatively}
        />
      </ResourceViewer>
      <ShareDialog
        resource={r}
        open={sharing}
        onClose={() => setSharing(false)}
        onShared={(channel) => {
          invalidateRequestCachePrefix(resourceViewKey(r.id));
          invalidateRequestCachePrefix('resources:');
          push('success', `Shared in #${channel}`);
        }}
      />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${r.name}?`}
        body="It moves to the trash, where it can be restored."
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          await fetch(`/api/resources?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' });
          invalidateRequestCachePrefix('resources:');
          invalidateRequestCachePrefix(resourceViewKey(r.id));
          setDeleting(false);
          onClose();
        }}
      />
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
