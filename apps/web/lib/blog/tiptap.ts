import { mergeAttributes } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TextStyle, Color } from "@tiptap/extension-text-style";

export type Float = "left" | "right" | "none";

/**
 * Shared float geometry — single source of truth for the margin/max-width a
 * floated image gets, used by both the static renderer (below) and the live
 * editor's React NodeView (ResizableImageView). Keep the emitted strings stable.
 */
export function floatMargin(float: "left" | "right"): string {
  return float === "left"
    ? "0.25rem 1.5rem 0.75rem 0"
    : "0.25rem 0 0.75rem 1.5rem";
}

export const FLOAT_MAX_WIDTH = "60%";

/**
 * StarterKit configuration shared by the editor and the read-only renderer, so
 * the two can't drift apart. The editor adds editor-only extensions on top.
 */
export const STARTER_KIT_CONFIG = {
  link: {
    openOnClick: false,
    HTMLAttributes: { rel: "noopener noreferrer nofollow" },
  },
} satisfies Parameters<typeof StarterKit.configure>[0];

/**
 * Image extension with `width` and `float` attributes, rendered into inline
 * `style` so the server (static renderer) and the live editor produce identical
 * markup. Text wrap around floated images is handled natively by the browser.
 *
 * The editor attaches a React NodeView on top of this (see PostEditor) to add
 * resize handles; that part is client-only and must not live here.
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        // rendered via the node-level `style` below, not as its own attribute
        renderHTML: () => ({}),
        parseHTML: (el: HTMLElement) =>
          el.style.width || el.getAttribute("width") || null,
      },
      float: {
        default: "none",
        renderHTML: () => ({}),
        parseHTML: (el: HTMLElement) => el.style.float || "none",
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const width = node.attrs.width as string | number | null;
    const float = node.attrs.float as Float | null;
    const styles: string[] = [];
    if (width) {
      styles.push(`width: ${typeof width === "number" ? `${width}px` : width}`);
      styles.push("height: auto");
    }
    if (float === "left" || float === "right") {
      styles.push(`float: ${float}`);
      styles.push(`margin: ${floatMargin(float)}`);
      styles.push(`max-width: ${FLOAT_MAX_WIDTH}`);
    }
    const style = styles.join("; ");
    return [
      "img",
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        style ? { style } : {},
      ),
    ];
  },
});

/**
 * Extensions shared by the editor and the read-only server renderer. Keep this
 * server-safe — no `@tiptap/react` imports.
 */
export const extensions: Extensions = [
  StarterKit.configure(STARTER_KIT_CONFIG),
  ResizableImage.configure({
    inline: false,
    HTMLAttributes: { class: "blog-img" },
  }),
  TextStyle,
  Color,
];

/** An empty TipTap document, used for brand-new drafts. */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };
