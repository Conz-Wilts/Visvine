import { notFound, redirect } from "next/navigation";
import type { JSONContent } from "@tiptap/core";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import PostEditor from "@/features/blog/PostEditor";
import BlogCommentSection from "@/features/blog/comments/BlogCommentSection";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function BlogAdminEdit({ params }: Props) {
  const { slug } = await params;
  const session = await getSession();
  if (!isSuperAdmin(session?.email)) {
    redirect("/?signin=1&callbackUrl=/blog/admin");
  }

  const post = await prisma.blogPost.findUnique({
    where: { slug },
    include: { author: { select: { name: true, image: true } } },
  });
  if (!post) notFound();

  return (
    <article className="relative z-10 w-full max-w-[900px] mx-auto px-5 pt-6 pb-24 sm:px-8 sm:pt-10">
      <PostEditor
        postId={post.id}
        number={post.number}
        slug={post.slug}
        title={post.title}
        initialContent={post.content as JSONContent}
        published={post.published}
        publishedAt={post.publishedAt?.toISOString() ?? null}
        author={post.author}
      />
      <div className="mt-16 pt-10">
        <BlogCommentSection
          postId={post.id}
          currentUserId={session?.userId ?? null}
          isAdmin={true}
        />
      </div>
    </article>
  );
}
