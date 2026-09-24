import { FILE_KIND_LABEL, asFileKind } from '@visvine/ui';
import { timeAgo } from '@/lib/date';
import { formatBytes } from '@/lib/utils';
import type { ResourceView } from '@/lib/resources/shared/view';

/**
 * A resource's facts as one muted line, joined by `·`:
 * `Ana · #brand · 3d · PDF · 2.1 MB`, `docs.google.com · #launch · 1w`.
 */
export function resourceMeta(r: ResourceView, { people = true, channel: withChannel = true }: { people?: boolean; channel?: boolean } = {}): string {
  const parts: string[] = []
  if (people && r.creator?.name) parts.push(r.creator.name)
  const channel = r.shares.find((s) => s.channelName)?.channelName
  if (channel && withChannel) parts.push(`#${channel}`)
  parts.push(timeAgo(r.createdAt, { style: 'compact' }))
  if (r.source === 'link') {
    if (r.card?.siteName) parts.unshift(r.card.siteName)
  } else {
    parts.push(FILE_KIND_LABEL[asFileKind(r.kind)])
    if (r.fileSize) parts.push(formatBytes(r.fileSize))
  }
  return parts.filter(Boolean).join(' · ')
}
