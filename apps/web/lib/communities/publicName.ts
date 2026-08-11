// Public spaces must have distinct names; private ones may be called anything.
//
// A private space is somebody's own workspace — nobody else can see it, so its
// name is nobody else's business, and the one-field create dialog stays
// friction-free (new spaces are private by default). A public space is a public
// listing on /discover, where the name is all a stranger has to go on, so two
// public spaces called "Founders" would be indistinguishable.
//
// The rule is therefore asymmetric and deliberately one-sided: a public name is
// only ever checked against OTHER PUBLIC spaces. Private spaces neither consume
// a public name nor block one — checking against them would leak that a private
// space by that name exists and would reject a name the user cannot see.
//
// Enforced here on every write path that can leave a space public, and backed
// by the partial unique index in
// prisma/migrations/20260811_add_public_space_name_unique (which closes the
// check-then-write race this cannot).

import prisma from '@/lib/prisma';

/**
 * The comparison key: case- and whitespace-insensitive, so "Blackbird  VC"
 * can't sit next to "blackbird vc".
 *
 * MUST stay identical to the SQL index expression
 * `lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))`, or the app check and
 * the database backstop will disagree.
 */
export function normalizePublicName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The one wording for this conflict, shared by every route that can raise it. */
export function publicNameTakenMessage(existingName: string): string {
  return `A public space named "${existingName}" already exists. Choose a different name to make this space public.`;
}

/**
 * The public space already using `name`, or null if it's free.
 *
 * `excludeId` skips the space being edited — renaming a public space to the
 * name it already has must not conflict with itself. Personal spaces
 * (`me:<userId>`) are always private and are excluded outright.
 *
 * Loads the public rows and compares normalized keys in JS rather than pushing
 * the comparison into SQL: Prisma can't express the whitespace collapse, and
 * matching the index expression exactly matters more than the scan (public
 * spaces are few).
 */
export async function findPublicNameConflict(
  name: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  const key = normalizePublicName(name);
  if (!key) return null;

  const publicSpaces = await prisma.community.findMany({
    where: {
      visibility: 'public',
      personalOwnerId: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });

  return publicSpaces.find((c) => normalizePublicName(c.name) === key) ?? null;
}

/**
 * The name/visibility a space will have AFTER a partial patch is applied, given
 * what it has now. The settings route accepts either field on its own, so
 * "would this leave a public space with a taken name?" can't be answered from
 * the patch alone: a name-only patch conflicts if the space is already public,
 * and a visibility-only patch conflicts if its existing name is taken.
 */
export function effectiveNameAndVisibility(
  patch: { name?: string; visibility?: string },
  current: { name: string; visibility: string | null },
): { name: string; isPublic: boolean } {
  return {
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    isPublic: (patch.visibility !== undefined ? patch.visibility : current.visibility) === 'public',
  };
}
