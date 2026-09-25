/**
 * A Tool's deploy keys (`app_tool_deploy_keys`): minted, listed and revoked on
 * the Tool's own page by whoever may edit it, and verified when one arrives
 * as an MCP bearer (lib/mcp/auth.ts). The rules are ./shared/deployKeys.ts.
 *
 * A key acts as the person who minted it. Verifying one answers WHO and
 * WHICH TOOL; what that person may do in the space is re-resolved on every
 * call, as for an OAuth token, and `runAction` holds the call to the key's
 * space, Tool and actions.
 */
import prisma from '@/lib/prisma'
import { logAudit } from '@/lib/notes/audit'
import { writeDenialFull } from '@/lib/notes/contextService'
import type { ContextPrincipal } from '@/lib/notes/shared/contextTypes'
import * as store from '@/lib/notes/store'
import type { Context } from '@/lib/notes/store'
import { TOOL_NAME_RE, toolIndexPath } from './config'
import { toolFolderIn } from './location'
import {
  deployKeyHash,
  deployKeyLabel,
  deployKeyPrefix,
  isDeployKey,
  MAX_DEPLOY_KEYS,
  newDeployKey,
} from './shared/deployKeys'

export interface DeployKeySummary {
  id: string
  label: string
  prefix: string
  createdAt: string
  createdBy: { id: string; name: string }
  lastUsedAt: string | null
}

type Refusal = { ok: false; status: number; error: string }

/** The Tool's index path when the viewer may edit it — the bar for its keys. */
async function editableTool(p: ContextPrincipal, context: Context, name: string): Promise<{ ok: true; indexPath: string } | Refusal> {
  if (!TOOL_NAME_RE.test(name)) return { ok: false, status: 400, error: 'Bad tool name.' }
  const indexPath = toolIndexPath(name, await toolFolderIn(context.spaceId, name))
  if (!(await store.readNoteOrNull(context, indexPath))) return { ok: false, status: 404, error: `No tool named "${name}".` }
  const denial = await writeDenialFull(p, context, indexPath)
  if (denial) return { ok: false, status: 403, error: 'Only someone who can edit this tool manages its deploy keys.' }
  return { ok: true, indexPath }
}

export async function listDeployKeys(p: ContextPrincipal, context: Context, name: string): Promise<{ ok: true; keys: DeployKeySummary[] } | Refusal> {
  const tool = await editableTool(p, context, name)
  if (!tool.ok) return tool
  const rows = await prisma.appToolDeployKey.findMany({
    where: { spaceId: context.spaceId, toolName: name, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, label: true, prefix: true, createdAt: true, lastUsedAt: true, creator: { select: { id: true, name: true } } },
  })
  return {
    ok: true,
    keys: rows.map((row) => ({
      id: row.id,
      label: row.label,
      prefix: row.prefix,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.creator,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    })),
  }
}

/** A new key for the Tool, returned once — only its hash is kept. */
export async function mintDeployKey(
  p: ContextPrincipal,
  context: Context,
  name: string,
  rawLabel?: unknown,
): Promise<{ ok: true; key: string; summary: DeployKeySummary } | Refusal> {
  const tool = await editableTool(p, context, name)
  if (!tool.ok) return tool
  const label = deployKeyLabel(rawLabel)
  if (!label.ok) return { ok: false, status: 400, error: label.error }
  const live = await prisma.appToolDeployKey.count({ where: { spaceId: context.spaceId, toolName: name, revokedAt: null } })
  if (live >= MAX_DEPLOY_KEYS) return { ok: false, status: 409, error: `A tool has at most ${MAX_DEPLOY_KEYS} deploy keys — revoke one first.` }
  const key = newDeployKey()
  const row = await prisma.appToolDeployKey.create({
    data: { spaceId: context.spaceId, toolName: name, label: label.label, prefix: deployKeyPrefix(key), keyHash: deployKeyHash(key), createdBy: p.userId },
    select: { id: true, label: true, prefix: true, createdAt: true, creator: { select: { id: true, name: true } } },
  })
  void logAudit(context.spaceId, {
    userId: p.userId,
    name: p.name,
    action: 'tool',
    path: tool.indexPath,
    detail: `made the deploy key “${row.label}” (${row.prefix}…)`,
  })
  return {
    ok: true,
    key,
    summary: { id: row.id, label: row.label, prefix: row.prefix, createdAt: row.createdAt.toISOString(), createdBy: row.creator, lastUsedAt: null },
  }
}

export async function revokeDeployKey(p: ContextPrincipal, context: Context, name: string, keyId: string): Promise<{ ok: true } | Refusal> {
  const tool = await editableTool(p, context, name)
  if (!tool.ok) return tool
  const revoked = await prisma.appToolDeployKey.updateMany({
    where: { id: keyId, spaceId: context.spaceId, toolName: name, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: p.userId },
  })
  if (revoked.count === 0) return { ok: false, status: 404, error: 'No such key.' }
  void logAudit(context.spaceId, { userId: p.userId, name: p.name, action: 'tool', path: tool.indexPath, detail: 'revoked a deploy key' })
  return { ok: true }
}

/** A deleted Tool's keys go with it. */
export async function dropDeployKeys(spaceId: string, name: string): Promise<void> {
  await prisma.appToolDeployKey.deleteMany({ where: { spaceId, toolName: name } })
}

export interface VerifiedDeployKey {
  id: string
  label: string
  spaceId: string
  tool: string
  user: { id: string; name: string; email: string }
}

/** How often a key's last use is written — a CI loop must not write a row per call. */
const TOUCH_EVERY_MS = 60_000

/** A presented key → who it acts as and for which Tool; null for anything else. */
export async function verifyDeployKey(token: string, now: Date = new Date()): Promise<VerifiedDeployKey | null> {
  if (!isDeployKey(token)) return null
  const row = await prisma.appToolDeployKey.findUnique({
    where: { keyHash: deployKeyHash(token) },
    select: {
      id: true,
      label: true,
      spaceId: true,
      toolName: true,
      revokedAt: true,
      lastUsedAt: true,
      creator: { select: { id: true, name: true, email: true, isActive: true } },
    },
  })
  if (!row || row.revokedAt || !row.creator.isActive) return null
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    void prisma.appToolDeployKey.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => undefined)
  }
  return {
    id: row.id,
    label: row.label,
    spaceId: row.spaceId,
    tool: row.toolName,
    user: { id: row.creator.id, name: row.creator.name, email: row.creator.email },
  }
}
