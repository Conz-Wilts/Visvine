import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireSession, isSuperAdmin } from "@/lib/session";
import { slugify } from "@/lib/blog/slug";
import { EMPTY_DOC } from "@/lib/blog/tiptap";

// Create a new draft post and return its id + slug.
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!isSuperAdmin(session.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { title?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — defaults to an untitled draft
  }

  const title = body.title?.trim() || "Untitled post";
  const base = slugify(title);

  // Ensure a unique slug + number, retrying on collision. The number is
  // recomputed inside the loop so concurrent inserts (which would otherwise
  // race to the same max+1) get a fresh value on each P2002 retry.
  for (let attempt = 0; attempt < 25; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    // Sequential blog number — one higher than the highest existing post.
    const agg = await prisma.blogPost.aggregate({ _max: { number: true } });
    const number = (agg._max.number ?? 0) + 1;
    try {
      const post = await prisma.blogPost.create({
        data: { title, slug, content: EMPTY_DOC, number },
      });
      return Response.json({ id: post.id, slug: post.slug });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  return Response.json({ error: "Could not generate a unique slug" }, { status: 409 });
}
