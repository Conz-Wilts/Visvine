/**
 * Who used a resource and how (`resource_access`): every read through the MCP,
 * an agent or the API, and a person's downloads and deletes. Written inside
 * the request that did the thing — never fire-and-forget, which a runtime that
 * throttles after the response would drop — and never allowed to fail it.
 */
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type AccessVia = 'web' | 'mcp' | 'agent' | 'api' | 'tool'
type AccessAction = 'read' | 'download' | 'upload' | 'share' | 'use' | 'delete'

export interface AccessEntry {
  resourceId: string
  spaceId: string
  userId: string | null
  via: AccessVia
  action: AccessAction
  agentName?: string | null
  runId?: string | null
  /** What it was used AS: the event whose cover it became, the person whose photo. */
  targetNodeId?: string | null
}

export async function logResourceAccess(entry: AccessEntry | AccessEntry[]): Promise<void> {
  const rows = Array.isArray(entry) ? entry : [entry]
  if (rows.length === 0) return
  try {
    await prisma.resourceAccess.createMany({
      data: rows.map((row) => ({
        resourceId: row.resourceId,
        spaceId: row.spaceId,
        userId: row.userId,
        via: row.via,
        action: row.action,
        agentName: row.agentName ?? null,
        runId: row.runId ?? null,
        targetNodeId: row.targetNodeId ?? null,
      })),
    })
  } catch (err) {
    logger.warn('resources.access.log.failed', { err })
  }
}
