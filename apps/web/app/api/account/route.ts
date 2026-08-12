import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, handleApiError, parseBody, requireApiSession } from '@/lib/api/route'
import { COOKIE_NAME } from '@/lib/session'
import { deleteAccount } from '@/lib/account/deleteAccount'
import prisma from '@/lib/prisma'

const deleteSchema = z.object({
  /**
   * The account's own email, typed by the person. A password would prove more,
   * but Google accounts have no `passwordHash` to check, so the confirmation is
   * the same for everyone: retype the address on the account.
   */
  confirmEmail: z.string().min(1),
})

/**
 * DELETE /api/account — permanent deletion of the caller's own account.
 * Only ever acts on the session's own user; there is no target parameter and no
 * admin variant (an admin removes someone from a community, which is a different
 * thing — see /api/communities/[communityId]/members/[userId]).
 */
export async function DELETE(request: Request) {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session

  const body = await parseBody(request, deleteSchema)
  if (body instanceof NextResponse) return body

  try {
    // Read the email from the DB rather than the 30-day JWT: an address changed
    // since sign-in must be what you type.
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true },
    })
    if (!user) throw new ApiError(404, 'Account not found.')

    if (body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new ApiError(400, "That doesn't match the email on this account.")
    }

    const result = await deleteAccount(session.userId)

    // The session outlives the row it points at, so it has to go with it.
    const response = NextResponse.json({ success: true, ...result })
    response.cookies.delete(COOKIE_NAME)
    return response
  } catch (error) {
    return handleApiError(error, 'api.account.delete.failed')
  }
}
