import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import PostContent from "@/features/blog/PostContent";
import BlogCommentSection from "@/features/blog/comments/BlogCommentSection";
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
  if (!post.published) {
    const session = await getSession();
    if (!isSuperAdmin(session?.email)) return {};
  }
  return {
    title: `${post.title} — Visvine`,
    description: post.excerpt ?? undefined,
    openGraph: {
      title: `${post.title} — Visvine`,
      description: post.excerpt ?? undefined,
      images: [],
    },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  const admin = isSuperAdmin(session?.email);

  const post = await prisma.blogPost.findUnique({
    where: { slug },
    include: { author: { select: { name: true, image: true } } },
  });
  if (!post) notFound();
  if (!post.published && !admin) notFound();

  return (
    <article className="relative z-10 w-full max-w-[900px] mx-auto px-5 pt-4 pb-24 sm:px-8 sm:pt-6">
      <Link
        href="/blog"
        className="text-xl text-neutral-400 transition hover:text-black"
        aria-label="Back to blog"
      >
        ←
      </Link>

      <header className="mt-5 sm:mt-6">
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-white"
          style={{ backgroundColor: BRAND }}
        >
          Through The Visvine
        </span>
        <h1
          className="mt-4 text-3xl font-medium tracking-tight leading-[1.05] sm:text-4xl md:text-5xl"
          style={{ color: "#2f7a3e" }}
        >
          {post.title}
        </h1>
        <div className="mt-5 flex items-center gap-3">
          {post.author?.image && (
            <img
              src={post.author.image}
              alt={post.author.name}
              className="w-11 h-11 rounded-2xl object-cover border-2 border-brand-green"
              referrerPolicy="no-referrer"
            />
          )}
          <div>
            {post.author?.name && (
              <p className="text-base font-normal text-neutral-600">
                Written by {post.author.name}
              </p>
            )}
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
              {formatBlogDate(post.publishedAt ?? post.updatedAt, "Draft")}
            </p>
          </div>
        </div>
      </header>
      <hr className="mt-8 border-neutral-200" />
      <div className="mt-8">
        <PostContent content={post.content as JSONContent} />
      </div>
      <div className="mt-16 pt-10">
        <BlogCommentSection
          postId={post.id}
          currentUserId={session?.userId ?? null}
          isAdmin={admin}
        />
      </div>
    </article>
  );
}
