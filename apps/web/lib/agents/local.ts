/**
 * Local runtimes — a member's own Claude or ChatGPT plan, run from the
 * desktop app.
 *
 * A brief may pin `model: local/claude` or `model: local/codex`. That is not a
 * provider the SERVER can call: there is no key, no endpoint and no note,
 * because the plan is one person's and the vendor's own binary on that
 * person's machine is the only thing allowed to spend it (Anthropic permits
 * exactly the unmodified Claude Code binary signed in by its user, and
 * forbids anyone else holding the token; OpenAI's Codex sign-in is the same
 * shape). So the desktop shell spawns the binary (apps/desktop/src/runtimes),
 * the web app streams what it says, and the server only ever receives the
 * finished run through `POST …/agents/<name>/local-runs`.
 *
 * Consequences this module states once:
 *   • `resolveAgentChatConfig` refuses a local ref with `local_runtime`, so
 *     the tick never tries it and nothing is deactivated for it.
 *   • A local brief cannot be ACTIVATED — nothing unattended can run it — it
 *     runs when a person presses Run in the desktop app.
 *   • Tokens are metered; dollars are null. The plan was charged, not the
 *     space's key, so the model page and the Usage section say "tokens only".
 *   • The kill switch is `LOCAL_RUNTIMES_OFF=claude,codex` on the server
 *     (surfaced by GET …/models): a vendor changing course is a deploy-free
 *     env change, not a release.
 *
 * Pure: no prisma, no fetch, importable from the client.
 */
import type { ProviderEntry } from './registry'

export type LocalRuntimeId = 'claude' | 'codex'

export interface LocalRuntime {
  id: LocalRuntimeId
  /** What the picker calls it. */
  label: string
  /** The plan it spends. */
  plan: string
  /** The binary the desktop shell runs, for the copy that says so. */
  binary: string
  /** The vendor's stated position, shown beside the switch. */
  policy: string
}

export const LOCAL_PROVIDER_ID = 'local'

export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [
  {
    id: 'claude',
    label: 'Your Claude plan',
    plan: 'Claude Pro or Max',
    binary: 'Claude Code',
    policy: 'Runs the official Claude Code binary on this machine, signed in by you. Usage counts against your Claude plan. Anthropic may change this.',
  },
  {
    id: 'codex',
    label: 'Your ChatGPT plan',
    plan: 'ChatGPT Plus or Pro',
    binary: 'Codex',
    policy: 'Runs the official Codex binary on this machine, signed in with your ChatGPT account. Usage counts against your ChatGPT plan.',
  },
]

/**
 * The registry entry a `local/<runtime>` ref resolves to. `baseURL` is a
 * marker, never fetched; `keySecret` names a secret nothing ever stores, so
 * every "is the key stored" check answers no and no surface offers to add it.
 */
export const LOCAL_PROVIDER: ProviderEntry = {
  id: LOCAL_PROVIDER_ID,
  label: 'Your plan (desktop app)',
  baseURL: 'local://desktop/',
  keySecret: 'MODEL_KEY_LOCAL',
  probePath: null,
  models: LOCAL_RUNTIMES.map((r) => ({ id: r.id, label: r.label, pricing: null })),
}

export function isLocalRuntimeId(value: unknown): value is LocalRuntimeId {
  return value === 'claude' || value === 'codex'
}

/** `local/claude` → `claude`; anything else → null. */
export function localRuntimeOf(ref: string | null | undefined): LocalRuntimeId | null {
  if (!ref) return null
  const m = /^local\/([a-z]+)$/.exec(ref.trim().toLowerCase())
  return m && isLocalRuntimeId(m[1]) ? m[1] : null
}

export function localModelRef(id: LocalRuntimeId): string {
  return `${LOCAL_PROVIDER_ID}/${id}`
}

/** Which runtimes the deployment has switched off — `LOCAL_RUNTIMES_OFF=claude,codex`. */
export function localRuntimesEnabled(env: Record<string, string | undefined> = process.env): Record<LocalRuntimeId, boolean> {
  const off = new Set((env.LOCAL_RUNTIMES_OFF ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  return { claude: !off.has('claude') && !off.has('all'), codex: !off.has('codex') && !off.has('all') }
}

/** The one sentence every server surface says when a local brief reaches it. */
export function localRuntimeRefusal(id: LocalRuntimeId): string {
  const r = LOCAL_RUNTIMES.find((x) => x.id === id)!
  return `This agent runs on ${r.label.toLowerCase()} from the desktop app — press Run there. It cannot be scheduled or run by the server.`
}

/**
 * What a local run is told, ahead of the brief. Shorter than the server's
 * preamble (lib/agents/shared/prompt.ts) because the binary brings its own
 * tools: it can fetch the web itself, and it reaches the space's notes only
 * through the `visvine` MCP tool when the desktop hands one in. A run writes
 * nothing to the member's disk; its answer is what gets recorded.
 */
export function localAgentPreamble(name: string, opts: { hasVisvineTool: boolean }): string {
  const home = `agents/${name}/`
  return [
    `You are an agent named "${name}" running on a member's own plan, from their machine, for the Visvine space they are in — a shared knowledge space ("the context") of markdown notes. A person pressed Run and is watching; finish with a plain-text summary of what you did and found, because that summary is what is recorded on the agent's page.`,
    '',
    'Rules:',
    opts.hasVisvineTool
      ? `- The space's notes are reachable through the visvine tool: call it with no action and your request to get the plan and the catalogue, then run actions by name. ${home}memory.md is your own memory — read it first if it exists, and append what the next run should know.`
      : `- The space's notes are not reachable from this run; work from the brief and the web, and put anything the space should keep in your final answer.`,
    '- Do not edit files on this machine. Read, fetch and reason; write only through the visvine tool, and only under your own folder unless the brief says otherwise.',
    '- If something the brief asks for is out of reach, say so in the summary rather than guessing.',
    '',
    `# Brief`,
  ].join('\n')
}
