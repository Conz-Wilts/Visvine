import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, handleApiError, parseBody, requireApiSession } from '@/lib/api/route'
import { removeAccount, setAccountOffSpaces } from '@/lib/connectors/accounts'

const patchSchema = z.object({
  /** The spaces this account stays out of. */
  offSpaces: z.array(z.string().min(1).max(200)).max(500),
})

type Params = { params: Promise<{ name: string }> }

/** PATCH /api/account/connectors/<name> — which spaces one of the caller's accounts is off in. */
export async function PATCH(request: Request, { params }: Params) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  const body = await parseBody(request, patchSchema)
  if (body instanceof NextResponse) return body
  try {
    const { name } = await params
    if (!(await setAccountOffSpaces(session.userId, decodeURIComponent(name), body.offSpaces))) {
      throw new ApiError(404, 'No such account.')
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'api.account.connectors.patch.failed')
  }
}

/** DELETE /api/account/connectors/<name> — disconnect one of the caller's own accounts. */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  try {
    const { name } = await params
    if (!(await removeAccount(session.userId, decodeURIComponent(name)))) throw new ApiError(404, 'No such account.')
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'api.account.connectors.delete.failed')
  }
}
