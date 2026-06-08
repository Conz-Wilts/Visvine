import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import NewPostButton from "@/features/blog/NewPostButton";
import { formatBlogDate } from "@/lib/blog/dates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Visvine",
  robots: { index: false, follow: false },
};

export default async function BlogAdmin() {
  // /blog/admin is reachable via the public /blog prefix, so gate it here:
  // only super admins may view it; everyone else is sent to sign in.
  const session = await getSession();
  if (!isSuperAdmin(session?.email)) {
    redirect("/signin?callbackUrl=/blog/admin");
  }

  // Admin list — every post, drafts included, most recently edited first.
  const posts = await prisma.blogPost.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      slug: true,
      number: true,
      published: true,
      publishedAt: true,
      updatedAt: true,
    },
  });

  return (
    <section className="relative z-10 w-full max-w-[900px] px-5 pt-6 pb-24 sm:px-8 sm:pt-10 lg:pl-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl font-medium tracking-tight leading-[1.02] text-black sm:text-6xl">
          Admin.
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <NewPostButton />
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
          No posts yet. Create your first one.
        </p>
      ) : (
        <ul className="mt-12 divide-y divide-neutral-200 border-t border-neutral-200">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                href={`/blog/admin/${post.slug}`}
                className="group flex items-center gap-4 py-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${
                        post.published
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {post.published ? "Published" : "Draft"}
                    </span>
                    <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                      #{post.number} ·{" "}
                      {post.published
                        ? formatBlogDate(post.publishedAt, "—")
                        : `edited ${formatBlogDate(post.updatedAt, "—")}`}
                    </span>
                  </div>
                  <h2 className="mt-1 truncate text-xl font-medium tracking-tight text-black transition group-hover:opacity-80">
                    Through The Visvine #{post.number}
                  </h2>
                </div>
                <span className="shrink-0 text-sm text-neutral-400 transition group-hover:text-black">
                  Edit →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
