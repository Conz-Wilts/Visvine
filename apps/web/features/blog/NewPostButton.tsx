"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

export default function NewPostButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await fetch("/api/blog/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const { slug } = await res.json();
      router.push(`/blog/${slug}`);
    } else {
      setBusy(false);
      alert("Could not create post");
    }
  }

  return (
    <button
      type="button"
      onClick={create}
      disabled={busy}
      className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      style={{ backgroundColor: BRAND }}
    >
      {busy ? "Creating…" : "+ New post"}
    </button>
  );
}
