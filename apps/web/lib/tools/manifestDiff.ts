/**
 * Every field of a Tool's manifest that grants reach or places UI, and the one
 * comparison of two versions over them. Pure.
 *
 * The trusted-publisher rule lists a new version without a person when "it
 * asks for nothing the last one didn't" — so whatever this diff cannot see, a
 * trusted publisher could widen unreviewed. That makes the list below the
 * whole guarantee, and `tests/tools-diff-coverage.test.ts` holds it: every key
 * a parsed manifest carries must be either REVIEWED here or named DESCRIPTIVE,
 * and each reviewed field, changed alone, must show up in the diff.
 */
import { manifestOf, type ToolConfig } from './config'

const sorted = (list: readonly string[]) => [...list].sort()

/** Each reviewed field, read into a canonical shape: order that means nothing is not a change. */
export const REVIEWED_FIELDS = {
  'perimeter.read': (c: ToolConfig) => sorted(c.perimeter.read),
  'perimeter.write': (c: ToolConfig) => sorted(c.perimeter.write),
  'perimeter.types': (c: ToolConfig) => sorted(c.perimeter.types),
  'perimeter.connectors': (c: ToolConfig) => sorted(c.perimeter.connectors),
  'perimeter.agents': (c: ToolConfig) => sorted(c.perimeter.agents),
  'surfaces.rail': (c: ToolConfig) =>
    c.surfaces.rail ? { label: c.surfaces.rail.label, icon: c.surfaces.rail.icon } : null,
  'surfaces.types': (c: ToolConfig) =>
    [...c.surfaces.types].map((t) => ({ type: t.type, mode: t.mode })).sort((a, b) => a.type.localeCompare(b.type)),
  // A section's order is what the band shows, so it is part of what was reviewed.
  'surfaces.nav': (c: ToolConfig) =>
    c.surfaces.nav
      ? {
          style: c.surfaces.nav.style,
          sections: c.surfaces.nav.sections.map((s) => ({ id: s.id, label: s.label, admin: !!s.admin })),
        }
      : null,
  'surfaces.actions': (c: ToolConfig) => (c.surfaces.actions ?? []).map((a) => ({ id: a.id, label: a.label })),
  // Manifest 2: every family of reach, what a binding may be bound to, the
  // third-party code it ships and the data it keeps are all read by a person.
  'manifest.permissions': (c: ToolConfig) => {
    const p = manifestOf(c).permissions
    return {
      context: { read: sorted(p.context.read), write: sorted(p.context.write) },
      records: {
        read: sorted(p.records.read),
        write: [...p.records.write].map((w) => ({ type: w.type, fields: sorted(w.fields) })).sort((a, b) => a.type.localeCompare(b.type)),
      },
      resources: { read: sorted(p.resources.read), write: sorted(p.resources.write) },
      connectors: [...p.connectors].map((u) => ({ use: u.use, actions: u.actions ? sorted(u.actions) : null })).sort((a, b) => a.use.localeCompare(b.use)),
      agents: sorted(p.agents),
      types: sorted(p.types),
      actions: sorted(p.actions),
      ai: p.ai,
      ui: p.ui,
    }
  },
  'manifest.bindings': (c: ToolConfig) =>
    Object.entries(manifestOf(c).bindings)
      .map(([name, slot]) => ({ name, kind: slot.kind, within: slot.within ?? null, fields: sorted(slot.fields ?? []), recipe: slot.recipe ?? null, optional: !!slot.optional }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  'manifest.dependencies': (c: ToolConfig) => Object.entries(manifestOf(c).dependencies).sort(([a], [b]) => a.localeCompare(b)),
  'manifest.collections': (c: ToolConfig) =>
    Object.entries(manifestOf(c).collections)
      .map(([name, spec]) => ({ name, spec }))
      .sort((a, b) => a.name.localeCompare(b.name)),
} as const

export type ReviewedField = keyof typeof REVIEWED_FIELDS

/**
 * The manifest keys that describe a Tool without granting or placing
 * anything: its words, its release and licence, which kit it was built for,
 * the clients it runs in (web and desktop only, whatever it says), and the
 * install-time settings an admin fills in.
 */
export const DESCRIPTIVE_FIELDS = [
  'name',
  'title',
  'description',
  'version',
  'tags',
  'previewUrl',
  'manifest.manifestVersion',
  'manifest.release',
  'manifest.license',
  'manifest.sdk',
  'manifest.platforms',
  'manifest.settings',
] as const

/** The reviewed fields that differ between two versions, in the order above. */
export function diffManifest(previous: ToolConfig, next: ToolConfig): ReviewedField[] {
  return (Object.keys(REVIEWED_FIELDS) as ReviewedField[]).filter(
    (field) => JSON.stringify(REVIEWED_FIELDS[field](previous)) !== JSON.stringify(REVIEWED_FIELDS[field](next)),
  )
}
