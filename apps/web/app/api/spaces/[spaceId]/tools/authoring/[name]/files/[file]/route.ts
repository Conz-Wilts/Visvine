import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/api/route'
import { writeToolFile } from '@/lib/tools/service'
import { TOOL_SOURCE_FILES } from '@/lib/tools/config'
import { bad, requireToolsAccess } from '@/lib/tools/route'
import type { WriteFileResponse } from '@/lib/tools/api'

const FILES = ['index.md', TOOL_SOURCE_FILES.ui.authorName, TOOL_SOURCE_FILES.data.authorName, TOOL_SOURCE_FILES.icon.authorName] as const
const bodySchema = z.object({ content: z.string().max(600_000) })

/**
 * PUT — write one of a Tool's files from the Workbench: the same
 * `writeToolFile` and compile-on-write hook `write_tool` runs, so an editor
 * and an agent never disagree about what a save means. Answers with the fresh
 * build.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string; name: string; file: string }> },
) {
  const { spaceId, name: rawName, file: rawFile } = await params
  const name = decodeURIComponent(rawName)
  const file = decodeURIComponent(rawFile)
  const ctx = await requireToolsAccess(spaceId)
  if (ctx instanceof Response) return ctx
  if (!(FILES as readonly string[]).includes(file)) return bad(`A tool's files are ${FILES.join(', ')}.`, 404)
  const body = await parseBody(req, bodySchema)
  if (body instanceof NextResponse) return body

  const result = await writeToolFile(ctx.principal, ctx.resolved, name, file as (typeof FILES)[number], body.content)
  if (!result.ok) return bad(result.error, result.status)
  const answer: WriteFileResponse = { build: result.build }
  return NextResponse.json(answer)
}
