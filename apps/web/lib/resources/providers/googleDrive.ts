/**
 * A Google file described by Google, the way a Slack Work Object's entity is
 * supplied by the provider's own app rather than scraped: the real title,
 * owner, modified date, size and a thumbnail — read with the SHARER's own
 * Google Drive account (Settings → Accounts), when they have one connected.
 *
 * The Drive recipe asks for `drive.file`, which reaches files the person
 * opened or made through Visvine, so for most links Google answers 404 and the
 * unfurl falls back to the page's own tags. A failure of any kind is null.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { resolveAccountConnection } from '@/lib/connectors/accounts'
import { catalogEntryFor } from '@/lib/connectors/catalog'
import type { ConnectorAuth } from '@/lib/connectors/auth'
import { readBounded } from '@/lib/resources/unfurlFetch'

export interface ProviderEntity {
  title: string
  mimeType: string | null
  owner: string | null
  modifiedAt: string | null
  size: number | null
  thumbnail: Buffer | null
  source: string
}

const TIMEOUT_MS = 5_000
const MAX_THUMB_BYTES = 5 * 1024 * 1024

function driveAuth(): ConnectorAuth | null {
  const recipe = catalogEntryFor('google-drive', 'google-drive')
  const oauth = recipe?.oauth
  if (!oauth) return null
  return {
    provider: oauth.provider,
    mode: 'user',
    discovery: { kind: 'explicit', authorizeUrl: oauth.authorizeUrl!, tokenUrl: oauth.tokenUrl! },
    clientId: oauth.clientId ?? null,
    clientSecret: null,
    scopes: [...(oauth.scopes ?? [])],
    params: oauth.params ?? {},
    hosts: ['www.googleapis.com'],
  }
}

/** The Drive file id a Google URL names, or null. */
export function googleFileId(url: string): string | null {
  const m = /\/d\/([A-Za-z0-9_-]{6,})/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]{6,})/.exec(url)
  return m?.[1] ?? null
}

export async function googleDriveEntity(url: string, sharerId: string | null): Promise<ProviderEntity | null> {
  const fileId = googleFileId(url)
  if (!fileId || !sharerId) return null
  const account = await prisma.connectorAccount.findFirst({
    where: { userId: sharerId, recipe: 'google-drive', brokenAt: null },
    select: { name: true, recipe: true },
  })
  const auth = driveAuth()
  if (!account || !auth) return null
  try {
    const connection = await resolveAccountConnection({ userId: sharerId, name: account.name, recipe: account.recipe, auth })
    const headers = { Authorization: `Bearer ${connection.accessToken}` }
    const fields = 'name,mimeType,modifiedTime,size,owners(displayName),thumbnailLink'
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const file = (await res.json()) as {
      name?: string
      mimeType?: string
      modifiedTime?: string
      size?: string
      owners?: Array<{ displayName?: string }>
      thumbnailLink?: string
    }
    if (!file.name) return null
    let thumbnail: Buffer | null = null
    if (file.thumbnailLink && /^https:\/\/[a-z0-9.-]+\.(googleusercontent|google)\.com\//.test(file.thumbnailLink)) {
      // Short-lived and private: fetched with the same bearer, then re-hosted.
      const thumb = await fetch(file.thumbnailLink.replace(/=s\d+$/, '=s1200'), {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null)
      if (thumb?.ok) thumbnail = await readBounded(thumb, MAX_THUMB_BYTES)
    }
    return {
      title: file.name,
      mimeType: file.mimeType ?? null,
      owner: file.owners?.[0]?.displayName ?? null,
      modifiedAt: file.modifiedTime ?? null,
      size: file.size ? Number(file.size) : null,
      thumbnail,
      source: `connector:${account.name}`,
    }
  } catch (err) {
    logger.warn('resources.unfurl.googleDrive', { err })
    return null
  }
}
