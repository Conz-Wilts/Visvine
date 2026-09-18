/**
 * One-shot repair: accounts whose name was stored as `Ana Ruiz (Ana Ruiz)`.
 *
 * Google's userinfo `name` is the account's display name, which may read
 * "Full name (nickname)"; sign-in stored it verbatim until
 * lib/auth/googleName.ts, and the name was copied from there into the
 * account's identity, its personal space and its person node in every space it
 * joined. This puts the plain name back in each of those, rewriting the `title:`
 * of each node's note through `writeNote` so the revision ledger and
 * projections see an ordinary edit, then rebuilds the account's Visvine record.
 *
 * Only a name that is exactly `X (X)` is touched. Node ids and note paths stay
 * as they are — they are link identity.
 *
 * Usage: pnpm --filter @visvine/web exec tsx scripts/fix-doubled-names.ts [--apply]
 * Dry run unless --apply. Re-running finds nothing.
 */

import 'dotenv/config'
import prisma from '../lib/prisma'
import { writeNote, SHARED_OWNER_KEY } from '../lib/notes/store'
import { nameKey } from '../lib/identity/normalize'
import { syncGlobalRecordForUser } from '../lib/global/record'

const DOUBLED = /^(.+) \(\1\)$/

function retitle(content: string, from: string, to: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!fm) return content
  const block = fm[1]
    .split('\n')
    .map((line) => (/^title:/.test(line) && line.includes(from) ? line.replace(from, to) : line))
    .join('\n')
  return content.replace(fm[1], block)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const users = (await prisma.user.findMany({ select: { id: true, name: true, email: true } })).filter(
    (u) => u.name && DOUBLED.test(u.name),
  )
  if (users.length === 0) {
    console.log('no doubled names — nothing to do')
    return
  }

  for (const user of users) {
    const from = user.name!
    const to = DOUBLED.exec(from)![1]
    console.log(`${user.email}: "${from}" → "${to}"`)

    const identity = await prisma.identity.findUnique({ where: { userId: user.id } })
    const spaces = await prisma.space.findMany({ where: { personalOwnerId: user.id, name: from } })
    const nodes = await prisma.node.findMany({
      where: { name: from, ...(identity ? { identityId: identity.id } : {}) },
      select: { id: true, spaceId: true },
    })
    console.log(`  identity: ${identity?.canonicalName === from ? 'rename' : 'leave'}`)
    for (const s of spaces) console.log(`  space ${s.id}`)

    const notes: { spaceId: string; path: string; content: string }[] = []
    for (const node of nodes) {
      if (!node.spaceId) continue
      const rows = await prisma.contextNote.findMany({
        where: {
          spaceId: node.spaceId,
          ownerKey: SHARED_OWNER_KEY,
          deletedAt: null,
          content: { contains: `node: ${node.id}` },
        },
        select: { path: true, content: true },
      })
      console.log(`  node ${node.id} in ${node.spaceId} — note(s): ${rows.map((r) => r.path).join(', ') || 'none'}`)
      for (const r of rows) notes.push({ spaceId: node.spaceId, ...r })
    }

    if (!apply) continue

    await prisma.user.update({ where: { id: user.id }, data: { name: to } })
    if (identity?.canonicalName === from) {
      await prisma.identity.update({ where: { id: identity.id }, data: { canonicalName: to, nameKey: nameKey(to) } })
    }
    for (const s of spaces) await prisma.space.update({ where: { id: s.id }, data: { name: to } })
    for (const n of nodes) await prisma.node.update({ where: { id: n.id }, data: { name: to } })
    const actor = { id: user.id, name: to, email: user.email }
    for (const n of notes) {
      const next = retitle(n.content, from, to)
      if (next !== n.content) {
        await writeNote({ spaceId: n.spaceId, ownerKey: SHARED_OWNER_KEY }, n.path, next, actor, 'maintenance')
      }
    }
    await syncGlobalRecordForUser(user.id)
    console.log('  applied')
  }
  if (!apply) console.log('dry run — pass --apply to write')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
