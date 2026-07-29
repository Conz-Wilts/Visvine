"use client";

import { useState } from "react";
import Link from "next/link";
import { formatBlogDate } from "@/lib/blog/dates";
import { BRAND } from "@/lib/brand";

type Post = {
  id: string;
  slug: string;
  number: number;
  title: string;
  excerpt: string | null;
  publishedAt: string | null;
};

export default function BlogSearchList({ posts }: { posts: Post[] }) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? posts.filter(
        (p) =>
          p.title.toLowerCase().includes(query.toLowerCase()) ||
          p.excerpt?.toLowerCase().includes(query.toLowerCase()),
      )
    : posts;

  return (
    <div>
      <div className="mt-8 sm:mt-10">
        <input
          type="search"
          placeholder="Search posts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-12 text-lg leading-[1.7] text-neutral-500 sm:text-xl">
          {query ? "No posts match your search." : "Nothing here yet. Check back soon."}
        </p>
      ) : (
        <ul className="mt-6 space-y-4 sm:mt-8">
          {filtered.map((post) => (
            <li key={post.id}>
              <Link
                href={`/blog/${post.slug}`}
                className="group block rounded-2xl border border-neutral-200 bg-white p-6 transition-all hover:border-neutral-300 hover:shadow-sm sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-white"
                    style={{ backgroundColor: BRAND }}
                  >
                    Through The Visvine
                  </span>
                  {post.publishedAt && (
                    <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">
                      {formatBlogDate(new Date(post.publishedAt))}
                    </span>
                  )}
                </div>
                <h2
                  className="mt-3 text-2xl font-medium tracking-tight leading-[1.1] transition group-hover:opacity-75 sm:text-3xl"
                  style={{ color: "#2f7a3e" }}
                >
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p className="mt-3 text-base leading-[1.6] text-neutral-600 sm:text-lg">
                    {post.excerpt}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
