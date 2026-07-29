import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import BlogSearchList from "@/features/blog/BlogSearchList";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog — Visvine",
  description: "Writing from the Visvine team.",
};

export default async function BlogIndex() {
  const posts = await prisma.blogPost.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      slug: true,
      number: true,
      title: true,
      excerpt: true,
      publishedAt: true,
    },
  });

  const serialized = posts.map((p) => ({
    ...p,
    publishedAt: p.publishedAt?.toISOString() ?? null,
  }));

  return (
    <section className="relative z-10 w-full max-w-[900px] mx-auto px-5 pt-6 pb-24 sm:px-8 sm:pt-10">
      <h1 className="text-5xl font-medium tracking-tight leading-[1.02] text-black sm:text-6xl">
        Blogs
      </h1>
      <BlogSearchList posts={serialized} />
    </section>
  );
}
