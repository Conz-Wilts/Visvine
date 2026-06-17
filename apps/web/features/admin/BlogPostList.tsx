import Link from "next/link";
import { formatBlogDate } from "@/lib/blog/dates";

interface BlogPostRow {
  id: string;
  slug: string;
  number: number;
  published: boolean;
  publishedAt: Date | null;
  updatedAt: Date;
}

interface BlogPostListProps {
  posts: BlogPostRow[];
}

/**
 * Admin list of every blog post (drafts included) for the admin console.
 * Each row links to the existing editor at /blog/admin/[slug].
 */
export default function BlogPostList({ posts }: BlogPostListProps) {
  if (posts.length === 0) {
    return (
      <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
        No posts yet. Create your first one.
      </p>
    );
  }

  return (
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
  );
}
