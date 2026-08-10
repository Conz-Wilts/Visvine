// AI assist for notes: refactor a note/snippet and propose a folder
// reorganization. Ported from blackbird-brain's src/server/{gemma,refactor,
// reorganize}.ts, with the OpenAI SDK swapped for plain `fetch` against the same
// OpenAI-compatible chat endpoint so no new dependency is needed.
//
// Configure with GEMINI_API_KEY (Gemini's OpenAI-compatible endpoint); the
// model can be overridden with GEMINI_MODEL. When the key is unset,
// aiConfigured() is false and the UI hides the refactor/reorganize affordances.

import { buildNoteIndex } from './shared/context'
import { splitFrontmatter } from './shared/markdown'
import { coerceMoves } from './shared/reorganize'
import type { ReorganizePlan } from './shared/types'
import { listRaw, type Brain } from './store'

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

interface ChatConfig {
  apiKey: string
  baseURL: string
  model: string
}

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const DEFAULT_GEMINI_MODEL = 'gemma-4-31b-it'

function resolveConfig(): ChatConfig | null {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseURL: GEMINI_BASE_URL,
    model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  }
}

/** Whether the LLM backend is configured (GEMINI_API_KEY set). */
export function aiConfigured(): boolean {
  return resolveConfig() !== null
}

/** The chat model in use — recorded on AI-refactor revisions for attribution. */
export function aiModelName(): string {
  return resolveConfig()?.model ?? DEFAULT_GEMINI_MODEL
}

// One chat completion over the OpenAI-compatible REST API. Throws if unconfigured.
// Exported for the other AI passes (enrichment in ./enrich.ts).
export async function chat(messages: ChatMessage[]): Promise<string> {
  const config = resolveConfig()
  if (!config) {
    throw new Error('AI is not configured: set GEMINI_API_KEY.')
  }
  const base = config.baseURL.endsWith('/') ? config.baseURL : `${config.baseURL}/`
  const res = await fetch(`${base}chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('The model returned an empty response.')
  return stripReasoning(content)
}

// ── Tool-calling chat, for agent loops (the connectors creation agent) ──────
// Same endpoint and config as chat(), plus the OpenAI-compatible `tools`
// wire format. Kept here so every AI pass shares one config resolution.

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string as the model produced it — the caller parses and validates. */
  arguments: string
}

export type AgentMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

/**
 * One completion turn that may answer in text, tool calls, or both. Throws if
 * unconfigured — callers gate on {@link aiConfigured} first.
 */
export async function chatWithTools(
  messages: AgentMessage[],
  tools: ToolSpec[],
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const config = resolveConfig()
  if (!config) {
    throw new Error('AI is not configured: set GEMINI_API_KEY.')
  }
  const base = config.baseURL.endsWith('/') ? config.baseURL : `${config.baseURL}/`
  const res = await fetch(`${base}chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string | null
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
      }
    }[]
  }
  const message = data.choices?.[0]?.message
  if (!message) throw new Error('The model returned an empty response.')
  const toolCalls = (message.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.function!.name!,
      arguments: c.function!.arguments ?? '{}',
    }))
  const content = typeof message.content === 'string' ? stripReasoning(message.content) : null
  return { content, toolCalls }
}

// Gemma instruction-tuned models prepend a <thought>…</thought> reasoning trace.
// Strip it so only the model's real output reaches callers.
function stripReasoning(text: string): string {
  const stripped = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
  const lastClose = stripped.lastIndexOf('</thought>')
  return (lastClose === -1 ? stripped : stripped.slice(lastClose + '</thought>'.length)).trim()
}

// Extract and parse the first JSON object from model output (tolerates fences/prose).
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object in model output')
  }
  return JSON.parse(body.slice(start, end + 1))
}

// Drop a leading/trailing ```markdown fence if the model wrapped its output.
function stripFence(text: string): string {
  const fenced = text.match(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i)
  return fenced ? fenced[1] : text
}

// refactor

const REFACTOR_SYSTEM =
  'You are an editor that refactors a markdown note to make it clearer and better ' +
  'organised, WITHOUT changing its meaning or losing any information. Produce a clean ' +
  'structure: a single top-level (#) heading, then logical sections with headings and ' +
  'bullet or numbered lists where they help; fix grammar and wording and keep the ' +
  'markdown formatting consistent. Links between notes are standard markdown links — ' +
  '[text](path.md) — with relative or notes-root-absolute (/) paths. Preserve every ' +
  'existing link exactly as written: keep its text and href unchanged, and NEVER convert ' +
  'a link to a [[wikilink]], a bare URL, or any other form. Do NOT add YAML frontmatter. ' +
  'Return ONLY the refactored markdown body — no commentary and no code fences.'

/** Refactor a note's markdown body. Throws if AI is not configured. */
export async function refactorNote(body: string): Promise<string> {
  const content = await chat([
    { role: 'system', content: REFACTOR_SYSTEM },
    { role: 'user', content: body },
  ])
  return stripFence(content).trim()
}

