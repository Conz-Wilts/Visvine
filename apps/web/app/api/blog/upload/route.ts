import { randomUUID } from "node:crypto";
import { requireSession, isSuperAdmin } from "@/lib/session";
import { uploadBlogImage, getMediaUrl } from "@/lib/gcs";
import { slugify } from "@/lib/blog/slug";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Raster image types only. SVG is deliberately excluded — it can carry
// <script>/onload handlers and would be served as an active document.
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof Response) return session;
  if (!isSuperAdmin(session.email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return Response.json(
      { error: "Only PNG, JPEG, WebP, or GIF images are allowed" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Image is larger than 10 MB" }, { status: 400 });
  }

  // Derive the filename base from the upload, but the extension comes from the
  // validated MIME type — never from the user-supplied name. All blog images are
  // converted to WebP by uploadBlogImage (the /api/media proxy is WebP-only).
  const dot = file.name.lastIndexOf(".");
  const base = slugify(dot >= 0 ? file.name.slice(0, dot) : file.name);

  const objectPath = `blog/${base}-${randomUUID()}.webp`;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadBlogImage(objectPath, buffer);
  } catch (err) {
    console.error("Failed to process blog image upload", err);
    return Response.json({ error: "Could not process image" }, { status: 400 });
  }

  return Response.json({ url: getMediaUrl(objectPath) });
}
