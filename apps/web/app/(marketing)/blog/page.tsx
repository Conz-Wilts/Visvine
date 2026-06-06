import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { formatBlogDate } from "@/lib/blog/dates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog — Visvine",
  description: "Writing from the Visvine team.",
};

export default async function BlogIndex() {
  // Public list — published posts only. Drafts live in the admin view.
  const posts = await prisma.blogPost.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      publishedAt: true,
    },
  });

  return (
    <section className="relative z-10 w-full max-w-[720px] px-5 pt-6 pb-24 sm:px-8 sm:pt-10 lg:pl-16">
      <h1 className="text-5xl font-medium tracking-tight leading-[1.02] text-black sm:text-6xl">
        Blogs
      </h1>

      {posts.length === 0 ? (
        <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
          Nothing here yet. Check back soon.
        </p>
      ) : (
        <ul className="mt-12 space-y-10 sm:mt-16 sm:space-y-12">
          {posts.map((post) => (
            <li key={post.id}>
              <Link href={`/blog/${post.slug}`} className="group block">
                <div className="flex items-center gap-3 text-sm uppercase tracking-[0.18em] text-neutral-500">
                  <span>{formatBlogDate(post.publishedAt)}</span>
                </div>
                <h2 className="mt-2 text-2xl font-medium tracking-tight leading-[1.1] text-black transition group-hover:opacity-80 sm:text-3xl md:text-4xl">
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p className="mt-3 text-lg leading-[1.6] text-neutral-700 sm:text-xl">
                    {post.excerpt}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
