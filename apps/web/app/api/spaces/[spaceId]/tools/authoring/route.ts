import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { mcpResourceUrl } from '@/lib/mcp/config'
import { createTool, listAuthoredTools } from '@/lib/tools/service'
import { TOOL_NAME_RE, toolIndexPath } from '@/lib/tools/config'
import { appOrigin } from '@/lib/tools/origin'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import type {
  AuthoredToolSummary,
  AuthoredToolsResponse,
  CreateToolResponse,
} from '@/lib/tools/api'

/**
 * The working copies authored in this space — the marketplace's Mine tab.
 *
 * Members author, so this is a member read, and it is narrowed by the caller's
 * own grants: `listAuthoredTools` reads through the principal's visible vault,
 * so a Tool in a folder you cannot see is not on your roster. A Tool whose
 * config does not parse still lists, carrying its error — a broken Tool the
 * author cannot see is a Tool they cannot fix.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const tools: AuthoredToolSummary[] = await listAuthoredTools(ctx.principal, ctx.resolved)
  const body: AuthoredToolsResponse = { tools }
  return NextResponse.json(body)
}

const createSchema = z.object({
  name: z.string().trim().toLowerCase().regex(TOOL_NAME_RE, 'Use lower-case letters, digits and hyphens (63 max).'),
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  railLabel: z.string().trim().max(40).optional(),
})

/**
 * Scaffold a new Tool — the Create panel's Tool tile, and the REST twin of the
 * creator MCP server's `create_tool`.
 *
 * A member act, not an admin one: `createTool` writes through `writeGated`
 * under the caller's own principal, so the only gate is the note gate on
 * `tools/<name>/` (the same one an MCP author hits). What comes back is what
 * the success screen needs — the preview URL and the creator MCP address, so
 * the person can hand the rest of the job to a coding agent.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx

  const body = await parseBody(req, createSchema)
  if (body instanceof NextResponse) return body

  const result = await createTool(ctx.principal, ctx.resolved, {
    name: body.name,
    title: body.title,
    description: body.description,
    railLabel: body.railLabel,
  })
  if (!result.ok) return bad(result.error, result.status)

  const answer: CreateToolResponse = {
    tool: {
      name: result.name,
      path: toolIndexPath(result.name),
      nodeId: `tool:${result.name}`,
      title: result.build.config?.title ?? body.title ?? result.name,
    },
    build: result.build,
    previewUrl: `${appOrigin()}/tools/preview/${result.name}`,
    creatorMcpUrl: mcpResourceUrl('tools'),
  }
  return NextResponse.json(answer, { status: 201 })
}
