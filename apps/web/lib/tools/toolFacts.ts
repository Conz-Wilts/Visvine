/**
 * A Tool's structured facts live in a row; its index note keeps the prose.
 *
 * What a machine enforces or places — `surfaces`, the reach (`perimeter` in a
 * v1 manifest, `permissions` in v2), bindings, settings, platforms, the kit
 * range, dependencies, collections — is `app_tool_configs.facts`. Title,
 * description, tags, docs, `share:` and the registry's `version:` stay in the
 * note. The two are read as ONE index note (`composeToolIndex`), so every
 * reader — the build, publish, the checks, `read_tool`, the preview page —
 * parses one shape with one parser (config.ts#parseToolConfig), and an author
 * still writes one index.md: `writeToolFile` splits it (`splitToolIndex`),
 * and a note written straight to the store is adopted by the Tool hook.
 *
 * The row is written through `writeToolFacts` alone, which records every key
 * that moved in `app_tool_config_changes`.
 */
import prisma from '@/lib/prisma'
import type { ToolFacts } from './indexFacts'

/** A Tool's facts in a space, or null when it has no row yet (its note carries them, or it declares none). */
export async function readToolFacts(spaceId: string, name: string): Promise<ToolFacts | null> {
  const row = await prisma.appToolConfig.findUnique({
    where: { app_tool_config_identity: { spaceId, name } },
    select: { facts: true },
  })
  return row && row.facts && typeof row.facts === 'object' && !Array.isArray(row.facts) ? (row.facts as ToolFacts) : null
}

/**
 * Replace a Tool's facts, keeping a change row per key that moved. Stored as
 * written — a malformed permission is still the author's to read as a build
 * diagnostic, exactly as a malformed index note was — so a caller that must
 * refuse bad facts (the `configure_tool` action) parses them first.
 */
export async function writeToolFacts(spaceId: string, name: string, facts: ToolFacts, actor: string): Promise<string[]> {
  const before = (await readToolFacts(spaceId, name)) ?? {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(facts)])]
  const moved = keys.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(facts[key] ?? null))
  await prisma.$transaction([
    prisma.appToolConfig.upsert({
      where: { app_tool_config_identity: { spaceId, name } },
      create: { spaceId, name, facts: facts as object },
      update: { facts: facts as object },
    }),
    ...(moved.length
      ? [
          prisma.appToolConfigChange.createMany({
            data: moved.map((key) => ({
              spaceId,
              name,
              key,
              before: (before[key] ?? undefined) as object | undefined,
              after: (facts[key] ?? undefined) as object | undefined,
              actor: actor || 'system',
            })),
          }),
        ]
      : []),
  ])
  return moved
}

/** A Tool's facts leave with it: its folder is gone, so nothing reads them. */
export async function dropToolFacts(spaceId: string, name: string): Promise<void> {
  await prisma.appToolConfig.deleteMany({ where: { spaceId, name } })
}

/** Every Tool's facts in a space, for a roster that composes many index notes at once. */
export async function readAllToolFacts(spaceId: string): Promise<Map<string, ToolFacts>> {
  const rows = await prisma.appToolConfig.findMany({ where: { spaceId }, select: { name: true, facts: true } })
  const out = new Map<string, ToolFacts>()
  for (const row of rows) {
    if (row.facts && typeof row.facts === 'object' && !Array.isArray(row.facts)) out.set(row.name, row.facts as ToolFacts)
  }
  return out
}
