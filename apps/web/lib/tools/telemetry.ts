/**
 * What installs of Tools did, as counts — never content (`app_tool_telemetry`).
 *
 * Every bridge call, CSP report, navigation and frame error is added up in
 * this instance's memory, per install and day. On the request path, once a
 * minute has passed, the instance adds what it has to ITS OWN row for each
 * install and day — the row keyed by the instance — so no row is written by
 * two instances and N instances still sum. Never on a timer: a runtime that
 * scales to zero never runs one. Counts are best-effort by design (an
 * instance that stops before its flush loses a minute); incidents, which
 * decide things, are written at once (lib/tools/monitor.ts).
 *
 * When a day is over its rows are rolled into one (`instance: 'day'`), and
 * rows past 90 days are dropped — both on the minute tick.
 */
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/prisma'
import { logger } from '@/lib/logger'
import type { DayCounts } from './shared/monitoring'

const INSTANCE = randomUUID().slice(0, 12)
const FLUSH_MS = 60_000
const KEEP_DAYS = 90
const ROLLED = 'day'

interface MethodCounts {
  calls: number
  refusals: Record<string, number>
}

interface Bucket {
  installId: string
  versionId: string
  day: string
  calls: number
  refusals: number
  methods: Record<string, MethodCounts>
  bytesRead: number
  bytesWritten: number
  paths: Set<string>
  dataMs: number
  aiTokens: number
  cspReports: number
  navigations: number
  frameErrors: number
  viewers: Set<string>
}

interface TelemetryState {
  buckets: Map<string, Bucket>
  lastFlush: number
  flushing: Promise<number> | null
}

declare global {
  var __vvToolTelemetry: TelemetryState | undefined
}

/**
 * This process's counts, on `globalThis` like the change and verdict buses:
 * a route that counts and a route that flushes must add to one Map, however
 * many times the module was evaluated.
 */
const telemetry: TelemetryState = (globalThis.__vvToolTelemetry ??= { buckets: new Map(), lastFlush: Date.now(), flushing: null })
const buckets = telemetry.buckets

function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10)
}

function bucketFor(installId: string, versionId: string, at: Date): Bucket {
  const day = dayOf(at)
  const key = `${installId}|${versionId}|${day}`
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = {
      installId,
      versionId,
      day,
      calls: 0,
      refusals: 0,
      methods: {},
      bytesRead: 0,
      bytesWritten: 0,
      paths: new Set(),
      dataMs: 0,
      aiTokens: 0,
      cspReports: 0,
      navigations: 0,
      frameErrors: 0,
      viewers: new Set(),
    }
    buckets.set(key, bucket)
  }
  return bucket
}

/** One bridge call an install made: its method, its answer, what it moved. */
export function countCall(input: {
  installId: string
  versionId: string
  viewerId: string
  method: string
  /** The refusal's code, or null when it was answered. */
  refused: string | null
  bytesIn: number
  bytesOut: number
  /** A note it read, for the distinct-paths count. */
  path?: string | null
  dataMs?: number
  aiTokens?: number
  at?: Date
}): void {
  const bucket = bucketFor(input.installId, input.versionId, input.at ?? new Date())
  bucket.calls += 1
  bucket.viewers.add(input.viewerId)
  const method = (bucket.methods[input.method] ??= { calls: 0, refusals: {} })
  method.calls += 1
  if (input.refused) {
    bucket.refusals += 1
    method.refusals[input.refused] = (method.refusals[input.refused] ?? 0) + 1
  }
  bucket.bytesRead += input.bytesOut
  bucket.bytesWritten += input.bytesIn
  if (input.path) bucket.paths.add(input.path)
  bucket.dataMs += Math.max(0, Math.round(input.dataMs ?? 0))
  bucket.aiTokens += Math.max(0, Math.round(input.aiTokens ?? 0))
}

