"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminBar({
  postId,
  published,
}: {
  postId: string;
  published: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function togglePublish() {
    setBusy(true);
    await fetch(`/api/blog/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: !published }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this post permanently?")) return;
    setBusy(true);
    await fetch(`/api/blog/posts/${postId}`, { method: "DELETE" });
    router.push("/blog");
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 text-sm">
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          published ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
        }`}
      >
        {published ? "Published" : "Draft"}
      </span>
      <button
        type="button"
        onClick={togglePublish}
        disabled={busy}
        className="rounded-lg bg-black px-3 py-1.5 font-medium text-white disabled:opacity-50"
      >
        {published ? "Unpublish" : "Publish"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="rounded-lg px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={logout}
        className="ml-auto rounded-lg px-3 py-1.5 text-neutral-500 hover:bg-neutral-100"
      >
        Log out
      </button>
    </div>
  );
}
