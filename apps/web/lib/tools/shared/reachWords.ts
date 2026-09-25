/**
 * A Tool's declared reach as the sentences an installing admin reads — with
 * each binding slot left IN the sentence, so the sheet can draw its picker
 * right there: "Edits notes in [Deal notes ▾]", "Calls [CRM ▾] (search
 * deals)". Pure (tests/tools-listing.test.ts).
 */
import { bindingRef, type ToolManifestFacts } from '@visvine/tool-protocol/manifest'

/** One sentence: words, and the slots to draw pickers for where they stand. */
type ReachPart = string | { slot: string }
export type ReachSentence = ReachPart[]

function words(list: readonly string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

/** An entry as a part: its slot when it names one, else the entry itself (a glob's tail trimmed). */
function partOf(entry: string, trimGlob = false): ReachPart {
  const ref = bindingRef(entry)
  if (ref) return { slot: ref.slot }
  return trimGlob ? entry.replace(/\/\*\*$/, '/').replace(/\/\*$/, '/') : entry
}

/** A list of entries as parts joined by commas, slots kept whole. */
function joined(entries: readonly string[], trimGlob = false): ReachPart[] {
  const seen = new Set<string>()
  const parts: ReachPart[] = []
  for (const entry of entries) {
    const part = partOf(entry, trimGlob)
    const id = typeof part === 'string' ? part : `$${part.slot}`
    if (seen.has(id)) continue
    seen.add(id)
    if (parts.length) parts.push(', ')
    parts.push(part)
  }
  return parts
}

export function reachSentences(facts: ToolManifestFacts): ReachSentence[] {
  const p = facts.permissions
  const out: ReachSentence[] = []
  const writes = new Set(p.context.write)
  const readOnly = p.context.read.filter((glob) => !writes.has(glob))
  if (p.context.write.length) out.push(['Reads and edits notes in ', ...joined(p.context.write, true)])
  if (readOnly.length) out.push(['Reads notes in ', ...joined(readOnly, true)])
  if (p.records.read.length) out.push(['Reads ', ...joined(p.records.read), ' records'])
  for (const w of p.records.write) {
    out.push([w.fields.length ? `Edits ${words(w.fields)} on ` : 'Edits ', partOf(w.type), ' records'])
  }
  if (p.resources.read.length) out.push(['Reads files in ', ...joined(p.resources.read, true)])
  for (const c of p.connectors) {
    out.push(['Calls ', partOf(c.use), ...(c.actions?.length ? [` (${words(c.actions.map((a) => a.replace(/_/g, ' ')))})`] : [])])
  }
  if (p.agents.length) out.push(['Runs ', ...joined(p.agents)])
  if (p.types.length) out.push(['Reads ', ...joined(p.types), ' entities'])
  if (p.actions.length) out.push([`Runs ${words(p.actions.map((a) => a.replace(/_/g, ' ')))}`])
  if (p.ai.complete) out.push(['Uses the space’s AI'])
  if (p.ai.decide) out.push(['Asks the space’s judge'])
  if (p.ui.download) out.push(['Saves files to your computer'])
  return out
}
