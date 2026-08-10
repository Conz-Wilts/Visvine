import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSession, isSuperAdmin } from "@/lib/session";
import NewPostButton from "@/features/blog/components/NewPostButton";
import BlogPostList from "@/features/admin/components/BlogPostList";
import WaitlistTable from "@/features/admin/components/WaitlistTable";
import IdentityReviewTable from "@/features/admin/components/IdentityReviewTable";
import { listSuggestions } from "@/lib/identity/steward";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin console — Visvine",
  robots: { index: false, follow: false },
};

type ConsoleTab = "blog" | "waitlist" | "identities";

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "blog", label: "Blog" },
  { id: "waitlist", label: "Waitlist" },
  { id: "identities", label: "Identities" },
];

export default async function AdminConsole({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // /console sits under the public /marketing shell, so gate it here:
  // only super admins may view it; everyone else is sent to sign in.
  const session = await getSession();
  if (!isSuperAdmin(session?.email)) {
    redirect("/?signin=1&callbackUrl=/console");
  }

  const { tab } = await searchParams;
  const activeTab: ConsoleTab =
    tab === "waitlist" ? "waitlist" : tab === "identities" ? "identities" : "blog";

  const posts =
    activeTab === "blog"
      ? await prisma.blogPost.findMany({
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            slug: true,
            number: true,
            published: true,
            publishedAt: true,
            updatedAt: true,
          },
        })
      : [];

  const waitlist =
    activeTab === "waitlist"
      ? await prisma.waitlistEntry.findMany({ orderBy: { createdAt: "asc" } })
      : [];

  // Super admins reach the whole queue (no community scope) — see listSuggestions.
  const suggestions = activeTab === "identities" ? await listSuggestions() : [];

  return (
    <section className="relative z-10 w-full max-w-[900px] mx-auto px-5 pt-6 pb-24 sm:px-8 sm:pt-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl font-medium tracking-tight leading-[1.02] text-black sm:text-6xl">
          Admin.
        </h1>
        {activeTab === "blog" && (
          <div className="flex flex-wrap items-center gap-3">
            <NewPostButton />
          </div>
        )}
      </div>

      {/* Tabs */}
      <nav className="mt-8 flex items-center gap-6 border-b border-neutral-200">
        {TABS.map((t) => {
          const isActive = t.id === activeTab;
          return (
            <Link
              key={t.id}
              href={`/console?tab=${t.id}`}
              className={`-mb-px border-b-2 pb-3 text-sm font-medium transition ${
                isActive
                  ? "border-black text-black"
                  : "border-transparent text-neutral-400 hover:text-black"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "blog" ? (
        <BlogPostList posts={posts} />
      ) : activeTab === "waitlist" ? (
        <WaitlistTable entries={waitlist} />
      ) : (
        <IdentityReviewTable initial={suggestions} />
      )}
    </section>
  );
}
