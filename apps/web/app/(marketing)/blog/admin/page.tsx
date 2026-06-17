import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The blog admin list now lives inside the unified admin console.
// /blog/admin/[slug] (the post editor) is unchanged; only this list view moved.
export default function BlogAdmin() {
  redirect("/console?tab=blog");
}
