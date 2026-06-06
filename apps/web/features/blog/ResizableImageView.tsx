"use client";

import { useEffect, useRef } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { type Float, floatMargin, FLOAT_MAX_WIDTH } from "@/lib/blog/tiptap";

const FLOATS: { value: Float; label: string }[] = [
  { value: "left", label: "Wrap left" },
  { value: "none", label: "Center" },
  { value: "right", label: "Wrap right" },
];

export default function ResizableImageView(props: ReactNodeViewProps) {
  const { node, updateAttributes, selected, editor } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Handlers for an in-flight resize drag, tracked so we can detach them if the
  // component unmounts mid-drag (otherwise they leak and fire on a torn-down node).
  const dragHandlers = useRef<{
    onMove: (ev: PointerEvent) => void;
    onUp: () => void;
  } | null>(null);

  const float = (node.attrs.float as Float) ?? "none";
  const width = node.attrs.width as string | number | null;

  const wrapperStyle: React.CSSProperties = {};
  if (float === "left" || float === "right") {
    wrapperStyle.float = float;
    wrapperStyle.maxWidth = FLOAT_MAX_WIDTH;
    wrapperStyle.margin = floatMargin(float);
  } else {
    wrapperStyle.display = "block";
    wrapperStyle.margin = "1.5rem auto";
  }
  if (width) wrapperStyle.width = typeof width === "number" ? `${width}px` : width;

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = imgRef.current?.offsetWidth ?? 300;
    const editorWidth =
      editor.view.dom.clientWidth || imgRef.current?.parentElement?.clientWidth || 680;

    function onMove(ev: PointerEvent) {
      const next = Math.max(60, Math.min(editorWidth, startWidth + (ev.clientX - startX)));
      updateAttributes({ width: Math.round(next) });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragHandlers.current = null;
    }
    dragHandlers.current = { onMove, onUp };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Detach any drag listeners still attached if we unmount mid-drag.
  useEffect(
    () => () => {
      if (dragHandlers.current) {
        window.removeEventListener("pointermove", dragHandlers.current.onMove);
        window.removeEventListener("pointerup", dragHandlers.current.onUp);
        dragHandlers.current = null;
      }
    },
    [],
  );

  return (
    <NodeViewWrapper
      ref={containerRef}
      className="blog-img-wrapper"
      style={wrapperStyle}
      data-selected={selected ? "true" : undefined}
    >
      <div className="relative inline-block w-full">
        {/* drag handle: lets ProseMirror move the node within the document.
            A raw <img> is required — next/image can't live in a contenteditable. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ""}
          title={node.attrs.title ?? undefined}
          data-drag-handle
          draggable
          className="block w-full cursor-move rounded"
          style={{ height: "auto" }}
        />

        {selected && (
          <>
            {/* resize handle */}
            <span
              onPointerDown={startResize}
              className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-black shadow"
            />
            {/* float / alignment controls */}
            <div className="absolute -top-9 left-1/2 flex -translate-x-1/2 gap-1 rounded-md bg-black/85 px-1 py-1 text-xs text-white">
              {FLOATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => updateAttributes({ float: f.value })}
                  className={`rounded px-2 py-0.5 ${
                    float === f.value ? "bg-white text-black" : "hover:bg-white/20"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
