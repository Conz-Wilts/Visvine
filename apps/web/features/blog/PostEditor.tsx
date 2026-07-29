"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import { Extension, type JSONContent, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { ResizableImage, STARTER_KIT_CONFIG } from "@/lib/blog/tiptap";
import ResizableImageView from "@/features/blog/ResizableImageView";
import AdminBar from "@/features/blog/AdminBar";
import { BRAND } from "@/lib/brand";
import { formatBlogDate } from "@/lib/blog/dates";

const EditorImage = ResizableImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
}).configure({ inline: false, HTMLAttributes: { class: "blog-img" } });

// Ensure Shift+Enter inserts a line break within the current paragraph.
const HardBreakKeymap = Extension.create({
  name: "hardBreakKeymap",
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
    };
  },
});

type SaveState = "idle" | "saving" | "saved" | "error";

function textLinesToHtml(lines: string[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[*\-•]\s+(.*)/);
    if (m) {
      if (!inList) { parts.push("<ul>"); inList = true; }
      parts.push(`<li>${esc(m[1])}</li>`);
    } else {
      if (inList) { parts.push("</ul>"); inList = false; }
      const t = line.trim();
      if (t) parts.push(`<p>${esc(t)}</p>`);
    }
  }
  if (inList) parts.push("</ul>");
  return parts.join("");
}

