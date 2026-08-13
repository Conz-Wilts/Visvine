// The context's control-plane sidecar. One ContextState row per named file per
// context: "folders.json" (registry), "audit.jsonl", "join-
// requests.jsonl", "move-proposals.jsonl", "enrichment-state.json". Content is
// text; JSON/JSONL parsing lives here, domain meaning in the callers.

import prisma from '@/lib/prisma'
import type { Context } from './store'

async function readText(context: Context, name: string): Promise<string | null> {
  const row = await prisma.contextState.findUnique({
    where: {
      context_state_identity: { spaceId: context.spaceId, ownerKey: context.ownerKey, name },
    },
    select: { content: true },
  })
  return row?.content ?? null
}

async function writeText(context: Context, name: string, content: string): Promise<void> {
  await prisma.contextState.upsert({
    where: {
      context_state_identity: { spaceId: context.spaceId, ownerKey: context.ownerKey, name },
    },
    create: { spaceId: context.spaceId, ownerKey: context.ownerKey, name, content },
    update: { content },
  })
}

export async function readJson<T>(context: Context, name: string, fallback: T): Promise<T> {
  const raw = await readText(context, name)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(context: Context, name: string, value: unknown): Promise<void> {
  await writeText(context, name, JSON.stringify(value, null, 2))
}

/** Parse a JSONL file into records (malformed lines skipped). */
export async function readJsonl<T>(context: Context, name: string): Promise<T[]> {
  const raw = await readText(context, name)
  if (!raw) return []
  const out: T[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      /* skip malformed line */
    }
  }
  return out
}

export async function appendJsonl(context: Context, name: string, record: unknown): Promise<void> {
  const raw = (await readText(context, name)) ?? ''
  const line = JSON.stringify(record)
  await writeText(context, name, raw ? `${raw.replace(/\n+$/, '')}\n${line}\n` : `${line}\n`)
}

/** Rewrite a whole JSONL file (used when resolving requests/proposals in place). */
export async function writeJsonl(context: Context, name: string, records: unknown[]): Promise<void> {
  await writeText(context, name, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''))
}
