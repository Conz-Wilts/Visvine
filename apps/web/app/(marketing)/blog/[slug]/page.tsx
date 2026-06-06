import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import PostContent from "@/features/blog/PostContent";
import PostEditor from "@/features/blog/PostEditor";
import { BRAND } from "@/lib/brand";
import { formatBlogDate } from "@/lib/blog/dates";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    select: { title: true, excerpt: true, published: true },
  });
  if (!post) return {};
  // Don't leak a draft's title/excerpt in <head> to non-admins.
  if (!post.published) {
    const session = await getSession();
    if (!isSuperAdmin(session?.email)) return {};
  }
  return {
    title: `${post.title} — Visvine`,
    description: post.excerpt ?? undefined,
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const admin = isSuperAdmin(session?.email);

  const post = await prisma.blogPost.findUnique({ where: { slug } });
  if (!post) notFound();
  if (!post.published && !admin) notFound();

  return (
    <article className="relative z-10 w-full max-w-[720px] px-5 pt-6 pb-24 sm:px-8 sm:pt-10 lg:pl-16">
      <Link
        href="/blog"
        className="text-sm uppercase tracking-[0.18em] text-neutral-500 transition hover:text-black"
      >
        ← Blog
      </Link>

      {admin ? (
        <div className="mt-8">
          <PostEditor
            postId={post.id}
            number={post.number}
            initialTitle={post.title}
            initialContent={post.content as JSONContent}
            published={post.published}
          />
        </div>
      ) : (
        <>
          <header className="mt-8 sm:mt-10">
            <p
              className="text-lg font-semibold tracking-tight sm:text-xl"
              style={{ color: BRAND }}
            >
              Through The Visvine #{post.number}
            </p>
            <p className="mt-2 text-sm uppercase tracking-[0.18em] text-neutral-500">
              {formatBlogDate(post.publishedAt, "Draft")}
            </p>
            <h1 className="mt-3 text-4xl font-medium tracking-tight leading-[1.05] text-black sm:text-5xl md:text-6xl">
              {post.title}
            </h1>
          </header>
          <div className="mt-10">
            <PostContent content={post.content as JSONContent} />
          </div>
        </>
      )}
    </article>
  );
}
