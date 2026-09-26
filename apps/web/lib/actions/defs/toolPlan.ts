/**
 * The two Tool actions that come before and around the code: `plan_tool`,
 * which reads the space and hands back the design brief a build starts from,
 * and `set_tool_icon`, which gives a Tool its rail icon from a built-in name,
 * SVG text or an uploaded file.
 *
 * Neither writes around the authoring loop: the icon goes through
 * `write_tool`'s and `configure_tool`'s own handlers, under the same gates.
 */
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { defineAction, ActionError, type ActionCaller } from '@/lib/actions/types'
import { CONTEXT_ACTIONS } from '@/lib/actions/defs/context'
import { appToolHandlers } from '@/lib/actions/defs/apps'
import { requireVisibleResource } from '@/lib/resources/visibility'
import { downloadResourceFile } from '@/lib/gcs'
import { sanitizeToolIcon } from '@/lib/tools/iconSvg'
import { TOOL_RAIL_ICONS } from '@/lib/tools/config'
// A Tool may name any lucide icon for its rail (a curated Tool dependency);
// the app's own icons stay ours.
// eslint-disable-next-line no-restricted-imports
import * as Lucide from 'lucide-react'
import { ICON_NAMES, ICON_PATHS } from '@/features/tools/kit/components/Icon'
import { buildPlanBrief, type SpaceTypeFact } from '@/lib/tools/shared/planBrief'
import { buildTool, DEFAULT_BUILD_BUDGET_S } from '@/lib/tools/builder'
import { TOOL_TEMPLATES } from '@/lib/tools/templates'

const spaceArg = z.string().describe('The space the Tool is for — from list_spaces')
const nameArg = z.string().describe('The Tool\'s name (its folder under tools/)')

