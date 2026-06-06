"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import { Extension, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import { ResizableImage, STARTER_KIT_CONFIG } from "@/lib/blog/tiptap";
import ResizableImageView from "@/features/blog/ResizableImageView";
import AdminBar from "@/features/blog/AdminBar";
import { BRAND } from "@/lib/brand";

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

export default function PostEditor({
  postId,
  number,
  initialTitle,
  initialContent,
  published,
}: {
  postId: string;
  number: number;
  initialTitle: string;
  initialContent: JSONContent;
  published: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    },
  });

  const save = useCallback(
    async (nextTitle: string) => {
      if (!editor) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/blog/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle, content: editor.getJSON() }),
        });
        if (!res.ok) throw new Error();
        const data: { slug?: string } = await res.json();
        setSaveState("saved");
        // Slug tracks the title while unpublished — keep the URL current.
        if (!published && data.slug) {
          window.history.replaceState(null, "", `/blog/${data.slug}`);
        }
      } catch {
        setSaveState("error");
      }
    },
    [editor, postId, published],
  );

  const queueSave = useCallback(
    (nextTitle: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(nextTitle), 1200);
    },
    [save],
  );

  // Autosave on content edits.
  useEffect(() => {
    if (!editor) return;
    const handler = () => queueSave(title);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, queueSave, title]);

  // Cancel any pending debounced save on unmount so navigating away mid-debounce
  // can't fire a stray PATCH / setState on a torn-down component.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  async function onUpload(file: File) {
    if (!editor) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/blog/upload", { method: "POST", body: form });
    if (!res.ok) {
      alert("Image upload failed");
      return;
    }
    const { url } = await res.json();
    editor.chain().focus().setImage({ src: url }).run();
  }

  if (!editor) return null;

  const btn = (active: boolean) =>
    `rounded px-2.5 py-1 text-sm ${active ? "bg-black text-white" : "hover:bg-neutral-100"}`;

  return (
    <div>
      {/* Combined toolbar: admin actions + formatting in one box. Full-width top bar on mobile, fixed box top-right on desktop. */}
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

      <p
        className="mb-2 text-lg font-semibold tracking-tight sm:text-xl"
        style={{ color: BRAND }}
      >
        Through The Visvine #{number}
      </p>

      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          queueSave(e.target.value);
        }}
        placeholder="Post title"
        className="mb-8 w-full text-4xl font-medium tracking-tight text-black outline-none sm:text-5xl"
        style={{ fontFamily: "var(--font-ginto)" }}
      />

      <EditorContent editor={editor} />

      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(title)}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: BRAND }}
        >
          Save now
        </button>
      </div>
    </div>
  );
}
