import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import PostContent from "@/features/blog/PostContent";
import PostEditor from "@/features/blog/PostEditor";
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
    title: `Through The Visvine #${post.title} — Visvine`,
    description: post.excerpt ?? undefined,
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
    <article className="relative z-10 w-full max-w-[720px] px-5 pt-6 pb-24 sm:px-8 sm:pt-10 lg:pl-16">
      <Link
        href="/blog"
        className="text-sm uppercase tracking-[0.18em] text-neutral-500 transition hover:text-black"
      >
        ← Blog
      </Link>

      {admin ? (
        <>
          <div className="mt-8">
            <PostEditor
              postId={post.id}
              number={post.number}
              initialContent={post.content as JSONContent}
              published={post.published}
            />
          </div>
          <div className="mt-16 pt-10">
            <BlogCommentSection
              postId={post.id}
              currentUserId={session?.userId ?? null}
              isAdmin={true}
            />
          </div>
        </>
      ) : (
        <>
          <header className="mt-8 sm:mt-10">
            <h1
              className="text-3xl font-semibold tracking-tight leading-[1.05] sm:text-4xl md:text-5xl"
              style={{ color: BRAND }}
            >
              Through The Visvine{" "}
              <span className="whitespace-nowrap">#{post.number}</span>
            </h1>
            <div className="mt-4 flex items-center gap-3">
              {post.author?.image && (
                <img
                  src={post.author.image}
                  alt={post.author.name}
                  className="w-8 h-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              <div>
                {post.author && (
                  <p className="text-sm font-medium text-neutral-800">
                    {post.author.name}
                  </p>
                )}
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                  {formatBlogDate(post.publishedAt, "Draft")}
                </p>
              </div>
            </div>
          </header>
          <div className="mt-10">
            <PostContent content={post.content as JSONContent} />
          </div>
          <div className="mt-16 pt-10">
            <BlogCommentSection
              postId={post.id}
              currentUserId={session?.userId ?? null}
              isAdmin={false}
            />
          </div>
        </>
      )}
    </article>
  );
}
