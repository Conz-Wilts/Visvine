/**
 * What an entity's note suggests for one of its select fields.
 * POST /api/nodes/[nodeId]/suggest  { spaceId, label, options }
 *
 * A suggestion, never a write: the table marks the option and the person picks.
 * The note is read under the viewer's own lens, so nothing they cannot read
 * shapes the answer. No judge, no note, or no confident reading → `null`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { parseBody } from '@/lib/api/route'
import { requireContext } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { readVisible } from '@/lib/notes/contextService'
import { entityNotePath } from '@/lib/notes/entities'
import { splitFrontmatter } from '@/lib/notes/shared/markdown'
import { decide } from '@/lib/judge/client'
import { choiceOf } from '@/lib/judge/shared/types'
import { FIELD_VALUE_CONFIDENCE, fieldValueQuestion } from '@/lib/judge/shared/questions'

const Body = z.object({
  spaceId: z.string().min(1),
  label: z.string().min(1).max(80),
  options: z.array(z.string().min(1).max(80)).min(2).max(40),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ nodeId: string }> }) {
  const body = await parseBody(request, Body)
  if (body instanceof NextResponse) return body
  const resolved = await requireContext(request, { spaceId: body.spaceId })
  if (resolved instanceof Response) return resolved
  const { nodeId } = await params

  const node = await prisma.node.findFirst({
    where: { id: nodeId, spaceId: body.spaceId },
    select: { id: true, type: true, name: true, subtitle: true, metadata: true },
  })
  const path = node ? entityNotePath({ ...node, metadata: node.metadata as Record<string, unknown> | null }) : null
  if (!node || !path) return NextResponse.json({ suggested: null })

  const principal = await principalOf(resolved)
  const content = await readVisible(principal, resolved, path).catch(() => null)
  const text = content ? splitFrontmatter(content).body.trim() : ''
  if (text.length < 40) return NextResponse.json({ suggested: null })

  const answers = await decide(
    { name: node.name, about: node.subtitle ?? '', note: text.slice(0, 6_000) },
    { value: fieldValueQuestion(body.label, body.options) },
    { deadlineMs: 2_000 },
  )
  const value = choiceOf(answers, 'value')
  const picked = value && value.choice !== 'none' && value.confidence >= FIELD_VALUE_CONFIDENCE ? body.options[Number(value.choice.slice(1))] : null
  return NextResponse.json({ suggested: picked ?? null })
}
