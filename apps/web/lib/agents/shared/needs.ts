/**
 * What an agent needs before it can do its job, and how to get each thing.
 *
 * A brief is written in a minute and runs unattended for months, so the
 * moment it is written is the moment to say "this will not work yet, and here
 * is why". Three kinds of gap:
 *
 *   - the space has no model, so nothing runs at all;
 *   - a connector the brief DECLARES is missing, off, broken or not signed in;
 *   - the brief's instructions NAME a service (post to Slack, read Gmail)
 *     that the brief never declared — either the space has a connector for it
 *     and the brief forgot to list it, or the space has none and someone has
 *     to add one first.
 *
 * Each need carries a one-line why, a one-line fix a person can act on, and
 * where to go. The plan is those fixes in order, ending with the rehearsal and
 * the switch. Pure: every input is a value, so the wording is testable and the
 * same function serves create_agent, rehearse_agent and the agent page.
 */
import type { RehearsalConnector } from '@/lib/agents/shared/rehearsal'

/** A catalogue entry, narrowed to what a need's wording reads. */
export interface NeedsCatalogEntry {
  /** The catalogue category — two services in one category do the same job (Slack, Discord). */
  category?: string
  id: string
  name: string
  /** How a person connects it: `one-click` | `sign-in` | `key` | `password`. */
  connects: 'one-click' | 'sign-in' | 'key' | 'password'
  /** Whether each member signs in themselves, for an OAuth service. */
  perMember: boolean
}

/** A connector the space already has, by name and the recipe it came from. */
interface NeedsSpaceConnector {
  name: string
  recipe: string | null
}

export interface NeedsInput {
  /** The brief's declared connectors, as `connectorReadiness` judged them. */
  declared: readonly RehearsalConnector[]
  /** The brief body, scanned for services it names but never declared. */
  instructions: string
  /** Why no run can happen at all, already phrased — or null. */
  modelProblem: string | null
  catalog: readonly NeedsCatalogEntry[]
  spaceConnectors: readonly NeedsSpaceConnector[]
  /**
   * Catalogue ids the instructions IMPLY without naming ("post it to the team
   * channel"), as a judge read them (lib/agents/needs.ts). Treated like a named
   * service, and worded as the reading it is.
   */
  implied?: readonly string[]
}

type NeedStatus =
  | 'no_model'
  | 'missing'
  | 'disabled'
  | 'invalid'
  | 'needs_connection'
  | 'broken'
  | 'undeclared'
  | 'not_in_space'

export interface AgentNeed {
  /** What is needed: `model`, or a connector name, or a catalogue id. */
  need: string
  status: NeedStatus
  /** Why the agent cannot do its job without it. */
  why: string
  /** What to do about it, for the person. */
  fix: string
  /** Where to go, as an app path or a sign-in URL. */
  href: string | null
  /** Whether a member can fix it themselves, or it takes a space admin. */
  who: 'member' | 'admin'
}

export interface AgentNeeds {
  /** True when a real run would have everything the brief asks for. */
  ready: boolean
  needs: AgentNeed[]
  /** The fixes in order, then the rehearsal and the switch. */
  plan: string[]
}

/** The Space Console's Connectors section; the console is always the current space's. */
const CONSOLE = '/admin?section=connectors'

/** Catalogue names too generic to read as a service the brief is asking for. */
const GENERIC_NAMES = new Set(['mcp server', 'website login', 'http', 'custom'])

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentions(text: string, name: string): boolean {
  if (name.length < 4 || GENERIC_NAMES.has(name.toLowerCase())) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRe(name)}(?=$|[^a-z0-9])`, 'i').test(text)
}

/** How to add a catalogue service, said for the person who will press the button. */
function addLine(entry: NeedsCatalogEntry): string {
  const how = {
    'one-click': 'one press of Connect',
    'sign-in': entry.perMember ? 'a sign-in by each person who runs the agent' : 'a sign-in by an admin',
    key: 'an API key an admin pastes in',
    password: 'the account an admin enters',
  }[entry.connects]
  return `Add ${entry.name} from the catalogue in the Space Console (Connectors → Add a connector) — it takes ${how}.`
}

function declaredNeed(c: RehearsalConnector, catalog: readonly NeedsCatalogEntry[]): AgentNeed | null {
  const entry = catalog.find((e) => e.id === c.connector.toLowerCase()) ?? null
  switch (c.status) {
    case 'ok':
      return null
    case 'missing':
      return {
        need: c.connector,
        status: 'missing',
        why: `The brief declares \`${c.connector}\`, but this space has no connector of that name.`,
        fix: entry
          ? addLine(entry)
          : `Write connectors/${c.connector}.md (an admin, through the create_connector recipe), then store its secrets with set_connector_secret.`,
        href: CONSOLE,
        who: 'admin',
      }
    case 'disabled':
      return {
        need: c.connector,
        status: 'disabled',
        why: `\`${c.connector}\` is switched off, so every run through it is refused.`,
        fix: `Turn it back on: Space Console → Connectors → ${c.connector} → Manage → Enable.`,
        href: CONSOLE,
        who: 'admin',
      }
    case 'invalid':
      return {
        need: c.connector,
        status: 'invalid',
        why: `\`${c.connector}\` has a note that does not parse${c.detail ? ` (${c.detail})` : ''}.`,
        fix: `Fix the note at connectors/${c.connector}.md — its frontmatter is the perimeter, and a run refuses a perimeter it cannot read.`,
        href: CONSOLE,
        who: 'admin',
      }
    case 'needs_connection':
      return {
        need: c.connector,
        status: 'needs_connection',
        why: `\`${c.connector}\` is not signed in to, so its runs would fail at the first call.`,
        fix: c.connectUrl ? `Sign in: ${c.connectUrl}` : 'Sign in to it from the Connectors dialog on the account menu.',
        href: c.connectUrl ?? CONSOLE,
        who: 'member',
      }
    case 'broken':
      return {
        need: c.connector,
        status: 'broken',
        why: `\`${c.connector}\`'s sign-in has stopped working${c.detail ? ` (${c.detail})` : ''}.`,
        fix: c.connectUrl ? `Sign in again: ${c.connectUrl}` : 'Sign in again from the Connectors dialog on the account menu.',
        href: c.connectUrl ?? CONSOLE,
        who: 'member',
      }
  }
}