const REFACTOR_SELECTION_SYSTEM =
  'You are an editor that rewrites a snippet of markdown text taken from a larger note. ' +
  'Improve its clarity, grammar, and wording WITHOUT changing its meaning or losing any ' +
  'information. Preserve the markdown formatting and keep every existing link exactly as ' +
  'written — [text](path.md) — never converting it to a [[wikilink]], a bare URL, or any ' +
  'other form. Do NOT add headings or frontmatter that were not already in the snippet. ' +
  'Return ONLY the rewritten markdown snippet — no commentary and no code fences.'

/** Refactor a selected snippet, optionally following a free-text instruction. */
export async function refactorText(text: string, instruction?: string): Promise<string> {
  const trimmed = instruction?.trim()
  const system = trimmed
    ? `${REFACTOR_SELECTION_SYSTEM}\n\nApply this instruction from the user: ${trimmed}`
    : REFACTOR_SELECTION_SYSTEM
  const content = await chat([
    { role: 'system', content: system },
    { role: 'user', content: text },
  ])
  return stripFence(content).trim()
}

// reorganize

const EXCERPT_CHARS = 600

interface NoteSummary {
  path: string
  title: string
  excerpt: string
}

function topFolder(path: string): string {
  const idx = path.indexOf('/')
  return idx === -1 ? '(root)' : path.slice(0, idx)
}

function summarize(notes: NoteSummary[]): string {
  return notes.map((n) => `- "${n.title}" (${n.path})\n  ${n.excerpt}`).join('\n')
}

const ANALYST_SYSTEM =
  'You are one of several agents, each independently reviewing ONE folder of a ' +
  "markdown notes collection. Assess how well this folder's notes are grouped: " +
  'point out notes that do not belong here, themes that deserve their own subfolder, ' +
  'and anything obviously misplaced. Be concise — a few bullet points. Do NOT yet ' +
  'propose final file paths; just give observations the lead organiser will use.'

const SYNTH_SYSTEM =
  'You are the lead organiser of a markdown notes collection. Several agents each ' +
  'reviewed one folder; their observations follow, along with the full list of notes ' +
  'and their current paths. Produce ONE concrete reorganization plan that makes the ' +
  'folder structure clean and intuitive. Return ONLY JSON of the shape ' +
  '{"summary": string, "moves": [{"from": string, "to": string, "reason": string}]}. ' +
  '"from" MUST be an existing note path copied exactly from the list. "to" is the new ' +
  'notes-relative path and MUST end in ".md" (introduce new folders freely via the ' +
  'path). Only include notes that should move; omit well-placed ones. Keep "reason" to ' +
  'one short sentence. No prose, no code fences.'

/** Analyse a brain's notes and propose a folder reorganization (never applied here). */
export async function reorganizeNotes(brain: Brain): Promise<ReorganizePlan> {
  if (!aiConfigured()) {
    throw new Error('Reorganize needs an LLM: set GEMINI_API_KEY.')
  }
  const raw = await listRaw(brain)
  const index = buildNoteIndex(raw)
  const notes: NoteSummary[] = raw.map((n) => {
    const meta = index.find((m) => m.path === n.path)
    const body = splitFrontmatter(n.content).body
    return {
      path: n.path,
      title: meta?.title ?? n.path,
      excerpt: body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS),
    }
  })
  if (notes.length === 0) {
    return { summary: 'This brain is empty — nothing to reorganize.', moves: [] }
  }

  const groups = new Map<string, NoteSummary[]>()
  for (const note of notes) {
    const key = topFolder(note.path)
    const list = groups.get(key)
    if (list) list.push(note)
    else groups.set(key, [note])
  }

  const analyses = await Promise.all(
    Array.from(groups.entries()).map(async ([folder, folderNotes]) => ({
      folder,
      observations: await chat([
        { role: 'system', content: ANALYST_SYSTEM },
        { role: 'user', content: `Folder: ${folder}\n\nNotes:\n${summarize(folderNotes)}` },
      ]),
    })),
  )

  const observations = analyses
    .map((a) => `### Folder: ${a.folder}\n${a.observations}`)
    .join('\n\n')
  const allNotes = notes.map((n) => `- ${n.path} — "${n.title}"`).join('\n')
  const planText = await chat([
    { role: 'system', content: SYNTH_SYSTEM },
    {
      role: 'user',
      content: `All notes (current paths):\n${allNotes}\n\nPer-folder observations:\n${observations}`,
    },
  ])

  const obj = extractJsonObject(planText) as { summary?: unknown; moves?: unknown }
  const moves = coerceMoves(obj.moves, new Set(notes.map((n) => n.path)))
  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim()
      : `Proposed ${moves.length} move${moves.length === 1 ? '' : 's'}.`
  return { summary, moves }
}
