import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/session";
import { requireApiSession, forbiddenResponse } from "@/lib/api/route";
import { uniqueSlug } from "@/lib/blog/slug";

type Body = {
  title?: string;
  content?: Prisma.InputJsonValue;
  excerpt?: string | null;
  coverImage?: string | null;
  published?: boolean;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!isSuperAdmin(session.email)) {
    return forbiddenResponse();
  }
  const { id } = await params;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const data: Prisma.BlogPostUpdateInput = {};
  if (typeof body.title === "string") {
    data.title = body.title.trim() || "Untitled post";
    // Keep the URL in sync with the title while the post is still a draft;
    // freeze the slug once the post has EVER been published so previously
    // shared/indexed links don't break (unpublish → rename → republish).
    if (!post.publishedAt) {
      data.slug = await uniqueSlug(data.title as string, id);
    }
  }
  if (body.content !== undefined) data.content = body.content;
  if (body.excerpt !== undefined) data.excerpt = body.excerpt;
  if (body.coverImage !== undefined) data.coverImage = body.coverImage;
  if (typeof body.published === "boolean") {
    data.published = body.published;
    if (body.published && !post.publishedAt) data.publishedAt = new Date();
  }

  try {
    const updated = await prisma.blogPost.update({ where: { id }, data });
    return Response.json({
      ok: true,
      slug: updated.slug,
      published: updated.published,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return Response.json(
        { error: "Slug already in use, please retry" },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  if (!isSuperAdmin(session.email)) {
    return forbiddenResponse();
  }
  const { id } = await params;
  await prisma.blogPost.delete({ where: { id } }).catch(() => {});
  return Response.json({ ok: true });
}
