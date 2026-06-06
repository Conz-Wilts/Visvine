import prisma from "@/lib/prisma";

/** Turn a title into a URL-safe slug. Falls back to "untitled" when empty. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/**
 * Find a slug derived from `title` that no other post is using. Pass `ignoreId`
 * to exclude the post being updated from the collision check.
 */
export async function uniqueSlug(title: string, ignoreId?: string): Promise<string> {
  const base = slugify(title);
  for (let attempt = 0; attempt < 25; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await prisma.blogPost.findFirst({
      where: ignoreId ? { slug, NOT: { id: ignoreId } } : { slug },
      select: { id: true },
    });
    if (!clash) return slug;
  }
  return `${base}-${(ignoreId ?? base).slice(-6)}`;
}
