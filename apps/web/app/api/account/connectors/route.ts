import { NextResponse } from 'next/server'
import { handleApiError, requireApiSession } from '@/lib/api/route'
import prisma from '@/lib/prisma'
import { listAccounts } from '@/lib/connectors/accounts'
import { accountRecipes } from '@/lib/connectors/accountRecipes'
import { availablePlatformClients } from '@/lib/connectors/platformClients'

/**
 * GET /api/account/connectors — the caller's own accounts, the services this
 * deployment offers as accounts, and the spaces an account can be kept out of.
 */
export async function GET() {
  const session = await requireApiSession()
  if (session instanceof NextResponse) return session
  try {
    const [accounts, memberships] = await Promise.all([
      listAccounts(session.userId),
      prisma.spaceMember.findMany({
        where: { userId: session.userId, status: 'active', space: { personalOwnerId: null } },
        select: { space: { select: { id: true, name: true } } },
        orderBy: { space: { name: 'asc' } },
      }),
    ])
    return NextResponse.json({
      accounts,
      services: accountRecipes(availablePlatformClients()).map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        logo: entry.logo,
      })),
      spaces: memberships.map((m) => m.space),
    })
  } catch (error) {
    return handleApiError(error, 'api.account.connectors.list.failed')
  }
}