/**
 * Services the instructions name that the brief never declared. A catalogue
 * name found in the body — "post it to Slack" — is read as a request to reach
 * that service; whether the space can is what decides the need.
 */
function undeclaredNeeds(input: NeedsInput): AgentNeed[] {
  const declared = new Set(input.declared.map((c) => c.connector.toLowerCase()))
  const declaredRecipes = new Set(
    input.spaceConnectors.filter((s) => declared.has(s.name.toLowerCase())).map((s) => (s.recipe ?? s.name).toLowerCase()),
  )
  // One service may have several recipes (Notion, and Notion's MCP server):
  // a mention of the name is a need for any of them.
  const byName = new Map<string, NeedsCatalogEntry[]>()
  for (const entry of input.catalog) {
    const key = entry.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), entry])
  }
  const implied = new Set((input.implied ?? []).map((id) => id.toLowerCase()))
  const heldCategories = new Set(
    input.spaceConnectors
      .map((c) => input.catalog.find((e) => e.id === (c.recipe ?? c.name).toLowerCase())?.category)
      .filter((c): c is string => Boolean(c)),
  )
  const out: AgentNeed[] = []
  for (const entries of byName.values()) {
    const entry = entries[0]
    const named = mentions(input.instructions, entry.name)
    if (!named && !entries.some((e) => implied.has(e.id.toLowerCase()))) continue
    // "Post it to the team channel" implies A messenger, not Slack: a space
    // that already holds one service of the kind is not told it needs another.
    if (!named && entry.category && heldCategories.has(entry.category)) continue
    const reads = named ? `The instructions mention ${entry.name}` : `The instructions read as needing ${entry.name}, without naming it`
    const ids = new Set(entries.map((e) => e.id))
    if ([...ids].some((id) => declared.has(id) || declaredRecipes.has(id))) continue
    const held = input.spaceConnectors.filter(
      (s) => ids.has(s.name.toLowerCase()) || ids.has((s.recipe ?? '').toLowerCase()),
    )
    if (held.length > 0) {
      const names = held.map((h) => `\`${h.name}\``).join(' or ')
      out.push({
        need: held[0].name,
        status: 'undeclared',
        why: `${reads}, but the brief's connectors do not include it — a run cannot reach a service it did not declare.`,
        fix: `Add ${names} to the brief's \`connectors:\` on the agent's page.`,
        href: null,
        who: 'member',
      })
    } else {
      out.push({
        need: entry.id,
        status: 'not_in_space',
        why: `${reads}, and this space has no connector to it.`,
        fix: `${addLine(entry)} Then add it to the brief's \`connectors:\`.`,
        href: CONSOLE,
        who: 'admin',
      })
    }
  }
  return out
}

export function agentNeeds(input: NeedsInput): AgentNeeds {
  const needs: AgentNeed[] = []
  if (input.modelProblem) {
    needs.push({
      need: 'model',
      status: 'no_model',
      why: input.modelProblem,
      fix: 'Add a model from Models on the account menu — it writes models/<name>.md and stores the provider key. The agent runs on it with no edit to the brief.',
      href: null,
      who: 'admin',
    })
  }
  for (const c of input.declared) {
    const need = declaredNeed(c, input.catalog)
    if (need) needs.push(need)
  }
  needs.push(...undeclaredNeeds(input))

  const plan = needs.map((n, i) => `${i + 1}. ${n.fix}${n.who === 'admin' ? ' (a space admin)' : ''}`)
  plan.push(
    `${needs.length + 1}. Rehearse it — rehearse_agent — so the person reads what it would produce before an unattended run does.`,
    `${needs.length + 2}. Turn it on — activate_agent — with a schedule and a timezone.`,
  )
  return { ready: needs.length === 0, needs, plan }
}

/**
 * The needs no run can get past, whoever it runs as: a declared connector that
 * is not there, is off, or does not parse. A sign-in is a person's to do and
 * a service the prose names is a reading of the prose — both are reported,
 * never a refusal.
 */
export function hardNeeds(needs: AgentNeeds): AgentNeed[] {
  return needs.needs.filter((n) => n.status === 'missing' || n.status === 'disabled' || n.status === 'invalid')
}