/** What an SVG loses in the sanitizer, said so the author is not surprised by a blank icon. */
export function droppedFromIcon(svg: string): string[] {
  const dropped: string[] = []
  if (/<text\b/i.test(svg)) dropped.push('text')
  if (/<image\b/i.test(svg)) dropped.push('embedded images')
  if (/Gradient\b/.test(svg)) dropped.push('gradients')
  if (/\bfill="(?!none|currentColor)[^"]+"|\bstroke="(?!none|currentColor)[^"]+"|style="/i.test(svg)) dropped.push('colours and styles (the rail paints it in the theme)')
  if (/<(mask|clipPath|filter|use|defs|symbol)\b/i.test(svg)) dropped.push('masks, clips, filters and <use>')
  return dropped
}

const listContext = CONTEXT_ACTIONS.find((a) => a.name === 'list_context')!

interface ListContextAnswer {
  you: { admin: boolean }
  types?: Array<SpaceTypeFact & { type: string }>
  notes: string[]
}

async function planTool(ctx: ActionCaller, args: { space_id: string; request?: string }) {
  const [space, tools] = await Promise.all([
    listContext.run(ctx, { space_id: args.space_id, limit: 500 }) as Promise<ListContextAnswer>,
    appToolHandlers.listTools(ctx, { space_id: args.space_id }).catch(() => ({ authored: [], installed: [] })),
  ])
  return buildPlanBrief({
    spaceId: args.space_id,
    admin: space.you.admin,
    types: (space.types ?? []).map((t) => ({
      type: t.type,
      usage_count: t.usage_count,
      fields: t.fields,
      note_dir: t.note_dir,
      enabled: t.enabled,
    })),
    notePaths: space.notes.map((line) => line.split(' — ')[0]),
    tools: tools.authored.map((t) => ({ name: t.name, title: t.title, description: t.description ?? null })),
    request: args.request,
  })
}

interface SetIconArgs {
  space_id: string
  name: string
  icon?: string
  svg?: string
  resource_id?: string
}

async function iconSource(ctx: ActionCaller, args: SetIconArgs): Promise<string> {
  if (args.svg) return args.svg
  const gated = await requireVisibleResource(args.resource_id!, ctx.userId, ctx.email)
  if (gated.spaceId !== args.space_id) throw new ActionError(400, 'That file is in another space — upload the SVG into this one.')
  const row = await prisma.resource.findUnique({ where: { id: gated.id }, select: { gcsPath: true, mimeType: true, fileSize: true } })
  if (!row?.gcsPath) throw new ActionError(400, 'That resource has no file — upload the SVG with upload_file first.')
  if (row.mimeType !== 'image/svg+xml') throw new ActionError(400, `That resource is ${row.mimeType ?? 'not an SVG'} — the icon must be an SVG.`)
  if ((row.fileSize ?? 0) > 64_000) throw new ActionError(400, 'That SVG is too large for an icon.')
  return (await downloadResourceFile(row.gcsPath)).toString('utf8')
}

/** A kit icon's or a lucide icon's SVG by name ("target", "message-square", "MessageSquare"), or null. */
export function namedIconSvg(name: string): string | null {
  const kit = (ICON_PATHS as Record<string, string>)[name] ?? (ICON_PATHS as Record<string, string>)[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())]
  if (kit) {
    const paths = kit.split(' M').map((d, i) => `<path d="${i === 0 ? d : `M${d}`}"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
  }
  const pascal = name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  // A lucide icon is a forwardRef whose render hands its drawing (`icon.node`,
  // a list of [tag, attributes]) to the shared Icon — read it from there.
  const component = (Lucide as unknown as Record<string, { render?: (props: object, ref: null) => { props?: { icon?: { node?: Array<[string, Record<string, string>]> } } } }>)[pascal]
  const node = component?.render?.({}, null)?.props?.icon?.node
  if (!Array.isArray(node)) return null
  const shapes = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(' ')}/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
}

async function setToolIcon(ctx: ActionCaller, args: SetIconArgs) {
  const given = [args.icon, args.svg, args.resource_id].filter(Boolean).length
  if (given !== 1) throw new ActionError(400, 'Give exactly one of `icon` (a built-in name), `svg` or `resource_id`.')

  const current = await appToolHandlers.readTool(ctx, { space_id: args.space_id, name: args.name, file: 'index.md' })
  const surfaces = (current.config?.surfaces ?? { rail: null, types: [] }) as { rail: { label: string; icon: string } | null } & Record<string, unknown>
  const label = surfaces.rail?.label ?? current.config?.title ?? args.name

  // A name that is not a rail glyph but is an icon the kit or lucide draws
  // becomes that icon's SVG — a model reaching for "star" or "target" gets it.
  if (args.icon && !(TOOL_RAIL_ICONS as readonly string[]).includes(args.icon)) {
    const svg = namedIconSvg(args.icon)
    if (!svg) throw new ActionError(400, `Unknown icon "${args.icon}" — a built-in (${TOOL_RAIL_ICONS.join(', ')}), a kit icon (${ICON_NAMES.join(', ')}), a lucide name, or your own svg.`)
    return setToolIcon(ctx, { space_id: args.space_id, name: args.name, svg })
  }

  if (args.icon) {
    const configured = await appToolHandlers.configureTool(ctx, {
      space_id: args.space_id,
      name: args.name,
      facts: { surfaces: { ...surfaces, rail: { label, icon: args.icon } } },
    })
    return { name: args.name, icon: args.icon, build: configured.build }
  }

  const raw = await iconSource(ctx, args)
  // Text and its kin carry content between tags, which the sanitizer refuses
  // outright; the rail would drop them anyway, so they go here and are named.
  const source = raw.replace(/<\?xml[^>]*>|<!--[\s\S]*?-->/g, '').replace(/<(text|title|desc|style|metadata)\b[\s\S]*?<\/\1>/gi, '')
  const clean = sanitizeToolIcon(source)
  if (!clean.ok) throw new ActionError(400, `${clean.error} Draw it on a 24×24 viewBox in strokes only (path, circle, rect, line).`)
  await appToolHandlers.writeTool(ctx, { space_id: args.space_id, name: args.name, file: 'icon.svg', content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${clean.svg}</svg>` })
  const configured = await appToolHandlers.configureTool(ctx, {
    space_id: args.space_id,
    name: args.name,
    facts: { surfaces: { ...surfaces, rail: { label, icon: 'custom' } } },
  })
  const dropped = droppedFromIcon(raw)
  return {
    name: args.name,
    icon: 'custom',
    // What will actually be drawn — read it: anything missing here was stripped.
    drawn: clean.svg,
    ...(dropped.length ? { dropped: `Stripped: ${dropped.join(', ')}.` } : {}),
    build: configured.build,
  }
}

