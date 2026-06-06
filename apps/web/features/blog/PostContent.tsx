import { renderToReactElement } from "@tiptap/static-renderer";
import type { JSONContent } from "@tiptap/core";
import { extensions } from "@/lib/blog/tiptap";

/**
 * Read-only render of a post's TipTap JSON, server-side. Ships no editor JS to
 * visitors. Uses the same `extensions` as the editor so output is identical.
 */
export default function PostContent({ content }: { content: JSONContent }) {
  // Guard against malformed/empty rows (e.g. the DB default `{}`): the renderer
  // throws on anything that isn't a TipTap `doc`, which would 500 the page.
  if (!content || (content as { type?: string }).type !== "doc") {
    return <div className="blog-prose" />;
  }
  return (
    <div className="blog-prose">
      {renderToReactElement({ content, extensions })}
    </div>
  );
}
