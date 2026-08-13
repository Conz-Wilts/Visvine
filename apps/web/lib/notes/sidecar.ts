// The brain's control-plane sidecar — the DB port of blackbird-brain's
// src/server/brainStore.ts (`.brain/` directory). One SpaceBrainFile row per
// named file per brain: "folders.json" (registry), "audit.jsonl", "join-
// requests.jsonl", "move-proposals.jsonl", "enrichment-state.json". Content is
// text; JSON/JSONL parsing lives here, domain meaning in the callers.

import prisma from '@/lib/prisma'
import type { Brain } from './store'

async function readText(brain: Brain, name: string): Promise<string | null> {
  const row = await prisma.spaceBrainFile.findUnique({
    where: {
      brain_file_identity: { spaceId: brain.spaceId, ownerKey: brain.ownerKey, name },
    },
    select: { content: true },
  })
  return row?.content ?? null
}

async function writeText(brain: Brain, name: string, content: string): Promise<void> {
  await prisma.spaceBrainFile.upsert({
    where: {
      brain_file_identity: { spaceId: brain.spaceId, ownerKey: brain.ownerKey, name },
    },
    create: { spaceId: brain.spaceId, ownerKey: brain.ownerKey, name, content },
    update: { content },
  })
}

export async function readJson<T>(brain: Brain, name: string, fallback: T): Promise<T> {
  const raw = await readText(brain, name)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(brain: Brain, name: string, value: unknown): Promise<void> {
  await writeText(brain, name, JSON.stringify(value, null, 2))
}

/** Parse a JSONL file into records (malformed lines skipped). */
export async function readJsonl<T>(brain: Brain, name: string): Promise<T[]> {
  const raw = await readText(brain, name)
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

export async function appendJsonl(brain: Brain, name: string, record: unknown): Promise<void> {
  const raw = (await readText(brain, name)) ?? ''
  const line = JSON.stringify(record)
  await writeText(brain, name, raw ? `${raw.replace(/\n+$/, '')}\n${line}\n` : `${line}\n`)
}

/** Rewrite a whole JSONL file (used when resolving requests/proposals in place). */
export async function writeJsonl(brain: Brain, name: string, records: unknown[]): Promise<void> {
  await writeText(brain, name, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''))
}
