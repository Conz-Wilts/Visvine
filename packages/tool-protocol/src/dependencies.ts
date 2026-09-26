/**
 * The third-party modules a Tool may import besides React and the kit — each
 * one pinned to the single version the server builds and serves from the
 * tools origin. Pure.
 *
 * A Tool names what it uses in its manifest's `dependencies` (`{ "zod": "^4" }`),
 * the compiler lets it import exactly those, and the frame's import map points
 * each bare specifier at the server's copy — so no Tool bundle carries its own,
 * nothing is fetched from a CDN, and a reviewer reads a short list of known
 * packages instead of a vendored blob. A new entry here is a reviewed decision:
 * its code runs in every frame that declares it.
 */

interface CuratedDependency {
  /** The version the server serves; a declared range must admit it. */
  version: string
  /** The vendor file the import map points the specifier at. */
  file: string
  license: string
  /** One line for the SDK docs and the install sheet. */
  summary: string
  /** The npm package, where the specifier is a subpath of it (`motion/react` → `motion`). */
  package?: string
}

export const CURATED_DEPENDENCIES = {
  zod: { version: '4.3.6', file: 'dep-zod.js', license: 'MIT', summary: 'schema validation' },
  'date-fns': { version: '4.1.0', file: 'dep-date-fns.js', license: 'MIT', summary: 'date arithmetic and formatting' },
  clsx: { version: '2.1.1', file: 'dep-clsx.js', license: 'MIT', summary: 'class name joining' },
  'lucide-react': { version: '1.48.0', file: 'dep-lucide-react.js', license: 'ISC', summary: 'icons — `import { Users } from "lucide-react"`, sized with `size-4`' },
  'motion/react': { version: '13.4.4', file: 'dep-motion-react.js', license: 'MIT', summary: 'animation — `motion.div`, `AnimatePresence`', package: 'motion' },
  '@dnd-kit/core': { version: '6.3.1', file: 'dep-dnd-kit-core.js', license: 'MIT', summary: 'drag and drop' },
  '@dnd-kit/sortable': { version: '10.0.0', file: 'dep-dnd-kit-sortable.js', license: 'MIT', summary: 'sortable lists over @dnd-kit/core' },
  '@dnd-kit/utilities': { version: '3.2.2', file: 'dep-dnd-kit-utilities.js', license: 'MIT', summary: 'CSS transform helpers for @dnd-kit' },
  '@tanstack/react-table': { version: '9.2.4', file: 'dep-tanstack-react-table.js', license: 'MIT', summary: 'headless tables — grouping, column filters, pagination' },
  'react-hook-form': { version: '7.89.0', file: 'dep-react-hook-form.js', license: 'MIT', summary: 'forms with validation' },
  papaparse: { version: '5.7.0', file: 'dep-papaparse.js', license: 'MIT', summary: 'CSV parse and unparse — imports and exports' },
  'fuse.js': { version: '7.5.0', file: 'dep-fuse.js', license: 'Apache-2.0', summary: 'fuzzy search over rows' },
  nanoid: { version: '6.0.1', file: 'dep-nanoid.js', license: 'MIT', summary: 'short unique ids' },
} as const satisfies Record<string, CuratedDependency>

export type CuratedDependencyName = keyof typeof CURATED_DEPENDENCIES

/** The npm package a curated specifier is served from. */
export function curatedPackageOf(name: CuratedDependencyName): string {
  const dep: CuratedDependency = CURATED_DEPENDENCIES[name]
  return dep.package ?? name
}

export function isCuratedDependency(name: string): name is CuratedDependencyName {
  return Object.hasOwn(CURATED_DEPENDENCIES, name)
}

type Version = [number, number, number]

function parseVersion(text: string): Version | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * Does one range admit a version? The grammar a manifest needs and no more:
 * `*`, an exact `1.2.3`, a partial `1` / `1.2` (that major / minor), `^`, `~`,
 * `>=`, and `||` between alternatives.
 */
export function rangeAdmits(range: string, version: string): boolean {
  const v = parseVersion(version)
  if (!v) return false
  return range.split('||').some((raw) => {
    const part = raw.trim()
    if (part === '*' || part === 'x' || part === '') return true
    const op = /^(\^|~|>=)?\s*v?(.+)$/.exec(part)
    if (!op) return false
    const digits = op[2].split('.').filter((d) => d !== 'x' && d !== '*')
    const base = parseVersion(digits.join('.'))
    if (!base) return false
    switch (op[1]) {
      case '>=':
        return compare(v, base) >= 0
      case '^':
        // ^0.y.z locks the minor; ^x locks the major.
        if (compare(v, base) < 0) return false
        return base[0] === 0 ? v[0] === 0 && v[1] === base[1] : v[0] === base[0]
      case '~':
        return compare(v, base) >= 0 && v[0] === base[0] && (digits.length < 2 || v[1] === base[1])
      default:
        // Exact, or a partial naming a major (and minor).
        return digits.every((d, i) => Number(d) === v[i])
    }
  })
}

/** Why a Tool may not depend on this, or null when it may. */
export function dependencyDenial(name: string, range: string): string | null {
  if (!isCuratedDependency(name)) {
    return `${name} is not a module tools may import — they may use ${Object.keys(CURATED_DEPENDENCIES).join(', ')}`
  }
  const served = CURATED_DEPENDENCIES[name].version
  return rangeAdmits(range, served) ? null : `${name}@${range} — this server serves ${name} ${served}`
}
