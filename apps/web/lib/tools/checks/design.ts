/**
 * The design half of the compatibility stage: does this Tool look like the app
 * and hold up as a page? Pure — the sources and the parsed config in, advice
 * out. Never blocking: a person may ask for their own look, and these rules are
 * the default, not a wall (lib/tools/catalog.ts#TOOL_DESIGN_RULES). They exist
 * so an AI author reads, before it hands a preview over, what a person would
 * see in a second — a boxed page, a frame-sized modal, a text box where a
 * dropdown belongs, a create button that is gone after the first item.
 *
 * Read over the source as written, so each rule is a pattern over text: a
 * finding may be wrong about intent, which is why every one is `low`.
 */
import { manifestOf, type ToolConfig } from '../config'
import type { CheckFile, CheckFinding } from './findings'

export interface DesignInput {
  ui: string | null
  modules?: Record<string, string>
  config: ToolConfig | null
}

const VIEWPORT = /100d?vh|\bh-screen\b|\bmin-h-screen\b|position:\s*['"]fixed['"]/
/** `fixed` as a class token inside a className string. */
const FIXED_CLASS = /className=[^\n]*?(?<![\w-])fixed(?![\w-])/
const HEX = /['"`][^'"`\n]*#[0-9a-fA-F]{3,8}\b/
const PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
/** A centred max-width column, or a bordered rounded box, as one className. */
const BOXED = /className=["'`{][^\n]*(?:\bmax-w-[^\s"'`]+[^\n]*\bmx-auto\b|\bmx-auto\b[^\n]*\bmax-w-[^\s"'`]+)/
const TABS_USE = /<Tabs\b/
const INSERTS = /\.insert\s*\(|collections\.insert/

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length
}

function firstMatch(source: string, pattern: RegExp): number | null {
  const m = pattern.exec(source)
  return m ? lineOf(source, m.index) : null
}

/** A collection field's `enum`, by field name, across every collection. */
function enumFields(config: ToolConfig): string[] {
  const names = new Set<string>()
  for (const spec of Object.values(manifestOf(config).collections)) {
    const props = (spec.schema as { properties?: Record<string, { enum?: unknown }> }).properties ?? {}
    for (const [key, prop] of Object.entries(props)) if (Array.isArray(prop?.enum)) names.add(key)
  }
  return [...names]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function designFindings(input: DesignInput): CheckFinding[] {
  const files: Array<{ file: CheckFile; code: string }> = []
  if (input.ui?.trim()) files.push({ file: 'ui.tsx', code: input.ui })
  for (const [file, code] of Object.entries(input.modules ?? {})) files.push({ file: file as CheckFile, code })
  if (files.length === 0) return []

  const findings: CheckFinding[] = []
  const once = (rule: string, message: string) => (file: CheckFile, line: number | null) => {
    if (findings.some((f) => f.rule === rule)) return
    findings.push({ rule, severity: 'low', message, file, ...(line ? { line } : {}) })
  }
  const viewport = once('design.viewport', '100vh or position: fixed measures the frame, not the window — use the kit’s Modal for a dialog')
  const colour = once('design.colour', 'A hex or palette colour — paint with the kit or var(--vv-*) so it follows the theme')
  const boxed = once('design.boxed', 'A centred max-width column — a Tool is full bleed; drop the container and keep the page gutter')
  const tabs = once('design.tab-strip', 'A tab strip in the frame — declare the views as surfaces.nav sections and read useSection')
  const enumInput = once('design.enum-input', 'A text box for a field with a fixed set of values — draw it with Select or Segmented')

  const nav = input.config?.surfaces.nav?.sections ?? []
  const enums = input.config ? enumFields(input.config) : []
  let inserts = false

  for (const { file, code } of files) {
    const v = firstMatch(code, VIEWPORT) ?? firstMatch(code, FIXED_CLASS)
    if (v) viewport(file, v)
    const c = firstMatch(code, HEX) ?? firstMatch(code, PALETTE)
    if (c) colour(file, c)
    const b = firstMatch(code, BOXED)
    if (b) boxed(file, b)
    if (nav.length < 2) {
      const t = firstMatch(code, TABS_USE)
      if (t) tabs(file, t)
    }
    for (const key of enums) {
      const e = firstMatch(code, new RegExp(`<Input\\b[^>]*\\b${escape(key)}\\b`))
      if (e) enumInput(file, e)
    }
    if (INSERTS.test(code)) inserts = true
  }

  if (inserts && input.config && (input.config.surfaces.actions ?? []).length === 0) {
    findings.push({
      rule: 'design.no-band-action',
      severity: 'low',
      message: 'It adds rows but declares no band button — put the add act in surfaces.actions (useBandAction) so it is always one press away',
      file: 'index.md',
    })
  }
  return findings
}
