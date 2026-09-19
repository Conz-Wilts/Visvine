import type { KeyboardEvent } from "react";
import { END_ROW_H } from "@/features/shared/components/layout/railRow";

/**
 * The search at the head of a rail panel (the space switcher, Create). It is a
 * row, not a box: edge to edge, one rail cell tall so it sits level with the
 * space at the rail's head, and held off the list by one hairline — the same
 * line the rail draws between its own bands.
 */
export default function PanelSearch({
  placeholder,
  value,
  onChange,
  onKeyDown,
  tabbable,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  tabbable: boolean;
}) {
  return (
    <label
      className="flex flex-shrink-0 cursor-text items-center gap-3 border-b px-5"
      style={{ height: END_ROW_H, borderBottomColor: "var(--shell-border, #e5e7eb)" }}
    >
      <svg className="h-5 w-5 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        tabIndex={tabbable ? 0 : -1}
        className="min-w-0 flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
      />
    </label>
  );
}