/** Something the browser saw of an install's frame. */
export function countEvent(input: { installId: string; versionId: string; kind: 'csp' | 'navigation' | 'frame_error'; at?: Date }): void {
  const bucket = bucketFor(input.installId, input.versionId, input.at ?? new Date())
  if (input.kind === 'csp') bucket.cspReports += 1
  else if (input.kind === 'navigation') bucket.navigations += 1
  else bucket.frameErrors += 1
}

function mergeMethods(into: Record<string, MethodCounts>, add: Record<string, MethodCounts>): Record<string, MethodCounts> {
  const out: Record<string, MethodCounts> = JSON.parse(JSON.stringify(into ?? {}))
  for (const [method, counts] of Object.entries(add)) {
    const target = (out[method] ??= { calls: 0, refusals: {} })
    target.calls += counts.calls
    for (const [code, n] of Object.entries(counts.refusals)) target.refusals[code] = (target.refusals[code] ?? 0) + n
  }
  return out
}

function methodsOf(raw: unknown): Record<string, MethodCounts> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, MethodCounts>) : {}
}

/** Add this instance's counts to its rows. Returns how many rows it wrote. */
async function flushNow(): Promise<number> {
  const pending = [...buckets.values()]
  buckets.clear()
  telemetry.lastFlush = Date.now()
  let written = 0
  for (const bucket of pending) {
    const where = { app_tool_telemetry_identity: { installId: bucket.installId, day: new Date(`${bucket.day}T00:00:00Z`), instance: INSTANCE } }
    try {
      const existing = await prisma.appToolTelemetry.findUnique({ where, select: { methods: true } })
      const counts = {
        calls: bucket.calls,
        refusals: bucket.refusals,
        bytesRead: BigInt(bucket.bytesRead),
        bytesWritten: BigInt(bucket.bytesWritten),
        paths: bucket.paths.size,
        dataMs: bucket.dataMs,
        aiTokens: bucket.aiTokens,
        cspReports: bucket.cspReports,
        navigations: bucket.navigations,
        frameErrors: bucket.frameErrors,
        viewers: bucket.viewers.size,
      }
      if (existing) {
        await prisma.appToolTelemetry.update({
          where,
          data: {
            ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { increment: v }])),
            methods: mergeMethods(methodsOf(existing.methods), bucket.methods) as object,
          },
        })
      } else {
        await prisma.appToolTelemetry.create({
          data: { installId: bucket.installId, versionId: bucket.versionId, day: where.app_tool_telemetry_identity.day, instance: INSTANCE, ...counts, methods: bucket.methods as object },
        })
      }
      written++
    } catch (err) {
      // The install may have gone. Counts are best-effort; a lost minute is fine.
      logger.warn('tools.telemetry.flush_failed', { err, installId: bucket.installId })
    }
  }
  return written
}

/** Flush when a minute has passed since the last — called on the request path. */
export async function maybeFlushTelemetry(now: number = Date.now()): Promise<void> {
  if (telemetry.flushing || now - telemetry.lastFlush < FLUSH_MS || buckets.size === 0) return
  telemetry.flushing = flushNow()
  try {
    await telemetry.flushing
  } finally {
    telemetry.flushing = null
  }
}

/** Flush whatever this instance holds now — the tick, and tests. */
export async function flushTelemetry(): Promise<number> {
  if (telemetry.flushing) await telemetry.flushing
  return flushNow()
}

/**
 * Roll every instance's rows of a finished day into one, and drop what is past
 * keeping. Idempotent: a day already rolled has one row.
 */
