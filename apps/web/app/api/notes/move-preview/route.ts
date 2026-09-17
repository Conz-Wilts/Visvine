// What dropping a note or folder somewhere else will do to who can see it —
// read by the context tree BEFORE the move, so a drop that changes the
// audience asks first (features/notes/components/MoveAccessDialog.tsx).
//
//   GET ?spaceId=&from=<path>&to=<path>&kind=note|folder
//     → { hasChanges, gained, lost, changed, entersRestricted,
//         leavesRestricted, lockedBefore, lockedAfter, sharedDown }
//
// Nothing is written. The rules are the pure ones in
// lib/notes/shared/movePreview.ts, played over the space's real grants. It
// answers only someone who could make the move — edit on both ends, the gate
// the move itself applies — so it names no audience to anyone who couldn't
// already read it off the Share panel. A personal space has no grants: every
// move there is a no-change.

import { NextRequest, NextResponse } from 'next/server'
import { requireContext, fail } from '@/lib/notes/api'
import { principalOf } from '@/lib/notes/resolve'
import { loadSpaceAccess, subjectNamer } from '@/lib/notes/access'
import { readNoteOrNull } from '@/lib/notes/store'
import { moveTargets } from '@/lib/notes/federation'
import { parseFrontmatter } from '@/lib/notes/shared/markdown'
import { levelName } from '@/lib/notes/shared/authz'
import { principalCanWrite } from '@/lib/notes/shared/permissions'
import { moveAccessDiff, moveChangesAccess, type MoveSubjectChange } from '@/lib/notes/shared/movePreview'
import { isSharedDown } from '@/lib/spaces/subspaces'

const NO_CHANGE = {
  hasChanges: false,
  gained: [],
  lost: [],
  changed: [],
  entersRestricted: null,
  leavesRestricted: null,
  lockedBefore: false,
  lockedAfter: false,
  sharedDown: null,
}

export async function GET(req: NextRequest) {
  const context = await requireContext(req)
  if (context instanceof Response) return context
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const kind = url.searchParams.get('kind') === 'folder' ? 'folder' : 'note'
  if (!from || !to) return fail('from and to are required')

  const p = await principalOf(context)
  const ends = await moveTargets(p, context, from, to)
  if ('denial' in ends) return fail(ends.denial, 403)
  const { context: ctx, principal, path: src } = ends.from
  const dst = ends.to.path
  if (ctx.isPersonalSpace) return NextResponse.json(NO_CHANGE)
  if (!principalCanWrite(principal, src) || !principalCanWrite(principal, dst)) {
    return fail('You need edit access on both ends to move this', 403)
  }

  const access = await loadSpaceAccess(ctx.spaceId)
  const diff = moveAccessDiff(access, src, dst)

  // Shared down to sub-spaces is decided by where a flagged note is filed
  // (lib/spaces/subspaces.ts#isSharedDown) — the flag rides the note, never a
  // subtree, so only a note's own move can change it.
  let sharedDown: 'starts' | 'stops' | null = null
  if (kind === 'note') {
    const content = await readNoteOrNull(ctx, src)
    const frontmatter = content ? parseFrontmatter(content) : null
    const [was, will] = [isSharedDown(src, frontmatter), isSharedDown(dst, frontmatter)]
    if (was !== will) sharedDown = will ? 'starts' : 'stops'
  }

  const nameOf = await subjectNamer(ctx.spaceId, [...diff.gained, ...diff.lost, ...diff.changed])
  const named = (rows: MoveSubjectChange[]) =>
    rows.map((r) => ({
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      name: nameOf(r.subjectType, r.subjectId).name,
      before: levelName(r.before),
      after: levelName(r.after),
    }))

  return NextResponse.json({
    hasChanges: moveChangesAccess(diff) || sharedDown !== null,
    gained: named(diff.gained),
    lost: named(diff.lost),
    changed: named(diff.changed),
    entersRestricted: diff.entersRestricted,
    leavesRestricted: diff.leavesRestricted,
    lockedBefore: diff.lockedBefore,
    lockedAfter: diff.lockedAfter,
    sharedDown,
  })
}