export const TOOL_PLAN_ACTIONS = [
  defineAction({
    name: 'plan_tool',
    scope: 'context:read',
    guides: ['tool_data', 'tool_charts'],
    summary: 'The design brief a Tool build starts from: what the space holds, where each thing should live, and the plan to show the person.',
    description:
      'CALL THIS FIRST when asked to build a Tool, before create_tool. It reads the space — its record types and how many of each, ' +
      'the types it made itself with their fields, its folders, the Tools it already has — and warns about traps in the request ' +
      '(a "company" type is the built-in organisation record, for one). It returns `decide` (where each kind of thing should live: ' +
      'the space\'s records, a note type in a folder, or the Tool\'s own collection), `plan_template` (views, band actions, data, ' +
      'controls, charts, images, icon, reach) and `next`. Fill in the template, show it to the person in one message, and build on ' +
      'their yes — then pass it to create_tool as `plan`.',
    input: {
      space_id: spaceArg,
      request: z.string().max(2000).optional().describe('What the person asked for, verbatim — the brief warns about the words in it'),
    },
    annotations: { readOnlyHint: true },
    run: (ctx, args) => planTool(ctx, args),
  }),

  defineAction({
    name: 'build_tool',
    scope: 'tools:author',
    summary: "Build a whole Tool from one sentence on the space's model: a designed template, a spec for this request, then a review by eye and polish.",
    description:
      'The one-call build. Give the person\'s request verbatim — however vague — and the space\'s own model decides what a great version is for this team ' +
      `and writes it as the spec of a finished, designed template (${TOOL_TEMPLATES.map((t) => t.id).join(', ')}): fields, stages, realistic sample rows. ` +
      'The Tool is created, every screen is captured and scored 0–10 by a designer model, and while it scores under 8.5 and time allows the model ' +
      'gets the fixes and rewrites ui.tsx — a rewrite is kept only if it compiles, renders and scores higher. Returns the preview link, the score and ' +
      'what was done. With no model in the space it runs nothing and hands the round back (`stand_in`): write the spec yourself and call ' +
      'create_tool { template, spec }. To plan with the person first, use plan_tool instead.',
    input: {
      space_id: spaceArg,
      request: z.string().min(1).max(2000).describe('What the person asked for, verbatim'),
      name: z.string().optional().describe("The Tool's name, if the person gave one — otherwise the model names it"),
      template: z.string().optional().describe(`Force a template: ${TOOL_TEMPLATES.map((t) => t.id).join(', ')}`),
      budget_seconds: z.number().int().min(30).max(600).optional().describe(`Wall clock for the build, default ${DEFAULT_BUILD_BUDGET_S}; polish rounds stop when it runs short. An MCP call ends at 120s.`),
      polish_rounds: z.number().int().min(0).max(3).optional().describe('Rewrite rounds after the first review, default 2'),
    },
    run: (ctx, args) => buildTool(ctx, args),
  }),

  defineAction({
    name: 'set_tool_icon',
    scope: 'tools:author',
    summary: "Give a Tool its rail icon — a built-in name, SVG text, or an SVG uploaded with upload_file.",
    description:
      'Set the icon on a Tool\'s rail row. Give exactly one of: `icon`, a built-in name (' +
      `${TOOL_RAIL_ICONS.join(', ')}) or any kit or lucide icon name ("star", "target", "message-square"); \`svg\`, the markup; or \`resource_id\`, an SVG the person attached (upload_file or ` +
      'request_upload first). A custom icon is drawn on a 24×24 viewBox in strokes only — path, circle, rect, line, polyline — ' +
      'and the rail paints it in the theme: colour, text, images, gradients and filters are stripped, and the answer says which ' +
      'were. `drawn` is exactly what will render. Gives the Tool a rail row if it had none.',
    input: {
      space_id: spaceArg,
      name: nameArg,
      icon: z.string().optional().describe('A built-in rail icon, or any kit or lucide icon name'),
      svg: z.string().max(64_000).optional().describe('Your own SVG — viewBox="0 0 24 24", strokes only'),
      resource_id: z.string().optional().describe('An uploaded SVG, from upload_file / request_upload'),
    },
    run: (ctx, args) => setToolIcon(ctx, args),
  }),
]