export async function rollUpTelemetry(now: Date = new Date()): Promise<{ rolled: number; pruned: number }> {
  const today = new Date(`${dayOf(now)}T00:00:00Z`)
  const keepFrom = new Date(today.getTime() - KEEP_DAYS * 86_400_000)
  const pruned = await prisma.appToolTelemetry.deleteMany({ where: { day: { lt: keepFrom } } })
  const rows = await prisma.appToolTelemetry.findMany({
    where: { day: { lt: today, gte: keepFrom }, instance: { not: ROLLED } },
    take: 5_000,
  })
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.installId}|${row.day.toISOString().slice(0, 10)}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  let rolled = 0
  for (const list of groups.values()) {
    const first = list[0]
    const existing = await prisma.appToolTelemetry.findUnique({
      where: { app_tool_telemetry_identity: { installId: first.installId, day: first.day, instance: ROLLED } },
    })
    const all = existing ? [existing, ...list] : list
    const sum = <K extends 'calls' | 'refusals' | 'paths' | 'dataMs' | 'aiTokens' | 'cspReports' | 'navigations' | 'frameErrors' | 'viewers'>(key: K) =>
      all.reduce((acc, row) => acc + row[key], 0)
    const data = {
      versionId: list[list.length - 1].versionId,
      calls: sum('calls'),
      refusals: sum('refusals'),
      methods: all.reduce<Record<string, MethodCounts>>((acc, row) => mergeMethods(acc, methodsOf(row.methods)), {}) as object,
      bytesRead: all.reduce((acc, row) => acc + row.bytesRead, BigInt(0)),
      bytesWritten: all.reduce((acc, row) => acc + row.bytesWritten, BigInt(0)),
      paths: sum('paths'),
      dataMs: sum('dataMs'),
      aiTokens: sum('aiTokens'),
      cspReports: sum('cspReports'),
      navigations: sum('navigations'),
      frameErrors: sum('frameErrors'),
      viewers: sum('viewers'),
    }
    await prisma.$transaction([
      prisma.appToolTelemetry.upsert({
        where: { app_tool_telemetry_identity: { installId: first.installId, day: first.day, instance: ROLLED } },
        create: { installId: first.installId, day: first.day, instance: ROLLED, ...data },
        update: data,
      }),
      prisma.appToolTelemetry.deleteMany({ where: { id: { in: list.map((row) => row.id) } } }),
    ])
    rolled++
  }
  return { rolled, pruned: pruned.count }
}

/** The day's counts an install has so far, every instance's rows summed. */
export async function dayCounts(installIds: readonly string[], day: Date): Promise<Map<string, DayCounts>> {
  const out = new Map<string, DayCounts>()
  if (installIds.length === 0) return out
  const rows = await prisma.appToolTelemetry.findMany({
    where: { installId: { in: [...installIds] }, day: new Date(`${dayOf(day)}T00:00:00Z`) },
    select: { installId: true, calls: true, refusals: true, methods: true, bytesRead: true },
  })
  for (const row of rows) {
    const errors = Object.values(methodsOf(row.methods)).reduce((acc, m) => acc + (m.refusals.internal ?? 0) + (m.refusals.timeout ?? 0), 0)
    const prev = out.get(row.installId) ?? { calls: 0, refusals: 0, errors: 0, bytesRead: 0 }
    out.set(row.installId, {
      calls: prev.calls + row.calls,
      refusals: prev.refusals + row.refusals - errors,
      errors: prev.errors + errors,
      bytesRead: prev.bytesRead + Number(row.bytesRead),
    })
  }
  return out
}

/** Up to a week of an install's finished days, for its baseline. */
export async function recentDays(installId: string, before: Date): Promise<DayCounts[]> {
  const until = new Date(`${dayOf(before)}T00:00:00Z`)
  const since = new Date(until.getTime() - 7 * 86_400_000)
  const rows = await prisma.appToolTelemetry.findMany({
    where: { installId, day: { gte: since, lt: until } },
    select: { day: true, calls: true, refusals: true, methods: true, bytesRead: true },
  })
  const byDay = new Map<string, DayCounts>()
  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10)
    const errors = Object.values(methodsOf(row.methods)).reduce((acc, m) => acc + (m.refusals.internal ?? 0) + (m.refusals.timeout ?? 0), 0)
    const prev = byDay.get(key) ?? { calls: 0, refusals: 0, errors: 0, bytesRead: 0 }
    byDay.set(key, {
      calls: prev.calls + row.calls,
      refusals: prev.refusals + row.refusals - errors,
      errors: prev.errors + errors,
      bytesRead: prev.bytesRead + Number(row.bytesRead),
    })
  }
  return [...byDay.values()]
}