export default function PostEditor({
  postId,
  slug,
  title,
  initialContent,
  published,
  publishedAt,
  author,
}: {
  postId: string;
  slug: string;
  title: string;
  initialContent: JSONContent;
  published: boolean;
  publishedAt: string | null;
  author: { name: string | null; image: string | null } | null;
}) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleValue, setTitleValue] = useState(title);
  const [currentSlug, setCurrentSlug] = useState(slug);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure(STARTER_KIT_CONFIG),
      EditorImage,
      TextStyle,
      Color,
      HardBreakKeymap,
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "blog-prose focus:outline-none min-h-[40vh]" },
      transformPastedHTML(html) {
        return html.replace(/<img\b[^>]*>/gi, (match) => {
          if (!/class="[^"]*emoji[^"]*"/.test(match) && !/\bdata-emoji\b/.test(match)) return match;
          const alt = match.match(/\balt="([^"]*)"/)?.[1] ?? "";
          return alt && !alt.startsWith(":") ? alt : "";
        });
      },
      handlePaste: (_view, event) => {
        if (event.clipboardData?.getData("text/html")) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const lines = text.split(/\r?\n/);
        if (!lines.some((l) => /^\s*[*\-•]\s+\S/.test(l))) return false;
        editorRef.current?.commands.insertContent(textLinesToHtml(lines));
        return true;
      },
    },
  });

  const save = useCallback(async () => {
    if (!editor) return;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/blog/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editor.getJSON() }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [editor, postId]);

  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 1200);
  }, [save]);

  async function saveTitle(newTitle: string) {
    const trimmed = newTitle.trim() || "Untitled post";
    try {
      const res = await fetch(`/api/blog/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        const { slug: newSlug } = await res.json();
        if (newSlug && newSlug !== currentSlug) {
          setCurrentSlug(newSlug);
          router.replace(`/blog/admin/${newSlug}`);
        }
      }
    } catch {
      // silent — content save state covers feedback
    }
  }

  function queueTitleSave(newTitle: string) {
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    titleSaveTimer.current = setTimeout(() => saveTitle(newTitle), 1200);
  }

  useEffect(() => {
    if (!editor) return;
    const handler = () => queueSave();
    editor.on("update", handler);
    return () => { editor.off("update", handler); };
  }, [editor, queueSave]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
    },
    [],
  );

  useEffect(() => { editorRef.current = editor; }, [editor]);

  async function onUpload(file: File) {
    if (!editor) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/blog/upload", { method: "POST", body: form });
    if (!res.ok) { alert("Image upload failed"); return; }
    const { url } = await res.json();
    editor.chain().focus().setImage({ src: url }).run();
  }

  if (!editor) return null;

  const btn = (active: boolean) =>
    `rounded px-2.5 py-1 text-sm ${active ? "bg-black text-white" : "hover:bg-neutral-100"}`;

  return (
    <div>
      {/* Toolbar */}
      <div className="sticky top-0 z-20 mb-6 flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white/95 px-2 py-2 shadow-sm backdrop-blur lg:fixed lg:right-5 lg:top-44 lg:mb-0 lg:w-auto lg:gap-1.5 lg:shadow-md">
        <AdminBar postId={postId} published={published} />
        <span className="h-px w-full bg-neutral-200" />
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
            <b>B</b>
          </button>
          <button type="button" className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <i>I</i>
          </button>
          <span className="mx-1 h-5 w-px bg-neutral-200" />
          <button type="button" className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </button>
          <button type="button" className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            H3
          </button>
          <button type="button" className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            • List
          </button>
          <button type="button" className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            1. List
          </button>
          <button type="button" className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            ❝
          </button>
          <span className="mx-1 h-5 w-px bg-neutral-200" />
          <button
            type="button"
            className={btn(editor.isActive("link"))}
            onClick={() => {
              const prev = editor.getAttributes("link").href as string | undefined;
              const url = window.prompt("Link URL", prev ?? "https://");
              if (url === null) return;
              if (url === "") editor.chain().focus().unsetLink().run();
              else editor.chain().focus().setLink({ href: url }).run();
            }}
          >
            Link
          </button>
          <button type="button" className={btn(false)} onClick={() => fileInputRef.current?.click()}>
            🖼 Image
          </button>
          <span className="mx-1 h-5 w-px bg-neutral-200" />
          <label
            className={`${btn(editor.isActive("textStyle"))} relative flex cursor-pointer items-center`}
            title="Text colour"
          >
            <span
              className="font-semibold"
              style={{ color: (editor.getAttributes("textStyle").color as string) || undefined }}
            >
              A
            </span>
            <input
              type="color"
              aria-label="Text colour"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={(editor.getAttributes("textStyle").color as string) || "#000000"}
              onInput={(e) => editor.chain().focus().setColor(e.currentTarget.value).run()}
            />
          </label>
          {editor.getAttributes("textStyle").color && (
            <button
              type="button"
              className={btn(false)}
              title="Reset text colour"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              ✕
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <span className="ml-auto pl-1 text-sm text-neutral-400 lg:text-xs">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && <span className="text-red-600">Save failed</span>}
          </span>
        </div>
      </div>

      {/* Back link — matches reading view */}
      <Link
        href="/blog/admin"
        className="text-sm uppercase tracking-[0.18em] text-neutral-500 transition hover:text-black"
      >
        ← All posts
      </Link>

      {/* Header — matches reading view layout */}
      <header className="mt-8 sm:mt-10">
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.15em] text-white"
          style={{ backgroundColor: BRAND }}
        >
          Through The Visvine
        </span>
        {/* Editable title — styled identically to the public H1 */}
        <input
          type="text"
          value={titleValue}
          onChange={(e) => {
            setTitleValue(e.target.value);
            queueTitleSave(e.target.value);
          }}
          onBlur={() => {
            if (titleSaveTimer.current) {
              clearTimeout(titleSaveTimer.current);
              titleSaveTimer.current = null;
            }
            saveTitle(titleValue);
          }}
          placeholder="Untitled post"
          className="mt-4 w-full bg-transparent text-3xl font-medium tracking-tight leading-[1.05] placeholder:text-neutral-300 focus:outline-none sm:text-4xl md:text-5xl"
          style={{ color: "#2f7a3e" }}
        />
        <div className="mt-5 flex items-center gap-3">
          {author?.image && (
            <img
              src={author.image}
              alt={author.name ?? ""}
              className="w-11 h-11 rounded-2xl object-cover border-2 border-brand-green"
              referrerPolicy="no-referrer"
            />
          )}
          <div>
            {author?.name && (
              <p className="text-base font-normal text-neutral-600">Written by {author.name}</p>
            )}
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
              {publishedAt ? formatBlogDate(new Date(publishedAt), "Draft") : "Draft"}
            </p>
          </div>
        </div>
      </header>

      <hr className="mt-8 border-neutral-200" />

      <div className="mt-8">
        <EditorContent editor={editor} />
      </div>

      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: BRAND }}
        >
          Save now
        </button>
      </div>
    </div>
  );
}
